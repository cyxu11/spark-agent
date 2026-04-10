"""Local filesystem outputs backend — wraps existing artifacts logic."""
from __future__ import annotations
from pathlib import Path
from starlette.responses import FileResponse, Response
from .base import OutputsBackend


class LocalOutputsBackend(OutputsBackend):
    """Pass-through backend that serves files from local disk (current behavior)."""

    def __init__(self, paths=None) -> None:
        self._paths = paths

    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        # No-op for local backend; file is already on disk.
        return str(local_path)

    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        if self._paths is None:
            from deerflow.config.paths import get_paths
            self._paths = get_paths()
        actual_path = self._paths.resolve_virtual_path(thread_id, virtual_path)
        return FileResponse(path=actual_path)

    async def delete_thread(self, thread_id: str) -> None:
        # Thread dir cleanup is handled by paths.delete_thread_dir elsewhere.
        pass

    async def sync_directory(self, thread_id: str, local_dir: Path, subdir: str) -> None:
        # No-op for local backend; files are already on disk.
        pass
