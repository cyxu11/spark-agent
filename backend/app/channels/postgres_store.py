"""PostgreSQL-backed channel store for multi-node deployments."""
from __future__ import annotations
import logging
import threading
import time
from typing import Any

try:
    import psycopg
    import psycopg.rows
except ImportError:
    psycopg = None  # type: ignore[assignment]

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
_LIST_SQL = "SELECT key, thread_id, user_id, created_at, updated_at FROM channel_thread_mapping ORDER BY updated_at DESC;"


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

    def list_entries(self, channel_name: str | None = None) -> list[dict[str, Any]]:
        import psycopg
        import psycopg.rows
        with psycopg.connect(self._conn_str, row_factory=psycopg.rows.dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(_LIST_SQL)
                rows = cur.fetchall()
        if channel_name is None:
            return rows
        return [r for r in rows if r["key"].startswith(f"{channel_name}:")]

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
