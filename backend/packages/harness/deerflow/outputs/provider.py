"""Factory for outputs backend — selects local or MinIO based on config."""
from __future__ import annotations
from .backends.base import OutputsBackend

_backend_instance: OutputsBackend | None = None


def get_outputs_backend() -> OutputsBackend:
    global _backend_instance
    if _backend_instance is not None:
        return _backend_instance
    _backend_instance = _create_backend()
    return _backend_instance


def _create_backend() -> OutputsBackend:
    try:
        from deerflow.config import get_app_config
        cfg = get_app_config().outputs
    except Exception:
        from .backends.local import LocalOutputsBackend
        return LocalOutputsBackend()

    if cfg.backend == "minio":
        from .backends.minio import MinioOutputsBackend
        m = cfg.minio
        return MinioOutputsBackend(
            endpoint=m.endpoint,
            access_key=m.access_key,
            secret_key=m.secret_key,
            bucket=m.bucket,
            secure=m.secure,
        )
    from .backends.local import LocalOutputsBackend
    return LocalOutputsBackend()
