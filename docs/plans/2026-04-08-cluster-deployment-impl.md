# 集群部署分布式存储升级 Implementation Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
**Goal:** 将 DeerFlow 从单节点本地存储升级为双节点集群，使用 PostgreSQL + Redis + MinIO 支持 400 人并发。
**Architecture:** 应用节点（A/B）完全无状态，所有状态通过三个中间件共享：PostgreSQL 存 LangGraph checkpoints/store 和 Agent 记忆，Redis Streams 承载跨节点 SSE 事件流，MinIO 存用户上传文件。前置 Nginx 以 least_conn 轮询分发流量，无需会话粘滞。
**Tech Stack:** PostgreSQL 16, Redis 7, MinIO (minio-py SDK), langgraph-checkpoint-postgres, aioredis / redis-py[hiredis], Docker Compose
**设计文档：** `docs/plans/2026-04-08-cluster-deployment-design.md`
---
## Task 1: RedisStreamBridge — 核心实现
**Files:**
- Create: `backend/packages/harness/deerflow/runtime/stream_bridge/redis.py`
- Modify: `backend/packages/harness/deerflow/runtime/stream_bridge/async_provider.py`
- Test: `backend/tests/test_redis_stream_bridge.py`
**背景：** `MemoryStreamBridge` 是进程内实现，跨节点 SSE 断线重连会丢事件。需实现 `RedisStreamBridge`，用 Redis Streams 作为跨进程事件总线。`async_provider.py` 中 Redis 分支已有接口骨架，抛出 `NotImplementedError`。
**Step 1: 安装依赖**
```bash
cd backend
uv add "redis[hiredis]>=5.0"
```
Expected: `uv.lock` 更新，无报错。
**Step 2: 写失败测试**
创建 `backend/tests/test_redis_stream_bridge.py`：
```python
"""Tests for RedisStreamBridge using a real Redis instance (fakeredis)."""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from deerflow.runtime.stream_bridge.base import END_SENTINEL, HEARTBEAT_SENTINEL
@pytest.fixture
def fake_redis():
    """Provide a fakeredis async client."""
    import fakeredis.aioredis
    return fakeredis.aioredis.FakeRedis()
@pytest.mark.asyncio
async def test_publish_and_subscribe_single_event(fake_redis):
    """publish then subscribe should yield the event."""
    from deerflow.runtime.stream_bridge.redis import RedisStreamBridge
    bridge = RedisStreamBridge(redis=fake_redis)
    await bridge.publish("run-1", "updates", {"msg": "hello"})
    await bridge.publish_end("run-1")
    events = []
    async for event in bridge.subscribe("run-1"):
        if event is END_SENTINEL:
            break
        events.append(event)
    assert len(events) == 1
    assert events[0].event == "updates"
    assert events[0].data == {"msg": "hello"}
@pytest.mark.asyncio
async def test_subscribe_replays_from_last_event_id(fake_redis):
    """subscribe with last_event_id should replay only subsequent events."""
    from deerflow.runtime.stream_bridge.redis import RedisStreamBridge
    bridge = RedisStreamBridge(redis=fake_redis)
    await bridge.publish("run-2", "updates", {"seq": 1})
    await bridge.publish("run-2", "updates", {"seq": 2})
    await bridge.publish("run-2", "updates", {"seq": 3})
    await bridge.publish_end("run-2")
    # collect first event id
    first_id = None
    async for event in bridge.subscribe("run-2"):
        if event is END_SENTINEL:
            break
        if first_id is None:
            first_id = event.id
    # replay from after first event
    replayed = []
    async for event in bridge.subscribe("run-2", last_event_id=first_id):
        if event is END_SENTINEL:
            break
        replayed.append(event)
    assert len(replayed) == 2
    assert replayed[0].data == {"seq": 2}
    assert replayed[1].data == {"seq": 3}
@pytest.mark.asyncio
async def test_cleanup_removes_stream(fake_redis):
    """cleanup should delete the Redis stream key."""
    from deerflow.runtime.stream_bridge.redis import RedisStreamBridge
    bridge = RedisStreamBridge(redis=fake_redis)
    await bridge.publish("run-3", "updates", {})
    await bridge.cleanup("run-3")
    exists = await fake_redis.exists("stream:run-3")
    assert exists == 0
```
**Step 3: 运行测试确认失败**
```bash
cd backend
uv add fakeredis --dev
uv run pytest tests/test_redis_stream_bridge.py -v
```
Expected: `ImportError: cannot import name 'RedisStreamBridge'`
**Step 4: 实现 RedisStreamBridge**
创建 `backend/packages/harness/deerflow/runtime/stream_bridge/redis.py`：
```python
"""Redis Streams-backed stream bridge for multi-process/multi-node deployments."""
from __future__ import annotations
import json
import logging
from collections.abc import AsyncIterator
from typing import Any
from .base import END_SENTINEL, HEARTBEAT_SENTINEL, StreamBridge, StreamEvent
logger = logging.getLogger(__name__)
_STREAM_PREFIX = "stream:"
_END_EVENT = "__end__"
class RedisStreamBridge(StreamBridge):
    """Cross-process stream bridge backed by Redis Streams.
    Each run gets its own Redis stream key ``stream:{run_id}``.
    Events are stored as Redis stream entries and consumed via XREAD BLOCK,
    enabling multi-node SSE with Last-Event-ID replay.
    """
    def __init__(self, *, redis, ttl: int = 3600) -> None:
        """
        Args:
            redis: An async Redis client (redis.asyncio.Redis or fakeredis equivalent).
            ttl: Seconds to keep stream keys after publish_end (default 1 hour).
        """
        self._redis = redis
        self._ttl = ttl
    def _key(self, run_id: str) -> str:
        return f"{_STREAM_PREFIX}{run_id}"
    async def publish(self, run_id: str, event: str, data: Any) -> None:
        key = self._key(run_id)
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        await self._redis.xadd(key, {"payload": payload})
    async def publish_end(self, run_id: str) -> None:
        key = self._key(run_id)
        payload = json.dumps({"event": _END_EVENT, "data": None})
        await self._redis.xadd(key, {"payload": payload})
        # Set TTL so streams are cleaned up automatically
        await self._redis.expire(key, self._ttl)
    async def subscribe(
        self,
        run_id: str,
        *,
        last_event_id: str | None = None,
        heartbeat_interval: float = 15.0,
    ) -> AsyncIterator[StreamEvent]:
        key = self._key(run_id)
        # Redis XREAD uses "$" for new-only or a specific entry ID for replay
        start_id = last_event_id if last_event_id else "0-0"
        while True:
            # Block up to heartbeat_interval seconds waiting for new entries
            block_ms = int(heartbeat_interval * 1000)
            results = await self._redis.xread(
                {key: start_id}, count=10, block=block_ms
            )
            if not results:
                yield HEARTBEAT_SENTINEL
                continue
            for _stream_key, entries in results:
                for entry_id, fields in entries:
                    raw = fields.get(b"payload") or fields.get("payload")
                    if raw is None:
                        continue
                    msg = json.loads(raw)
                    event_name = msg["event"]
                    event_data = msg["data"]
                    if event_name == _END_EVENT:
                        yield END_SENTINEL
                        return
                    # entry_id from Redis is bytes, decode to str
                    eid = entry_id.decode() if isinstance(entry_id, bytes) else entry_id
                    yield StreamEvent(id=eid, event=event_name, data=event_data)
                    start_id = entry_id  # advance cursor
    async def cleanup(self, run_id: str, *, delay: float = 0) -> None:
        if delay > 0:
            import asyncio
            await asyncio.sleep(delay)
        await self._redis.delete(self._key(run_id))
    async def close(self) -> None:
        await self._redis.aclose()
```
**Step 5: 解锁 async_provider.py 中的 Redis 分支**
修改 `backend/packages/harness/deerflow/runtime/stream_bridge/async_provider.py`，将 Redis 分支的 `NotImplementedError` 替换为实际实现：
```python
    if config.type == "redis":
        if not config.redis_url:
            raise ValueError("stream_bridge.redis_url is required for redis type")
        try:
            from redis.asyncio import Redis as AsyncRedis
        except ImportError as exc:
            raise ImportError(
                "Install redis: uv add 'redis[hiredis]'"
            ) from exc
        from deerflow.runtime.stream_bridge.redis import RedisStreamBridge
        redis_client = AsyncRedis.from_url(config.redis_url)
        bridge = RedisStreamBridge(redis=redis_client)
        logger.info("Stream bridge initialised: redis (%s)", config.redis_url)
        try:
            yield bridge
        finally:
            await bridge.close()
        return
```
**Step 6: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_redis_stream_bridge.py -v
```
Expected: 3 tests PASS
**Step 7: Commit**
```bash
git add backend/packages/harness/deerflow/runtime/stream_bridge/redis.py \
        backend/packages/harness/deerflow/runtime/stream_bridge/async_provider.py \
        backend/tests/test_redis_stream_bridge.py \
        backend/pyproject.toml backend/uv.lock
