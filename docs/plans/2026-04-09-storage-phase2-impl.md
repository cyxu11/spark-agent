# 存储层 Phase 2 Implementation Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
**Goal:** 修复 Memory Storage 接入 bug，补全 Skills、Workspace/Outputs、Channels Store 四块存储的集群化方案。
**Architecture:** Task 1 修复工厂函数让 PostgresMemoryStorage 可达；Task 2 为 Channels Store 新增 PostgresChannelStore 实现类；Task 3 新增 Outputs 存储模块并在 present_files + artifacts 路由接入 MinIO；Task 4 是纯 Docker Compose 配置，零代码。四个 Task 互相独立，可并行执行，建议按 1→2→3→4 顺序。
**Tech Stack:** Python 3.11+, psycopg (同步), psycopg_pool, minio-py SDK（已在 uploads 引入）, pytest, pytest-asyncio, uv
**设计文档：** `docs/plans/2026-04-09-storage-phase2-design.md`
---
## Task 1：修复 Memory Storage 接入
**Files:**
- Modify: `backend/packages/harness/deerflow/config/memory_config.py`
- Modify: `backend/packages/harness/deerflow/agents/memory/storage.py`
- Modify: `backend/packages/harness/deerflow/agents/memory/postgres_storage.py`
- Modify: `backend/packages/harness/deerflow/agents/memory/__init__.py`
- Modify: `config.yaml`
- Modify: `config.example.yaml`（如存在）
- Test: `backend/tests/test_memory_storage.py`（追加新测试用例）
**背景：**
`get_memory_storage()` 调用 `storage_class()` 无参实例化，但 `PostgresMemoryStorage.__init__` 必须传 `connection_string: str`，导致构造失败后被 `except Exception` 捕获并静默回退到 `FileMemoryStorage`。还有一个行为差异：`FileMemoryStorage.save` 会更新根级 `lastUpdated`，`PostgresMemoryStorage.save` 不会。
**Step 1: 写失败测试**
在 `backend/tests/test_memory_storage.py` 末尾追加：
```python
def test_get_memory_storage_returns_postgres_when_configured(monkeypatch, tmp_path):
    """get_memory_storage() should return PostgresMemoryStorage when storage_class points to it
    and a valid connection_string is available from checkpointer config."""
    import importlib
    from unittest.mock import MagicMock, patch
    # Patch PostgresMemoryStorage so we don't need a real DB
    mock_pg = MagicMock()
    mock_pg_cls = MagicMock(return_value=mock_pg)
    mock_pg_cls.__name__ = "PostgresMemoryStorage"
    postgres_class_path = "deerflow.agents.memory.postgres_storage.PostgresMemoryStorage"
    # Patch checkpointer config to return postgres type with DSN
    mock_cp_config = MagicMock()
    mock_cp_config.type = "postgres"
    mock_cp_config.connection_string = "postgresql://user:pass@localhost/db"
    with patch(
        "deerflow.agents.memory.storage.get_checkpointer_config",
        return_value=mock_cp_config,
    ):
        with patch(
            "deerflow.agents.memory.storage._import_storage_class",
            return_value=mock_pg_cls,
        ):
            from deerflow.config.memory_config import MemoryConfig
            from deerflow.agents.memory import storage as mem_storage
            # Reset singleton
            mem_storage._storage_instance = None
            cfg = MemoryConfig(storage_class=postgres_class_path)
            with patch("deerflow.agents.memory.storage.get_memory_config", return_value=cfg):
                instance = mem_storage.get_memory_storage()
    mock_pg_cls.assert_called_once_with(
        connection_string="postgresql://user:pass@localhost/db"
    )
    assert instance is mock_pg
def test_get_memory_storage_uses_memory_config_dsn_over_checkpointer(monkeypatch):
    """memory.connection_string takes precedence over checkpointer DSN."""
    from unittest.mock import MagicMock, patch
    mock_pg_cls = MagicMock()
    mock_pg_cls.__name__ = "PostgresMemoryStorage"
    mock_pg_cls.return_value = MagicMock()
    postgres_class_path = "deerflow.agents.memory.postgres_storage.PostgresMemoryStorage"
    mock_cp_config = MagicMock()
    mock_cp_config.type = "postgres"
    mock_cp_config.connection_string = "postgresql://checkpointer/db"
    with patch(
        "deerflow.agents.memory.storage.get_checkpointer_config",
        return_value=mock_cp_config,
    ):
        with patch(
            "deerflow.agents.memory.storage._import_storage_class",
            return_value=mock_pg_cls,
        ):
            from deerflow.config.memory_config import MemoryConfig
            from deerflow.agents.memory import storage as mem_storage
            mem_storage._storage_instance = None
            cfg = MemoryConfig(
                storage_class=postgres_class_path,
                connection_string="postgresql://memory-specific/db",
            )
            with patch("deerflow.agents.memory.storage.get_memory_config", return_value=cfg):
                mem_storage.get_memory_storage()
    mock_pg_cls.assert_called_once_with(
        connection_string="postgresql://memory-specific/db"
    )
def test_postgres_memory_storage_save_updates_last_updated():
    """PostgresMemoryStorage.save should update lastUpdated like FileMemoryStorage does."""
    from unittest.mock import MagicMock, patch
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    with patch("psycopg.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_connect.return_value.__exit__ = MagicMock(return_value=False)
        storage = PostgresMemoryStorage.__new__(PostgresMemoryStorage)
        storage._conn_str = "postgresql://x/y"
        storage._cache = {}
        data = {"facts": ["item1"]}
        with patch.object(storage, "_save_to_db"):
            storage.save(data, agent_name="test-agent")
        assert "lastUpdated" in data
```
**Step 2: 运行测试确认失败**
```bash
cd backend
uv run pytest tests/test_memory_storage.py::test_get_memory_storage_returns_postgres_when_configured -v
```
Expected: `FAIL` 或 `ImportError`（`get_checkpointer_config`、`_import_storage_class` 等还未提取为独立函数）
**Step 3: 修改 `memory_config.py`，新增 `connection_string` 字段**
```python
# backend/packages/harness/deerflow/config/memory_config.py
# 在现有字段末尾追加：
connection_string: str | None = Field(
    default=None,
    description=(
        "PostgreSQL DSN for PostgresMemoryStorage. "
        "If not set, falls back to checkpointer.connection_string when checkpointer.type=postgres."
    ),
)
```
**Step 4: 重构 `storage.py` 的工厂函数**
把 `get_memory_storage()` 中的实例化逻辑拆出两个辅助函数，便于测试 mock：
```python
# backend/packages/harness/deerflow/agents/memory/storage.py
# 在文件顶部 import 区追加（已有则跳过）：
import importlib
# 在 get_memory_storage() 上方新增两个函数：
def _import_storage_class(class_path: str):
    """Import a storage class by dotted path. Extracted for testability."""
    module_path, class_name = class_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)
def _resolve_connection_string(config) -> str | None:
    """Return Postgres DSN: memory config takes precedence, then checkpointer."""
    if config.connection_string:
        return config.connection_string
    try:
        from deerflow.config.checkpointer_config import get_checkpointer_config
        cp = get_checkpointer_config()
        if cp.type == "postgres" and cp.connection_string:
            return cp.connection_string
    except Exception:
        pass
    return None
def _build_storage_kwargs(cls, config) -> dict:
    """Build constructor kwargs for the given storage class."""
    if cls.__name__ == "PostgresMemoryStorage":
        dsn = _resolve_connection_string(config)
        if not dsn:
            raise ValueError(
                "PostgresMemoryStorage requires a connection_string. "
                "Set memory.connection_string in config.yaml, "
                "or configure checkpointer.type=postgres with a connection_string."
            )
        return {"connection_string": dsn}
    return {}
```
然后将 `get_memory_storage()` 中实例化那段改为：
```python
# 替换原来的：
#   _storage_instance = storage_class()
# 改为：
storage_kwargs = _build_storage_kwargs(storage_class, config)
_storage_instance = storage_class(**storage_kwargs)
```
**Step 5: 修复 `postgres_storage.py` 的 `save` 方法——补充 `lastUpdated`**
在 `save` 方法写入数据库前加一行：
```python
def save(self, memory_data: dict[str, Any], agent_name: str | None = None) -> bool:
    import time
    memory_data["lastUpdated"] = time.time()   # ← 新增这行，与 FileMemoryStorage 行为一致
    # ... 其余现有逻辑不变
```
**Step 6: 更新 `__init__.py`，导出 `PostgresMemoryStorage`**
```python
# backend/packages/harness/deerflow/agents/memory/__init__.py
# 追加：
from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
__all__ = [
    ...,           # 现有导出列表
    "PostgresMemoryStorage",
]
```
**Step 7: 更新 `config.yaml`**
在 `memory:` 段下增加注释说明（不改默认值，只做文档化）：
```yaml
memory:
  enabled: true
  storage_path: memory.json
  # 集群模式：切换到 PostgreSQL 存储
  # storage_class: deerflow.agents.memory.postgres_storage.PostgresMemoryStorage
  # connection_string: $POSTGRES_DSN  # 可选，默认复用 checkpointer.connection_string
  debounce_seconds: 30
  model_name: null
  max_facts: 100
  fact_confidence_threshold: 0.7
  injection_enabled: true
  max_injection_tokens: 2000
```
**Step 8: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_memory_storage.py -v
```
Expected: 全部 PASS
**Step 9: Commit**
```bash
git add backend/packages/harness/deerflow/config/memory_config.py \
        backend/packages/harness/deerflow/agents/memory/storage.py \
        backend/packages/harness/deerflow/agents/memory/postgres_storage.py \
        backend/packages/harness/deerflow/agents/memory/__init__.py \
        config.yaml \
        backend/tests/test_memory_storage.py
