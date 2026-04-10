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

try:
    from deerflow.uploads.backends.minio import MinioUploadBackend
except ImportError:
    MinioUploadBackend = None  # type: ignore[assignment,misc]


def _normalize_presented_filepath(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepath: str,
) -> str:
    """Normalize a presented file path to the `/mnt/user-data/outputs/*` contract.

    Accepts either:
    - A virtual sandbox path such as `/mnt/user-data/outputs/report.md`
    - A host-side thread outputs path such as
      `/app/backend/.deer-flow/threads/<thread>/user-data/outputs/report.md`

    Returns:
        The normalized virtual path.

    Raises:
        ValueError: If runtime metadata is missing or the path is outside the
            current thread's outputs directory.
    """
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

    # The merge_artifacts reducer will handle merging and deduplication
    return Command(
        update={
            "artifacts": normalized_paths,
            "messages": [ToolMessage("Successfully presented files", tool_call_id=tool_call_id)],
        },
    )