git commit -m "feat(stream-bridge): implement RedisStreamBridge for multi-node SSE"
```
---
## Task 2: MinIO 上传后端
**Files:**
- Create: `backend/packages/harness/deerflow/uploads/backends/__init__.py`
- Create: `backend/packages/harness/deerflow/uploads/backends/base.py`
- Create: `backend/packages/harness/deerflow/uploads/backends/local.py`
- Create: `backend/packages/harness/deerflow/uploads/backends/minio.py`
- Modify: `backend/packages/harness/deerflow/uploads/manager.py`
- Create: `backend/packages/harness/deerflow/config/uploads_config.py`
- Modify: `backend/packages/harness/deerflow/config/app_config.py`
- Test: `backend/tests/test_minio_upload_backend.py`
**背景：** 现有 `uploads/manager.py` 直接调用 `Path.write_bytes` / `Path.read_bytes`，绑定本地文件系统。需抽象出后端接口，新增 MinIO 实现，通过配置切换。
**Step 1: 安装依赖**
```bash
cd backend
uv add "minio>=7.2"
```
**Step 2: 写失败测试**
创建 `backend/tests/test_minio_upload_backend.py`：
```python
"""Tests for MinioUploadBackend using moto/minio mock."""
import pytest
import io
from unittest.mock import MagicMock, patch
def make_minio_backend():
    from deerflow.uploads.backends.minio import MinioUploadBackend
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
```
**Step 3: 运行确认失败**
```bash
cd backend
uv run pytest tests/test_minio_upload_backend.py -v
```
Expected: `ImportError: cannot import name 'MinioUploadBackend'`
**Step 4: 创建抽象接口**
创建 `backend/packages/harness/deerflow/uploads/backends/base.py`：
```python
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
```
创建 `backend/packages/harness/deerflow/uploads/backends/minio.py`：
```python
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
        return f"{thread_id}/{filename}"
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
        objects = self._client.list_objects(self._bucket, prefix=f"{thread_id}/")
        return [obj.object_name.split("/", 1)[1] for obj in objects]
