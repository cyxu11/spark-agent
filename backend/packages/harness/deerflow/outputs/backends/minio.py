"""MinIO-backed outputs backend for multi-node deployments."""
from __future__ import annotations
import io
import logging
import mimetypes
from pathlib import Path
from starlette.responses import Response, StreamingResponse
from .base import OutputsBackend

logger = logging.getLogger(__name__)


class MinioOutputsBackend(OutputsBackend):
    def __init__(self, *, endpoint: str, access_key: str, secret_key: str,
                 bucket: str, secure: bool = False) -> None:
        try:
            from minio import Minio
        except ImportError as exc:
            raise ImportError("Install minio: uv add minio") from exc
        from minio import Minio
        self._client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        self._bucket = bucket
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)

    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        key = self._object_key(thread_id, virtual_path)
        content_type, _ = mimetypes.guess_type(local_path.name)
        content_type = content_type or "application/octet-stream"
        data = local_path.read_bytes()
        self._client.put_object(
            self._bucket, key, io.BytesIO(data), length=len(data), content_type=content_type
        )
        logger.debug("Uploaded output to MinIO: bucket=%s key=%s", self._bucket, key)
        return key

    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        key = self._object_key(thread_id, virtual_path)
        try:
            obj = self._client.get_object(self._bucket, key)
            content_type, _ = mimetypes.guess_type(virtual_path)
            content_type = content_type or "application/octet-stream"
            return StreamingResponse(obj, media_type=content_type)
        except Exception as e:
            logger.warning("MinIO get_response failed for key=%s: %s", key, e)
            raise

    async def delete_thread(self, thread_id: str) -> None:
        prefix = f"outputs/{thread_id}/"
        objects = self._client.list_objects(self._bucket, prefix=prefix, recursive=True)
        for obj in objects:
            self._client.remove_object(self._bucket, obj.object_name)
