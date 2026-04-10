"""MinIO-backed outputs backend for multi-node deployments."""
from __future__ import annotations
import asyncio
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
        self._bucket_ensured = False  # lazy: checked on first async operation

    def _ensure_bucket(self) -> None:
        """Synchronous bucket check — must only be called from a thread pool worker."""
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)
        self._bucket_ensured = True

    async def _ensure_bucket_async(self) -> None:
        """Ensure bucket exists without blocking the event loop."""
        if self._bucket_ensured:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._ensure_bucket)

    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        await self._ensure_bucket_async()
        key = self._object_key(thread_id, virtual_path)
        content_type, _ = mimetypes.guess_type(local_path.name)
        content_type = content_type or "application/octet-stream"
        data = local_path.read_bytes()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: self._client.put_object(
                self._bucket, key, io.BytesIO(data), length=len(data), content_type=content_type
            ),
        )
        logger.debug("Uploaded output to MinIO: bucket=%s key=%s", self._bucket, key)
        return key

    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        await self._ensure_bucket_async()
        key = self._object_key(thread_id, virtual_path)
        try:
            loop = asyncio.get_running_loop()
            obj = await loop.run_in_executor(None, lambda: self._client.get_object(self._bucket, key))
            content_type, _ = mimetypes.guess_type(virtual_path)
            content_type = content_type or "application/octet-stream"
            return StreamingResponse(obj, media_type=content_type)
        except Exception as e:
            logger.warning("MinIO get_response failed for key=%s: %s", key, e)
            raise

    async def delete_thread(self, thread_id: str) -> None:
        await self._ensure_bucket_async()
        prefix = f"{thread_id}/"
        loop = asyncio.get_running_loop()
        objects = await loop.run_in_executor(
            None, lambda: list(self._client.list_objects(self._bucket, prefix=prefix, recursive=True))
        )
        for obj in objects:
            await loop.run_in_executor(None, lambda o=obj: self._client.remove_object(self._bucket, o.object_name))

    async def sync_directory(self, thread_id: str, local_dir: Path, subdir: str) -> None:
        """Sync all files in local_dir to MinIO under {thread_id}/{subdir}/."""
        await self._ensure_bucket_async()
        loop = asyncio.get_running_loop()
        for file_path in local_dir.rglob("*"):
            if not file_path.is_file():
                continue
            relative = file_path.relative_to(local_dir)
            key = f"{thread_id}/{subdir}/{relative}"
            content_type, _ = mimetypes.guess_type(file_path.name)
            content_type = content_type or "application/octet-stream"
            data = file_path.read_bytes()
            await loop.run_in_executor(
                None,
                lambda k=key, d=data, ct=content_type: self._client.put_object(
                    self._bucket, k, io.BytesIO(d), length=len(d), content_type=ct
                ),
            )
            logger.debug("Synced workspace file to MinIO: bucket=%s key=%s", self._bucket, key)