```
创建 `backend/packages/harness/deerflow/uploads/backends/__init__.py`：
```python
from .base import UploadBackend
from .minio import MinioUploadBackend
__all__ = ["UploadBackend", "MinioUploadBackend"]
```
**Step 5: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_minio_upload_backend.py -v
```
Expected: 3 tests PASS
**Step 6: 新增 UploadsConfig**
创建 `backend/packages/harness/deerflow/config/uploads_config.py`：
```python
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
```
**Step 7: 将 UploadsConfig 接入 app_config.py**
在 `backend/packages/harness/deerflow/config/app_config.py` 中添加 uploads 字段加载（参考现有 checkpointer 字段的加载模式）。
**Step 8: Commit**
```bash
git add backend/packages/harness/deerflow/uploads/ \
        backend/packages/harness/deerflow/config/uploads_config.py \
        backend/tests/test_minio_upload_backend.py \
        backend/pyproject.toml backend/uv.lock
git commit -m "feat(uploads): add MinioUploadBackend for cluster-shared file storage"
```
---
## Task 3: PostgresMemoryStorage
**Files:**
- Create: `backend/packages/harness/deerflow/agents/memory/postgres_storage.py`
- Modify: `backend/packages/harness/deerflow/agents/memory/storage.py`
- Test: `backend/tests/test_postgres_memory_storage.py`
**背景：** `FileMemoryStorage` 读写本地 JSON 文件，多节点会有读写竞争。新增 `PostgresMemoryStorage`，通过一张 `agent_memory` 表存储，与 checkpointer 共用同一 PostgreSQL。
**Step 1: 写失败测试**
创建 `backend/tests/test_postgres_memory_storage.py`：
```python
"""Tests for PostgresMemoryStorage."""
import pytest
from unittest.mock import MagicMock, patch
def make_storage(conn_str="postgresql://user:pass@localhost/db"):
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    with patch("deerflow.agents.memory.postgres_storage.psycopg") as mock_psycopg:
        mock_conn = MagicMock()
        mock_psycopg.connect.return_value.__enter__.return_value = mock_conn
        storage = PostgresMemoryStorage(connection_string=conn_str)
    return storage
def test_save_and_load_roundtrip():
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    import json
    storage = PostgresMemoryStorage.__new__(PostgresMemoryStorage)
    storage._conn_str = "mock"
    storage._cache = {}
    memory_data = {"version": "1.0", "facts": [{"key": "name", "value": "Alice"}]}
    with patch.object(storage, "_execute") as mock_exec, \
         patch.object(storage, "_fetch_one", return_value=(json.dumps(memory_data),)):
        storage.save(memory_data, agent_name="lead_agent")
        result = storage.load(agent_name="lead_agent")
    assert result["facts"][0]["value"] == "Alice"
def test_load_missing_returns_empty():
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    from deerflow.agents.memory.storage import create_empty_memory
    storage = PostgresMemoryStorage.__new__(PostgresMemoryStorage)
    storage._conn_str = "mock"
    storage._cache = {}
    with patch.object(storage, "_fetch_one", return_value=None):
        result = storage.load(agent_name="lead_agent")
    assert result == create_empty_memory()
```
**Step 2: 运行确认失败**
```bash
cd backend
uv run pytest tests/test_postgres_memory_storage.py -v
```
Expected: `ImportError`
**Step 3: 实现 PostgresMemoryStorage**
创建 `backend/packages/harness/deerflow/agents/memory/postgres_storage.py`：
```python
"""PostgreSQL-backed memory storage."""
from __future__ import annotations
import json
import logging
from typing import Any
from .storage import MemoryStorage, create_empty_memory
logger = logging.getLogger(__name__)
_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS agent_memory (
    agent_name TEXT NOT NULL,
    memory_data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (agent_name)
);
"""
class PostgresMemoryStorage(MemoryStorage):
    """Memory storage backed by a PostgreSQL table ``agent_memory``."""
    def __init__(self, *, connection_string: str) -> None:
        try:
            import psycopg  # noqa: F401
        except ImportError as exc:
            raise ImportError("Install psycopg: uv add 'psycopg[binary]'") from exc
        self._conn_str = connection_string
        self._cache: dict[str | None, dict[str, Any]] = {}
        self._ensure_table()
    def _ensure_table(self) -> None:
        import psycopg
        with psycopg.connect(self._conn_str) as conn:
            conn.execute(_CREATE_TABLE)
            conn.commit()
    def _execute(self, sql: str, params=()) -> None:
        import psycopg
        with psycopg.connect(self._conn_str) as conn:
            conn.execute(sql, params)
            conn.commit()
    def _fetch_one(self, sql: str, params=()) -> tuple | None:
        import psycopg
        with psycopg.connect(self._conn_str) as conn:
            cur = conn.execute(sql, params)
            return cur.fetchone()
    def _resolve_agent_name(self, agent_name: str | None) -> str:
        return agent_name or "__global__"
    def load(self, agent_name: str | None = None) -> dict[str, Any]:
        key = self._resolve_agent_name(agent_name)
        if key in self._cache:
            return self._cache[key]
        return self.reload(agent_name)
    def reload(self, agent_name: str | None = None) -> dict[str, Any]:
        key = self._resolve_agent_name(agent_name)
        row = self._fetch_one(
            "SELECT memory_data FROM agent_memory WHERE agent_name = %s", (key,)
        )
        if row is None:
            data = create_empty_memory()
        else:
            raw = row[0]
            data = raw if isinstance(raw, dict) else json.loads(raw)
        self._cache[key] = data
        return data
    def save(self, memory_data: dict[str, Any], agent_name: str | None = None) -> bool:
        key = self._resolve_agent_name(agent_name)
        try:
            self._execute(
                """
                INSERT INTO agent_memory (agent_name, memory_data, updated_at)
                VALUES (%s, %s::jsonb, now())
                ON CONFLICT (agent_name) DO UPDATE
                    SET memory_data = EXCLUDED.memory_data,
                        updated_at  = now()
                """,
                (key, json.dumps(memory_data)),
            )
            self._cache[key] = memory_data
            return True
        except Exception:
            logger.exception("Failed to save memory for agent %s", key)
            return False
```
**Step 4: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_postgres_memory_storage.py -v
```
Expected: 2 tests PASS
**Step 5: Commit**
```bash
git add backend/packages/harness/deerflow/agents/memory/postgres_storage.py \
        backend/tests/test_postgres_memory_storage.py
