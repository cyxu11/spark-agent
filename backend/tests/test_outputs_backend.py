"""Tests for outputs storage backends."""
import io
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import pytest


def test_local_backend_get_response_returns_file_response(tmp_path):
    """LocalOutputsBackend.get_response should return a FileResponse for existing files."""
    from deerflow.outputs.backends.local import LocalOutputsBackend

    paths = MagicMock()
    sample_file = tmp_path / "report.pdf"
    sample_file.write_bytes(b"PDF content")
    paths.resolve_virtual_path.return_value = sample_file

    backend = LocalOutputsBackend(paths=paths)
    import asyncio
    response = asyncio.get_event_loop().run_until_complete(
        backend.get_response("tid-1", "/mnt/user-data/outputs/report.pdf")
    )
    assert response.path == sample_file


@pytest.mark.asyncio
async def test_minio_backend_upload_calls_put_object(tmp_path):
    """MinioOutputsBackend.upload should call minio client put_object."""
    from deerflow.outputs.backends.minio import MinioOutputsBackend

    sample = tmp_path / "chart.png"
    sample.write_bytes(b"\x89PNG")

    mock_client = MagicMock()
    mock_client.put_object = MagicMock()
    mock_client.bucket_exists.return_value = True

    backend = MinioOutputsBackend.__new__(MinioOutputsBackend)
    backend._client = mock_client
    backend._bucket = "deerflow-outputs"

    key = await backend.upload("tid-1", "/mnt/user-data/outputs/chart.png", sample)
    assert mock_client.put_object.called
    assert "tid-1" in key
    assert "chart.png" in key


@pytest.mark.asyncio
async def test_minio_backend_delete_thread_removes_objects(tmp_path):
    """MinioOutputsBackend.delete_thread should remove all objects under thread prefix."""
    from deerflow.outputs.backends.minio import MinioOutputsBackend

    mock_client = MagicMock()
    mock_obj = MagicMock()
    mock_obj.object_name = "outputs/tid-1/report.pdf"
    mock_client.list_objects.return_value = [mock_obj]
    mock_client.remove_object = MagicMock()

    backend = MinioOutputsBackend.__new__(MinioOutputsBackend)
    backend._client = mock_client
    backend._bucket = "deerflow-outputs"

    await backend.delete_thread("tid-1")
    mock_client.remove_object.assert_called_once_with("deerflow-outputs", "outputs/tid-1/report.pdf")
