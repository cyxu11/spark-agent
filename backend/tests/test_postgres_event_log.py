"""Unit tests for PostgresEventLog using monkeypatching (no real DB needed)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


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
