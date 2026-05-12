"""Tagged summarization middleware.

子类化 langchain 自带的 SummarizationMiddleware,只做一件事:
在注入的 summary HumanMessage 上加 `additional_kwargs.element = "summary"` 标记,
方便前端按"压缩历史对话"折叠卡片渲染,而不是默认的用户气泡。
"""

from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.messages.human import HumanMessage


class TaggedSummarizationMiddleware(SummarizationMiddleware):
    """SummarizationMiddleware variant whose summary message carries a UI tag."""

    def _build_new_messages(self, summary: str) -> list[HumanMessage]:
        return [
            HumanMessage(
                content=f"Here is a summary of the conversation to date:\n\n{summary}",
                additional_kwargs={"element": "summary"},
            )
        ]
