"""Abstract upload backend interface."""
from __future__ import annotations
import abc
class UploadBackend(abc.ABC):
    """Abstract base for file upload backends."""
    @abc.abstractmethod
    def save(self, thread_id: str, filename: str, data: bytes, *, content_type: str = "application/octet-stream") -> None:
        """Persist file data."""
    @abc.abstractmethod
    def load(self, thread_id: str, filename: str) -> bytes:
        """Return file bytes. Raises FileNotFoundError if missing."""
    @abc.abstractmethod
    def delete(self, thread_id: str, filename: str) -> None:
        """Remove a file. No-op if not found."""
    @abc.abstractmethod
    def get_url(self, thread_id: str, filename: str, *, expires: int = 3600) -> str:
        """Return a URL to access the file (presigned or virtual path)."""
    @abc.abstractmethod
    def list_files(self, thread_id: str) -> list[str]:
        """Return list of filenames for a thread."""
