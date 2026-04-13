"""Thread export endpoints — currently HTML report sharing.

Accepts a finished HTML report from the frontend, persists it under the
thread's outputs directory (and replicates to the configured outputs
backend, e.g. MinIO, for multi-node deployments), and serves it back
inline so the user gets a shareable webpage URL.

The serving endpoint is intentionally separate from
:mod:`app.gateway.routers.artifacts`, which forces ``text/html`` to be a
download attachment to defend against XSS in agent-produced files.
Reports here are explicitly user-initiated exports of their own
conversation, so inline rendering is the desired behaviour.
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threads", tags=["exports"])

EXPORTS_SUBDIR = "exports"
MAX_HTML_BYTES = 10 * 1024 * 1024  # 10 MB safety cap
SLUG_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.html$")


def _exports_dir(thread_id: str) -> Path:
    paths = get_paths()
    target = paths.thread_dir(thread_id) / "user-data" / "outputs" / EXPORTS_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


@router.post("/{thread_id}/exports/html")
async def upload_html_export(thread_id: str, request: Request) -> dict:
    """Persist an HTML report and return a shareable URL.

    The frontend POSTs the fully-rendered HTML document as the raw request
    body (Content-Type: ``text/html``).  We store it under the thread's
    outputs directory so that the existing artifact-cleanup pipeline reaps
    it on thread deletion, and replicate to the configured outputs
    backend (MinIO etc.) when one is wired up.
    """
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")
    if len(body) > MAX_HTML_BYTES:
        raise HTTPException(status_code=413, detail=f"Export exceeds {MAX_HTML_BYTES} bytes")

    slug = uuid.uuid4().hex[:12]
    filename = f"{slug}.html"
    local_path = _exports_dir(thread_id) / filename
    local_path.write_bytes(body)

    # Best-effort replication to the outputs backend (MinIO etc.) so the
    # link is reachable from any gateway node.  Failure is non-fatal —
    # local serving still works on this node.
    try:
        from deerflow.outputs.provider import get_outputs_backend

        backend = get_outputs_backend()
        virtual_path = f"/mnt/user-data/outputs/{EXPORTS_SUBDIR}/{filename}"
        await backend.upload(thread_id, virtual_path, local_path)
    except Exception:
        logger.warning(
            "exports: failed to replicate %s to outputs backend (serving locally only)",
            filename,
            exc_info=True,
        )

    return {
        "share_url": f"/api/threads/{thread_id}/exports/{filename}",
        "filename": filename,
    }


@router.get("/{thread_id}/exports/{filename}")
async def serve_html_export(thread_id: str, filename: str) -> Response:
    """Serve a previously-uploaded HTML export inline."""
    if not SLUG_RE.fullmatch(filename):
        raise HTTPException(status_code=400, detail="Invalid export filename")

    local_path = _exports_dir(thread_id) / filename
    if local_path.exists():
        return FileResponse(local_path, media_type="text/html; charset=utf-8")

    # Fall back to the outputs backend for nodes that did not receive the
    # original POST (multi-node behind a load balancer + MinIO).
    try:
        from deerflow.outputs.provider import get_outputs_backend

        backend = get_outputs_backend()
        virtual_path = f"/mnt/user-data/outputs/{EXPORTS_SUBDIR}/{filename}"
        response = await backend.get_response(thread_id, virtual_path)
        # ``artifacts`` forces HTML to be a download attachment for safety;
        # for explicit user exports we want inline rendering, so override.
        if "Content-Disposition" in response.headers:
            del response.headers["Content-Disposition"]
        response.headers["Content-Type"] = "text/html; charset=utf-8"
        return response
    except HTTPException:
        raise
    except Exception:
        logger.exception("exports: backend retrieval failed for %s", filename)

    raise HTTPException(status_code=404, detail="Export not found")