git commit -m "fix(memory): wire PostgresMemoryStorage through factory with DSN resolution"
```
---
## Task 2：Channels Store → PostgreSQL
**Files:**
- Create: `backend/app/channels/postgres_store.py`
- Modify: `backend/app/channels/store.py`（重命名类为 `FileChannelStore`，保留向下兼容别名）
- Modify: `backend/app/channels/service.py`
- Test: `backend/tests/test_channels_store.py`（追加 PostgresChannelStore 测试）
**背景：**
`ChannelStore` 在进程启动时读一次文件，之后只用内存。多节点下不同节点维护不同的 chat→thread_id 映射，导致同一 IM 会话反复创建新 thread。`ChannelStore` 接口已隔离（`get_thread_id` / `set_thread_id` / `remove` / `list_entries`），替换实现不影响调用方。
**Step 1: 了解现有 `ChannelStore` 接口**
阅读 `backend/app/channels/store.py`，记录以下公开方法签名：
- `get_thread_id(channel_name, chat_id, *, topic_id=None) -> str | None`
- `set_thread_id(channel_name, chat_id, thread_id, *, topic_id=None, user_id="") -> None`
- `remove(channel_name, chat_id, *, topic_id=None) -> None`
- `list_entries() -> list[dict]`
- 静态方法 `_key(channel_name, chat_id, topic_id=None) -> str`
**Step 2: 写失败测试**
创建 `backend/tests/test_postgres_channel_store.py`：
```python
"""Tests for PostgresChannelStore using mocked psycopg connection."""
import time
from unittest.mock import MagicMock, patch, call
import pytest
from app.channels.postgres_store import PostgresChannelStore
@pytest.fixture
def mock_conn():
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn, cursor
@pytest.fixture
def store(mock_conn):
    conn, cursor = mock_conn
    with patch("app.channels.postgres_store.psycopg") as mock_psycopg:
        mock_psycopg.connect.return_value.__enter__ = MagicMock(return_value=conn)
        mock_psycopg.connect.return_value.__exit__ = MagicMock(return_value=False)
        s = PostgresChannelStore.__new__(PostgresChannelStore)
        s._conn_str = "postgresql://x/y"
        s._pool = None
        return s, conn, cursor
