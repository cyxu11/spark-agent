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
