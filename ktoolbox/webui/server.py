from __future__ import annotations

import secrets
import socket
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.staticfiles import StaticFiles

from ktoolbox.webui.config import ConfigValidationError, build_config_schema, save_config_values
from ktoolbox.webui.tasks import EditableJob, TaskQueueManager, WebTask

__all__ = ["create_app", "run_webui"]


class ConfigSaveRequest(BaseModel):
    values: Dict[str, Any]
    language: str = "zh"


class TaskCreateRequest(BaseModel):
    kind: str
    params: Dict[str, Any]
    title: Optional[str] = None


class TaskUpdateRequest(BaseModel):
    params: Optional[Dict[str, Any]] = None
    jobs: Optional[List[EditableJob]] = None
    title: Optional[str] = None
    status: Optional[str] = None


class ReorderRequest(BaseModel):
    task_ids: List[str]


def create_app(
        *,
        token: str,
        state_path: Optional[Path] = None,
        no_auth: bool = False,
) -> FastAPI:
    app = FastAPI(title="KToolBox WebUI", version="1")
    manager = TaskQueueManager(state_path=state_path)

    async def verify_token(
            request: Request,
            x_ktoolbox_token: Optional[str] = Header(None),
            query_token: Optional[str] = Query(None, alias="token"),
    ) -> None:
        if no_auth:
            return
        supplied = x_ktoolbox_token or query_token or request.cookies.get("ktoolbox_token")
        if not supplied or not secrets.compare_digest(supplied, token):
            raise HTTPException(status_code=401, detail="Invalid or missing KToolBox WebUI token")

    @app.get("/api/health")
    async def health() -> Dict[str, Any]:
        return {"ok": True, "auth": not no_auth}

    @app.get("/api/config", dependencies=[Depends(verify_token)])
    async def get_config(language: str = "zh") -> Dict[str, Any]:
        return build_config_schema(language=language)

    @app.put("/api/config", dependencies=[Depends(verify_token)])
    async def save_config(payload: ConfigSaveRequest) -> Dict[str, Any]:
        try:
            return save_config_values(payload.values, language=payload.language)
        except ConfigValidationError as exc:
            return JSONResponse(status_code=422, content={"detail": exc.errors})

    @app.get("/api/tasks", dependencies=[Depends(verify_token)])
    async def list_tasks() -> List[WebTask]:
        return manager.list_tasks()

    @app.post("/api/tasks", dependencies=[Depends(verify_token)])
    async def create_task(payload: TaskCreateRequest) -> WebTask:
        if payload.kind not in ("post_download", "creator_sync"):
            raise HTTPException(status_code=422, detail="Unsupported task kind")
        return await manager.create_task(payload.kind, payload.params, payload.title)

    @app.patch("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
    async def update_task(task_id: str, payload: TaskUpdateRequest) -> WebTask:
        try:
            jobs = [job.model_dump(mode="json") for job in payload.jobs] if payload.jobs is not None else None
            return await manager.update_task(
                task_id,
                params=payload.params,
                jobs=jobs,
                title=payload.title,
                status=payload.status,
            )
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @app.delete("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
    async def delete_task(task_id: str) -> Dict[str, bool]:
        try:
            await manager.delete_task(task_id)
            return {"ok": True}
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")

    @app.post("/api/tasks/{task_id}/duplicate", dependencies=[Depends(verify_token)])
    async def duplicate_task(task_id: str) -> WebTask:
        try:
            return await manager.duplicate_task(task_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")

    @app.post("/api/tasks/reorder", dependencies=[Depends(verify_token)])
    async def reorder_tasks(payload: ReorderRequest) -> List[WebTask]:
        return await manager.reorder_tasks(payload.task_ids)

    @app.post("/api/tasks/{task_id}/materialize", dependencies=[Depends(verify_token)])
    async def materialize_task(task_id: str) -> WebTask:
        try:
            return await manager.materialize_task(task_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @app.post("/api/tasks/{task_id}/start", dependencies=[Depends(verify_token)])
    async def start_task(task_id: str) -> WebTask:
        try:
            return await manager.start_task(task_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")

    @app.post("/api/tasks/start-all", dependencies=[Depends(verify_token)])
    async def start_all() -> List[WebTask]:
        return await manager.start_all()

    @app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(verify_token)])
    async def cancel_task(task_id: str) -> WebTask:
        try:
            return await manager.cancel_task(task_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Task not found")

    static_dir = Path(__file__).parent / "static"
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str = ""):
        target = static_dir / path
        if path and target.is_file() and _is_relative_to(target.resolve(), static_dir.resolve()):
            return FileResponse(target)
        index = static_dir / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "WebUI assets are not built. Run `npm install && npm run build` in the webui directory."
            },
        )

    return app


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _display_urls(host: str, port: int, token: str) -> List[str]:
    local_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    urls = [f"http://{local_host}:{port}/?token={token}"]
    if host == "0.0.0.0":
        try:
            hostname = socket.gethostname()
            urls.append(f"http://{hostname}.local:{port}/?token={token}")
        except OSError:
            pass
    return urls


def run_webui(
        host: str = "0.0.0.0",
        port: int = 8789,
        token: Optional[str] = None,
        no_auth: bool = False,
) -> None:
    token = token or secrets.token_urlsafe(24)
    print("KToolBox WebUI is starting.")
    for url in _display_urls(host, port, token):
        print(f"Open: {url}")
    if host == "0.0.0.0" and not no_auth:
        print("LAN access is enabled. Keep the token private.")
    app = create_app(token=token, no_auth=no_auth)
    uvicorn.run(app, host=host, port=port)