def test_set_and_get_thread_id(store):
    s, conn, cursor = store
    cursor.fetchone.return_value = ("thread-abc",)
    with patch.object(s, "_execute") as mock_exec:
        mock_exec.return_value = None
        with patch.object(s, "_fetchone", return_value={"thread_id": "thread-abc", "user_id": "u1", "created_at": 0.0, "updated_at": 0.0}):
            result = s.get_thread_id("feishu", "chat-001")
    assert result == "thread-abc"
def test_get_thread_id_returns_none_when_not_found(store):
    s, conn, cursor = store
    with patch.object(s, "_fetchone", return_value=None):
        result = s.get_thread_id("feishu", "chat-999")
    assert result is None
def test_set_thread_id_calls_upsert(store):
    s, conn, cursor = store
    with patch.object(s, "_execute") as mock_exec:
        s.set_thread_id("feishu", "chat-001", "thread-xyz", user_id="u1")
        assert mock_exec.called
        sql = mock_exec.call_args[0][0]
        assert "ON CONFLICT" in sql
        assert "thread_id" in sql
def test_remove_calls_delete(store):
    s, conn, cursor = store
    with patch.object(s, "_execute") as mock_exec:
        s.remove("feishu", "chat-001")
        assert mock_exec.called
        sql = mock_exec.call_args[0][0]
        assert "DELETE" in sql.upper()
