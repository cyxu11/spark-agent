"""Tests for MinioUploadBackend using moto/minio mock."""
import pytest
import io
from unittest.mock import MagicMock, patch
def make_minio_backend():
    from deerflow.uploads.backends.minio import MinioUploadBackend
    with patch("deerflow.uploads.backends.minio.MinioUploadBackend._ensure_bucket"):
        return MinioUploadBackend(
            endpoint="localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
            bucket="test-bucket",
            secure=False,
        )
def test_save_and_load_roundtrip():
    """save then load should return the same bytes."""
    backend = make_minio_backend()
    data = b"hello world"
    with patch.object(backend._client, "put_object") as mock_put, \
         patch.object(backend._client, "get_object") as mock_get:
        mock_get.return_value = MagicMock(
            read=lambda: data,
            __enter__=lambda s: s,
            __exit__=MagicMock(return_value=False),
        )
        backend.save("thread-1", "file.txt", data, content_type="text/plain")
        mock_put.assert_called_once()
        result = backend.load("thread-1", "file.txt")
        assert result == data
def test_get_url_format():
    """get_url should return a presigned-style URL string."""
    backend = make_minio_backend()
    with patch.object(backend._client, "presigned_get_object", return_value="http://localhost:9000/test-bucket/thread-1/file.txt"):
        url = backend.get_url("thread-1", "file.txt")
        assert "thread-1" in url
        assert "file.txt" in url
def test_delete_calls_remove_object():
    """delete should call minio remove_object."""
    backend = make_minio_backend()
    with patch.object(backend._client, "remove_object") as mock_rm:
        backend.delete("thread-1", "file.txt")
        mock_rm.assert_called_once_with("test-bucket", "thread-1/file.txt")
