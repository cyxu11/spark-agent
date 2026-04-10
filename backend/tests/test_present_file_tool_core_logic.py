"""Core behavior tests for present_files path normalization."""

import importlib
from types import SimpleNamespace

present_file_tool_module = importlib.import_module("deerflow.tools.builtins.present_file_tool")


def _make_runtime(outputs_path: str) -> SimpleNamespace:
    return SimpleNamespace(
        state={"thread_data": {"outputs_path": outputs_path}},
        context={"thread_id": "thread-1"},
    )


def test_present_files_normalizes_host_outputs_path(tmp_path):
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact_path = outputs_dir / "report.md"
    artifact_path.write_text("ok")

    result = present_file_tool_module.present_file_tool.func(
        runtime=_make_runtime(str(outputs_dir)),
        filepaths=[str(artifact_path)],
        tool_call_id="tc-1",
    )

    assert result.update["artifacts"] == ["/mnt/user-data/outputs/report.md"]
    assert result.update["messages"][0].content == "Successfully presented files"


def test_present_files_keeps_virtual_outputs_path(tmp_path, monkeypatch):
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact_path = outputs_dir / "summary.json"
    artifact_path.write_text("{}")

    monkeypatch.setattr(
        present_file_tool_module,
        "get_paths",
        lambda: SimpleNamespace(resolve_virtual_path=lambda thread_id, path: artifact_path),
    )

    result = present_file_tool_module.present_file_tool.func(
        runtime=_make_runtime(str(outputs_dir)),
        filepaths=["/mnt/user-data/outputs/summary.json"],
        tool_call_id="tc-2",
    )

    assert result.update["artifacts"] == ["/mnt/user-data/outputs/summary.json"]


def test_present_files_rejects_paths_outside_outputs(tmp_path):
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    workspace_dir = tmp_path / "threads" / "thread-1" / "user-data" / "workspace"
    outputs_dir.mkdir(parents=True)
    workspace_dir.mkdir(parents=True)
    leaked_path = workspace_dir / "notes.txt"
    leaked_path.write_text("leak")

    result = present_file_tool_module.present_file_tool.func(
        runtime=_make_runtime(str(outputs_dir)),
        filepaths=[str(leaked_path)],
        tool_call_id="tc-3",
    )

    assert "artifacts" not in result.update
    assert result.update["messages"][0].content == f"Error: Only files in /mnt/user-data/outputs can be presented: {leaked_path}"


from unittest.mock import MagicMock, patch


def _make_minio_config():
    """Return a UploadsConfig-shaped namespace with MinIO enabled."""
    minio_cfg = SimpleNamespace(
        endpoint="localhost:9000",
        access_key="minioadmin",
        secret_key="deerflow123",
        bucket="deerflow-uploads",
        secure=False,
    )
    return SimpleNamespace(backend="minio", minio=minio_cfg)


def test_present_files_uploads_to_minio_when_configured(tmp_path, monkeypatch):
    """Files are uploaded to MinIO with key outputs/{filename}."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "report.xlsx"
    artifact.write_bytes(b"xlsx-content")

    mock_backend = MagicMock()

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: _make_minio_config(),
    )
    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        return_value=mock_backend,
    ):
        result = present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-minio-1",
        )

    assert result.update["artifacts"] == ["/mnt/user-data/outputs/report.xlsx"]
    mock_backend.save.assert_called_once_with(
        "thread-1",
        "outputs/report.xlsx",
        b"xlsx-content",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def test_present_files_skips_minio_when_not_configured(tmp_path, monkeypatch):
    """No MinIO upload when backend is 'local'."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "notes.txt"
    artifact.write_text("hello")

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: SimpleNamespace(backend="local", minio=None),
    )
    mock_backend_cls = MagicMock()

    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        mock_backend_cls,
    ):
        present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-no-minio",
        )

    mock_backend_cls.assert_not_called()


def test_present_files_minio_failure_is_nonfatal(tmp_path, monkeypatch):
    """MinIO upload error is logged as warning; tool still succeeds."""
    outputs_dir = tmp_path / "threads" / "thread-1" / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True)
    artifact = outputs_dir / "data.csv"
    artifact.write_text("a,b\n1,2")

    mock_backend = MagicMock()
    mock_backend.save.side_effect = Exception("connection refused")

    monkeypatch.setattr(
        present_file_tool_module,
        "get_uploads_config",
        lambda: _make_minio_config(),
    )
    with patch(
        "deerflow.tools.builtins.present_file_tool.MinioUploadBackend",
        return_value=mock_backend,
    ):
        result = present_file_tool_module.present_file_tool.func(
            runtime=_make_runtime(str(outputs_dir)),
            filepaths=[str(artifact)],
            tool_call_id="tc-fail",
        )

    assert result.update["artifacts"] == ["/mnt/user-data/outputs/data.csv"]
    assert result.update["messages"][0].content == "Successfully presented files"
