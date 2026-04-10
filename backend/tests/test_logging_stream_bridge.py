import pytest
from unittest.mock import AsyncMock, MagicMock


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
