"""Middleware for logging agent execution events to PostgreSQL event log.

Bridges the gap between LangGraph Server (standard mode) and the
LoggingStreamBridge (Gateway mode) so that Session Events are recorded
regardless of deployment mode.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.config import get_config
from langgraph.runtime import Runtime
from langgraph.types import Command

logger = logging.getLogger(__name__)


class EventLogMiddleware(AgentMiddleware):
    """Records agent execution events to PostgreSQL event log."""

    def __init__(self) -> None:
        self._event_log = None
        self._initialized = False
        self._seq_counter = 0
        self._thread_id: str | None = None
        self._run_id: str | None = None

    def _ensure_event_log(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        try:
            from deerflow.config.event_log_config import get_event_log_config

            cfg = get_event_log_config()
            if cfg and cfg.enabled:
                from deerflow.runtime.event_log.postgres import PostgresEventLog

                self._event_log = PostgresEventLog(connection_string=cfg.connection_string)
                logger.info("EventLogMiddleware: PostgreSQL backend ready")
        except Exception:
            logger.warning("EventLogMiddleware: init failed", exc_info=True)

    def _run_info(self, runtime: Runtime | None = None) -> tuple[str | None, str | None]:
        try:
            config_data = get_config()
            configurable = config_data.get("configurable", {})
            thread_id = configurable.get("thread_id")
            run_id = config_data.get("run_id") or configurable.get("run_id")
            if not thread_id or not run_id:
                metadata = config_data.get("metadata", {})
                if not thread_id:
                    thread_id = metadata.get("thread_id")
                if not run_id:
                    run_id = metadata.get("run_id")
            return thread_id, run_id
        except Exception:
            return self._thread_id, self._run_id

    async def _log(self, thread_id: str, run_id: str, event: str, data: dict) -> None:
        if not self._event_log:
            return
        self._seq_counter += 1
        ts = int(time.time() * 1000)
        try:
            await self._event_log.append(
                run_id=run_id,
                thread_id=thread_id,
                event=event,
                data=data,
                seq=f"{ts}-{self._seq_counter}",
            )
        except Exception:
            logger.warning("EventLogMiddleware: append failed event=%s", event, exc_info=True)

    # ── agent lifecycle ──────────────────────────────────────────────────

    @override
    async def abefore_agent(self, state: AgentState, runtime: Runtime) -> dict | None:
        self._ensure_event_log()
        if not self._event_log:
            return None
        thread_id, run_id = self._run_info(runtime)
        if not thread_id or not run_id:
            return None
        self._thread_id = thread_id
        self._run_id = run_id
        self._seq_counter = 0
        await self._log(thread_id, run_id, "agent_start", {"ts": time.time()})
        return None

    @override
    async def aafter_agent(self, state: AgentState, runtime: Runtime) -> dict | None:
        if not self._event_log:
            return None
        thread_id, run_id = self._run_info(runtime)
        if not thread_id or not run_id:
            return None
        messages = state.get("messages", [])
        await self._log(thread_id, run_id, "agent_end", {"ts": time.time(), "total_messages": len(messages)})
        await self._log(thread_id, run_id, "__end__", {})
        return None

    # ── model lifecycle ──────────────────────────────────────────────────

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        if not self._event_log:
            return None
        thread_id, run_id = self._run_info(runtime)
        if not thread_id or not run_id:
            return None
        await self._log(thread_id, run_id, "model_start", {"message_count": len(state.get("messages", []))})
        return None

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        if not self._event_log:
            return None
        thread_id, run_id = self._run_info(runtime)
        if not thread_id or not run_id:
            return None
        messages = state.get("messages", [])
        last = messages[-1] if messages else None
        data: dict = {}
        if last:
            data["message_type"] = last.__class__.__name__
            content = getattr(last, "content", "")
            if isinstance(content, str) and content:
                data["content_preview"] = content[:200]
            usage = getattr(last, "usage_metadata", None)
            if usage:
                data["usage"] = dict(usage)
            tool_calls = getattr(last, "tool_calls", None)
            if tool_calls:
                data["tool_calls"] = [{"name": tc.get("name", "?"), "id": tc.get("id", "")} for tc in tool_calls]
        await self._log(thread_id, run_id, "model_end", data)
        return None

    # ── tool lifecycle ───────────────────────────────────────────────────

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        if not self._event_log:
            return await handler(request)
        thread_id, run_id = self._run_info()
        tool_name = request.tool_call.get("name", "unknown")
        tool_call_id = request.tool_call.get("id", "")
        if thread_id and run_id:
            await self._log(thread_id, run_id, "tool_start", {"tool": tool_name, "tool_call_id": tool_call_id})
        start = time.time()
        try:
            result = await handler(request)
        except Exception as exc:
            if thread_id and run_id:
                await self._log(thread_id, run_id, "tool_error", {
                    "tool": tool_name, "tool_call_id": tool_call_id,
                    "error": str(exc)[:200], "duration_s": round(time.time() - start, 2),
                })
            raise
        if thread_id and run_id:
            data: dict = {"tool": tool_name, "tool_call_id": tool_call_id, "duration_s": round(time.time() - start, 2)}
            if isinstance(result, ToolMessage):
                content = result.content
                if isinstance(content, str):
                    data["result_preview"] = content[:300]
            await self._log(thread_id, run_id, "tool_end", data)
        return result