def test_key_with_topic():
    key = PostgresChannelStore._key("slack", "C123", topic_id="T456")
    assert key == "slack:C123:T456"
def test_key_without_topic():
    key = PostgresChannelStore._key("slack", "C123")
    assert key == "slack:C123"
```
**Step 3: 运行测试确认失败**
```bash
cd backend
uv run pytest tests/test_postgres_channel_store.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.channels.postgres_store'`
**Step 4: 创建 `postgres_store.py`**
创建 `backend/app/channels/postgres_store.py`：
```python
"""PostgreSQL-backed channel store for multi-node deployments."""
from __future__ import annotations
import logging
import threading
import time
from typing import Any
logger = logging.getLogger(__name__)
_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS channel_thread_mapping (
    key         TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL DEFAULT '',
    created_at  DOUBLE PRECISION NOT NULL,
    updated_at  DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ctm_updated ON channel_thread_mapping (updated_at DESC);
"""
_UPSERT_SQL = """
INSERT INTO channel_thread_mapping (key, thread_id, user_id, created_at, updated_at)
VALUES (%s, %s, %s, %s, %s)
ON CONFLICT (key) DO UPDATE SET
    thread_id  = EXCLUDED.thread_id,
    user_id    = EXCLUDED.user_id,
    updated_at = EXCLUDED.updated_at;
"""
_SELECT_SQL = "SELECT thread_id, user_id, created_at, updated_at FROM channel_thread_mapping WHERE key = %s;"
_DELETE_SQL = "DELETE FROM channel_thread_mapping WHERE key = %s;"
_LIST_SQL   = "SELECT key, thread_id, user_id, created_at, updated_at FROM channel_thread_mapping ORDER BY updated_at DESC;"
class PostgresChannelStore:
    """Multi-node safe replacement for FileChannelStore backed by PostgreSQL.
    Uses a connection per operation (no pool) for simplicity; psycopg handles
    connection reuse internally. For very high-throughput use, swap to psycopg_pool.
    """
    def __init__(self, *, connection_string: str) -> None:
        try:
            import psycopg  # noqa: F401
        except ImportError as exc:
            raise ImportError("Install psycopg: uv add 'psycopg[binary]'") from exc
        self._conn_str = connection_string
        self._lock = threading.Lock()
        self._ensure_table()
    # ------------------------------------------------------------------
    # Public interface (same as FileChannelStore)
    # ------------------------------------------------------------------
    @staticmethod
    def _key(channel_name: str, chat_id: str, topic_id: str | None = None) -> str:
        if topic_id:
            return f"{channel_name}:{chat_id}:{topic_id}"
        return f"{channel_name}:{chat_id}"
    def get_thread_id(
        self, channel_name: str, chat_id: str, *, topic_id: str | None = None
    ) -> str | None:
        row = self._fetchone(_SELECT_SQL, (self._key(channel_name, chat_id, topic_id),))
        return row["thread_id"] if row else None
    def set_thread_id(
        self,
        channel_name: str,
        chat_id: str,
        thread_id: str,
        *,
        topic_id: str | None = None,
        user_id: str = "",
    ) -> None:
        key = self._key(channel_name, chat_id, topic_id)
        now = time.time()
        existing = self._fetchone(_SELECT_SQL, (key,))
        created_at = existing["created_at"] if existing else now
        self._execute(_UPSERT_SQL, (key, thread_id, user_id, created_at, now))
    def remove(
        self, channel_name: str, chat_id: str, *, topic_id: str | None = None
    ) -> None:
        self._execute(_DELETE_SQL, (self._key(channel_name, chat_id, topic_id),))
    def list_entries(self) -> list[dict[str, Any]]:
        import psycopg
        import psycopg.rows
        with psycopg.connect(self._conn_str, row_factory=psycopg.rows.dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(_LIST_SQL)
                return cur.fetchall()
    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _ensure_table(self) -> None:
        self._execute(_CREATE_TABLE_SQL)
    def _execute(self, sql: str, params: tuple = ()) -> None:
        import psycopg
        with self._lock:
            with psycopg.connect(self._conn_str) as conn:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                conn.commit()
    def _fetchone(self, sql: str, params: tuple = ()) -> dict | None:
        import psycopg
        import psycopg.rows
        with psycopg.connect(self._conn_str, row_factory=psycopg.rows.dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchone()
```
**Step 5: 在 `store.py` 保留向下兼容别名**
在 `backend/app/channels/store.py` 末尾追加（不改任何现有代码）：
```python
# Backward-compatible alias; new code should use PostgresChannelStore for multi-node.
FileChannelStore = ChannelStore
```
**Step 6: 修改 `service.py`，按 checkpointer 类型自动选择 store**
在 `backend/app/channels/service.py` 的 `ChannelService.__init__` 中，把 `self.store = ChannelStore()` 替换为：
```python
self.store = _create_channel_store()
```
并在文件顶部（imports 区）后、类定义前新增工厂函数：
```python
def _create_channel_store():
    """Return PostgresChannelStore when checkpointer uses postgres, else FileChannelStore."""
    try:
        from deerflow.config.checkpointer_config import get_checkpointer_config
        cp = get_checkpointer_config()
        if cp.type == "postgres" and cp.connection_string:
            from app.channels.postgres_store import PostgresChannelStore
            logger.info("ChannelStore: using PostgresChannelStore")
            return PostgresChannelStore(connection_string=cp.connection_string)
    except Exception as e:
        logger.warning("Could not initialize PostgresChannelStore, falling back: %s", e)
    from app.channels.store import ChannelStore
    return ChannelStore()
```
**Step 7: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_postgres_channel_store.py -v
```
Expected: 全部 PASS
**Step 8: Commit**
```bash
git add backend/app/channels/postgres_store.py \
        backend/app/channels/store.py \
        backend/app/channels/service.py \
        backend/tests/test_postgres_channel_store.py
