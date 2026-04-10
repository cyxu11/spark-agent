"""Configuration for outputs storage backend."""
from __future__ import annotations
from pydantic import BaseModel, Field


class MinioOutputsConfig(BaseModel):
    endpoint: str = Field(default="localhost:9000")
    access_key: str = Field(default="minioadmin")
    secret_key: str = Field(default="minioadmin")
    bucket: str = Field(default="deerflow-outputs")
    secure: bool = Field(default=False)


class OutputsConfig(BaseModel):
    backend: str = Field(default="local", description="'local' or 'minio'")
    minio: MinioOutputsConfig = Field(default_factory=MinioOutputsConfig)
