# Session Event Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist all SSE stream events to PostgreSQL so sessions can be replayed after completion and monitored in real-time from a second client.

**Architecture:** A `LoggingStreamBridge` decorator wraps the existing bridge and writes every `publish` call to a `run_event_log` PostgreSQL table. A new Gateway router exposes REST + SSE query endpoints. The frontend adds a Sheet panel on the chat page to display events.

**Tech Stack:** Python 3.12, psycopg (async), FastAPI SSE, Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui Sheet + Tabs

---

## Task 1: EventLog Config

**Files:**
- Create: `backend/packages/harness/deerflow/config/event_log_config.py`
- Modify: `backend/packages/harness/deerflow/config/app_config.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_event_log_config.py
from deerflow.config.event_log_config import EventLogConfig, get_event_log_config, set_event_log_config


def test_default_disabled():
    cfg = EventLogConfig(connection_string="postgresql://localhost/test")
    assert cfg.enabled is False


def test_get_returns_none_by_default():
    set_event_log_config(None)
    assert get_event_log_config() is None


def test_set_and_get():
    cfg = EventLogConfig(enabled=True, connection_string="postgresql://localhost/test")
    set_event_log_config(cfg)
    assert get_event_log_config() is cfg
    set_event_log_config(None)  # cleanup
```

**Step 2: Run to confirm it fails**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_event_log_config.py -v
```
Expected: `ModuleNotFoundError` or `ImportError`

**Step 3: Create the config module**

```python
# backend/packages/harness/deerflow/config/event_log_config.py
"""Configuration for the run event log (PostgreSQL persistence of SSE events)."""
from __future__ import annotations

from pydantic import BaseModel, Field

_event_log_config: "EventLogConfig | None" = None


class EventLogConfig(BaseModel):
    """Configuration for persisting SSE stream events to PostgreSQL."""

    enabled: bool = Field(default=False, description="Enable event log persistence.")
    connection_string: str = Field(description="PostgreSQL DSN, e.g. 'postgresql://user:pass@host/db'.")


def get_event_log_config() -> "EventLogConfig | None":
    return _event_log_config


def set_event_log_config(config: "EventLogConfig | None") -> None:
    global _event_log_config
    _event_log_config = config


def load_event_log_config_from_dict(d: dict) -> None:
    global _event_log_config
    _event_log_config = EventLogConfig(**d)
```

**Step 4: Wire into AppConfig**

In `backend/packages/harness/deerflow/config/app_config.py`, add:

```python
# add import near other config imports
from deerflow.config.event_log_config import EventLogConfig, load_event_log_config_from_dict
```

In the `AppConfig` class body (after `outputs`):
```python
event_log: EventLogConfig | None = Field(default=None, description="Run event log persistence configuration.")
```

In the `from_dict` / loading section of `AppConfig` (find where `checkpointer` is loaded and add analogously):
```python
if raw.get("event_log"):
    load_event_log_config_from_dict(raw["event_log"])
```

Find the exact pattern by reading `app_config.py` lines 80-160 first.

**Step 5: Run tests**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_event_log_config.py -v
```
Expected: all 3 tests PASS

**Step 6: Commit**

```bash
git add backend/packages/harness/deerflow/config/event_log_config.py \
        backend/packages/harness/deerflow/config/app_config.py
git commit -m "feat(config): add EventLogConfig for run event persistence"
```

---

## Task 2: PostgresEventLog — append and list_events

**Files:**
- Create: `backend/packages/harness/deerflow/runtime/event_log/__init__.py`
- Create: `backend/packages/harness/deerflow/runtime/event_log/postgres.py`
- Create: `backend/tests/test_postgres_event_log.py`

**Step 1: Write failing tests**