git commit -m "feat(channels): add PostgresChannelStore for multi-node channel-thread mapping"
```
---
## Task 3：Outputs → MinIO
**Files:**
- Create: `backend/packages/harness/deerflow/outputs/__init__.py`
- Create: `backend/packages/harness/deerflow/outputs/backends/__init__.py`
- Create: `backend/packages/harness/deerflow/outputs/backends/base.py`
- Create: `backend/packages/harness/deerflow/outputs/backends/local.py`
- Create: `backend/packages/harness/deerflow/outputs/backends/minio.py`
- Create: `backend/packages/harness/deerflow/outputs/provider.py`
- Modify: `backend/packages/harness/deerflow/tools/builtins/present_file_tool.py`
- Modify: `backend/app/gateway/routers/artifacts.py`
- Modify: `backend/packages/harness/deerflow/config/` — 新增 `outputs_config.py`
- Modify: `config.yaml`
- Test: `backend/tests/test_outputs_backend.py`
**背景：**
`present_files` 工具是唯一把 outputs 文件登记到 artifacts 的入口。在此处触发上传，artifacts 路由优先从 MinIO 读取，可保证多节点下用户在任意节点都能下载到文件。本地运行时 `backend: local`，代码路径无变化。
**Step 1: 新增 `OutputsConfig`**
创建 `backend/packages/harness/deerflow/config/outputs_config.py`：
```python
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
```
在 `AppConfig`（`deerflow/config/app_config.py`）中注册该字段（参考 uploads 字段的添加方式）：
```python
outputs: OutputsConfig = Field(default_factory=OutputsConfig)
```
**Step 2: 写失败测试**
创建 `backend/tests/test_outputs_backend.py`：
```python
"""Tests for outputs storage backends."""
import io
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
def test_local_backend_get_response_returns_file_response(tmp_path):
    """LocalOutputsBackend.get_response should return a FileResponse for existing files."""
    from deerflow.outputs.backends.local import LocalOutputsBackend
    from deerflow.config.paths import Paths
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
```
**Step 3: 运行测试确认失败**
```bash
cd backend
uv run pytest tests/test_outputs_backend.py -v
```
Expected: `ModuleNotFoundError: No module named 'deerflow.outputs'`
**Step 4: 实现抽象基类**
创建 `backend/packages/harness/deerflow/outputs/backends/base.py`：
```python
"""Abstract interface for outputs storage backends."""
from __future__ import annotations
import abc
from pathlib import Path
from starlette.responses import Response
class OutputsBackend(abc.ABC):
    @abc.abstractmethod
    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        """Upload file to storage; return the object key."""
    @abc.abstractmethod
    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        """Return HTTP response suitable for streaming/downloading the file."""
    @abc.abstractmethod
    async def delete_thread(self, thread_id: str) -> None:
        """Remove all outputs for a thread (called on thread deletion)."""
    @staticmethod
    def _object_key(thread_id: str, virtual_path: str) -> str:
        """Derive a stable MinIO object key from thread_id + virtual_path."""
        # e.g. "outputs/tid-abc123/report.pdf"
        filename = virtual_path.lstrip("/").split("/")[-1]
        return f"outputs/{thread_id}/{filename}"
