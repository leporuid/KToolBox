from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set
from uuid import uuid4

from pydantic import BaseModel, Field

from ktoolbox.action import create_job_from_creator, create_job_from_post, generate_post_path_name
from ktoolbox.action import search_creator as search_creator_action
from ktoolbox.api.model import Post
from ktoolbox.api.posts import get_post as get_post_api
from ktoolbox.configuration import config
from ktoolbox.job import Job, JobRunner
from ktoolbox.utils import parse_webpage_url

__all__ = [
    "EditableJob",
    "WebTask",
    "TaskQueueManager",
]


TaskKind = Literal["post_download", "creator_sync"]
TaskStatus = Literal["queued", "running", "completed", "failed", "cancelled", "paused"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class EditableJob(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    enabled: bool = True
    path: str
    alt_filename: Optional[str] = None
    server_path: str
    type: Optional[str] = None
    post_title: Optional[str] = None
    status: str = "waiting"
    error: Optional[str] = None
    post: Optional[Dict[str, Any]] = None


class WebTask(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    kind: TaskKind
    title: str
    status: TaskStatus = "queued"
    params: Dict[str, Any] = Field(default_factory=dict)
    jobs: List[EditableJob] = Field(default_factory=list)
    logs: List[str] = Field(default_factory=list)
    total: int = 0
    completed: int = 0
    failed: int = 0
    order: int = 0
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None


class WebUIState(BaseModel):
    tasks: List[WebTask] = Field(default_factory=list)


class TaskQueueManager:
    def __init__(self, state_path: Optional[Path] = None):
        self.state_path = state_path or Path(".ktoolbox") / "webui_state.json"
        self.state = self._load()
        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    def _load(self) -> WebUIState:
        if not self.state_path.is_file():
            return WebUIState()
        try:
            return WebUIState.model_validate_json(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return WebUIState()

    def _save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            self.state.model_dump_json(indent=config.json_dump_indent),
            encoding="utf-8",
        )

    def list_tasks(self) -> List[WebTask]:
        return sorted(self.state.tasks, key=lambda task: task.order)

    def get_task(self, task_id: str) -> WebTask:
        for task in self.state.tasks:
            if task.id == task_id:
                return task
        raise KeyError(task_id)

    async def create_task(self, kind: TaskKind, params: Dict[str, Any], title: Optional[str] = None) -> WebTask:
        async with self._lock:
            next_order = max([task.order for task in self.state.tasks], default=-1) + 1
            task = WebTask(
                kind=kind,
                title=title or self._default_title(kind, params),
                params=params,
                order=next_order,
            )
            task.logs.append("任务已创建")
            self.state.tasks.append(task)
            self._save()
            return task

    async def update_task(
            self,
            task_id: str,
            params: Optional[Dict[str, Any]] = None,
            jobs: Optional[List[Dict[str, Any]]] = None,
            title: Optional[str] = None,
            status: Optional[TaskStatus] = None,
    ) -> WebTask:
        async with self._lock:
            task = self.get_task(task_id)
            if task.status == "running":
                raise ValueError("Running tasks cannot be edited")
            if params is not None:
                task.params = params
            if jobs is not None:
                task.jobs = [EditableJob.model_validate(job) for job in jobs]
                task.total = len([job for job in task.jobs if job.enabled])
            if title is not None:
                task.title = title
            if status is not None:
                task.status = status
            task.updated_at = _now()
            task.logs.append("任务已更新")
            self._save()
            return task

    async def delete_task(self, task_id: str) -> None:
        async with self._lock:
            task = self.get_task(task_id)
            if task.status == "running":
                await self.cancel_task(task_id)
            self.state.tasks = [item for item in self.state.tasks if item.id != task_id]
            self._save()

    async def duplicate_task(self, task_id: str) -> WebTask:
        async with self._lock:
            source = self.get_task(task_id)
            duplicate = source.model_copy(deep=True)
            duplicate.id = uuid4().hex
            duplicate.title = source.title + " 副本"
            duplicate.status = "queued"
            duplicate.completed = 0
            duplicate.failed = 0
            duplicate.started_at = None
            duplicate.finished_at = None
            duplicate.error = None
            duplicate.created_at = _now()
            duplicate.updated_at = _now()
            duplicate.order = max([task.order for task in self.state.tasks], default=-1) + 1
            duplicate.logs = ["任务已复制"]
            self.state.tasks.append(duplicate)
            self._save()
            return duplicate

    async def reorder_tasks(self, task_ids: List[str]) -> List[WebTask]:
        async with self._lock:
            order_by_id = {task_id: index for index, task_id in enumerate(task_ids)}
            for task in self.state.tasks:
                if task.id in order_by_id:
                    task.order = order_by_id[task.id]
            self._save()
            return self.list_tasks()

    async def materialize_task(self, task_id: str) -> WebTask:
        task = self.get_task(task_id)
        if task.status == "running":
            raise ValueError("Running tasks cannot be materialized")
        task.logs.append("开始解析下载任务")
        try:
            jobs = await self._build_jobs(task)
        except Exception as exc:
            task.error = f"{type(exc).__name__}: {exc}"
            task.status = "failed"
            task.finished_at = _now()
            task.logs.append(task.error)
            self._save()
            return task

        task.jobs = [self._editable_job_from_job(job) for job in jobs]
        task.total = len([job for job in task.jobs if job.enabled])
        task.completed = 0
        task.failed = 0
        task.error = None
        task.status = "queued"
        task.updated_at = _now()
        task.logs.append(f"已生成 {task.total} 个文件任务")
        self._save()
        return task

    async def start_task(self, task_id: str) -> WebTask:
        task = self.get_task(task_id)
        if task.status == "running":
            return task
        if task_id in self._running_tasks and not self._running_tasks[task_id].done():
            return task
        task.status = "running"
        task.started_at = _now()
        task.finished_at = None
        task.error = None
        task.logs.append("任务开始运行")
        self._save()
        self._running_tasks[task_id] = asyncio.create_task(self._run_task(task_id))
        return task

    async def start_all(self) -> List[WebTask]:
        for task in self.list_tasks():
            if task.status in ("queued", "paused", "failed", "cancelled"):
                await self.start_task(task.id)
        return self.list_tasks()

    async def cancel_task(self, task_id: str) -> WebTask:
        task = self.get_task(task_id)
        running_task = self._running_tasks.get(task_id)
        if running_task and not running_task.done():
            running_task.cancel()
        task.status = "cancelled"
        task.finished_at = _now()
        task.updated_at = _now()
        task.logs.append("任务已取消")
        self._save()
        return task

    async def _run_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        try:
            if not task.jobs:
                await self.materialize_task(task.id)
                task = self.get_task(task.id)
                task.status = "running"
                task.started_at = task.started_at or _now()

            enabled_jobs = [job for job in task.jobs if job.enabled]
            task.total = len(enabled_jobs)
            task.completed = 0
            task.failed = 0
            self._save()

            runner = JobRunner(
                job_list=[self._job_from_editable(job) for job in enabled_jobs],
                progress=False,
                centralized_progress=False,
            )
            failed = await runner.start()
            task.failed = failed
            task.completed = max(0, task.total - failed)
            task.status = "failed" if failed else "completed"
            task.finished_at = _now()
            task.updated_at = _now()
            task.logs.append("任务运行完成" if not failed else f"{failed} 个文件失败")
        except asyncio.CancelledError:
            task.status = "cancelled"
            task.finished_at = _now()
            task.updated_at = _now()
            task.logs.append("任务运行被取消")
        except Exception as exc:
            task.status = "failed"
            task.error = f"{type(exc).__name__}: {exc}"
            task.finished_at = _now()
            task.updated_at = _now()
            task.logs.append(task.error)
        finally:
            self._save()

    async def _build_jobs(self, task: WebTask) -> List[Job]:
        if task.kind == "post_download":
            return await self._build_post_jobs(task.params)
        if task.kind == "creator_sync":
            return await self._build_creator_jobs(task.params)
        raise ValueError(f"Unsupported task kind: {task.kind}")

    async def _build_post_jobs(self, params: Dict[str, Any]) -> List[Job]:
        service = params.get("service") or None
        creator_id = params.get("creator_id") or None
        post_id = params.get("post_id") or None
        revision_id = params.get("revision_id") or None
        if params.get("url"):
            service, creator_id, post_id, revision_id = parse_webpage_url(params["url"])
        if not all([service, creator_id, post_id]):
            raise ValueError("Post task requires url or service, creator_id and post_id")

        ret = await get_post_api(
            service=service,
            creator_id=creator_id,
            post_id=post_id,
            revision_id=revision_id,
        )
        if not ret:
            raise ValueError(ret.message)
        post = ret.data.post
        post_path = Path(params.get("path") or ".") / generate_post_path_name(post)
        if revision_id:
            post_path = post_path / "revision" / str(revision_id)
        return await create_job_from_post(
            post=post,
            post_path=post_path,
            dump_post_data=bool(params.get("dump_post_data", True)),
            materialize=False,
        )

    async def _build_creator_jobs(self, params: Dict[str, Any]) -> List[Job]:
        service = params.get("service") or None
        creator_id = params.get("creator_id") or None
        if params.get("url"):
            service, creator_id, _, _ = parse_webpage_url(params["url"])
        if not all([service, creator_id]):
            raise ValueError("Creator task requires url or service and creator_id")

        creator_name = creator_id
        creator_ret = await search_creator_action(id=creator_id, service=service)
        if creator_ret:
            creator = next(creator_ret.data, None)
            if creator:
                creator_name = creator.name

        base_path = Path(params.get("path") or ".") / creator_name
        keywords = self._string_set(params.get("keywords"))
        keywords_exclude = self._string_set(params.get("keywords_exclude"))
        ret = await create_job_from_creator(
            service=service,
            creator_id=creator_id,
            path=base_path,
            all_pages=not params.get("length"),
            offset=int(params.get("offset") or 0),
            length=self._optional_int(params.get("length")),
            save_creator_indices=bool(params.get("save_creator_indices", False)),
            mix_posts=params.get("mix_posts"),
            start_time=self._optional_date(params.get("start_time")),
            end_time=self._optional_date(params.get("end_time")),
            keywords=keywords,
            keywords_exclude=keywords_exclude,
            materialize=False,
        )
        if not ret:
            raise ValueError(ret.message)
        return ret.data

    @staticmethod
    def _optional_int(value: Any) -> Optional[int]:
        if value in (None, ""):
            return None
        return int(value)

    @staticmethod
    def _optional_date(value: Any) -> Optional[datetime]:
        if value in (None, ""):
            return None
        return datetime.strptime(str(value), "%Y-%m-%d")

    @staticmethod
    def _string_set(value: Any) -> Optional[Set[str]]:
        if value in (None, ""):
            return None
        if isinstance(value, str):
            return {item.strip() for item in value.split(",") if item.strip()}
        return {str(item) for item in value}

    @staticmethod
    def _editable_job_from_job(job: Job) -> EditableJob:
        post_title = job.post.title if job.post else None
        post_data = job.post.model_dump(mode="json") if job.post else None
        return EditableJob(
            path=str(job.path),
            alt_filename=job.alt_filename,
            server_path=job.server_path,
            type=str(job.type) if job.type else None,
            post_title=post_title,
            post=post_data,
        )

    @staticmethod
    def _job_from_editable(job: EditableJob) -> Job:
        post = Post.model_validate(job.post) if job.post else None
        return Job(
            path=Path(job.path),
            alt_filename=job.alt_filename,
            server_path=job.server_path,
            type=job.type,
            post=post,
        )

    @staticmethod
    def _default_title(kind: TaskKind, params: Dict[str, Any]) -> str:
        if kind == "post_download":
            return params.get("url") or "Post 下载任务"
        if kind == "creator_sync":
            return params.get("url") or "作者同步任务"
        return "下载任务"

    def export_json(self) -> str:
        return json.dumps(self.state.model_dump(mode="json"), ensure_ascii=False, indent=2)