git commit -m "feat(memory): add PostgresMemoryStorage for multi-node agent memory"
```
---
## Task 4: Docker Compose 中间件配置
**Files:**
- Create: `docker/docker-compose.middleware.yaml`
- Create: `docker/docker-compose.lb.yaml`
- Create: `docker/nginx/lb.conf`
- Create: `docker/middleware/init-postgres.sql`
- Create: `docker/middleware/minio-init.sh`
- Modify: `docker/docker-compose.yaml`
**Step 1: 创建 `docker/docker-compose.middleware.yaml`**
见设计文档中的完整 YAML（Task 2 — Docker Compose 中间件配置节）。
**Step 2: 创建前置 LB 配置**
创建 `docker/docker-compose.lb.yaml`：
```yaml
services:
  lb:
    image: nginx:alpine
    container_name: deer-flow-lb
    ports:
      - "${LB_PORT:-80}:80"
    volumes:
      - ./nginx/lb.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped
```
创建 `docker/nginx/lb.conf`（内容见设计文档第三节）。
**Step 3: 创建 `docker/middleware/init-postgres.sql`**
```sql
-- Init script: runs automatically on first postgres container start
-- Database and user are already created by POSTGRES_DB / POSTGRES_USER env vars.
-- This file is kept for future schema migrations.
SELECT 1;
```
**Step 4: 修改 `docker/docker-compose.yaml` 增加中间件环境变量**
在 gateway 和 langgraph 服务的 `environment` 块中追加：
```yaml
- POSTGRES_DSN=${POSTGRES_DSN:-}
- REDIS_URL=${REDIS_URL:-}
- MINIO_ENDPOINT=${MINIO_ENDPOINT:-}
- MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-minioadmin}
- MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-}
```
**Step 5: 本地验证中间件启动**
```bash
cd docker
# 复制 .env 示例并填入密码
cp ../.env .env.middleware
# 启动中间件
POSTGRES_PASSWORD=testpass MINIO_SECRET_KEY=testpass123 \
  docker compose -f docker-compose.middleware.yaml up -d
