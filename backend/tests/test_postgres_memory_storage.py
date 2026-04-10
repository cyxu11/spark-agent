"""Tests for PostgresMemoryStorage."""
import pytest
from unittest.mock import MagicMock, patch
def make_storage(conn_str="postgresql://user:pass@localhost/db"):
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    with patch("deerflow.agents.memory.postgres_storage.psycopg") as mock_psycopg:
        mock_conn = MagicMock()
        mock_psycopg.connect.return_value.__enter__.return_value = mock_conn
        storage = PostgresMemoryStorage(connection_string=conn_str)
    return storage
def test_save_and_load_roundtrip():
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    import json
    storage = PostgresMemoryStorage.__new__(PostgresMemoryStorage)
    storage._conn_str = "mock"
    storage._cache = {}
    memory_data = {"version": "1.0", "facts": [{"key": "name", "value": "Alice"}]}
    with patch.object(storage, "_execute") as mock_exec, \
         patch.object(storage, "_fetch_one", return_value=(json.dumps(memory_data),)):
        storage.save(memory_data, agent_name="lead_agent")
        result = storage.load(agent_name="lead_agent")
    assert result["facts"][0]["value"] == "Alice"
def test_load_missing_returns_empty():
    from deerflow.agents.memory.postgres_storage import PostgresMemoryStorage
    from deerflow.agents.memory.storage import create_empty_memory
    storage = PostgresMemoryStorage.__new__(PostgresMemoryStorage)
    storage._conn_str = "mock"
    storage._cache = {}
    with patch.object(storage, "_fetch_one", return_value=None):
        result = storage.load(agent_name="lead_agent")
    expected = create_empty_memory()
    # lastUpdated is generated at call time, exclude from structural comparison
    result_cmp = {k: v for k, v in result.items() if k != "lastUpdated"}
    expected_cmp = {k: v for k, v in expected.items() if k != "lastUpdated"}
    assert result_cmp == expected_cmp
