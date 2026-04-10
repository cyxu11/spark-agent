"""Configuration for file upload backends."""
from typing import Literal
from pydantic import BaseModel, Field
class MinioConfig(BaseModel):
    endpoint: str
    access_key: str
    secret_key: str
    bucket: str = "deerflow-uploads"
    secure: bool = False
class UploadsConfig(BaseModel):
    backend: Literal["local", "minio"] = "local"
    minio: MinioConfig | None = None
_uploads_config: UploadsConfig | None = None
def get_uploads_config() -> UploadsConfig:
    return _uploads_config or UploadsConfig()
def set_uploads_config(config: UploadsConfig) -> None:
    global _uploads_config
    _uploads_config = config
def load_uploads_config_from_dict(config_dict: dict) -> None:
    global _uploads_config
    _uploads_config = UploadsConfig(**config_dict)
