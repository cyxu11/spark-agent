"""Abstract interface for outputs storage backends."""
from __future__ import annotations
import abc
from pathlib import Path
from starlette.responses import Response


class OutputsBackend(abc.ABC):
    @abc.abstractmethod
    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        """Upload file to storage; return the object key."""

    @abc.abstractmethod
    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        """Return HTTP response suitable for streaming/downloading the file."""

    @abc.abstractmethod
    async def delete_thread(self, thread_id: str) -> None:
        """Remove all outputs for a thread (called on thread deletion)."""

    @abc.abstractmethod
    async def sync_directory(self, thread_id: str, local_dir: Path, subdir: str) -> None:
        """Sync all files in local_dir to storage under {thread_id}/{subdir}/."""

    @staticmethod
    def _object_key(thread_id: str, virtual_path: str) -> str:
        """Derive MinIO key: {thread_id}/{subdir}/{relative_path}

        /mnt/user-data/outputs/file.xlsx   → {thread_id}/outputs/file.xlsx
        /mnt/user-data/workspace/script.py → {thread_id}/workspace/script.py
        """
        prefix = "/mnt/user-data/"
        if virtual_path.startswith(prefix):
            relative = virtual_path[len(prefix):]
        else:
            filename = virtual_path.lstrip("/").split("/")[-1]
            relative = f"outputs/{filename}"
        return f"{thread_id}/{relative}"
