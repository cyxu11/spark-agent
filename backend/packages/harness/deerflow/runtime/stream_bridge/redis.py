"""Redis Streams-backed stream bridge for multi-process/multi-node deployments."""
from __future__ import annotations
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any
from .base import END_SENTINEL, HEARTBEAT_SENTINEL, StreamBridge, StreamEvent
logger = logging.getLogger(__name__)
_STREAM_PREFIX = "stream:"
_END_EVENT = "__end__"
# Valid Redis stream ID: "<ms>" or "<ms>-<seq>" (e.g. "1729957800000-0").
# We also accept the special "0" / "0-0" sentinel used for "from beginning".
_REDIS_STREAM_ID_RE = re.compile(r"^\d+(-\d+)?$")


def _normalize_start_id(last_event_id: str | None) -> str:
    """Return a Redis-valid XREAD start ID.

    The browser may send arbitrary ``Last-Event-ID`` values (empty, a
    plain integer from a different bridge implementation, etc.).  Redis
    rejects anything that is not ``<ms>[-<seq>]`` with
    ``ResponseError: Invalid stream ID specified as stream command
    argument`` which surfaces in the browser as
    ``ERR_INCOMPLETE_CHUNKED_ENCODING``.  Fall back to replaying from
    the beginning when the value is missing or malformed.
    """
    if not last_event_id:
        return "0-0"
    candidate = last_event_id.strip()
    if _REDIS_STREAM_ID_RE.fullmatch(candidate):
        return candidate
    logger.warning(
        "redis-stream-bridge: ignoring malformed Last-Event-ID %r; replaying from start",
        last_event_id,
    )
    return "0-0"
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
        # Redis XREAD uses "$" for new-only or a specific entry ID for replay.
        # Validate the caller-supplied Last-Event-ID to avoid "Invalid stream ID"
        # errors that would abort the SSE response mid-flight.
        start_id = _normalize_start_id(last_event_id)
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
