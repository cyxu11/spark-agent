"""Configuration for the run event log (PostgreSQL persistence of SSE events)."""
from __future__ import annotations

from pydantic import BaseModel, Field

_event_log_config: "EventLogConfig | None" = None


class EventLogConfig(BaseModel):
    """Configuration for persisting SSE stream events to PostgreSQL."""

    enabled: bool = Field(default=False, description="Enable event log persistence.")
    connection_string: str = Field(description="PostgreSQL DSN, e.g. 'postgresql://user:pass@host/db'.")


def get_event_log_config() -> "EventLogConfig | None":
    return _event_log_config


def set_event_log_config(config: "EventLogConfig | None") -> None:
    global _event_log_config
    _event_log_config = config


def load_event_log_config_from_dict(d: dict) -> None:
    global _event_log_config
    _event_log_config = EventLogConfig(**d)
