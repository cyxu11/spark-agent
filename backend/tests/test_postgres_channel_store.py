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
        with patch.object(s, "_fetchone", return_value=None):
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