```
**Step 5: 实现 `LocalOutputsBackend`**
创建 `backend/packages/harness/deerflow/outputs/backends/local.py`：
```python
"""Local filesystem outputs backend — wraps existing artifacts logic."""
from __future__ import annotations
from pathlib import Path
from starlette.responses import FileResponse, Response
from .base import OutputsBackend
class LocalOutputsBackend(OutputsBackend):
    """Pass-through backend that serves files from local disk (current behavior)."""
    def __init__(self, paths=None) -> None:
        self._paths = paths
    async def upload(self, thread_id: str, virtual_path: str, local_path: Path) -> str:
        # No-op for local backend; file is already on disk.
        return str(local_path)
    async def get_response(self, thread_id: str, virtual_path: str) -> Response:
        if self._paths is None:
            from deerflow.config.paths import get_paths
            self._paths = get_paths()
        actual_path = self._paths.resolve_virtual_path(thread_id, virtual_path)
        return FileResponse(path=actual_path)
    async def delete_thread(self, thread_id: str) -> None:
        # Thread dir cleanup is handled by paths.delete_thread_dir elsewhere.
        pass
```
**Step 6: 实现 `MinioOutputsBackend`**
创建 `backend/packages/harness/deerflow/outputs/backends/minio.py`：
```python
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
```
**Step 7: 实现 `provider.py`**
创建 `backend/packages/harness/deerflow/outputs/provider.py`：
```python
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
```
创建 `backend/packages/harness/deerflow/outputs/__init__.py` 和 `backends/__init__.py`（空文件即可）。
**Step 8: 运行测试确认通过**
```bash
cd backend
uv run pytest tests/test_outputs_backend.py -v
```
Expected: 全部 PASS
**Step 9: 接入 `present_file_tool.py`**
在 `backend/packages/harness/deerflow/tools/builtins/present_file_tool.py` 的 `present_files` 函数中，在文件路径校验通过、写入 state 之后，追加上传逻辑：
```python
# 在 present_files 工具函数内，validated_paths 确认通过后追加：
import asyncio
from deerflow.outputs.provider import get_outputs_backend
from deerflow.config.paths import get_paths
backend = get_outputs_backend()
paths = get_paths()
for vpath in validated_paths:
    try:
        local_path = paths.resolve_virtual_path(thread_id, vpath)
        await backend.upload(thread_id, vpath, local_path)
    except Exception as e:
        logger.warning("Failed to upload output to backend: path=%s error=%s", vpath, e)
        # 上传失败不阻断主流程，文件仍在本地可 fallback 访问
```
注意：需确认 `present_files` 是 async 函数，若不是需要改为 async（检查调用方）。若调用方不支持 async，改用 `asyncio.create_task` 后台触发。
**Step 10: 修改 `artifacts.py` 路由，outputs 路径优先走 backend**
在 `backend/app/gateway/routers/artifacts.py` 中，找到解析 `virtual_path` 并返回 `FileResponse` 的地方，在 outputs 路径分支前加：
```python
# 在 outputs 路径判断前插入：
if virtual_path.startswith("/mnt/user-data/outputs/") or virtual_path.startswith("mnt/user-data/outputs/"):
    from deerflow.outputs.provider import get_outputs_backend
    backend = get_outputs_backend()
    try:
        return await backend.get_response(thread_id, virtual_path if virtual_path.startswith("/") else f"/{virtual_path}")
    except Exception:
        pass  # fallback 到本地文件逻辑
