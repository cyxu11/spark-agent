"""REST + SSE endpoints for querying persisted run events."""
from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.gateway.deps import get_event_log

logger = logging.getLogger(__name__)

router = APIRouter(tags=["run-events"])


class RunEvent(BaseModel):
    id: int
    run_id: str
    thread_id: str
    event: str
    data: object
    seq: str
    created_at: str


class EventsResponse(BaseModel):
    events: list[RunEvent]
    next_after_id: int


@router.get("/api/threads/{thread_id}/runs/{run_id}/events", response_model=EventsResponse)
async def get_run_events(
    thread_id: str,
    run_id: str,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    event_type: list[str] | None = Query(default=None),
    event_log=Depends(get_event_log),
):
    """Return paginated historical events for a specific run."""
    if event_log is None:
        return EventsResponse(events=[], next_after_id=0)
    rows = await event_log.list_events(
        run_id=run_id, after_id=after_id,
        event_types=event_type, limit=limit,
    )
    events = [RunEvent(**r) for r in rows]
    next_id = events[-1].id if events else after_id
    return EventsResponse(events=events, next_after_id=next_id)


@router.get("/api/threads/{thread_id}/events", response_model=EventsResponse)
async def get_thread_events(
    thread_id: str,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    event_type: list[str] | None = Query(default=None),
    event_log=Depends(get_event_log),
):
    """Return paginated events for all runs in a thread."""
    if event_log is None:
        return EventsResponse(events=[], next_after_id=0)
    rows = await event_log.list_events(
        thread_id=thread_id, after_id=after_id,
        event_types=event_type, limit=limit,
    )
    events = [RunEvent(**r) for r in rows]
    next_id = events[-1].id if events else after_id
    return EventsResponse(events=events, next_after_id=next_id)


@router.get("/api/threads/{thread_id}/runs/{run_id}/events/stream")
async def stream_run_events(
    thread_id: str,
    run_id: str,
    after_id: int = Query(default=0, ge=0),
    event_log=Depends(get_event_log),
):
    """SSE endpoint: replay buffered events then push live events via LISTEN/NOTIFY."""
    if event_log is None:
        async def empty():
            yield "data: {}\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    async def generate():
        try:
            async for ev in event_log.subscribe_live(run_id=run_id, after_id=after_id):
                payload = json.dumps(ev, default=str)
                yield f"data: {payload}\n\n"
                if ev.get("event") == "__end__":
                    break
        except Exception:
            logger.warning("stream_run_events: subscribe_live error for run=%s", run_id, exc_info=True)
            yield "event: error\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