```python
# backend/tests/test_postgres_event_log.py
"""Unit tests for PostgresEventLog using a real in-process PostgreSQL or monkeypatching."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


# We mock psycopg so tests run without a real DB.
# The mock simulates: connect → cursor → execute/fetchall.

@pytest.fixture
def mock_conn():
    """Return a fake async psycopg connection context manager."""
    cursor = AsyncMock()
    cursor.__aenter__ = AsyncMock(return_value=cursor)
    cursor.__aexit__ = AsyncMock(return_value=False)
    cursor.fetchall = AsyncMock(return_value=[])

    conn = AsyncMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)
    conn.cursor = MagicMock(return_value=cursor)
    conn.commit = AsyncMock()
    return conn, cursor


@pytest.mark.asyncio
async def test_append_inserts_row(mock_conn):
    conn, cursor = mock_conn
    with patch("psycopg.AsyncConnection.connect", return_value=conn):
        from deerflow.runtime.event_log.postgres import PostgresEventLog
        log = PostgresEventLog(connection_string="postgresql://localhost/test")
        await log.append(
            run_id="run-1", thread_id="th-1",
            event="messages-tuple", data={"msg": "hi"}, seq="100-0"
        )
    cursor.execute.assert_called()
    # Check that INSERT was called
    calls_sql = [str(c.args[0]) for c in cursor.execute.call_args_list]
    assert any("INSERT" in s for s in calls_sql)


@pytest.mark.asyncio
async def test_list_events_returns_rows(mock_conn):
    conn, cursor = mock_conn
    cursor.fetchall = AsyncMock(return_value=[
        {"id": 1, "run_id": "run-1", "thread_id": "th-1",
         "event": "values", "data": "{}", "seq": "100-0", "created_at": "2026-01-01T00:00:00Z"}
    ])
    with patch("psycopg.AsyncConnection.connect", return_value=conn):
        from deerflow.runtime.event_log.postgres import PostgresEventLog
        log = PostgresEventLog(connection_string="postgresql://localhost/test")
        events = await log.list_events(run_id="run-1")
    assert len(events) == 1
    assert events[0]["event"] == "values"


@pytest.mark.asyncio
async def test_append_failure_does_not_raise(mock_conn):
    conn, cursor = mock_conn
    cursor.execute = AsyncMock(side_effect=Exception("DB down"))
    with patch("psycopg.AsyncConnection.connect", return_value=conn):
        from deerflow.runtime.event_log.postgres import PostgresEventLog
        log = PostgresEventLog(connection_string="postgresql://localhost/test")
        # Should not raise — failures are logged as warnings
        await log.append("r", "t", "values", {}, "1-0")
```

**Step 2: Run to confirm failure**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_postgres_event_log.py -v
```
Expected: `ModuleNotFoundError`

**Step 3: Implement PostgresEventLog**

```python
# backend/packages/harness/deerflow/runtime/event_log/__init__.py
from .postgres import PostgresEventLog

