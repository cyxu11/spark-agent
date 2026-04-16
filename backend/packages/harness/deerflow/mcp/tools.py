"""Load MCP tools using langchain-mcp-adapters."""

import asyncio
import atexit
import concurrent.futures
import logging
from collections.abc import Callable
from typing import Any

from langchain_core.tools import BaseTool

from deerflow.config.extensions_config import ExtensionsConfig
from deerflow.mcp.client import build_servers_config
from deerflow.mcp.oauth import build_oauth_tool_interceptor, get_initial_oauth_headers

logger = logging.getLogger(__name__)

# Global thread pool for sync tool invocation in async environments
_SYNC_TOOL_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="mcp-sync-tool")

# Register shutdown hook for the global executor
atexit.register(lambda: _SYNC_TOOL_EXECUTOR.shutdown(wait=False))

# Maximum characters allowed in MCP tool output to prevent LLM request body overflow
_MCP_OUTPUT_MAX_CHARS = 10000


def _truncate_mcp_output(output: Any, max_chars: int = _MCP_OUTPUT_MAX_CHARS) -> Any:
    """Truncate MCP tool output to prevent exceeding LLM request body limits.

    Handles multiple output formats:
    - Simple string: truncate directly
    - Tuple (content_blocks, artifact): truncate text inside content blocks
    - List of content blocks: truncate text inside each block

    Uses middle truncation to preserve both head and tail context.
    """
    if max_chars == 0:
        return output

    # Handle simple string
    if isinstance(output, str):
        if len(output) <= max_chars:
            return output
        skipped = len(output) - max_chars
        head_len = max_chars // 2
        tail_len = max_chars - head_len
        marker = f"\n... [MCP output truncated: {skipped} chars skipped, total {len(output)} chars] ...\n"
        return f"{output[:head_len]}{marker}{output[-tail_len:]}"

    # Handle tuple (content_blocks, artifact) from response_format="content_and_artifact"
    if isinstance(output, tuple) and len(output) == 2:
        content, artifact = output
        truncated_content = _truncate_content_blocks(content, max_chars)
        return (truncated_content, artifact)

    # Handle list of content blocks
    if isinstance(output, list):
        return _truncate_content_blocks(output, max_chars)

    return output


def _truncate_content_blocks(content: Any, max_chars: int) -> Any:
    """Truncate text within content blocks (list of dicts with 'text' fields)."""
    if not isinstance(content, list):
        return content

    # Calculate total text size across all blocks
    total_text_len = 0
    text_blocks = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            total_text_len += len(block["text"])
            text_blocks.append(block)

    if total_text_len <= max_chars or not text_blocks:
        return content

    # Distribute the max_chars budget across text blocks proportionally
    result = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            text = block["text"]
            # Allocate chars proportionally to this block's share of total text
            block_budget = max(500, int(max_chars * len(text) / total_text_len))
            if len(text) > block_budget:
                skipped = len(text) - block_budget
                head_len = block_budget // 2
                tail_len = block_budget - head_len
                marker = f"\n... [MCP output truncated: {skipped} chars skipped, total {len(text)} chars] ...\n"
                truncated_text = f"{text[:head_len]}{marker}{text[-tail_len:]}"
                result.append({**block, "text": truncated_text})
            else:
                result.append(block)
        else:
            result.append(block)

    return result


def _make_async_tool_wrapper(coro: Callable[..., Any], tool_name: str) -> Callable[..., Any]:
    """Build an async wrapper that truncates MCP tool output.

    Args:
        coro: The tool's original asynchronous coroutine.
        tool_name: Name of the tool (for logging).

    Returns:
        An async function that truncates oversized output.
    """

    async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            result = await coro(*args, **kwargs)
            return _truncate_mcp_output(result)
        except Exception as e:
            logger.error(f"Error invoking MCP tool '{tool_name}' via async wrapper: {e}", exc_info=True)
            raise

    return async_wrapper


def _make_sync_tool_wrapper(coro: Callable[..., Any], tool_name: str) -> Callable[..., Any]:
    """Build a synchronous wrapper for an asynchronous tool coroutine.

    Args:
        coro: The tool's asynchronous coroutine.
        tool_name: Name of the tool (for logging).

    Returns:
        A synchronous function that correctly handles nested event loops.
    """

    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        try:
            if loop is not None and loop.is_running():
                # Use global executor to avoid nested loop issues and improve performance
                future = _SYNC_TOOL_EXECUTOR.submit(asyncio.run, coro(*args, **kwargs))
                result = future.result()
            else:
                result = asyncio.run(coro(*args, **kwargs))
            return _truncate_mcp_output(result)
        except Exception as e:
            logger.error(f"Error invoking MCP tool '{tool_name}' via sync wrapper: {e}", exc_info=True)
            raise

    return sync_wrapper


async def get_mcp_tools() -> list[BaseTool]:
    """Get all tools from enabled MCP servers.

    Returns:
        List of LangChain tools from all enabled MCP servers.
    """
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("langchain-mcp-adapters not installed. Install it to enable MCP tools: pip install langchain-mcp-adapters")
        return []

    # NOTE: We use ExtensionsConfig.from_file() instead of get_extensions_config()
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when initializing MCP tools.
    extensions_config = ExtensionsConfig.from_file()
    servers_config = build_servers_config(extensions_config)

    if not servers_config:
        logger.info("No enabled MCP servers configured")
        return []

    try:
        # Create the multi-server MCP client
        logger.info(f"Initializing MCP client with {len(servers_config)} server(s)")

        # Inject initial OAuth headers for server connections (tool discovery/session init)
        initial_oauth_headers = await get_initial_oauth_headers(extensions_config)
        for server_name, auth_header in initial_oauth_headers.items():
            if server_name not in servers_config:
                continue
            if servers_config[server_name].get("transport") in ("sse", "http"):
                existing_headers = dict(servers_config[server_name].get("headers", {}))
                existing_headers["Authorization"] = auth_header
                servers_config[server_name]["headers"] = existing_headers

        tool_interceptors = []
        oauth_interceptor = build_oauth_tool_interceptor(extensions_config)
        if oauth_interceptor is not None:
            tool_interceptors.append(oauth_interceptor)

        client = MultiServerMCPClient(servers_config, tool_interceptors=tool_interceptors, tool_name_prefix=True)

        # Load tools per-server so a single broken endpoint (e.g. a 502 from
        # one MCP host) does not nuke the entire MCP tool list.  The upstream
        # ``client.get_tools()`` wraps everything in an ``asyncio.gather``
        # TaskGroup, which fails-fast on the first exception — previously any
        # one failing server silently removed all other servers' tools too.
        tools: list[BaseTool] = []
        for server_name in list(client.connections.keys()):
            try:
                server_tools = await client.get_tools(server_name=server_name)
            except Exception as exc:
                logger.warning(
                    "MCP server %r failed to load tools (%s); skipping and continuing with other servers",
                    server_name,
                    exc,
                )
                continue
            logger.info("MCP server %r contributed %d tool(s)", server_name, len(server_tools))
            tools.extend(server_tools)
        logger.info(f"Successfully loaded {len(tools)} tool(s) from MCP servers")

        # Patch tools to truncate output and support sync invocation
        for tool in tools:
            original_coro = getattr(tool, "coroutine", None)
            if original_coro is not None:
                # Wrap async coroutine to truncate output
                tool.coroutine = _make_async_tool_wrapper(original_coro, tool.name)
                # Also provide a sync wrapper for deerflow client streaming
                if getattr(tool, "func", None) is None:
                    tool.func = _make_sync_tool_wrapper(tool.coroutine, tool.name)

        return tools

    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        return []
