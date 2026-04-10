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

    def set_run_registry(self, registry: Callable[[str], str | None]) -> None:
        self._run_registry = registry

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
