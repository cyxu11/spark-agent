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
