# Scheduled Tasks Feature — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a scheduled task management system — users create tasks via conversation, a dispatcher runs them via system crontab, and a new sidebar menu lets users start/stop/view results.

**Architecture:** File-based store at `.deer-flow/scheduled_tasks/{task_id}/`; a single crontab dispatcher checks enabled flags every minute; a new FastAPI router handles CRUD; a new LangGraph tool returns preview JSON; the frontend renders a confirmation card in chat and a management page in the sidebar.

**Tech Stack:** Python `croniter` (new dep), `pathlib` / `subprocess` / `fcntl`, FastAPI + Pydantic v2, Next.js App Router, TanStack Query, Shadcn UI, Lucide icons.

---

## Task 1: Add `croniter` dependency

**Files:**
- Modify: `backend/packages/harness/pyproject.toml`

**Step 1: Open pyproject.toml and add croniter**

In `backend/packages/harness/pyproject.toml`, find the `dependencies` list and add `"croniter>=1.4.0"` after any existing entry.

```toml
    "croniter>=1.4.0",
```

**Step 2: Sync deps**

```bash
cd backend && uv sync
```

Expected: no error, `croniter` appears in lock file.

**Step 3: Verify import**

```bash
cd backend && uv run python -c "from croniter import croniter; print('ok')"
```

Expected: prints `ok`.

**Step 4: Commit**

```bash
git add backend/packages/harness/pyproject.toml backend/uv.lock
git commit -m "chore(deps): add croniter for scheduled task dispatcher"
```

---

## Task 2: Add `scheduled_tasks_dir` property to `Paths`

**Files:**
- Modify: `backend/packages/harness/deerflow/config/paths.py`

**Step 1: Add property after `agents_dir`**

In `backend/packages/harness/deerflow/config/paths.py`, after the `agents_dir` property, add:

```python
@property
def scheduled_tasks_dir(self) -> Path:
    """Root directory for scheduled tasks: `{base_dir}/scheduled_tasks/`."""
    return self.base_dir / "scheduled_tasks"

def scheduled_task_dir(self, task_id: str) -> Path:
    """Directory for a specific scheduled task: `{base_dir}/scheduled_tasks/{task_id}/`."""
    return self.scheduled_tasks_dir / task_id
```

**Step 2: Run existing tests to confirm no regression**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v -x
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add backend/packages/harness/deerflow/config/paths.py
git commit -m "feat(paths): add scheduled_tasks_dir and scheduled_task_dir helpers"
```

---

## Task 3: Write the dispatcher script

**Files:**
- Create: `backend/scripts/scheduled_task_dispatcher.py`

**Step 1: Create the script**

```python
#!/usr/bin/env python3
"""Scheduled task dispatcher — run once per minute via crontab.

Reads all task configs in .deer-flow/scheduled_tasks/*/config.json,
checks enabled flag and cron schedule, and runs due tasks.
"""
import fcntl
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ── Resolve project root ──────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPT_DIR.parent  # backend/
_PROJECT_ROOT = _BACKEND_DIR.parent  # repo root

# Add backend to sys.path so we can import deerflow
sys.path.insert(0, str(_BACKEND_DIR))

from deerflow.config.paths import get_paths  # noqa: E402

TASK_TIMEOUT = 600  # seconds (10 minutes)


def _load_config(config_path: Path) -> dict | None:
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _is_due(cron_expr: str, now: datetime) -> bool:
    from croniter import croniter

    try:
        it = croniter(cron_expr, now)
        prev = it.get_prev(datetime)
        # Due if previous fire time is within the last 60 seconds
        return (now - prev).total_seconds() < 60
    except Exception:
        return False


