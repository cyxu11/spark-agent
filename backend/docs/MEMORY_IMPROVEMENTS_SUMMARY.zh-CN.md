# 记忆系统改进 —— 摘要

## 同步说明(2026-03-10)

本摘要已与 `main` 分支的实现同步。
TF-IDF / 上下文感知检索属于**规划中**,尚未合入。

## 已实现

- 记忆注入中通过 `tiktoken` 做精确 token 计数
- 事实(facts)被注入到 `<memory>` prompt 内容中
- 事实按 confidence 排序,受 `max_injection_tokens` 限制

## 规划中(尚未合入)

- 基于最近对话上下文的 TF-IDF 余弦相似度召回
- 为 `format_memory_for_injection` 增加 `current_context` 参数
- 加权排序(`similarity` + `confidence`)
- 面向上下文感知事实选择的运行时抽取/注入流程

## 为何需要这次同步

早期文档将 TF-IDF 行为描述为"已实现",但与 `main` 中的代码不符。
这一不一致记录在 issue `#1059` 中。

## 当前 API 形态

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

当前 `main` 中暂未提供 `current_context` 参数。

## 验证入口

- 实现：`packages/harness/deerflow/agents/memory/prompt.py`
- Prompt 组装：`packages/harness/deerflow/agents/lead_agent/prompt.py`
- 回归测试：`backend/tests/test_memory_prompt_injection.py`
