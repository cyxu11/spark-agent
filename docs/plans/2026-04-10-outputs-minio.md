# Outputs → MinIO Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sync agent-generated output files to MinIO when `present_files` is called, and fall back to MinIO in the artifacts endpoint when the local file is missing.

**Architecture:** `present_files` tool uploads each file to MinIO immediately after normalizing paths (push). The artifacts endpoint tries local disk first, then falls back to MinIO if the file isn't found locally (pull). This is the only clean Python-level hook for outputs; workspace files written directly by bash are out of scope.

**Tech Stack:** Python 3.12, `minio>=7.2`, FastAPI, pytest, `unittest.mock`

---

### Task 1: MinIO push in `present_file_tool`

**Files:**
- Modify: `backend/packages/harness/deerflow/tools/builtins/present_file_tool.py`
- Test: `backend/tests/test_present_file_tool_core_logic.py`

---

**Step 1: Write failing tests**

Add to the bottom of `backend/tests/test_present_file_tool_core_logic.py`:

```python
from unittest.mock import MagicMock, patch


def _make_minio_config():
    """Return a UploadsConfig-shaped namespace with MinIO enabled."""
    minio_cfg = SimpleNamespace(
        endpoint="localhost:9000",
        access_key="minioadmin",
        secret_key="deerflow123",
        bucket="deerflow-uploads",
        secure=False,
    )
    return SimpleNamespace(backend="minio", minio=minio_cfg)


def test_present_files_uploads_to_minio_when_configured(tmp_path, monkeypatch):
    """Files are uploaded to MinIO with key {thread_id}/outputs/{filename}."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "report.xlsx"
    artifact.write_bytes(b"xlsx-content")

    mock_backend = MagicMock()

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: _make_minio_config(),
    )
    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        return_value=mock_backend,
    ):
        result = present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-minio-1",
        )

    assert result.update["artifacts"] == ["/mnt/user-data/outputs/report.xlsx"]
    mock_backend.save.assert_called_once_with(
        "thread-1",
        "outputs/report.xlsx",
        b"xlsx-content",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def test_present_files_skips_minio_when_not_configured(tmp_path, monkeypatch):
    """No MinIO upload when backend is 'local'."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "notes.txt"
    artifact.write_text("hello")

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: SimpleNamespace(backend="local", minio=None),
    )
    mock_backend_cls = MagicMock()

    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        mock_backend_cls,
    ):
        present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-no-minio",
        )

    mock_backend_cls.assert_not_called()


def test_present_files_minio_failure_is_nonfatal(tmp_path, monkeypatch):
    """MinIO upload error is logged as warning; tool still succeeds."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "data.csv"
    artifact.write_text("a,b\n1,2")

    mock_backend = MagicMock()
    mock_backend.save.side_effect = Exception("connection refused")

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: _make_minio_config(),
    )
    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        return_value=mock_backend,
    ):
        result = present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-fail",
        )

    # Tool still reports success despite MinIO failure
    assert result.update["artifacts"] == ["/mnt/user-data/outputs/data.csv"]
    assert result.update["messages"][0].content == "Successfully presented files"
```

**Step 2: Run tests to verify they fail**

```bash
cd backend
PYTHONPATH=. uv run pytest tests/test_present_file_tool_core_logic.py -k "minio" -v
```

Expected: `FAILED` — `AttributeError: module has no attribute 'get_uploads_config'`

---

**Step 3: Implement MinIO push in `present_file_tool.py`**

Replace the contents of `backend/packages/harness/deerflow/tools/builtins/present_file_tool.py` with:

