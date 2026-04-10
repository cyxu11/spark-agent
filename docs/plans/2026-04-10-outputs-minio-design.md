# Outputs → MinIO Integration Design

**Date**: 2026-04-10  
**Status**: Approved

## Problem

Agent-generated files (`/mnt/user-data/outputs/`) are stored only on the local filesystem. In a multi-node cluster, the node that generates a file may not be the node that serves it via the artifacts API, causing 404 errors.

## Out of Scope

| Area | Decision | Reason |
|---|---|---|
| Workspace (`/mnt/user-data/workspace/`) | Shared volume | Bash writes can't be intercepted cleanly |
| Skills (`skills/custom/`) | Shared volume | Already covered by deployment |
| Uploads | Already done | Fixed in previous session |

## Design

### Push: `present_file_tool.py`

`present_files` is the agent's explicit signal that a file is ready for the user. This is the only clean Python-level hook for outputs.

After normalizing file paths (existing logic), upload each file to MinIO:

- **Object key**: `{thread_id}/outputs/{relative_path}` — namespaced under `outputs/` to distinguish from uploads (`{thread_id}/{filename}`)
- **Bucket**: same `deerflow-uploads` bucket, configured via `uploads_config`
- **Error handling**: non-fatal — log a warning on failure, do not interrupt the tool response
- **Dependency**: uses existing `MinioUploadBackend` from `deerflow.uploads.backends.minio` (harness-internal, no cross-layer import)

### Pull: `artifacts.py` (fallback)

When `GET /api/threads/{id}/artifacts/mnt/user-data/outputs/{path}` is called:

```
local file exists  → serve from local (unchanged)
local file missing + MinIO configured → fetch from MinIO, serve content
local file missing + no MinIO         → 404 (unchanged)
```

Object key derivation: strip `/mnt/user-data/` prefix from virtual path to get `outputs/{relative_path}`.

## Data Flow

```
Agent
  └─ bash writes files → /mnt/user-data/outputs/ (local disk)
  └─ present_files(["outputs/report.xlsx"])
       ├─ normalize path → /mnt/user-data/outputs/report.xlsx
       ├─ upload to MinIO: deerflow-uploads / {thread_id}/outputs/report.xlsx
       └─ return Command(artifacts=[...])

User downloads file
  └─ GET /api/threads/{id}/artifacts/mnt/user-data/outputs/report.xlsx
       ├─ check local disk → found → serve (fast path)
       └─ not found → MinIO.load({thread_id}, "outputs/report.xlsx") → serve
```

## Files Changed

| File | Change |
|---|---|
| `packages/harness/deerflow/tools/builtins/present_file_tool.py` | Add MinIO upload after path normalization |
| `app/gateway/routers/artifacts.py` | Add MinIO fallback in 404 branch |

No new files, no schema changes, no config changes.
