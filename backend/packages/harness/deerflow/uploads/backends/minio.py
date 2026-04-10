"""MinIO upload backend."""
from __future__ import annotations
import io
import logging
from datetime import timedelta
from .base import UploadBackend
logger = logging.getLogger(__name__)
class MinioUploadBackend(UploadBackend):
    """Upload backend backed by MinIO (or any S3-compatible store)."""
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
    ) -> None:
        try:
            from minio import Minio
        except ImportError as exc:
            raise ImportError("Install minio: uv add minio") from exc
        self._client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        self._bucket = bucket
        self._ensure_bucket()
    def _ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)
            logger.info("MinIO: created bucket %s", self._bucket)
    def _object_name(self, thread_id: str, filename: str) -> str:
        return f"{thread_id}/uploads/{filename}"
    def save(self, thread_id: str, filename: str, data: bytes, *, content_type: str = "application/octet-stream") -> None:
        name = self._object_name(thread_id, filename)
        self._client.put_object(
            self._bucket, name, io.BytesIO(data), length=len(data), content_type=content_type
        )
    def load(self, thread_id: str, filename: str) -> bytes:
        name = self._object_name(thread_id, filename)
        response = self._client.get_object(self._bucket, name)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    def delete(self, thread_id: str, filename: str) -> None:
        name = self._object_name(thread_id, filename)
        self._client.remove_object(self._bucket, name)
    def get_url(self, thread_id: str, filename: str, *, expires: int = 3600) -> str:
        name = self._object_name(thread_id, filename)
        return self._client.presigned_get_object(
            self._bucket, name, expires=timedelta(seconds=expires)
        )
    def list_files(self, thread_id: str) -> list[str]:
        prefix = f"{thread_id}/uploads/"
        objects = self._client.list_objects(self._bucket, prefix=prefix)
        return [obj.object_name[len(prefix):] for obj in objects]