```python
import logging
import mimetypes
from pathlib import Path
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from deerflow.config.uploads_config import get_uploads_config

OUTPUTS_VIRTUAL_PREFIX = f"{VIRTUAL_PATH_PREFIX}/outputs"

logger = logging.getLogger(__name__)


def _normalize_presented_filepath(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepath: str,
) -> str:
    """Normalize a presented file path to the `/mnt/user-data/outputs/*` contract."""
    if runtime.state is None:
        raise ValueError("Thread runtime state is not available")

    thread_id = runtime.context.get("thread_id") if runtime.context else None
    if not thread_id:
        raise ValueError("Thread ID is not available in runtime context")

    thread_data = runtime.state.get("thread_data") or {}
    outputs_path = thread_data.get("outputs_path")
    if not outputs_path:
        raise ValueError("Thread outputs path is not available in runtime state")

    outputs_dir = Path(outputs_path).resolve()
    stripped = filepath.lstrip("/")
    virtual_prefix = VIRTUAL_PATH_PREFIX.lstrip("/")

    if stripped == virtual_prefix or stripped.startswith(virtual_prefix + "/"):
        actual_path = get_paths().resolve_virtual_path(thread_id, filepath)
    else:
        actual_path = Path(filepath).expanduser().resolve()

    try:
        relative_path = actual_path.relative_to(outputs_dir)
    except ValueError as exc:
        raise ValueError(f"Only files in {OUTPUTS_VIRTUAL_PREFIX} can be presented: {filepath}") from exc

    return f"{OUTPUTS_VIRTUAL_PREFIX}/{relative_path.as_posix()}"


def _sync_to_minio(thread_id: str, virtual_path: str, physical_path: Path) -> None:
    """Upload a single output file to MinIO. Non-fatal on error."""
    uploads_cfg = get_uploads_config()
    if uploads_cfg.backend != "minio" or not uploads_cfg.minio:
        return

    try:
        from deerflow.uploads.backends.minio import MinioUploadBackend

        backend = MinioUploadBackend(
            endpoint=uploads_cfg.minio.endpoint,
            access_key=uploads_cfg.minio.access_key,
            secret_key=uploads_cfg.minio.secret_key,
            bucket=uploads_cfg.minio.bucket,
            secure=uploads_cfg.minio.secure,
        )
        # Strip "/mnt/user-data/" prefix → "outputs/filename.ext"
        prefix = VIRTUAL_PATH_PREFIX.lstrip("/") + "/"
        relative = virtual_path.lstrip("/")[len(prefix):]
        content_type = mimetypes.guess_type(physical_path.name)[0] or "application/octet-stream"
        backend.save(thread_id, relative, physical_path.read_bytes(), content_type=content_type)
        logger.info("Synced output to MinIO: %s/%s", thread_id, relative)
    except Exception:
        logger.warning("MinIO sync failed for %s (non-fatal)", virtual_path, exc_info=True)


@tool("present_files", parse_docstring=True)
def present_file_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepaths: list[str],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Make files visible to the user for viewing and rendering in the client interface.

    When to use the present_files tool:

    - Making any file available for the user to view, download, or interact with
    - Presenting multiple related files at once
    - After creating files that should be presented to the user

    When NOT to use the present_files tool:
    - When you only need to read file contents for your own processing
    - For temporary or intermediate files not meant for user viewing

    Notes:
    - You should call this tool after creating files and moving them to the `/mnt/user-data/outputs` directory.
    - This tool can be safely called in parallel with other tools. State updates are handled by a reducer to prevent conflicts.

    Args:
        filepaths: List of absolute file paths to present to the user. **Only** files in `/mnt/user-data/outputs` can be presented.
    """
    try:
        normalized_paths = [_normalize_presented_filepath(runtime, filepath) for filepath in filepaths]
    except ValueError as exc:
        return Command(
            update={"messages": [ToolMessage(f"Error: {exc}", tool_call_id=tool_call_id)]},
        )

    thread_id = (runtime.context or {}).get("thread_id")
    if thread_id:
        thread_data = (runtime.state or {}).get("thread_data") or {}
        outputs_path = thread_data.get("outputs_path")
        if outputs_path:
            outputs_dir = Path(outputs_path).resolve()
            for virtual_path, original_filepath in zip(normalized_paths, filepaths):
                stripped = original_filepath.lstrip("/")
                virtual_prefix = VIRTUAL_PATH_PREFIX.lstrip("/")
                if stripped.startswith(virtual_prefix + "/"):
                    physical = get_paths().resolve_virtual_path(thread_id, original_filepath)
                else:
                    physical = Path(original_filepath).expanduser().resolve()
                if not physical.is_absolute():
                    physical = outputs_dir / physical
                _sync_to_minio(thread_id, virtual_path, physical)

    return Command(
        update={
            "artifacts": normalized_paths,
            "messages": [ToolMessage("Successfully presented files", tool_call_id=tool_call_id)],
        },
    )
```

**Step 4: Run tests to verify they pass**

```bash
cd backend
PYTHONPATH=. uv run pytest tests/test_present_file_tool_core_logic.py -v
```

Expected: all tests `PASSED` (including the 3 original tests)

---

**Step 5: Commit**

```bash
cd backend
git add packages/harness/deerflow/tools/builtins/present_file_tool.py \
        tests/test_present_file_tool_core_logic.py
git commit -m "feat(outputs): sync to MinIO on present_files"
```

---

### Task 2: MinIO fallback in artifacts endpoint

**Files:**
- Modify: `backend/app/gateway/routers/artifacts.py`
- Test: `backend/tests/test_artifacts_router.py`

---

**Step 1: Write failing tests**

Add to the bottom of `backend/tests/test_artifacts_router.py`:

```python
import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


def _make_minio_config():
    minio_cfg = SimpleNamespace(
        endpoint="localhost:9000",
        access_key="minioadmin",
        secret_key="deerflow123",
        bucket="deerflow-uploads",
        secure=False,
    )
    return SimpleNamespace(backend="minio", minio=minio_cfg)


def test_get_artifact_falls_back_to_minio_when_local_missing(monkeypatch):
    """Serve file from MinIO when local path does not exist."""
    missing_path = MagicMock()
    missing_path.exists.return_value = False
    missing_path.name = "report.xlsx"

    mock_backend = MagicMock()
    mock_backend.load.return_value = b"xlsx-bytes"

    monkeypatch.setattr(artifacts_router, "resolve_thread_virtual_path", lambda _t, _p: missing_path)

    with patch("app.gateway.routers.artifacts.get_uploads_config", return_value=_make_minio_config()), \
         patch("app.gateway.routers.artifacts.MinioUploadBackend", return_value=mock_backend):
        response = asyncio.run(
            artifacts_router.get_artifact(
                "thread-1",
                "mnt/user-data/outputs/report.xlsx",
                _make_request(),
            )
        )

    mock_backend.load.assert_called_once_with("thread-1", "outputs/report.xlsx")
    assert response.body == b"xlsx-bytes"


def test_get_artifact_returns_404_when_missing_locally_and_no_minio(monkeypatch):
    """Return 404 when local file is missing and MinIO is not configured."""
    missing_path = MagicMock()
    missing_path.exists.return_value = False

    monkeypatch.setattr(artifacts_router, "resolve_thread_virtual_path", lambda _t, _p: missing_path)

    with patch(
        "app.gateway.routers.artifacts.get_uploads_config",
        return_value=SimpleNamespace(backend="local", minio=None),
    ):
        with pytest.raises(Exception) as exc_info:
            asyncio.run(
                artifacts_router.get_artifact(
                    "thread-1",
                    "mnt/user-data/outputs/missing.txt",
                    _make_request(),
                )
            )

    assert exc_info.value.status_code == 404


def test_get_artifact_local_file_takes_priority_over_minio(tmp_path, monkeypatch):
    """Local file is served directly; MinIO is never called."""
    artifact_path = tmp_path / "note.txt"
    artifact_path.write_text("local content")

    monkeypatch.setattr(artifacts_router, "resolve_thread_virtual_path", lambda _t, _p: artifact_path)

    mock_backend_cls = MagicMock()
    with patch("app.gateway.routers.artifacts.get_uploads_config", return_value=_make_minio_config()), \
         patch("app.gateway.routers.artifacts.MinioUploadBackend", mock_backend_cls):
        response = asyncio.run(
            artifacts_router.get_artifact(
                "thread-1",
                "mnt/user-data/outputs/note.txt",
                _make_request(),
            )
        )

    mock_backend_cls.assert_not_called()
    assert b"local content" in bytes(response.body)
```

**Step 2: Run tests to verify they fail**

```bash
cd backend
PYTHONPATH=. uv run pytest tests/test_artifacts_router.py -k "minio" -v
```

Expected: `FAILED` — `ImportError` or `AttributeError` on `get_uploads_config`

---

**Step 3: Implement MinIO fallback in `artifacts.py`**

Add two imports near the top of `backend/app/gateway/routers/artifacts.py` (after the existing imports):

```python
from deerflow.config.uploads_config import get_uploads_config
```

Replace the `if not actual_path.exists():` block (currently a simple 404) with:

```python
    if not actual_path.exists():
        # MinIO fallback: try to serve from object storage when local file is absent.
        # Object key convention: outputs/{relative_virtual_path}
        # e.g. virtual "mnt/user-data/outputs/report.xlsx" → "outputs/report.xlsx"
        uploads_cfg = get_uploads_config()
        if uploads_cfg.backend == "minio" and uploads_cfg.minio:
            _OUTPUTS_PREFIX = "mnt/user-data/outputs/"
            if path.startswith(_OUTPUTS_PREFIX):
                relative = path[len(_OUTPUTS_PREFIX):]
                object_key = f"outputs/{relative}"
                try:
                    from deerflow.uploads.backends.minio import MinioUploadBackend

                    backend = MinioUploadBackend(
                        endpoint=uploads_cfg.minio.endpoint,
                        access_key=uploads_cfg.minio.access_key,
                        secret_key=uploads_cfg.minio.secret_key,
                        bucket=uploads_cfg.minio.bucket,
                        secure=uploads_cfg.minio.secure,
                    )
                    data = backend.load(thread_id, object_key)
                    mime_type, _ = mimetypes.guess_type(actual_path.name)
                    logger.info("Served artifact from MinIO: %s/%s", thread_id, object_key)
                    return Response(
                        content=data,
                        media_type=mime_type or "application/octet-stream",
                        headers={"Content-Disposition": _build_content_disposition("inline", actual_path.name)},
                    )
                except FileNotFoundError:
                    pass  # fall through to 404
                except Exception:
                    logger.warning("MinIO fallback failed for %s/%s", thread_id, object_key, exc_info=True)

        raise HTTPException(status_code=404, detail=f"Artifact not found: {path}")
```

The existing `if not actual_path.exists(): raise HTTPException(status_code=404 ...)` line is **replaced** by the block above.

**Step 4: Run tests to verify they pass**

```bash
cd backend
PYTHONPATH=. uv run pytest tests/test_artifacts_router.py -v
```

Expected: all tests `PASSED`

---

**Step 5: Run full test suite**

```bash
cd backend
PYTHONPATH=. uv run pytest tests/ -v --tb=short
```

Expected: all pre-existing tests still pass.

---

**Step 6: Commit**

```bash
cd backend
git add app/gateway/routers/artifacts.py \
        tests/test_artifacts_router.py
git commit -m "feat(artifacts): fall back to MinIO when local output file is missing"
```
