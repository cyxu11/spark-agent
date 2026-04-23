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
    Path(__file__).resolve().parents[3] / "scripts" / "scheduled_task_dispatcher.py"
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
        lines = [line for line in result.stdout.splitlines() if dispatcher not in line]
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
