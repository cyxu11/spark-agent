import asyncio
import logging
from pathlib import Path
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.config import get_config
from langgraph.runtime import Runtime

from deerflow.agents.thread_state import ThreadDataState
from deerflow.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)


class ThreadDataMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    thread_data: NotRequired[ThreadDataState | None]


class ThreadDataMiddleware(AgentMiddleware[ThreadDataMiddlewareState]):
    """Create thread data directories for each thread execution.

    Creates the following directory structure:
    - {base_dir}/threads/{thread_id}/user-data/workspace
    - {base_dir}/threads/{thread_id}/user-data/uploads
    - {base_dir}/threads/{thread_id}/user-data/outputs

    Lifecycle Management:
    - With lazy_init=True (default): Only compute paths, directories created on-demand
    - With lazy_init=False: Eagerly create directories in before_agent()
    """

    state_schema = ThreadDataMiddlewareState

    def __init__(self, base_dir: str | None = None, lazy_init: bool = True):
        """Initialize the middleware.

        Args:
            base_dir: Base directory for thread data. Defaults to Paths resolution.
            lazy_init: If True, defer directory creation until needed.
                      If False, create directories eagerly in before_agent().
                      Default is True for optimal performance.
        """
        super().__init__()
        self._paths = Paths(base_dir) if base_dir else get_paths()
        self._lazy_init = lazy_init

    def _get_thread_paths(self, thread_id: str) -> dict[str, str]:
        """Get the paths for a thread's data directories.

        Args:
            thread_id: The thread ID.

        Returns:
            Dictionary with workspace_path, uploads_path, and outputs_path.
        """
        return {
            "workspace_path": str(self._paths.sandbox_work_dir(thread_id)),
            "uploads_path": str(self._paths.sandbox_uploads_dir(thread_id)),
            "outputs_path": str(self._paths.sandbox_outputs_dir(thread_id)),
        }

    def _create_thread_directories(self, thread_id: str) -> dict[str, str]:
        """Create the thread data directories.

        Args:
            thread_id: The thread ID.

        Returns:
            Dictionary with the created directory paths.
        """
        self._paths.ensure_thread_dirs(thread_id)
        return self._get_thread_paths(thread_id)

    @override
    def before_agent(self, state: ThreadDataMiddlewareState, runtime: Runtime) -> dict | None:
        context = runtime.context or {}
        thread_id = context.get("thread_id")
        if thread_id is None:
            config = get_config()
            thread_id = config.get("configurable", {}).get("thread_id")

        if thread_id is None:
            raise ValueError("Thread ID is required in runtime context or config.configurable")

        if self._lazy_init:
            # Lazy initialization: only compute paths, don't create directories
            paths = self._get_thread_paths(thread_id)
        else:
            # Eager initialization: create directories immediately
            paths = self._create_thread_directories(thread_id)
            logger.debug("Created thread data directories for thread %s", thread_id)

        return {
            "thread_data": {
                **paths,
            }
        }

    @override
    def after_agent(self, state: ThreadDataMiddlewareState, runtime: Runtime) -> dict | None:
        thread_data = state.get("thread_data")
        if thread_data is None:
            return None
        workspace_path_str = thread_data.get("workspace_path") if isinstance(thread_data, dict) else getattr(thread_data, "workspace_path", None)
        if not workspace_path_str:
            return None
        context = runtime.context or {}
        thread_id = context.get("thread_id")
        if thread_id is None:
            config = get_config()
            thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id is None:
            return None
        workspace_path = Path(workspace_path_str)
        _schedule_workspace_sync(thread_id, workspace_path)
        return None


def _schedule_workspace_sync(thread_id: str, workspace_path: Path) -> None:
    """Fire-and-forget: sync workspace directory to outputs backend after agent run."""
    try:
        from deerflow.outputs.provider import get_outputs_backend

        async def _do_sync() -> None:
            try:
                backend = get_outputs_backend()
                await backend.sync_directory(thread_id, workspace_path, "workspace")
                logger.debug("Workspace synced to storage for thread %s", thread_id)
            except Exception as exc:
                logger.warning("Workspace sync failed for thread %s: %s", thread_id, exc)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_do_sync())
            else:
                asyncio.run(_do_sync())
        except RuntimeError:
            asyncio.run(_do_sync())
    except Exception as exc:
        logger.warning("Failed to schedule workspace sync for thread %s: %s", thread_id, exc)