__all__ = ["PostgresEventLog"]
```

```python
# backend/packages/harness/deerflow/runtime/event_log/postgres.py
"""PostgreSQL-backed run event log."""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS run_event_log (
    id          BIGSERIAL PRIMARY KEY,
    run_id      TEXT        NOT NULL,
    thread_id   TEXT        NOT NULL,
    event       TEXT        NOT NULL,
    data        JSONB       NOT NULL,
    seq         TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rel_run    ON run_event_log (run_id, id);
CREATE INDEX IF NOT EXISTS idx_rel_thread ON run_event_log (thread_id, id);
"""

_INSERT_SQL = """
INSERT INTO run_event_log (run_id, thread_id, event, data, seq)
VALUES (%s, %s, %s, %s::jsonb, %s)
RETURNING id;
"""

_NOTIFY_SQL = "SELECT pg_notify('run_events', %s);"

_LIST_SQL_BASE = """
SELECT id, run_id, thread_id, event, data::text, seq, created_at::text
FROM run_event_log
WHERE id > %s
"""


class PostgresEventLog:
    """Async PostgreSQL-backed event log for SSE stream events."""

    def __init__(self, *, connection_string: str) -> None:
        self._conn_str = connection_string
        self._table_ensured = False

    async def _ensure_table(self) -> None:
        if self._table_ensured:
            return
        try:
            import psycopg
            async with await psycopg.AsyncConnection.connect(self._conn_str) as conn:
                async with conn.cursor() as cur:
                    await cur.execute(_CREATE_TABLE_SQL)
                await conn.commit()
            self._table_ensured = True
        except Exception:
            logger.warning("event_log: failed to ensure table", exc_info=True)

    async def append(
        self, run_id: str, thread_id: str, event: str, data: Any, seq: str
    ) -> int | None:
        """Insert one event row. Returns the new row id, or None on failure."""
        await self._ensure_table()
        try:
            import psycopg
            import psycopg.rows
            payload = json.dumps(data, ensure_ascii=False)
            async with await psycopg.AsyncConnection.connect(self._conn_str) as conn:
                async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                    await cur.execute(_INSERT_SQL, (run_id, thread_id, event, payload, seq))
                    row = await cur.fetchone()
                    new_id = row["id"] if row else None
                    if new_id:
                        await cur.execute(_NOTIFY_SQL, (run_id,))
                await conn.commit()
            return new_id
        except Exception:
            logger.warning("event_log: append failed for run=%s event=%s", run_id, event, exc_info=True)
            return None

    async def list_events(
        self,
        *,
        run_id: str | None = None,
        thread_id: str | None = None,
        after_id: int = 0,
        event_types: list[str] | None = None,
        limit: int = 500,
    ) -> list[dict]:
        await self._ensure_table()
        try:
            import psycopg
            import psycopg.rows
            sql = _LIST_SQL_BASE
            params: list[Any] = [after_id]
            if run_id:
                sql += " AND run_id = %s"
                params.append(run_id)
            if thread_id:
                sql += " AND thread_id = %s"
                params.append(thread_id)
            if event_types:
                placeholders = ", ".join(["%s"] * len(event_types))
                sql += f" AND event IN ({placeholders})"
                params.extend(event_types)
            sql += " ORDER BY id LIMIT %s"
            params.append(limit)
            async with await psycopg.AsyncConnection.connect(self._conn_str) as conn:
                async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                    await cur.execute(sql, params)
                    rows = await cur.fetchall()
            result = []
            for r in rows:
                r["data"] = json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]
                result.append(dict(r))
            return result
        except Exception:
            logger.warning("event_log: list_events failed", exc_info=True)
            return []

    async def subscribe_live(
        self, run_id: str, *, after_id: int = 0
    ) -> AsyncIterator[dict]:
        """Yield events for run_id via LISTEN/NOTIFY. Ends when __end__ event received."""
        await self._ensure_table()
        # First yield any already-stored events
        buffered = await self.list_events(run_id=run_id, after_id=after_id, limit=500)
        for ev in buffered:
            yield ev
            after_id = ev["id"]
            if ev["event"] == "__end__":
                return

        try:
            import psycopg
            import psycopg.rows
            async with await psycopg.AsyncConnection.connect(
                self._conn_str, autocommit=True
            ) as conn:
                await conn.execute("LISTEN run_events")
                async for notify in conn.notifies():
                    if notify.payload != run_id:
                        continue
                    # Fetch new rows since last seen id
                    new_events = await self.list_events(
                        run_id=run_id, after_id=after_id, limit=100
                    )
                    for ev in new_events:
                        yield ev
                        after_id = ev["id"]
                        if ev["event"] == "__end__":
                            return
        except Exception:
            logger.warning("event_log: subscribe_live failed for run=%s", run_id, exc_info=True)
```

**Step 4: Run tests**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_postgres_event_log.py -v
```
Expected: all 3 tests PASS

**Step 5: Commit**

```bash
git add backend/packages/harness/deerflow/runtime/event_log/ \
        backend/tests/test_postgres_event_log.py
git commit -m "feat(event-log): add PostgresEventLog with append/list/subscribe_live"
```

---

## Task 3: LoggingStreamBridge

**Files:**
- Create: `backend/packages/harness/deerflow/runtime/stream_bridge/logging_bridge.py`
- Create: `backend/tests/test_logging_stream_bridge.py`

**Step 1: Write failing tests**

```python
# backend/tests/test_logging_stream_bridge.py
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_inner():
    inner = AsyncMock()
    inner.subscribe = MagicMock(return_value=AsyncMock())
    inner.cleanup = AsyncMock()
    return inner


@pytest.fixture
def mock_log():
    log = AsyncMock()
    log.append = AsyncMock(return_value=1)
    return log


@pytest.mark.asyncio
async def test_publish_calls_inner_and_log(mock_inner, mock_log):
    from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
    registry = lambda rid: "thread-xyz"
    bridge = LoggingStreamBridge(inner=mock_inner, event_log=mock_log, run_registry=registry)
    await bridge.publish("run-1", "values", {"k": "v"})
    mock_inner.publish.assert_awaited_once_with("run-1", "values", {"k": "v"})
    mock_log.append.assert_awaited_once()
    call_kwargs = mock_log.append.call_args
    assert call_kwargs.kwargs["run_id"] == "run-1"
    assert call_kwargs.kwargs["thread_id"] == "thread-xyz"
    assert call_kwargs.kwargs["event"] == "values"


@pytest.mark.asyncio
async def test_publish_end_appends_end_event(mock_inner, mock_log):
    from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
    registry = lambda rid: None
    bridge = LoggingStreamBridge(inner=mock_inner, event_log=mock_log, run_registry=registry)
    await bridge.publish_end("run-1")
    mock_inner.publish_end.assert_awaited_once_with("run-1")
    mock_log.append.assert_awaited_once()
    assert mock_log.append.call_args.kwargs["event"] == "__end__"


@pytest.mark.asyncio
async def test_subscribe_delegates_to_inner(mock_inner, mock_log):
    from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
    registry = lambda rid: "t"
    bridge = LoggingStreamBridge(inner=mock_inner, event_log=mock_log, run_registry=registry)
    bridge.subscribe("run-1", last_event_id="abc")
    mock_inner.subscribe.assert_called_once_with("run-1", last_event_id="abc", heartbeat_interval=15.0)


@pytest.mark.asyncio
async def test_log_failure_does_not_block_publish(mock_inner, mock_log):
    """If event_log.append raises, publish should still succeed."""
    mock_log.append = AsyncMock(side_effect=Exception("log down"))
    from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
    registry = lambda rid: "t"
    bridge = LoggingStreamBridge(inner=mock_inner, event_log=mock_log, run_registry=registry)
    # Should not raise
    await bridge.publish("run-1", "values", {})
    mock_inner.publish.assert_awaited_once()
```

**Step 2: Run to confirm failure**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_logging_stream_bridge.py -v
```
Expected: `ModuleNotFoundError`

**Step 3: Implement LoggingStreamBridge**

```python
# backend/packages/harness/deerflow/runtime/stream_bridge/logging_bridge.py
"""Logging decorator for StreamBridge — persists all events to PostgresEventLog."""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from typing import Any, Callable

from .base import StreamBridge, StreamEvent

logger = logging.getLogger(__name__)


class LoggingStreamBridge(StreamBridge):
    """Wraps any StreamBridge and writes every published event to a PostgresEventLog.

    Args:
        inner: The underlying StreamBridge (MemoryStreamBridge or RedisStreamBridge).
        event_log: A PostgresEventLog instance for persistence.
        run_registry: Callable mapping run_id → thread_id (or None if unknown).
    """

    def __init__(
        self,
        *,
        inner: StreamBridge,
        event_log: Any,  # PostgresEventLog — avoid circular import
        run_registry: Callable[[str], str | None],
    ) -> None:
        self._inner = inner
        self._log = event_log
        self._run_registry = run_registry
        self._seqs: dict[str, int] = {}

    def _next_seq(self, run_id: str) -> str:
        n = self._seqs.get(run_id, 0)
        self._seqs[run_id] = n + 1
        ts = int(time.time() * 1000)
        return f"{ts}-{n}"

    async def publish(self, run_id: str, event: str, data: Any) -> None:
        await self._inner.publish(run_id, event, data)
        seq = self._next_seq(run_id)
        thread_id = self._run_registry(run_id) or ""
        try:
            await self._log.append(
                run_id=run_id, thread_id=thread_id, event=event, data=data, seq=seq
            )
        except Exception:
            logger.warning("event_log: append failed silently for run=%s", run_id, exc_info=True)

    async def publish_end(self, run_id: str) -> None:
        await self._inner.publish_end(run_id)
        seq = self._next_seq(run_id)
        thread_id = self._run_registry(run_id) or ""
        try:
            await self._log.append(
                run_id=run_id, thread_id=thread_id, event="__end__", data=None, seq=seq
            )
        except Exception:
            logger.warning("event_log: append(__end__) failed for run=%s", run_id, exc_info=True)
        self._seqs.pop(run_id, None)

    def subscribe(
        self,
        run_id: str,
        *,
        last_event_id: str | None = None,
        heartbeat_interval: float = 15.0,
    ) -> AsyncIterator[StreamEvent]:
        return self._inner.subscribe(
            run_id, last_event_id=last_event_id, heartbeat_interval=heartbeat_interval
        )

    async def cleanup(self, run_id: str, *, delay: float = 0) -> None:
        await self._inner.cleanup(run_id, delay=delay)

    async def close(self) -> None:
        await self._inner.close()
```

**Step 4: Run tests**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_logging_stream_bridge.py -v
```
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add backend/packages/harness/deerflow/runtime/stream_bridge/logging_bridge.py \
        backend/tests/test_logging_stream_bridge.py
git commit -m "feat(stream-bridge): add LoggingStreamBridge decorator"
```

---

## Task 4: Wire Up Factory and Deps

**Files:**
- Modify: `backend/packages/harness/deerflow/runtime/stream_bridge/async_provider.py`
- Modify: `backend/app/gateway/deps.py`

**Step 1: Update `make_stream_bridge` factory**

Read `async_provider.py` first. Then wrap the yielded bridge when event_log config is enabled.

At the **end** of `make_stream_bridge`, before `yield bridge`, add:

```python
# Wrap with logging bridge if event_log is configured
from deerflow.config.event_log_config import get_event_log_config
event_log_cfg = get_event_log_config()
if event_log_cfg and event_log_cfg.enabled:
    from deerflow.runtime.event_log.postgres import PostgresEventLog
    from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
    event_log = PostgresEventLog(connection_string=event_log_cfg.connection_string)
    # run_registry is injected later via set_run_registry()
    bridge = LoggingStreamBridge(
        inner=bridge,
        event_log=event_log,
        run_registry=lambda run_id: None,  # placeholder; updated in deps.py
    )
    logger.info("Stream bridge wrapped with LoggingStreamBridge (event log enabled)")
```

Since `run_registry` needs `RunManager` (which is created after the bridge), expose a setter:

In `LoggingStreamBridge`, add:
```python
def set_run_registry(self, registry: Callable[[str], str | None]) -> None:
    self._run_registry = registry
```

**Step 2: Update `langgraph_runtime` in `deps.py`**

After `app.state.run_manager = RunManager()`, add:

```python
# Wire run_registry into LoggingStreamBridge if present
from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
if isinstance(app.state.stream_bridge, LoggingStreamBridge):
    run_mgr = app.state.run_manager
    def _get_thread_id(run_id: str) -> str | None:
        rec = run_mgr._runs.get(run_id)
        return rec.thread_id if rec else None
    app.state.stream_bridge.set_run_registry(_get_thread_id)
```

Also add `app.state.event_log`:
```python
from deerflow.runtime.stream_bridge.logging_bridge import LoggingStreamBridge
if isinstance(app.state.stream_bridge, LoggingStreamBridge):
    app.state.event_log = app.state.stream_bridge._log
else:
    app.state.event_log = None
```

**Step 3: Add `get_event_log` dep getter**

In `deps.py`, add:
```python
def get_event_log(request: Request):
    """Return the PostgresEventLog if configured, else None."""
    return getattr(request.app.state, "event_log", None)
```

**Step 4: Verify existing tests still pass**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v --ignore=tests/test_client_live.py
```
Expected: all existing tests PASS (no regressions)

**Step 5: Commit**

```bash
git add backend/packages/harness/deerflow/runtime/stream_bridge/async_provider.py \
        backend/packages/harness/deerflow/runtime/stream_bridge/logging_bridge.py \
        backend/app/gateway/deps.py
git commit -m "feat(wire): connect LoggingStreamBridge to RunManager in gateway deps"
```

---

## Task 5: Gateway Router — run_events

**Files:**
- Create: `backend/app/gateway/routers/run_events.py`
- Modify: `backend/app/gateway/app.py`

**Step 1: Create the router**

```python
# backend/app/gateway/routers/run_events.py
"""REST + SSE endpoints for querying persisted run events."""
from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.gateway.deps import get_event_log

logger = logging.getLogger(__name__)

router = APIRouter(tags=["run-events"])


class RunEvent(BaseModel):
    id: int
    run_id: str
    thread_id: str
    event: str
    data: object
    seq: str
    created_at: str


class EventsResponse(BaseModel):
    events: list[RunEvent]
    next_after_id: int


@router.get("/api/threads/{thread_id}/runs/{run_id}/events", response_model=EventsResponse)
async def get_run_events(
    thread_id: str,
    run_id: str,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    event_type: list[str] | None = Query(default=None),
    event_log=Depends(get_event_log),
):
    """Return paginated historical events for a specific run."""
    if event_log is None:
        return EventsResponse(events=[], next_after_id=0)
    rows = await event_log.list_events(
        run_id=run_id, after_id=after_id,
        event_types=event_type, limit=limit,
    )
    events = [RunEvent(**r) for r in rows]
    next_id = events[-1].id if events else after_id
    return EventsResponse(events=events, next_after_id=next_id)


@router.get("/api/threads/{thread_id}/events", response_model=EventsResponse)
async def get_thread_events(
    thread_id: str,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    event_type: list[str] | None = Query(default=None),
    event_log=Depends(get_event_log),
):
    """Return paginated events for all runs in a thread."""
    if event_log is None:
        return EventsResponse(events=[], next_after_id=0)
    rows = await event_log.list_events(
        thread_id=thread_id, after_id=after_id,
        event_types=event_type, limit=limit,
    )
    events = [RunEvent(**r) for r in rows]
    next_id = events[-1].id if events else after_id
    return EventsResponse(events=events, next_after_id=next_id)


@router.get("/api/threads/{thread_id}/runs/{run_id}/events/stream")
async def stream_run_events(
    thread_id: str,
    run_id: str,
    after_id: int = Query(default=0, ge=0),
    event_log=Depends(get_event_log),
):
    """SSE endpoint: replay buffered events then push live events via LISTEN/NOTIFY."""
    if event_log is None:
        async def empty():
            yield "data: {}\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    async def generate():
        try:
            async for ev in event_log.subscribe_live(run_id=run_id, after_id=after_id):
                payload = json.dumps(ev, default=str)
                yield f"data: {payload}\n\n"
                if ev.get("event") == "__end__":
                    break
        except Exception:
            logger.warning("stream_run_events: subscribe_live error for run=%s", run_id, exc_info=True)
            yield "event: error\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**Step 2: Register router in `app.py`**

In `backend/app/gateway/app.py`, add the import:
```python
from app.gateway.routers import (
    ...
    run_events,  # add this
)
```

After the existing router includes, add:
```python
# Run Events API
app.include_router(run_events.router)
```

Also add to `openapi_tags`:
```python
{
    "name": "run-events",
    "description": "Query and stream persisted SSE events for runs and threads",
},
```

**Step 3: Verify app starts**

```bash
cd backend && PYTHONPATH=. uv run python -c "from app.gateway.app import create_app; app = create_app(); print('OK')"
```
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/gateway/routers/run_events.py \
        backend/app/gateway/app.py
git commit -m "feat(api): add run_events router for event log REST + SSE endpoints"
```

---

## Task 6: Frontend — API Types and useEventLog Hook

**Files:**
- Create: `frontend/src/core/run-events/types.ts`
- Create: `frontend/src/core/run-events/api.ts`
- Create: `frontend/src/core/run-events/use-event-log.ts`

**Step 1: Create types**

```typescript
// frontend/src/core/run-events/types.ts
export interface RunEvent {
  id: number;
  run_id: string;
  thread_id: string;
  event: string;
  data: unknown;
  seq: string;
  created_at: string;
}

export interface EventsResponse {
  events: RunEvent[];
  next_after_id: number;
}
```

**Step 2: Create API helper**

```typescript
// frontend/src/core/run-events/api.ts
import { type EventsResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "";

export async function fetchRunEvents(
  threadId: string,
  runId: string,
  afterId = 0,
  eventTypes?: string[],
): Promise<EventsResponse> {
  const params = new URLSearchParams({ after_id: String(afterId), limit: "200" });
  if (eventTypes?.length) {
    eventTypes.forEach((t) => params.append("event_type", t));
  }
  const res = await fetch(
    `${BASE}/api/threads/${threadId}/runs/${runId}/events?${params}`,
  );
  if (!res.ok) throw new Error(`fetchRunEvents: ${res.status}`);
  return res.json() as Promise<EventsResponse>;
}

export function createRunEventSource(
  threadId: string,
  runId: string,
  afterId = 0,
): EventSource {
  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "";
  return new EventSource(
    `${BASE_URL}/api/threads/${threadId}/runs/${runId}/events/stream?after_id=${afterId}`,
  );
}
```

**Step 3: Create useEventLog hook**

```typescript
// frontend/src/core/run-events/use-event-log.ts
"use client";

import { useEffect, useRef, useState } from "react";

import { fetchRunEvents, createRunEventSource } from "./api";
import { type RunEvent } from "./types";

export function useEventLog(
  threadId: string,
  runId: string | null,
  isLiveRun = false,
) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    setIsLoading(true);
    setEvents([]);

    fetchRunEvents(threadId, runId)
      .then(({ events: initial, next_after_id }) => {
        setEvents(initial);
        setIsLoading(false);

        if (isLiveRun) {
          const es = createRunEventSource(threadId, runId, next_after_id);
          esRef.current = es;
          es.onmessage = (e: MessageEvent) => {
            try {
              const ev: RunEvent = JSON.parse(e.data as string);
              setEvents((prev) => [...prev, ev]);
            } catch {
              // ignore parse errors
            }
          };
          es.onerror = () => es.close();
        }
      })
      .catch(() => setIsLoading(false));

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [threadId, runId, isLiveRun]);

  return { events, isLoading };
}
```

**Step 4: Type-check**

```bash
cd frontend && pnpm typecheck 2>&1 | grep -E "(error|Error)" | head -20
```
Expected: no errors in the new files

**Step 5: Commit**

```bash
git add frontend/src/core/run-events/
git commit -m "feat(frontend): add run-events API types and useEventLog hook"
```

---

## Task 7: Frontend — EventItem and EventLogList Components

**Files:**
- Create: `frontend/src/components/workspace/session-events/event-item.tsx`
- Create: `frontend/src/components/workspace/session-events/event-log-list.tsx`

**Step 1: Create EventItem**

```tsx
// frontend/src/components/workspace/session-events/event-item.tsx
"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { type RunEvent } from "@/core/run-events/types";
import { cn } from "@/lib/utils";

const EVENT_COLORS: Record<string, string> = {
  "messages-tuple": "bg-blue-500/10 text-blue-600 border-blue-200",
  values: "bg-green-500/10 text-green-600 border-green-200",
  updates: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  metadata: "bg-purple-500/10 text-purple-600 border-purple-200",
  error: "bg-red-500/10 text-red-600 border-red-200",
  __end__: "bg-gray-500/10 text-gray-600 border-gray-200",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function EventItem({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const badgeClass = EVENT_COLORS[event.event] ?? "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Badge variant="outline" className={cn("font-mono text-xs", badgeClass)}>
          {event.event}
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {formatTime(event.created_at)}
        </span>
      </button>
      {open && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs leading-relaxed">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

**Step 2: Create EventLogList**

```tsx
// frontend/src/components/workspace/session-events/event-log-list.tsx
"use client";

import { useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { type RunEvent } from "@/core/run-events/types";

import { EventItem } from "./event-item";

interface EventLogListProps {
  events: RunEvent[];
  isLoading: boolean;
  isLive: boolean;
}

export function EventLogList({ events, isLoading, isLive }: EventLogListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, isLive]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading events…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No events recorded for this run.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border/50">
        {events.map((ev) => (
          <EventItem key={ev.id} event={ev} />
        ))}
      </div>
      <div ref={bottomRef} />
    </ScrollArea>
  );
}
```

**Step 3: Type-check**

```bash
cd frontend && pnpm typecheck 2>&1 | grep -E "(error|Error)" | head -20
```
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/components/workspace/session-events/
git commit -m "feat(frontend): add EventItem and EventLogList components"
```

---

## Task 8: Frontend — SessionEventsSheet and Wire into Chat Toolbar

**Files:**
- Create: `frontend/src/components/workspace/session-events/session-events-sheet.tsx`
- Modify: chat toolbar component (find by reading `frontend/src/components/workspace/` structure)

**Step 1: Read the toolbar file**

```bash
ls frontend/src/components/workspace/
```

Find the toolbar or controls component in `frontend/src/components/ai-elements/toolbar.tsx` or `controls.tsx`. Read it to find how to add a button.

**Step 2: Create SessionEventsSheet**

```tsx
// frontend/src/components/workspace/session-events/session-events-sheet.tsx
"use client";

import { useState } from "react";
import { ActivityIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEventLog } from "@/core/run-events/use-event-log";

import { EventLogList } from "./event-log-list";

interface SessionEventsSheetProps {
  threadId: string;
  runs: Array<{ run_id: string; is_live?: boolean }>;
}

export function SessionEventsSheet({ threadId, runs }: SessionEventsSheetProps) {
  const [open, setOpen] = useState(false);
  const latestRun = runs[runs.length - 1];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    latestRun?.run_id ?? null,
  );
  const isLive = runs.find((r) => r.run_id === selectedRunId)?.is_live ?? false;
  const { events, isLoading } = useEventLog(threadId, selectedRunId, isLive);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Session Events">
          <ActivityIcon className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-medium">Session Events</SheetTitle>
        </SheetHeader>

        {runs.length > 1 ? (
          <Tabs
            value={selectedRunId ?? undefined}
            onValueChange={setSelectedRunId}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-4 mt-3 mb-1 h-8">
              {runs.map((r, i) => (
                <TabsTrigger key={r.run_id} value={r.run_id} className="text-xs">
                  Run {i + 1}
                  {r.is_live && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {runs.map((r) => (
              <TabsContent
                key={r.run_id}
                value={r.run_id}
                className="m-0 flex-1 overflow-hidden"
              >
                <EventLogList
                  events={events}
                  isLoading={isLoading}
                  isLive={r.is_live ?? false}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="flex-1 overflow-hidden">
            <EventLogList events={events} isLoading={isLoading} isLive={isLive} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

**Step 3: Wire into the chat page toolbar**

Read `frontend/src/app/workspace/chats/[thread_id]/page.tsx` to find where controls/toolbar are rendered. Add `SessionEventsSheet` there, passing `threadId` and a `runs` list derived from the thread state.

The exact integration depends on what run_id information is available in thread state. Check `frontend/src/core/threads/` for run_id tracking. If run_id is not currently exposed in thread state, the simplest approach is to pass a single current run derived from the active stream.

After reading the page, add the sheet button in the appropriate toolbar area.

**Step 4: Type-check and lint**

```bash
cd frontend && pnpm check 2>&1 | tail -20
```
Expected: no errors

**Step 5: Commit**

```bash
git add frontend/src/components/workspace/session-events/ \
        frontend/src/app/workspace/chats/
git commit -m "feat(frontend): add SessionEventsSheet panel to chat toolbar"
```

---

## Task 9: Final Integration Test

**Step 1: Add event_log to config.example.yaml**

Add at end of `config.example.yaml` (find the file first with `ls` from project root):
```yaml
# Run event log — persists all SSE events to PostgreSQL for replay and monitoring
# Requires checkpointer.type: postgres to share the same DSN
event_log:
  enabled: false
  connection_string: $POSTGRES_DSN
```

**Step 2: Run full backend test suite**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v --ignore=tests/test_client_live.py 2>&1 | tail -30
```
Expected: all tests PASS

**Step 3: Verify harness boundary**

```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_harness_boundary.py -v
```
Expected: PASS (event_log is in harness, no app.* imports)

**Step 4: Final commit**

```bash
git add config.example.yaml
git commit -m "docs(config): document event_log configuration option"
```

---

## Quick Reference

| Layer | File | Purpose |
|-------|------|---------|
| Config | `deerflow/config/event_log_config.py` | `EventLogConfig` + global accessor |
| Storage | `deerflow/runtime/event_log/postgres.py` | `PostgresEventLog` (append/list/subscribe_live) |
| Bridge | `deerflow/runtime/stream_bridge/logging_bridge.py` | `LoggingStreamBridge` decorator |
| Wire | `deerflow/runtime/stream_bridge/async_provider.py` | Wrap bridge when enabled |
| Wire | `app/gateway/deps.py` | Inject run_registry + expose event_log dep |
| API | `app/gateway/routers/run_events.py` | REST + SSE endpoints |
| Frontend | `core/run-events/` | Types, API helpers, `useEventLog` hook |
| Frontend | `components/workspace/session-events/` | `EventItem`, `EventLogList`, `SessionEventsSheet` |