def _run_task(task_id: str, task_dir: Path, config: dict) -> None:
    script_path = task_dir / "script.py"
    if not script_path.exists():
        print(f"[dispatcher] script not found for task {task_id}", flush=True)
        return

    lock_path = task_dir / ".lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"[dispatcher] task {task_id} already running, skipping", flush=True)
        lock_file.close()
        return

    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = task_dir / "outputs" / run_ts
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / "stdout.log"

    start = time.time()
    exit_code = 0
    try:
        with open(log_path, "w", encoding="utf-8") as log:
            proc = subprocess.run(
                [sys.executable, str(script_path)],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=TASK_TIMEOUT,
                cwd=str(task_dir),
            )
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        exit_code = 124
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"\n[dispatcher] timed out after {TASK_TIMEOUT}s\n")
    except Exception as exc:
        exit_code = 1
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"\n[dispatcher] error: {exc}\n")
    finally:
        fcntl.flock(lock_file, fcntl.LOCK_UN)
        lock_file.close()
        lock_path.unlink(missing_ok=True)

    duration = round(time.time() - start, 2)
    last_run = {
        "run_id": run_ts,
        "exit_code": exit_code,
        "duration_seconds": duration,
        "output_dir": run_ts,
    }
    (task_dir / "last_run.json").write_text(
        json.dumps(last_run, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # Update last_run_at in config
    config["last_run_at"] = datetime.now().isoformat()
    config_path = task_dir / "config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[dispatcher] task {task_id} exit_code={exit_code} duration={duration}s",
        flush=True,
    )


def main() -> None:
    tasks_dir = get_paths().scheduled_tasks_dir
    if not tasks_dir.exists():
        return

    now = datetime.now()
    for task_dir in tasks_dir.iterdir():
        if not task_dir.is_dir():
            continue
        config_path = task_dir / "config.json"
        config = _load_config(config_path)
        if config is None:
            continue
        if not config.get("enabled", False):
            continue
        cron = config.get("cron", "")
        if not cron or not _is_due(cron, now):
            continue
        task_id = config.get("id", task_dir.name)
        print(f"[dispatcher] firing task {task_id} ({config.get('name', '')})", flush=True)
        _run_task(task_id, task_dir, config)


if __name__ == "__main__":
    main()
```

**Step 2: Make script executable**

```bash
chmod +x backend/scripts/scheduled_task_dispatcher.py
```

**Step 3: Verify script runs without error when no tasks exist**

```bash
cd backend && uv run python scripts/scheduled_task_dispatcher.py
```

Expected: no output (tasks dir doesn't exist yet), exit 0.

**Step 4: Commit**

```bash
git add backend/scripts/scheduled_task_dispatcher.py
git commit -m "feat(scheduler): add crontab dispatcher script"
```

---

## Task 4: Create the FastAPI router for scheduled tasks

**Files:**
- Create: `backend/app/gateway/routers/scheduled_tasks.py`

**Step 1: Write the router**

```python
import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scheduled-tasks", tags=["scheduled-tasks"])

_DISPATCHER_SCRIPT = (
    Path(__file__).resolve().parents[4] / "scripts" / "scheduled_task_dispatcher.py"
)


# ── Pydantic models ───────────────────────────────────────────────────────────

class TaskConfig(BaseModel):
    id: str
    name: str
    description: str = ""
    cron: str
    enabled: bool = True
    created_at: str
    last_run_at: str | None = None


class CreateTaskRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    cron: str = Field(..., min_length=1)
    script_content: str = Field(..., min_length=1)


class UpdateTaskRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    cron: str | None = None


class RunRecord(BaseModel):
    run_id: str
    exit_code: int
    duration_seconds: float
    output_dir: str


class TaskListResponse(BaseModel):
    tasks: list[TaskConfig]


class TaskDetailResponse(BaseModel):
    task: TaskConfig
    last_run: RunRecord | None = None
    script_content: str = ""


class RunListResponse(BaseModel):
    runs: list[RunRecord]


class OutputFileItem(BaseModel):
    name: str
    size: int


class RunOutputResponse(BaseModel):
    files: list[OutputFileItem]


class CrontabStatusResponse(BaseModel):
    registered: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def _validate_cron(cron: str) -> None:
    try:
        from croniter import croniter
        croniter(cron)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {exc}") from exc


def _read_config(task_dir: Path) -> TaskConfig | None:
    config_path = task_dir / "config.json"
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return TaskConfig(**data)
    except Exception:
        return None


def _write_config(task_dir: Path, config: TaskConfig) -> None:
    config_path = task_dir / "config.json"
    config_path.write_text(
        json.dumps(config.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _ensure_crontab() -> None:
    """Append dispatcher to user crontab if not already registered."""
    dispatcher = str(_DISPATCHER_SCRIPT)
    python = sys.executable
    entry = f"* * * * * {python} {dispatcher} >> {get_paths().base_dir}/dispatcher.log 2>&1"
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""
        if dispatcher in existing:
            return
        new_crontab = existing.rstrip("\n") + "\n" + entry + "\n"
        subprocess.run(["crontab", "-"], input=new_crontab, text=True, check=True)
        logger.info("Registered dispatcher in crontab")
    except Exception:
        logger.warning("Could not auto-register dispatcher in crontab", exc_info=True)


def _remove_from_crontab() -> None:
    """Remove dispatcher from crontab when all tasks are deleted."""
    dispatcher = str(_DISPATCHER_SCRIPT)
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if result.returncode != 0 or dispatcher not in result.stdout:
            return
        lines = [l for l in result.stdout.splitlines() if dispatcher not in l]
        new_crontab = "\n".join(lines) + "\n"
        subprocess.run(["crontab", "-"], input=new_crontab, text=True, check=True)
        logger.info("Removed dispatcher from crontab (no tasks remaining)")
    except Exception:
        logger.warning("Could not remove dispatcher from crontab", exc_info=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/crontab-status", response_model=CrontabStatusResponse)
async def crontab_status() -> CrontabStatusResponse:
    dispatcher = str(_DISPATCHER_SCRIPT)
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        registered = result.returncode == 0 and dispatcher in result.stdout
    except Exception:
        registered = False
    return CrontabStatusResponse(registered=registered)


@router.get("", response_model=TaskListResponse)
async def list_tasks() -> TaskListResponse:
    tasks_dir = get_paths().scheduled_tasks_dir
    tasks: list[TaskConfig] = []
    if tasks_dir.exists():
        for task_dir in sorted(tasks_dir.iterdir()):
            if task_dir.is_dir():
                config = _read_config(task_dir)
                if config:
                    tasks.append(config)
    return TaskListResponse(tasks=tasks)


@router.post("", response_model=TaskConfig, status_code=201)
async def create_task(request: CreateTaskRequest) -> TaskConfig:
    _validate_cron(request.cron)
    import uuid
    task_id = uuid.uuid4().hex[:12]
    task_dir = get_paths().scheduled_task_dir(task_id)
    task_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "outputs").mkdir(exist_ok=True)

    config = TaskConfig(
        id=task_id,
        name=request.name,
        description=request.description,
        cron=request.cron,
        enabled=True,
        created_at=datetime.now().isoformat(),
        last_run_at=None,
    )
    _write_config(task_dir, config)
    (task_dir / "script.py").write_text(request.script_content, encoding="utf-8")
    _ensure_crontab()
    return config


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task(task_id: str) -> TaskDetailResponse:
    task_dir = get_paths().scheduled_task_dir(task_id)
    config = _read_config(task_dir)
    if config is None:
        raise HTTPException(status_code=404, detail="Task not found")
    script_content = ""
    script_path = task_dir / "script.py"
    if script_path.exists():
        script_content = script_path.read_text(encoding="utf-8")
    last_run: RunRecord | None = None
    last_run_path = task_dir / "last_run.json"
    if last_run_path.exists():
        try:
            last_run = RunRecord(**json.loads(last_run_path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return TaskDetailResponse(task=config, last_run=last_run, script_content=script_content)


@router.patch("/{task_id}", response_model=TaskConfig)
async def update_task(task_id: str, request: UpdateTaskRequest) -> TaskConfig:
    task_dir = get_paths().scheduled_task_dir(task_id)
    config = _read_config(task_dir)
    if config is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if request.name is not None:
        config.name = request.name
    if request.enabled is not None:
        config.enabled = request.enabled
    if request.cron is not None:
        _validate_cron(request.cron)
        config.cron = request.cron
    _write_config(task_dir, config)
    return config


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str) -> None:
    task_dir = get_paths().scheduled_task_dir(task_id)
    if not task_dir.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    shutil.rmtree(task_dir)
    # Remove crontab entry if no tasks remain
    tasks_dir = get_paths().scheduled_tasks_dir
    remaining = [d for d in tasks_dir.iterdir() if d.is_dir()] if tasks_dir.exists() else []
    if not remaining:
        _remove_from_crontab()


@router.get("/{task_id}/outputs", response_model=RunListResponse)
async def list_runs(task_id: str) -> RunListResponse:
    task_dir = get_paths().scheduled_task_dir(task_id)
    if not task_dir.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    outputs_dir = task_dir / "outputs"
    runs: list[RunRecord] = []
    if outputs_dir.exists():
        for run_dir in sorted(outputs_dir.iterdir(), reverse=True):
            if run_dir.is_dir():
                last_run_path = task_dir / "last_run.json"
                exit_code = 0
                duration = 0.0
                if last_run_path.exists():
                    try:
                        lr = json.loads(last_run_path.read_text(encoding="utf-8"))
                        if lr.get("run_id") == run_dir.name:
                            exit_code = lr.get("exit_code", 0)
                            duration = lr.get("duration_seconds", 0.0)
                    except Exception:
                        pass
                runs.append(RunRecord(
                    run_id=run_dir.name,
                    exit_code=exit_code,
                    duration_seconds=duration,
                    output_dir=run_dir.name,
                ))
    return RunListResponse(runs=runs)


@router.get("/{task_id}/outputs/{run_id}", response_model=RunOutputResponse)
async def list_run_outputs(task_id: str, run_id: str) -> RunOutputResponse:
    run_dir = get_paths().scheduled_task_dir(task_id) / "outputs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    files = [
        OutputFileItem(name=f.name, size=f.stat().st_size)
        for f in sorted(run_dir.iterdir())
        if f.is_file()
    ]
    return RunOutputResponse(files=files)


@router.get("/{task_id}/outputs/{run_id}/{filename}")
async def download_output(task_id: str, run_id: str, filename: str) -> FileResponse:
    file_path = get_paths().scheduled_task_dir(task_id) / "outputs" / run_id / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path), filename=filename)
```

**Step 2: Commit**

```bash
git add backend/app/gateway/routers/scheduled_tasks.py
git commit -m "feat(api): add /api/scheduled-tasks router"
```

---

## Task 5: Register the router in app

**Files:**
- Modify: `backend/app/gateway/routers/__init__.py`
- Modify: `backend/app/gateway/app.py`

**Step 1: Update `__init__.py`**

In `backend/app/gateway/routers/__init__.py`, change:
```python
from . import artifacts, assistants_compat, mcp, models, skills, suggestions, thread_runs, threads, uploads

__all__ = ["artifacts", "assistants_compat", "mcp", "models", "skills", "suggestions", "threads", "thread_runs", "uploads"]
```
to:
```python
from . import artifacts, assistants_compat, mcp, models, scheduled_tasks, skills, suggestions, thread_runs, threads, uploads

__all__ = ["artifacts", "assistants_compat", "mcp", "models", "scheduled_tasks", "skills", "suggestions", "threads", "thread_runs", "uploads"]
```

**Step 2: Update `app.py`**

In `backend/app/gateway/app.py`:

1. Add import at top with other router imports:
```python
from app.gateway.routers import (
    ...
    scheduled_tasks,
    ...
)
```

2. After the existing `app.include_router(skills.router)` line, add:
```python
    # Scheduled Tasks API
    app.include_router(scheduled_tasks.router)
```

3. Add OpenAPI tag entry in the `openapi_tags` list:
```python
{
    "name": "scheduled-tasks",
    "description": "Create and manage scheduled tasks with cron-based execution",
},
```

**Step 3: Start gateway and verify endpoint appears**

```bash
cd backend && make gateway &
sleep 3 && curl -s http://localhost:8001/api/scheduled-tasks | python3 -m json.tool
```

Expected: `{"tasks": []}` (empty list).

**Step 4: Commit**

```bash
git add backend/app/gateway/routers/__init__.py backend/app/gateway/app.py
git commit -m "feat(gateway): register scheduled-tasks router"
```

---

## Task 6: Create the Agent Tool (`create_scheduled_task`)

**Files:**
- Create: `backend/packages/harness/deerflow/tools/builtins/scheduled_task_tool.py`

**Step 1: Write the tool**

```python
import json
from typing import Annotated

from langchain.tools import InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

_PREVIEW_MARKER = "__scheduled_task_preview__"


@tool("create_scheduled_task", parse_docstring=True)
def scheduled_task_tool(
    name: str,
    description: str,
    cron: str,
    script_content: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Create a scheduled task that runs a Python script on a cron schedule.

    Use this tool when the user asks to schedule a recurring task, automation,
    or periodic job. The task will not be saved until the user confirms in the UI.

    Args:
        name: Short task name (e.g. "大宗商品市场政策收集").
        description: What the task does.
        cron: Cron expression (e.g. "0 9 * * *" for every day at 9am).
        script_content: Complete, self-contained Python script that performs the task.
            The script may use standard library, requests, and installed packages.
            It should save output files (e.g. HTML report) to its working directory.
    """
    preview = {
        _PREVIEW_MARKER: True,
        "name": name,
        "description": description,
        "cron": cron,
        "script_content": script_content,
    }
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=json.dumps(preview, ensure_ascii=False),
                    tool_call_id=tool_call_id,
                )
            ]
        }
    )
```

**Step 2: Export the tool from builtins `__init__.py`**

In `backend/packages/harness/deerflow/tools/builtins/__init__.py`, add:

```python
from .scheduled_task_tool import scheduled_task_tool
```

and add `scheduled_task_tool` to the `__all__` list (or whatever export mechanism exists).

**Step 3: Register tool in `tools.py`**

In `backend/packages/harness/deerflow/tools/tools.py`, add to `BUILTIN_TOOLS`:

```python
from deerflow.tools.builtins import ..., scheduled_task_tool

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    scheduled_task_tool,
]
```

**Step 4: Commit**

```bash
git add backend/packages/harness/deerflow/tools/builtins/scheduled_task_tool.py \
        backend/packages/harness/deerflow/tools/builtins/__init__.py \
        backend/packages/harness/deerflow/tools/tools.py
git commit -m "feat(tool): add create_scheduled_task agent tool"
```

---

## Task 7: Backend tests

**Files:**
- Create: `backend/tests/test_scheduled_tasks.py`

**Step 1: Write tests**

```python
import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

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
from deerflow.config.paths import Paths  # noqa: E402


@pytest.fixture()
def tmp_paths(tmp_path):
    return Paths(base_dir=tmp_path)


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


def test_create_task_request_validation():
    req = CreateTaskRequest(name="Task", cron="0 9 * * *", script_content="print('hi')")
    assert req.name == "Task"


def test_create_task_request_empty_name():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CreateTaskRequest(name="", cron="0 9 * * *", script_content="x")
```

**Step 2: Run tests**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_scheduled_tasks.py -v
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add backend/tests/test_scheduled_tasks.py
git commit -m "test(scheduled-tasks): add unit tests for router helpers"
```

---

## Task 8: Frontend — i18n keys

**Files:**
- Modify: `frontend/src/core/i18n/locales/types.ts`
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en-US.ts`

**Step 1: Add type in `types.ts`**

In the `sidebar` interface, add `scheduledTasks: string;`:

```typescript
sidebar: {
  recentChats: string;
  newChat: string;
  chats: string;
  demoChats: string;
  agents: string;
  scheduledTasks: string;  // ← add
};
```

Also add a new top-level key for the scheduled tasks section:

```typescript
scheduledTasks: {
  title: string;
  description: string;
  empty: string;
  createTaskTool: string;
  confirmCreate: string;
  cancel: string;
  cronLabel: string;
  scriptPreview: string;
  enabled: string;
  disabled: string;
  lastRun: string;
  never: string;
  viewOutputs: string;
  deleteTask: string;
  deleteConfirm: string;
  outputs: string;
  download: string;
  noOutputs: string;
  status: {
    success: string;
    failed: string;
  };
};
```

**Step 2: Add zh-CN translations**

In `frontend/src/core/i18n/locales/zh-CN.ts`, add to `sidebar`:
```typescript
scheduledTasks: "定时任务",
```

Add new top-level key:
```typescript
scheduledTasks: {
  title: "定时任务",
  description: "通过对话创建定时任务，自动执行并管理结果。",
  empty: "暂无定时任务，在对话中描述你的定时任务来创建。",
  createTaskTool: "创建定时任务",
  confirmCreate: "确认创建",
  cancel: "取消",
  cronLabel: "执行计划",
  scriptPreview: "脚本预览",
  enabled: "运行中",
  disabled: "已停止",
  lastRun: "上次执行",
  never: "从未执行",
  viewOutputs: "查看结果",
  deleteTask: "删除任务",
  deleteConfirm: "确定要删除这个定时任务吗？所有执行记录也将一并删除。",
  outputs: "执行记录",
  download: "下载",
  noOutputs: "暂无执行记录",
  status: {
    success: "成功",
    failed: "失败",
  },
},
```

**Step 3: Add en-US translations**

In `frontend/src/core/i18n/locales/en-US.ts`, add to `sidebar`:
```typescript
scheduledTasks: "Scheduled Tasks",
```

Add new top-level key:
```typescript
scheduledTasks: {
  title: "Scheduled Tasks",
  description: "Create scheduled tasks through conversation and manage their execution.",
  empty: "No scheduled tasks yet. Describe a recurring task in chat to create one.",
  createTaskTool: "Create Scheduled Task",
  confirmCreate: "Confirm Create",
  cancel: "Cancel",
  cronLabel: "Schedule",
  scriptPreview: "Script Preview",
  enabled: "Running",
  disabled: "Stopped",
  lastRun: "Last run",
  never: "Never",
  viewOutputs: "View Outputs",
  deleteTask: "Delete Task",
  deleteConfirm: "Are you sure you want to delete this task? All execution records will also be deleted.",
  outputs: "Execution Records",
  download: "Download",
  noOutputs: "No execution records yet",
  status: {
    success: "Success",
    failed: "Failed",
  },
},
```

**Step 4: Typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: no errors.

**Step 5: Commit**

```bash
git add frontend/src/core/i18n/locales/
git commit -m "feat(i18n): add scheduledTasks translations"
```

---

## Task 9: Frontend — Sidebar menu item

**Files:**
- Modify: `frontend/src/components/workspace/workspace-nav-chat-list.tsx`

**Step 1: Add the menu item**

```typescript
"use client";

import { BotIcon, ClockIcon, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild>
            <Link className="text-sidebar-foreground/70" href="/workspace/chats">
              <MessagesSquare />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
          >
            <Link className="text-sidebar-foreground/70" href="/workspace/agents">
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/scheduled-tasks")}
            asChild
          >
            <Link
              className="text-sidebar-foreground/70"
              href="/workspace/scheduled-tasks"
            >
              <ClockIcon />
              <span>{t.sidebar.scheduledTasks}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
```

**Step 2: Typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/components/workspace/workspace-nav-chat-list.tsx
git commit -m "feat(sidebar): add Scheduled Tasks menu item"
```

---

## Task 10: Frontend — API client for scheduled tasks

**Files:**
- Create: `frontend/src/core/scheduled-tasks/types.ts`
- Create: `frontend/src/core/scheduled-tasks/api.ts`
- Create: `frontend/src/core/scheduled-tasks/index.ts`

**Step 1: Write `types.ts`**

```typescript
export interface TaskConfig {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
}

export interface RunRecord {
  run_id: string;
  exit_code: number;
  duration_seconds: number;
  output_dir: string;
}

export interface TaskDetail {
  task: TaskConfig;
  last_run: RunRecord | null;
  script_content: string;
}

export interface OutputFileItem {
  name: string;
  size: number;
}

export interface CreateTaskPayload {
  name: string;
  description: string;
  cron: string;
  script_content: string;
}
```

**Step 2: Write `api.ts`**

```typescript
import { getBackendBaseURL } from "@/core/config";

import type {
  CreateTaskPayload,
  OutputFileItem,
  RunRecord,
  TaskConfig,
  TaskDetail,
} from "./types";

const BASE = () => `${getBackendBaseURL()}/api/scheduled-tasks`;

export async function listTasks(): Promise<TaskConfig[]> {
  const res = await fetch(BASE());
  const json = await res.json();
  return json.tasks as TaskConfig[];
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskConfig> {
  const res = await fetch(BASE(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getTask(taskId: string): Promise<TaskDetail> {
  const res = await fetch(`${BASE()}/${taskId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateTask(
  taskId: string,
  patch: { enabled?: boolean; name?: string; cron?: string },
): Promise<TaskConfig> {
  const res = await fetch(`${BASE()}/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${BASE()}/${taskId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function listRuns(taskId: string): Promise<RunRecord[]> {
  const res = await fetch(`${BASE()}/${taskId}/outputs`);
  const json = await res.json();
  return json.runs as RunRecord[];
}

export async function listRunFiles(
  taskId: string,
  runId: string,
): Promise<OutputFileItem[]> {
  const res = await fetch(`${BASE()}/${taskId}/outputs/${runId}`);
  const json = await res.json();
  return json.files as OutputFileItem[];
}

export function getDownloadUrl(taskId: string, runId: string, filename: string): string {
  return `${BASE()}/${taskId}/outputs/${runId}/${filename}`;
}
```

**Step 3: Write `index.ts`**

```typescript
export * from "./api";
export * from "./types";
```

**Step 4: Typecheck**

```bash
cd frontend && pnpm typecheck
```

**Step 5: Commit**

```bash
git add frontend/src/core/scheduled-tasks/
git commit -m "feat(api-client): add scheduled-tasks API client"
```

---

## Task 11: Frontend — Task list page

**Files:**
- Create: `frontend/src/app/workspace/scheduled-tasks/page.tsx`
- Create: `frontend/src/components/workspace/scheduled-tasks/task-list.tsx`

**Step 1: Write `task-list.tsx`**

```tsx
"use client";

import { ClockIcon, SquareIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  deleteTask,
  listTasks,
  updateTask,
  type TaskConfig,
} from "@/core/scheduled-tasks";
import Link from "next/link";

export function ScheduledTaskList() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toggle = async (task: TaskConfig) => {
    await updateTask(task.id, { enabled: !task.enabled });
    await reload();
  };

  const remove = async (task: TaskConfig) => {
    if (!confirm(t.scheduledTasks.deleteConfirm)) return;
    await deleteTask(task.id);
    await reload();
  };

  if (loading) {
    return <div className="p-8 text-muted-foreground">{t.common.loading}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center text-muted-foreground">
        <ClockIcon className="size-10 opacity-40" />
        <p className="max-w-xs text-sm">{t.scheduledTasks.empty}</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-4 px-6 py-4">
          <div className="flex-1 min-w-0">
            <Link
              href={`/workspace/scheduled-tasks/${task.id}`}
              className="font-medium hover:underline truncate block"
            >
              {task.name}
            </Link>
            <p className="text-xs text-muted-foreground mt-0.5">
              {task.cron}
              {" · "}
              {t.scheduledTasks.lastRun}:{" "}
              {task.last_run_at
                ? new Date(task.last_run_at).toLocaleString()
                : t.scheduledTasks.never}
            </p>
          </div>
          <Badge variant={task.enabled ? "default" : "secondary"}>
            {task.enabled ? t.scheduledTasks.enabled : t.scheduledTasks.disabled}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggle(task)}
            title={task.enabled ? t.scheduledTasks.disabled : t.scheduledTasks.enabled}
          >
            {task.enabled ? (
              <SquareIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => remove(task)}
            title={t.scheduledTasks.deleteTask}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Write the page**

```tsx
import { ScheduledTaskList } from "@/components/workspace/scheduled-tasks/task-list";

export default function ScheduledTasksPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">定时任务</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ScheduledTaskList />
      </div>
    </div>
  );
}
```

**Step 3: Typecheck**

```bash
cd frontend && pnpm typecheck
```

**Step 4: Commit**

```bash
git add frontend/src/app/workspace/scheduled-tasks/ \
        frontend/src/components/workspace/scheduled-tasks/task-list.tsx
git commit -m "feat(ui): add scheduled tasks list page"
```

---

## Task 12: Frontend — Task detail page

**Files:**
- Create: `frontend/src/app/workspace/scheduled-tasks/[task_id]/page.tsx`
- Create: `frontend/src/components/workspace/scheduled-tasks/task-detail.tsx`

**Step 1: Write `task-detail.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  getTask,
  listRunFiles,
  getDownloadUrl,
  type TaskDetail,
  type OutputFileItem,
} from "@/core/scheduled-tasks";

export function ScheduledTaskDetail({ taskId }: { taskId: string }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [files, setFiles] = useState<OutputFileItem[]>([]);

  useEffect(() => {
    getTask(taskId).then(setDetail).catch(console.error);
  }, [taskId]);

  useEffect(() => {
    if (!selectedRun) return;
    listRunFiles(taskId, selectedRun).then(setFiles).catch(console.error);
  }, [taskId, selectedRun]);

  if (!detail) {
    return <div className="p-8 text-muted-foreground">{t.common.loading}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">{detail.task.name}</h2>
        <p className="text-sm text-muted-foreground mt-1">{detail.task.description}</p>
        <div className="flex gap-2 mt-2">
          <Badge variant="outline">{detail.task.cron}</Badge>
          <Badge variant={detail.task.enabled ? "default" : "secondary"}>
            {detail.task.enabled ? t.scheduledTasks.enabled : t.scheduledTasks.disabled}
          </Badge>
        </div>
      </div>

      {detail.script_content && (
        <div>
          <h3 className="text-sm font-medium mb-2">{t.scheduledTasks.scriptPreview}</h3>
          <pre className="bg-muted rounded p-3 text-xs overflow-x-auto max-h-64">
            {detail.script_content}
          </pre>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-2">{t.scheduledTasks.outputs}</h3>
        {detail.last_run ? (
          <div className="space-y-2">
            <button
              className="w-full text-left border rounded p-3 hover:bg-muted/50 text-sm"
              onClick={() =>
                setSelectedRun(
                  selectedRun === detail.last_run?.run_id
                    ? null
                    : detail.last_run?.run_id ?? null,
                )
              }
            >
              <span className="font-mono">{detail.last_run.run_id}</span>
              {" · "}
              <Badge
                variant={detail.last_run.exit_code === 0 ? "default" : "destructive"}
                className="text-xs"
              >
                {detail.last_run.exit_code === 0
                  ? t.scheduledTasks.status.success
                  : t.scheduledTasks.status.failed}
              </Badge>
              {" · "}
              {detail.last_run.duration_seconds}s
            </button>
            {selectedRun === detail.last_run.run_id && (
              <div className="border rounded p-3 space-y-1">
                {files.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t.scheduledTasks.noOutputs}</p>
                ) : (
                  files.map((f) => (
                    <div key={f.name} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs">{f.name}</span>
                      <a
                        href={getDownloadUrl(taskId, selectedRun, f.name)}
                        download={f.name}
                      >
                        <Button variant="ghost" size="sm">
                          <DownloadIcon className="size-3 mr-1" />
                          {t.scheduledTasks.download}
                        </Button>
                      </a>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.scheduledTasks.noOutputs}</p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Write the page**

```tsx
import { ScheduledTaskDetail } from "@/components/workspace/scheduled-tasks/task-detail";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ task_id: string }>;
}) {
  const { task_id } = await params;
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <ScheduledTaskDetail taskId={task_id} />
    </div>
  );
}
```

**Step 3: Typecheck**

```bash
cd frontend && pnpm typecheck
```

**Step 4: Commit**

```bash
git add frontend/src/app/workspace/scheduled-tasks/[task_id]/ \
        frontend/src/components/workspace/scheduled-tasks/task-detail.tsx
git commit -m "feat(ui): add scheduled task detail page with run outputs"
```

---

## Task 13: Frontend — Scheduled task preview card in chat

**Files:**
- Modify: `frontend/src/core/messages/utils.ts`
- Create: `frontend/src/components/workspace/scheduled-tasks/task-preview-card.tsx`
- Modify: `frontend/src/components/workspace/messages/message-list.tsx`

**Step 1: Add new group type in `utils.ts`**

In `frontend/src/core/messages/utils.ts`:

1. Add interface and union type:
```typescript
interface AssistantScheduledTaskGroup extends GenericMessageGroup<"assistant:scheduled-task"> {}

type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup
  | AssistantScheduledTaskGroup;  // ← add
```

2. Add helper function:
```typescript
export function isScheduledTaskToolMessage(message: Message): boolean {
  if (message.type !== "tool" || message.name !== "create_scheduled_task") return false;
  try {
    const data = JSON.parse(typeof message.content === "string" ? message.content : "{}");
    return data.__scheduled_task_preview__ === true;
  } catch {
    return false;
  }
}
```

3. In `groupMessages`, in the `message.type === "tool"` branch, add a check before the existing `isClarificationToolMessage` check:
```typescript
if (message.type === "tool") {
  if (isScheduledTaskToolMessage(message)) {
    lastOpenGroup()?.messages.push(message);
    groups.push({
      id: message.id,
      type: "assistant:scheduled-task",
      messages: [message],
    });
  } else if (isClarificationToolMessage(message)) {
    // ... existing
```

**Step 2: Write `task-preview-card.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { Message } from "@langchain/langgraph-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { createTask } from "@/core/scheduled-tasks";

interface TaskPreview {
  __scheduled_task_preview__: true;
  name: string;
  description: string;
  cron: string;
  script_content: string;
}

function parseCronHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, dom, month, dow] = parts;
  if (dom === "*" && month === "*" && dow === "*") {
    if (min !== "*" && hour !== "*") return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}

export function ScheduledTaskPreviewCard({ message }: { message: Message }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaskPreview | null>(null);

  // Parse once on mount
  if (preview === null) {
    try {
      const data = JSON.parse(
        typeof message.content === "string" ? message.content : "{}"
      ) as TaskPreview;
      setPreview(data);
      setName(data.name);
      setCron(data.cron);
    } catch {
      return null;
    }
  }

  if (!preview) return null;

  const confirm = async () => {
    setError(null);
    try {
      await createTask({
        name,
        description: preview.description,
        cron,
        script_content: preview.script_content,
      });
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    }
  };

  if (confirmed) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        ✓ {t.scheduledTasks.title}「{name}」已创建
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{t.scheduledTasks.createTaskTool}</span>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">任务名称</label>
        <input
          className="rounded border px-2 py-1 text-sm bg-background"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">
          {t.scheduledTasks.cronLabel}
        </label>
        <div className="flex items-center gap-2">
          <input
            className="rounded border px-2 py-1 text-sm font-mono bg-background w-40"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
          <Badge variant="outline" className="text-xs">
            {parseCronHuman(cron)}
          </Badge>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t.scheduledTasks.scriptPreview}
        </summary>
        <pre className="mt-2 bg-muted rounded p-2 overflow-x-auto max-h-48 text-xs">
          {preview.script_content}
        </pre>
      </details>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" disabled>
          {t.scheduledTasks.cancel}
        </Button>
        <Button size="sm" onClick={confirm}>
          {t.scheduledTasks.confirmCreate}
        </Button>
      </div>
    </div>
  );
}
```

**Step 3: Update `message-list.tsx`**

In `frontend/src/components/workspace/messages/message-list.tsx`, after the `assistant:clarification` block, add:

```tsx
} else if (group.type === "assistant:scheduled-task") {
  const message = group.messages[0];
  if (message) {
    return (
      <ScheduledTaskPreviewCard key={group.id} message={message} />
    );
  }
  return null;
```

Also add the import at the top:
```typescript
import { ScheduledTaskPreviewCard } from "../scheduled-tasks/task-preview-card";
import { isScheduledTaskToolMessage } from "@/core/messages/utils";
```

**Step 4: Typecheck**

```bash
cd frontend && pnpm typecheck
```

**Step 5: Commit**

```bash
git add frontend/src/core/messages/utils.ts \
        frontend/src/components/workspace/scheduled-tasks/task-preview-card.tsx \
        frontend/src/components/workspace/messages/message-list.tsx
git commit -m "feat(ui): add scheduled task preview card in chat"
```

---

## Task 14: Run full test suite and typecheck

**Step 1: Backend tests**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v
```

Expected: all pass.

**Step 2: Frontend typecheck and lint**

```bash
cd frontend && pnpm check
```

Expected: no errors.

**Step 3: Commit if any lint fixes needed**

```bash
git add -A && git commit -m "fix(lint): address typecheck/lint issues"
```

---

## Task 15: Final integration test

**Step 1: Start the full app**

```bash
make dev
```

**Step 2: Verify sidebar shows "定时任务" item**

Navigate to `http://localhost:2026/workspace/scheduled-tasks` — should show empty state.

**Step 3: Test conversation creation**

In chat, type: "帮我创建一个每天9点收集大宗商品市场政策的任务，并展示成HTML"

Expected: AI calls `create_scheduled_task` tool → preview card appears with name, cron, script, Confirm/Cancel buttons.

**Step 4: Confirm and verify**

Click "确认创建" → card shows success → navigate to `/workspace/scheduled-tasks` → task appears in list.

**Step 5: Test start/stop**

Click the stop button → badge changes to "已停止". Click play → badge back to "运行中".

**Step 6: Commit if any fixes**

```bash
git add -A && git commit -m "fix: integration test fixes"
```