# 检查健康
docker compose -f docker-compose.middleware.yaml ps
```
Expected: postgres, redis, minio 全部 `healthy`
**Step 6: Commit**
```bash
git add docker/docker-compose.middleware.yaml \
        docker/docker-compose.lb.yaml \
        docker/nginx/lb.conf \
        docker/middleware/ \
        docker/docker-compose.yaml
git commit -m "feat(docker): add middleware compose and LB config for cluster deployment"
```
---
## Task 5: config.yaml 模板与文档更新
**Files:**
- Modify: `config.yaml`
- Modify: `config.example.yaml`
- Create: `scripts/migrate-to-cluster.sh`
- Modify: `docs/plans/2026-04-08-cluster-deployment-design.md`（补充实际文件路径）
**Step 1: 更新 config.yaml 新增配置块**
在 `config.yaml` 的 checkpointer 段之后添加：
```yaml
# stream_bridge:
#   type: redis
#   redis_url: $REDIS_URL
#   queue_maxsize: 256
# uploads:
#   backend: minio
#   minio:
#     endpoint: $MINIO_ENDPOINT
#     access_key: $MINIO_ACCESS_KEY
#     secret_key: $MINIO_SECRET_KEY
#     bucket: deerflow-uploads
#     secure: false
```
**Step 2: 创建数据迁移脚本 `scripts/migrate-to-cluster.sh`**
```bash
#!/usr/bin/env bash
# One-time migration: upload local .deer-flow files to MinIO
# Usage: MINIO_ENDPOINT=node-c:9000 MINIO_SECRET_KEY=xxx ./scripts/migrate-to-cluster.sh
set -euo pipefail
DEER_FLOW_HOME="${DEER_FLOW_HOME:-backend/.deer-flow}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:?MINIO_ENDPOINT required}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY required}"
BUCKET="deerflow-uploads"
echo "Migrating uploads from $DEER_FLOW_HOME to MinIO $MINIO_ENDPOINT/$BUCKET"
# Install mc (MinIO Client) if not present
if ! command -v mc &>/dev/null; then
  echo "mc not found. Install from: https://min.io/docs/minio/linux/reference/minio-mc.html"
  exit 1
