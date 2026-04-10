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

    @staticmethod
    def _object_key(thread_id: str, virtual_path: str) -> str:
        """Derive a stable MinIO object key from thread_id + virtual_path."""
        # e.g. "outputs/tid-abc123/report.pdf"
        filename = virtual_path.lstrip("/").split("/")[-1]
        return f"outputs/{thread_id}/{filename}"
