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
        import time
        memory_data["lastUpdated"] = time.time()
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
