from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ktoolbox.action import create_job_from_post
from ktoolbox.api.model import Attachment, File, Post
from ktoolbox.configuration import config
from ktoolbox.webui import create_app
from ktoolbox.webui.config import build_config_schema, save_config_values


def test_webui_config_schema_reads_docstring():
    schema = build_config_schema()
    count_field = next(field for field in schema["fields"] if field["path"] == "job.count")

    assert count_field["env"] == "KTOOLBOX_JOB__COUNT"
    assert "并发下载" in count_field["description"]
    assert count_field["type"] == "int"


def test_webui_save_config_values_writes_dotenv(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    old_count = config.job.count
    try:
        schema = save_config_values({"job.count": 7})

        assert schema["envPath"] == ".env"
        assert Path(".env").read_text(encoding="utf-8") == "KTOOLBOX_JOB__COUNT=7\n"
        assert config.job.count == 7
    finally:
        config.job.count = old_count


def test_webui_api_requires_token_and_creates_task(tmp_path):
    client = TestClient(create_app(token="secret", state_path=tmp_path / "state.json"))

    assert client.get("/api/config").status_code == 401

    authed = {"X-KToolBox-Token": "secret"}
    response = client.post(
        "/api/tasks",
        headers=authed,
        json={
            "kind": "post_download",
            "title": "Example post",
            "params": {"url": "https://kemono.cr/fanbox/user/1/post/2", "path": "."},
        },
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Example post"
    assert client.get("/api/tasks", headers=authed).json()[0]["kind"] == "post_download"


def test_webui_serves_spa_routes(tmp_path):
    client = TestClient(create_app(token="secret", state_path=tmp_path / "state.json"))

    response = client.get("/artist-sync?token=secret")

    assert response.status_code == 200
    assert "KToolBox WebUI" in response.text


@pytest.mark.asyncio
async def test_create_job_from_post_dry_run_has_no_side_effects(tmp_path):
    post = Post(
        id="123",
        user="456",
        service="fanbox",
        title="Preview Only",
        file=File(name="cover.jpg", path="/data/cover.jpg"),
        attachments=[Attachment(name="a.png", path="/data/a.png")],
    )
    post_path = tmp_path / "post"

    jobs = await create_job_from_post(post, post_path, materialize=False)

    assert len(jobs) == 2
    assert not post_path.exists()
