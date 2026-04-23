# Langfuse 链路追踪实施计划

**目标：** 为 DeerFlow 添加可选的 Langfuse 可观测性支持，同时保留现有的 LangSmith 追踪能力，并允许两个提供方同时启用。

**架构：** 将追踪配置从"仅 LangSmith"的单一形态扩展为多提供方配置；新增一个追踪回调工厂，根据环境变量构建零个、一个或两个回调；并更新模型创建流程以挂载这些回调。如果某个提供方被显式启用但配置错误或初始化失败,模型创建阶段的追踪初始化应抛出明确指出该提供方名称的错误。

**技术栈：** Python 3.12、Pydantic、LangChain callbacks、LangSmith、Langfuse、pytest

---

### 任务 1：添加会失败的追踪配置测试

**涉及文件：**
- 修改：`backend/tests/test_tracing_config.py`

**Step 1：编写会失败的测试**

添加覆盖以下场景的测试：
- 仅 Langfuse 的配置解析
- 双提供方配置解析
- 显式启用但缺少必需 Langfuse 字段
- 在不依赖仅 LangSmith 专用辅助函数的情况下检测提供方是否启用

**Step 2：运行测试以确认它们失败**

执行：`cd backend && uv run pytest tests/test_tracing_config.py -q`
预期：FAIL，因为当前追踪配置只支持 LangSmith。

**Step 3：编写最小实现**

更新追踪配置代码以表示多个提供方,并暴露测试所需的辅助函数。

**Step 4：运行测试以确认通过**

执行：`cd backend && uv run pytest tests/test_tracing_config.py -q`
预期：PASS

### 任务 2：添加会失败的回调工厂与模型挂载测试

**涉及文件：**
- 修改：`backend/tests/test_model_factory.py`
- 新建：`backend/tests/test_tracing_factory.py`

**Step 1：编写会失败的测试**

添加覆盖以下场景的测试：
- LangSmith 回调创建
- Langfuse 回调创建
- 双回调同时创建
- 当被显式启用的提供方无法初始化时,启动阶段应失败
- 模型工厂将所有追踪回调追加到模型的 callbacks 列表中

**Step 2：运行测试以确认它们失败**

执行：`cd backend && uv run pytest tests/test_model_factory.py tests/test_tracing_factory.py -q`
预期：FAIL,因为当前没有提供方工厂,且模型创建只挂载 LangSmith。

**Step 3：编写最小实现**

创建追踪回调工厂模块,并更新模型工厂以使用它。

**Step 4：运行测试以确认通过**

执行：`cd backend && uv run pytest tests/test_model_factory.py tests/test_tracing_factory.py -q`
预期：PASS

### 任务 3：接入依赖与文档

**涉及文件：**
- 修改：`backend/packages/harness/pyproject.toml`
- 修改：`README.md`
- 修改：`backend/README.md`

**Step 1：更新依赖**

在 harness 依赖中添加 `langfuse`。

**Step 2：更新文档**

记录以下内容：
- Langfuse 环境变量
- 双提供方共存行为
- 被显式启用的提供方在初始化失败时的行为

**Step 3：执行针对性的验证**

执行：`cd backend && uv run pytest tests/test_tracing_config.py tests/test_model_factory.py tests/test_tracing_factory.py -q`
预期：PASS

### 任务 4：运行更大范围的回归检查

**涉及文件：**
- 无需代码变更

**Step 1：运行相关测试套件**

执行：`cd backend && uv run pytest tests/test_tracing_config.py tests/test_model_factory.py tests/test_tracing_factory.py -q`

**Step 2：按需运行 lint**

执行：`cd backend && uv run ruff check packages/harness/deerflow/config/tracing_config.py packages/harness/deerflow/models/factory.py packages/harness/deerflow/tracing`

**Step 3：审阅 diff**

执行：`git diff -- backend/packages/harness backend/tests README.md backend/README.md`
