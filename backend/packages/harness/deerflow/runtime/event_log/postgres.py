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

    async def list_runs(self, *, thread_id: str) -> list[dict]:
        """Return distinct run_ids for a thread, ordered by first event time."""
        await self._ensure_table()
        try:
            import psycopg
            import psycopg.rows
            sql = """
                SELECT run_id, MIN(created_at)::text AS started_at
                FROM run_event_log
                WHERE thread_id = %s
                GROUP BY run_id
                ORDER BY MIN(id)
            """
            async with await psycopg.AsyncConnection.connect(self._conn_str) as conn:
                async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                    await cur.execute(sql, (thread_id,))
                    rows = await cur.fetchall()
            return [dict(r) for r in rows]
        except Exception:
            logger.warning("event_log: list_runs failed for thread=%s", thread_id, exc_info=True)
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
