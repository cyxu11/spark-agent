import json
from typing import Annotated

from langchain.tools import InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

_PREVIEW_MARKER = "__scheduled_task_preview__"


@tool("create_scheduled_task", parse_docstring=True)
def scheduled_task_tool(
    name: str,
    description: str,
    cron: str,
    script_content: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Create a scheduled task that runs a Python script on a cron schedule.

    Use this tool when the user asks to schedule a recurring task, automation,
    or periodic job. The task will not be saved until the user confirms in the UI.

    Args:
        name: Short task name (e.g. "大宗商品市场政策收集").
        description: What the task does.
        cron: Cron expression (e.g. "0 9 * * *" for every day at 9am).
        script_content: Complete, self-contained Python script that performs the task.
            The script may use standard library, requests, and installed packages.
            It should save output files (e.g. HTML report) to its working directory.
    """
    preview = {
        _PREVIEW_MARKER: True,
        "name": name,
        "description": description,
        "cron": cron,
        "script_content": script_content,
    }
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=json.dumps(preview, ensure_ascii=False),
                    tool_call_id=tool_call_id,
                )
            ]
        }
    )
