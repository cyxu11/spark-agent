# 基于 TodoList Middleware 的 Plan Mode

本文档介绍如何在 DeerFlow 2.0 中启用和使用基于 TodoList middleware 的 Plan Mode 功能。

## 概览

Plan Mode 向 agent 挂载一个 TodoList middleware,它提供一个 `write_todos` 工具,帮助 agent：
- 将复杂任务拆解成更小、更可控的步骤
- 在执行过程中跟踪进度
- 向用户清晰地展示当前在做什么

TodoList middleware 基于 LangChain 的 `TodoListMiddleware` 构建。

## 配置

### 启用 Plan Mode

Plan Mode 通过 **运行时配置** 控制,具体由 `RunnableConfig.configurable` 中的 `is_plan_mode` 参数决定。这样你可以按请求粒度动态开启或关闭。

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

# 通过运行时配置启用 plan mode
config = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # 启用 plan mode
    }
)

# 创建启用了 plan mode 的 agent
agent = make_lead_agent(config)
```

### 配置项

- **is_plan_mode**(bool)：是否启用基于 TodoList middleware 的 plan mode。默认：`False`
  - 通过 `config.get("configurable", {}).get("is_plan_mode", False)` 传入
  - 可按每次 agent 调用动态设置
  - 无需全局配置

## 默认行为

在默认设置下启用 plan mode 时,agent 会拿到一个 `write_todos` 工具,行为如下：

### 何时使用 TodoList

以下场景 agent 会使用 todo 列表：
1. 复杂的多步骤任务(3 步以上)
2. 需要仔细规划的非平凡任务
3. 用户明确要求给出 todo 列表
4. 用户一次性提出多个任务

### 何时 **不** 使用 TodoList

以下场景 agent 不会使用 todo 列表：
1. 单一、直截了当的任务
2. 平凡任务(少于 3 步)
3. 纯对话或纯信息查询

### 任务状态

- **pending**：任务尚未开始
- **in_progress**：当前正在进行(可同时有多个并行任务)
- **completed**：任务已成功完成

## 使用示例

### 基本用法

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

# 启用 plan mode 的 agent
config_with_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # 会挂载 TodoList middleware
    }
)
agent_with_todos = make_lead_agent(config_with_plan_mode)

# 未启用 plan mode 的 agent(默认)
config_without_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "another-thread",
        "thinking_enabled": True,
        "is_plan_mode": False,  # 不会挂载 TodoList middleware
    }
)
agent_without_todos = make_lead_agent(config_without_plan_mode)
```

### 按请求动态开关 Plan Mode

你可以针对不同对话或任务动态启用/关闭 plan mode：

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

def create_agent_for_task(task_complexity: str):
    """根据任务复杂度创建 agent,并决定是否启用 plan mode。"""
    is_complex = task_complexity in ["high", "very_high"]

    config = RunnableConfig(
        configurable={
            "thread_id": f"task-{task_complexity}",
            "thinking_enabled": True,
            "is_plan_mode": is_complex,  # 仅复杂任务启用
        }
    )

    return make_lead_agent(config)

# 简单任务 —— 不需要 TodoList
simple_agent = create_agent_for_task("low")

# 复杂任务 —— 启用 TodoList 便于跟踪
complex_agent = create_agent_for_task("high")
```

## 工作原理

1. 调用 `make_lead_agent(config)` 时,会从 `config.configurable` 中取出 `is_plan_mode`
2. 该 config 会被传入 `_build_middlewares(config)`
3. `_build_middlewares()` 读取 `is_plan_mode` 并调用 `_create_todo_list_middleware(is_plan_mode)`
4. 当 `is_plan_mode=True`,会创建一个 `TodoListMiddleware` 实例,并添加到 middleware 链中
5. 该 middleware 会自动在 agent 的工具集中追加 `write_todos`
6. agent 在执行过程中可使用此工具管理任务
7. middleware 会维护 todo list 的状态并将其提供给 agent

## 架构

```
make_lead_agent(config)
  │
  ├─> 读取：is_plan_mode = config.configurable.get("is_plan_mode", False)
  │
  └─> _build_middlewares(config)
        │
        ├─> ThreadDataMiddleware
        ├─> SandboxMiddleware
        ├─> SummarizationMiddleware(如已在全局配置中开启)
        ├─> TodoListMiddleware(若 is_plan_mode=True) ← NEW
        ├─> TitleMiddleware
        └─> ClarificationMiddleware
```

## 实现细节

### Agent 模块
- **位置**：`packages/harness/deerflow/agents/lead_agent/agent.py`
- **函数**：`_create_todo_list_middleware(is_plan_mode: bool)` —— 当 plan mode 启用时创建 TodoListMiddleware
- **函数**：`_build_middlewares(config: RunnableConfig)` —— 根据运行时配置构建 middleware 链
- **函数**：`make_lead_agent(config: RunnableConfig)` —— 创建挂载相应 middleware 的 agent

### 运行时配置
Plan mode 通过 `RunnableConfig.configurable` 中的 `is_plan_mode` 控制：
```python
config = RunnableConfig(
    configurable={
        "is_plan_mode": True,  # 启用 plan mode
        # ... 其他 configurable 选项
    }
)
```

## 核心收益

1. **动态控制**：按请求开启/关闭 plan mode,不依赖全局状态
2. **灵活性**：不同对话可使用不同的 plan mode 设置
3. **简洁**:无需维护全局配置
4. **上下文感知**:是否启用 plan mode 可根据任务复杂度、用户偏好等决定

## 自定义 Prompt

DeerFlow 为 TodoListMiddleware 自定义了 `system_prompt` 和 `tool_description`,以匹配 DeerFlow 的整体 prompt 风格：

### System Prompt 特点
- 使用 XML 标签(`<todo_list_system>`),与 DeerFlow 主 prompt 风格保持一致
- 强调 CRITICAL 规则与最佳实践
- 明确的 "何时使用" 与 "何时不使用" 指引
- 聚焦实时更新与即时完成任务

### 工具描述特点
- 带示例的详细使用场景
- 强烈强调对简单任务 **不** 使用
- 清晰定义任务状态(pending、in_progress、completed)
- 完整的最佳实践段落
- 有防止过早标注为 completed 的完成标准

自定义 prompt 的定义位于 `_create_todo_list_middleware()`,文件 `/Users/hetao/workspace/deer-flow/backend/packages/harness/deerflow/agents/lead_agent/agent.py:57`。

## 备注

- TodoList middleware 使用 LangChain 自带的 `TodoListMiddleware`,并搭配 **DeerFlow 风格的自定义 prompt**
- Plan mode **默认关闭**(`is_plan_mode=False`),以保持向后兼容
- 该 middleware 位于 `ClarificationMiddleware` 之前,以便在澄清流程中也能管理 todo
- 自定义 prompt 强调与 DeerFlow 主系统 prompt 相同的原则(清晰、行动导向、核心规则)
