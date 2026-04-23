import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest

# ── Stub heavy deps before importing router ───────────────────────────────────
_stub_croniter = types.ModuleType("croniter")


class _CroniterCls:
    def __init__(self, expr, *a, **kw):
        if expr == "INVALID":
            raise ValueError("bad cron")

    def get_prev(self, type_):
        from datetime import datetime, timedelta
        return datetime.now() - timedelta(seconds=30)


_stub_croniter.croniter = _CroniterCls
sys.modules.setdefault("croniter", _stub_croniter)


# ── Import after stubs ────────────────────────────────────────────────────────
from app.gateway.routers.scheduled_tasks import (  # noqa: E402
    _validate_cron,
    _read_config,
    _write_config,
    TaskConfig,
    CreateTaskRequest,
)


def test_validate_cron_valid():
    _validate_cron("0 9 * * *")  # should not raise


def test_validate_cron_invalid():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _validate_cron("INVALID")
    assert exc_info.value.status_code == 422


def test_read_config_missing(tmp_path):
    assert _read_config(tmp_path / "nonexistent") is None


def test_write_and_read_config(tmp_path):
    task_dir = tmp_path / "abc123"
    task_dir.mkdir()
    config = TaskConfig(
        id="abc123",
        name="Test",
        description="desc",
        cron="0 9 * * *",
        enabled=True,
        created_at="2026-04-23T09:00:00",
        last_run_at=None,
    )
    _write_config(task_dir, config)
    loaded = _read_config(task_dir)
    assert loaded is not None
    assert loaded.id == "abc123"
    assert loaded.name == "Test"
    assert loaded.enabled is True


def test_write_config_produces_valid_json(tmp_path):
    task_dir = tmp_path / "xyz"
    task_dir.mkdir()
    config = TaskConfig(
        id="xyz",
        name="名称",
        description="",
        cron="*/5 * * * *",
        enabled=False,
        created_at="2026-04-23T00:00:00",
        last_run_at="2026-04-23T01:00:00",
    )
    _write_config(task_dir, config)
    data = json.loads((task_dir / "config.json").read_text(encoding="utf-8"))
    assert data["name"] == "名称"
    assert data["enabled"] is False
    assert data["last_run_at"] == "2026-04-23T01:00:00"


def test_create_task_request_validation():
    req = CreateTaskRequest(name="Task", cron="0 9 * * *", script_content="print('hi')")
    assert req.name == "Task"


def test_create_task_request_empty_name():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CreateTaskRequest(name="", cron="0 9 * * *", script_content="x")


def test_create_task_request_max_length():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CreateTaskRequest(name="a" * 101, cron="0 9 * * *", script_content="x")


def test_task_config_defaults():
    config = TaskConfig(
        id="t1",
        name="test",
        cron="0 0 * * *",
        enabled=True,
        created_at="2026-04-23T00:00:00",
    )
    assert config.description == ""
    assert config.last_run_at is None


def test_dispatcher_script_exists():
    script = Path(__file__).resolve().parents[1] / "scripts" / "scheduled_task_dispatcher.py"
    assert script.exists(), f"Dispatcher script not found at {script}"


def test_paths_scheduled_tasks_dir(tmp_path):
    from deerflow.config.paths import Paths
    p = Paths(base_dir=tmp_path)
    assert p.scheduled_tasks_dir == tmp_path / "scheduled_tasks"


def test_paths_scheduled_task_dir(tmp_path):
    from deerflow.config.paths import Paths
    p = Paths(base_dir=tmp_path)
    assert p.scheduled_task_dir("abc123") == tmp_path / "scheduled_tasks" / "abc123"
