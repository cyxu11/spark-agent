# Task 工具改进

## 概览

Task 工具经过改进,消除了浪费性的 LLM 轮询。在之前的实现中,使用后台任务时 LLM 需要反复调用 `task_status` 以轮询完成状态,造成了不必要的 API 请求。

## 变更内容

### 1. 移除 `run_in_background` 参数

`task` 工具的 `run_in_background` 参数已被移除。所有 subagent 任务现在默认都以异步方式运行,但工具会自动处理完成态,LLM 无需操心。

**之前：**
```python
# LLM 需要自行管理轮询
task_id = task(
    subagent_type="bash",
    prompt="Run tests",
    description="Run tests",
    run_in_background=True
)
# 然后 LLM 需要反复轮询：
while True:
    status = task_status(task_id)
    if completed:
        break
```

**之后：**
```python
# 工具自身阻塞直到完成,轮询由后端负责
result = task(
    subagent_type="bash",
    prompt="Run tests",
    description="Run tests"
)
# 调用返回后立即可拿到最终结果
```

### 2. 后端轮询

现在 `task_tool` 的工作方式：
- 异步启动 subagent 任务
- 在后端进行完成态轮询(每 2 秒一次)
- 阻塞工具调用直到完成
- 直接返回最终结果

这意味着：
- ✅ LLM 只做一次工具调用
- ✅ 不再有浪费性的 LLM 轮询请求
- ✅ 由后端统一处理状态检查
- ✅ 带超时保护(最多 5 分钟)

### 3. 从 LLM 工具列表中移除 `task_status`

`task_status_tool` 不再暴露给 LLM。它仍保留在代码库中以备内部/调试使用,但 LLM 无法调用它。

### 4. 文档更新

- 更新了 `prompt.py` 中的 `SUBAGENT_SECTION`,移除所有关于后台任务与轮询的描述
- 简化了使用示例
- 明确说明该工具会自动等待完成

## 实现细节

### 轮询逻辑

位于 `packages/harness/deerflow/tools/builtins/task_tool.py`：

```python
# Start background execution
task_id = executor.execute_async(prompt)

# Poll for task completion in backend
while True:
    result = get_background_task_result(task_id)

    # Check if task completed or failed
    if result.status == SubagentStatus.COMPLETED:
        return f"[Subagent: {subagent_type}]\n\n{result.result}"
    elif result.status == SubagentStatus.FAILED:
        return f"[Subagent: {subagent_type}] Task failed: {result.error}"

    # Wait before next poll
    time.sleep(2)

    # Timeout protection (5 minutes)
    if poll_count > 150:
        return "Task timed out after 5 minutes"
```

### 执行超时

除了轮询超时外,subagent 的执行本身也内置了超时机制：

**配置**(`packages/harness/deerflow/subagents/config.py`)：
```python
@dataclass
class SubagentConfig:
    # ...
    timeout_seconds: int = 300  # 默认 5 分钟
```

**线程池架构**：

为避免线程池嵌套与资源浪费,我们使用两个专用线程池：

1. **调度池**(`_scheduler_pool`)：
   - 最大 worker 数：4
   - 用途：编排后台任务执行
   - 运行 `run_task()` 管理任务生命周期

2. **执行池**(`_execution_pool`)：
   - 最大 worker 数：8(更大以避免阻塞)
   - 用途：真正执行 subagent,带超时支持
   - 运行 `execute()` 调用 agent

**工作流程**：
```python
# In execute_async():
_scheduler_pool.submit(run_task)  # Submit orchestration task

# In run_task():
future = _execution_pool.submit(self.execute, task)  # Submit execution
exec_result = future.result(timeout=timeout_seconds)  # Wait with timeout
```

**收益**：
- ✅ 关注点清晰分离(调度 vs 执行)
- ✅ 无嵌套线程池
- ✅ 超时在合适层级强制执行
- ✅ 资源利用更优

**双层超时保护**：
1. **执行超时**：subagent 执行自身有 5 分钟超时(可在 SubagentConfig 中配置)
2. **轮询超时**:工具轮询有 5 分钟超时(30 次轮询 × 10 秒)

这样即使 subagent 执行挂住,系统也不会无限等待。

### 收益

1. **降低 API 成本**:不再有反复的 LLM 轮询请求
2. **更简单的 UX**:LLM 不用管理轮询逻辑
3. **更高可靠性**:后端统一处理状态检查
4. **超时保护**:双层超时防止无限等待(执行 + 轮询)

## 测试

验证改动是否生效：

1. 启动一个耗时数秒的 subagent 任务
2. 确认工具调用会阻塞到完成
3. 确认直接返回结果
4. 确认不再发生任何 `task_status` 调用

示例测试场景：
```python
# 这会阻塞约 10 秒,然后返回结果
result = task(
    subagent_type="bash",
    prompt="sleep 10 && echo 'Done'",
    description="Test task"
)
# result 中应当包含 "Done"
```

## 迁移说明

对于以前使用 `run_in_background=True` 的用户/代码：
- 直接移除该参数即可
- 移除所有轮询逻辑
- 工具会自动等待任务完成

除此之外无需其他改动 —— API 向后兼容(仅删除了这一参数)。