```
**Step 11: 线程删除时清理 MinIO**
在 `backend/app/gateway/routers/threads.py`（或处理 thread 删除的路由文件）中，找到 `delete_thread_dir` 调用，在其后追加：
```python
from deerflow.outputs.provider import get_outputs_backend
await get_outputs_backend().delete_thread(thread_id)
```
**Step 12: 更新 `config.yaml`**
```yaml
outputs:
  backend: local           # 本地运行保持 local；集群模式改为 minio
  # backend: minio
  # minio 字段复用 uploads.minio 相同的 endpoint/credentials
  minio:
    endpoint: $MINIO_ENDPOINT
    access_key: $MINIO_ACCESS_KEY
    secret_key: $MINIO_SECRET_KEY
    bucket: deerflow-outputs
    secure: false
```
**Step 13: 完整测试**
```bash
cd backend
uv run pytest tests/test_outputs_backend.py -v
```
Expected: 全部 PASS
**Step 14: Commit**
```bash
git add backend/packages/harness/deerflow/outputs/ \
        backend/packages/harness/deerflow/config/outputs_config.py \
        backend/packages/harness/deerflow/tools/builtins/present_file_tool.py \
        backend/app/gateway/routers/artifacts.py \
        config.yaml \
        backend/tests/test_outputs_backend.py
git commit -m "feat(outputs): add MinIO backend with present_files hook and artifacts fallback"
```
---
## Task 4：共享挂载卷配置（Skills + Workspace）
**Files:**
- Modify: `docker/docker-compose.middleware.yaml`（新增 volume 定义）
- Modify: `docker/docker-compose.yaml`（两个服务挂载共享卷）
- Modify: `config.yaml`（注释说明 skills.path 在集群模式下的用法）
**背景：** Skills 目录和 Workspace（threads/）目录在集群模式下需要两节点共享。无需改应用代码，只需在 Docker Compose 中定义并挂载共享 volume。
**Step 1: 在 `docker-compose.middleware.yaml` 新增 volume**
在 `volumes:` 段追加：
```yaml
volumes:
  postgres_data:
  redis_data:
  minio_data:
  skills_data:      # ← 新增：Skills 目录共享
  threads_data:     # ← 新增：线程工作区共享（workspace + outputs + uploads）
```
**Step 2: 在 `docker-compose.yaml` 挂载 volumes**
在 gateway 和 langgraph 服务的 `volumes:` 下追加挂载（参考现有 minio_data 等写法）：
```yaml
services:
  gateway:
    volumes:
      - skills_data:/app/skills
      - threads_data:/app/.deer-flow/threads      # 与 DEER_FLOW_HOME 路径对应
  langgraph:
    volumes:
      - skills_data:/app/skills
      - threads_data:/app/.deer-flow/threads
```
（实际容器内路径需对照 `DEER_FLOW_HOME` 和 `skills.path` 的配置值，以实际 docker-compose 中已有配置为准）
**Step 3: 更新 `config.yaml` 注释**
```yaml
skills:
  # path: /app/skills         # 集群模式：与 docker-compose skills_data volume 挂载路径一致
  container_path: /mnt/skills  # 沙箱内路径，保持不变
```
**Step 4: 验证本地运行无影响**
不使用 docker-compose 时，本地直接运行 `uv run ...`，skills.path 默认指向仓库 `skills/` 目录，DEER_FLOW_HOME 默认指向 `backend/.deer-flow/`，与这次 volume 配置无关，行为完全不变。
**Step 5: Commit**
```bash
git add docker/docker-compose.middleware.yaml \
        docker/docker-compose.yaml \
        config.yaml
git commit -m "feat(docker): add shared volumes for skills and threads directories"
```
---
## 验收标准
| Task | 验收方式 |
|------|---------|
| Task 1 Memory | `config.yaml` 配置 `storage_class: PostgresMemoryStorage` + postgres checkpointer DSN，启动后 log 中无 "falling back to FileMemoryStorage" |
| Task 2 Channels | 配置 postgres checkpointer 后，两节点的同一 IM 会话始终复用同一 thread_id |
| Task 3 Outputs | `present_files` 后文件出现在 MinIO bucket；节点 B 访问 artifacts 下载 URL 可正常返回文件 |
| Task 4 共享卷 | 节点 A 安装技能后节点 B 立即可见（无需重启）；两节点均可访问 workspace 中的文件 |
