# Scheduled Tasks Feature — Design Doc

**Date:** 2026-04-23  
**Status:** Approved  
**Approach:** Plan A — File-Based Dispatcher + System Crontab

---

## Overview

Allow users to create scheduled tasks through conversation. The Agent generates a Python script based on the user's description, stores it in a structured folder, and a system-level crontab dispatcher runs enabled tasks on schedule. Users manage tasks (start/stop/delete/view outputs) via a new left-sidebar menu.

---

## File Structure

```
.deer-flow/
└── scheduled_tasks/
    └── {task_id}/
        ├── config.json        # task metadata
        ├── script.py          # Agent-generated execution script
        ├── last_run.json      # last execution: time, exit_code, duration
        └── outputs/
            └── {YYYYMMDD_HHMMSS}/
                ├── result.html   # execution artifacts
                └── stdout.log    # stdout + stderr

backend/
└── app/gateway/
    ├── routers/
    │   └── scheduled_tasks.py        # new FastAPI router
    └── tools/
        └── create_scheduled_task.py  # new Agent tool

backend/scripts/
└── scheduled_task_dispatcher.py      # dispatcher (triggered by crontab)
```

### `config.json` Schema

```json
{
  "id": "abc123",
  "name": "大宗商品市场政策收集",
  "description": "每天9点收集并生成HTML报告",
  "cron": "0 9 * * *",
  "enabled": true,
  "created_at": "2026-04-23T10:00:00",
  "last_run_at": null
}
```

### Crontab Entry (one fixed entry)

```
* * * * * cd /path/to/project && python backend/scripts/scheduled_task_dispatcher.py >> .deer-flow/dispatcher.log 2>&1
```

---

## Task Creation Flow

```
User chat input
  → Lead Agent detects scheduled task intent
  → Calls Tool: create_scheduled_task(name, description, cron, script_content)
  → Frontend renders editable preview card (no files written yet)
  → User edits name / cron if needed, clicks "确认创建"
  → Frontend: POST /api/scheduled-tasks
  → Backend writes config.json + script.py
  → Frontend shows success toast, sidebar task list refreshes
```

### Agent Tool Signature

```python
create_scheduled_task(
    name: str,           # e.g. "大宗商品市场政策收集"
    description: str,    # task explanation
    cron: str,           # e.g. "0 9 * * *"
    script_content: str  # full Python script body
) -> dict  # preview data for frontend card
```

**Constraint:** The tool call returns preview data only — no disk writes until user confirms.

### Frontend Preview Card Contents

- Task name (editable)
- Cron expression + human-readable label (e.g. "每天 09:00")
- Script code preview (collapsible)
- "确认创建" / "取消" buttons

---

## Task Management UI

### Sidebar Entry

```
Chats
Agents
⏰ Scheduled Tasks   ← new item (clock icon)
Settings
```

### Task List Page `/workspace/scheduled-tasks`

| Column | Content |
|--------|---------|
| Name | clickable → detail page |
| Schedule | `0 9 * * *` + "每天 09:00" |
| Status | enabled/disabled toggle |
| Last Run | timestamp + success/failure badge |
| Actions | View Outputs / Delete |

### Task Detail Page `/workspace/scheduled-tasks/{id}`

- Script content display
- Execution history list (time, duration, status)
- Per-run artifact file list with download links

---

## Backend API

New router mounted at `/api/scheduled-tasks`:

```
GET    /api/scheduled-tasks                            # list all tasks
POST   /api/scheduled-tasks                            # create task (after user confirms)
GET    /api/scheduled-tasks/{id}                       # task detail
PATCH  /api/scheduled-tasks/{id}                       # update enabled / name / cron
DELETE /api/scheduled-tasks/{id}                       # delete task + all files
GET    /api/scheduled-tasks/{id}/outputs               # list execution runs
GET    /api/scheduled-tasks/{id}/outputs/{run}         # list files in a run
GET    /api/scheduled-tasks/{id}/outputs/{run}/{file}  # download file
GET    /api/scheduled-tasks/crontab-status             # check if dispatcher is registered
```

---

## Dispatcher Logic

```
Triggered every minute by crontab
  ↓
Read all .deer-flow/scheduled_tasks/*/config.json
  ↓
Filter: enabled = true
  ↓
Use croniter to check if current time matches cron expression
  ↓
Match found:
  → Create outputs/{YYYYMMDD_HHMMSS}/ directory
  → subprocess.run(script.py), capture stdout/stderr → stdout.log
  → Update last_run.json (time, exit_code, duration_seconds)
```

### Error Handling

| Scenario | Handling |
|----------|----------|
| Script timeout (default 10 min) | Kill process, exit_code=124 |
| Script raises exception | stderr captured in stdout.log, exit_code≠0 |
| Previous run still running | Skip (lockfile per task prevents overlap) |
| tasks directory missing | Silent exit |
| Invalid cron expression | Rejected at POST /api/scheduled-tasks creation time |

### Dependencies

- `croniter` — cron expression matching (add to pyproject.toml)
- Standard library: `subprocess`, `pathlib`, `json`, `fcntl`

### Crontab Auto-Registration

On first successful task creation, the backend automatically appends the dispatcher entry to the user's crontab via `crontab -l | crontab -`. `GET /api/scheduled-tasks/crontab-status` confirms registration state.

---

## Out of Scope

- Multi-user isolation (tasks are global to the deployment)
- Result push notifications (email / Slack)
- Task editing after creation (delete + recreate)
- Sub-minute scheduling precision