fi
mc alias set deerflow "http://$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
mc mb --ignore-existing "deerflow/$BUCKET"
mc mirror "$DEER_FLOW_HOME/uploads/" "deerflow/$BUCKET/"
echo "Migration complete."
```
**Step 3: Commit**
```bash
chmod +x scripts/migrate-to-cluster.sh
git add config.yaml config.example.yaml scripts/migrate-to-cluster.sh
git commit -m "feat(config): add stream_bridge and uploads config sections for cluster mode"
```
---
## Task 6: 集成验证
**Step 1: 本地端到端冒烟测试**
```bash
# 启动中间件
cd docker
docker compose -f docker-compose.middleware.yaml up -d
# 修改 config.yaml 启用 postgres + redis + minio
# checkpointer.type: postgres
# stream_bridge.type: redis
# uploads.backend: minio
# 启动应用
docker compose up -d
# 发一条消息，验证对话正常
curl -X POST http://localhost:2026/api/threads \
  -H "Content-Type: application/json" \
  -d '{"assistant_id": "lead_agent"}'
```
**Step 2: 验证跨节点 SSE**
在两个终端分别连接节点A和节点B的SSE端点，发起同一个对话，验证断线重连到另一节点后事件流正常续传。
**Step 3: 验证文件上传**
上传一个文件，然后重启应用容器，验证文件仍可访问（从MinIO读取）。
**Step 4: Commit（如有补丁）**
```bash
git add .
git commit -m "fix: cluster integration fixes from smoke testing"
```
