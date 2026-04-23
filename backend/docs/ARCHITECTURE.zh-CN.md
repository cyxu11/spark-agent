# 架构概览

本文档全面介绍 DeerFlow 后端架构。

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Client(浏览器)                              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Nginx(端口 2026)                                │
│                        统一反向代理入口                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  /api/langgraph/*  →  LangGraph Server(2024)                      │  │
│  │  /api/*            →  Gateway API(8001)                           │  │
│  │  /*                →  Frontend(3000)                              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   LangGraph Server  │ │    Gateway API      │ │     Frontend        │
│     (端口 2024)      │ │    (端口 8001)      │ │    (端口 3000)      │
│                     │ │                     │ │                     │
│  - Agent 运行时     │ │  - Models API       │ │  - Next.js App      │
│  - Thread 管理      │ │  - MCP 配置         │ │  - React UI         │
│  - SSE 流式         │ │  - 技能管理         │ │  - 聊天界面         │
│  - Checkpoint       │ │  - 文件上传         │ │                     │
│                     │ │  - Thread 清理      │ │                     │
│                     │ │  - Artifacts        │ │                     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
          │                       │
          │     ┌─────────────────┘
          │     │
          ▼     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         共享配置                                           │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │      config.yaml        │  │      extensions_config.json            │ │
│  │  - 模型                 │  │  - MCP 服务器                           │ │
│  │  - 工具                 │  │  - 技能启用状态                         │ │
│  │  - Sandbox              │  │                                        │ │
│  │  - 摘要压缩             │  │                                        │ │
│  └─────────────────────────┘  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## 组件细节

### LangGraph Server

LangGraph server 是核心的 agent 运行时,基于 LangGraph 构建,支持健壮的多 agent 工作流编排。

**入口:** `packages/harness/deerflow/agents/lead_agent/agent.py:make_lead_agent`

**关键职责:**
- Agent 创建与配置
- Thread 状态管理
- Middleware 链执行
- 工具执行编排
- 以 SSE 流式返回响应

**配置:** `langgraph.json`

```json
{
  "agent": {
    "type": "agent",
    "path": "deerflow.agents:make_lead_agent"
  }
}
```

### Gateway API

FastAPI 应用,提供非 agent 类操作的 REST 端点。

**入口:** `app/gateway/app.py`

**Router:**
- `models.py` —— `/api/models` —— 模型列表与详情
- `mcp.py` —— `/api/mcp` —— MCP 服务器配置
- `skills.py` —— `/api/skills` —— 技能管理
- `uploads.py` —— `/api/threads/{id}/uploads` —— 文件上传
- `threads.py` —— `/api/threads/{id}` —— LangGraph 删除后本地 DeerFlow thread 数据清理
- `artifacts.py` —— `/api/threads/{id}/artifacts` —— Artifact 提供
- `suggestions.py` —— `/api/threads/{id}/suggestions` —— 追问建议生成

Web 对话的删除流程现在被拆成两个后端表面:LangGraph 处理 `DELETE /api/langgraph/threads/{thread_id}` 来删除 thread 状态,然后 Gateway 的 `threads.py` 路由通过 `Paths.delete_thread_dir()` 清理 DeerFlow 管理的本地文件系统数据。

### Agent 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           make_lead_agent(config)                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            Middleware 链                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. ThreadDataMiddleware  - 初始化 workspace/uploads/outputs      │   │
│  │ 2. UploadsMiddleware     - 处理上传文件                          │   │
│  │ 3. SandboxMiddleware     - 获取 sandbox 环境                     │   │
│  │ 4. SummarizationMiddleware - 上下文压缩(若启用)                │   │
│  │ 5. TitleMiddleware       - 自动生成标题                          │   │
│  │ 6. TodoListMiddleware    - 任务跟踪(plan mode 下启用)          │   │
│  │ 7. ViewImageMiddleware   - 视觉模型支持                          │   │
│  │ 8. ClarificationMiddleware - 处理澄清                            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Agent Core                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │      Model       │  │      Tools       │  │    System Prompt     │   │
│  │  (来自 factory)  │  │  (config + MCP + │  │  (包含技能)          │   │
│  │                  │  │   built-in)      │  │                      │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Thread 状态

`ThreadState` 在 LangGraph 的 `AgentState` 基础上增加了若干字段:

```python
class ThreadState(AgentState):
    # 来自 AgentState 的核心字段
    messages: list[BaseMessage]

    # DeerFlow 扩展
    sandbox: dict             # Sandbox 环境信息
    artifacts: list[str]      # 生成文件路径
    thread_data: dict         # {workspace, uploads, outputs} 路径
    title: str | None         # 自动生成的对话标题
    todos: list[dict]         # 任务跟踪(plan mode)
    viewed_images: dict       # 视觉模型的图像数据
```

### Sandbox 系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Sandbox 架构                                   │
└─────────────────────────────────────────────────────────────────────────┘

                      ┌─────────────────────────┐
                      │    SandboxProvider      │ (抽象)
                      │  - acquire()            │
                      │  - get()                │
                      │  - release()            │
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                                         │
              ▼                                         ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│  LocalSandboxProvider   │              │  AioSandboxProvider     │
│  (packages/harness/deerflow/sandbox/local.py) │              │  (packages/harness/deerflow/community/)       │
│                         │              │                         │
│  - 单例实例             │              │  - 基于 Docker          │
│  - 直接执行             │              │  - 隔离容器             │
│  - 开发环境用           │              │  - 生产环境用           │
└─────────────────────────┘              └─────────────────────────┘

                      ┌─────────────────────────┐
                      │        Sandbox          │ (抽象)
                      │  - execute_command()    │
                      │  - read_file()          │
                      │  - write_file()         │
                      │  - list_dir()           │
                      └─────────────────────────┘
```

**虚拟路径映射:**

| 虚拟路径 | 物理路径 |
|-------------|---------------|
| `/mnt/user-data/workspace` | `backend/.deer-flow/threads/{thread_id}/user-data/workspace` |
| `/mnt/user-data/uploads` | `backend/.deer-flow/threads/{thread_id}/user-data/uploads` |
| `/mnt/user-data/outputs` | `backend/.deer-flow/threads/{thread_id}/user-data/outputs` |
| `/mnt/skills` | `deer-flow/skills/` |

### 工具系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            工具来源                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│   内置工具          │  │  配置工具           │  │     MCP 工具        │
│  (packages/harness/deerflow/tools/)       │  │  (config.yaml)      │  │  (extensions.json)  │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ - present_file      │  │ - web_search        │  │ - github            │
│ - ask_clarification │  │ - web_fetch         │  │ - filesystem        │
│ - view_image        │  │ - bash              │  │ - postgres          │
│                     │  │ - read_file         │  │ - brave-search      │
│                     │  │ - write_file        │  │ - puppeteer         │
│                     │  │ - str_replace       │  │ - ...               │
│                     │  │ - ls                │  │                     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
           │                       │                       │
           └───────────────────────┴───────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   get_available_tools() │
                      │   (packages/harness/deerflow/tools/__init__)  │
                      └─────────────────────────┘
```

### Model Factory

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Model Factory                                   │
│                     (packages/harness/deerflow/models/factory.py)                              │
└─────────────────────────────────────────────────────────────────────────┘

config.yaml:
┌─────────────────────────────────────────────────────────────────────────┐
│ models:                                                                  │
│   - name: gpt-4                                                         │
│     display_name: GPT-4                                                 │
│     use: langchain_openai:ChatOpenAI                                    │
│     model: gpt-4                                                        │
│     api_key: $OPENAI_API_KEY                                            │
│     max_tokens: 4096                                                    │
│     supports_thinking: false                                            │
│     supports_vision: true                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   create_chat_model()   │
                      │  - name: str            │
                      │  - thinking_enabled     │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   resolve_class()       │
                      │  (反射系统)             │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   BaseChatModel         │
                      │  (LangChain 实例)       │
                      └─────────────────────────┘
```

**已支持的提供方:**
- OpenAI(`langchain_openai:ChatOpenAI`)
- Anthropic(`langchain_anthropic:ChatAnthropic`)
- DeepSeek(`langchain_deepseek:ChatDeepSeek`)
- 通过 LangChain 集成的自定义提供方

### MCP 集成

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MCP 集成                                         │
│                        (packages/harness/deerflow/mcp/manager.py)                              │
└─────────────────────────────────────────────────────────────────────────┘

extensions_config.json:
┌─────────────────────────────────────────────────────────────────────────┐
│ {                                                                        │
│   "mcpServers": {                                                       │
│     "github": {                                                         │
│       "enabled": true,                                                  │
│       "type": "stdio",                                                  │
│       "command": "npx",                                                 │
│       "args": ["-y", "@modelcontextprotocol/server-github"],           │
│       "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}                          │
│     }                                                                   │
│   }                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │  MultiServerMCPClient   │
                      │  (langchain-mcp-adapters)│
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       ┌───────────┐        ┌───────────┐        ┌───────────┐
       │  stdio    │        │   SSE     │        │   HTTP    │
       │ transport │        │ transport │        │ transport │
       └───────────┘        └───────────┘        └───────────┘
```

### Skills 系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Skills 系统                                      │
│                       (packages/harness/deerflow/skills/loader.py)                             │
└─────────────────────────────────────────────────────────────────────────┘

目录结构:
┌─────────────────────────────────────────────────────────────────────────┐
│ skills/                                                                  │
│ ├── public/                        # 公共技能(已提交)                 │
│ │   ├── pdf-processing/                                                 │
│ │   │   └── SKILL.md                                                    │
│ │   ├── frontend-design/                                                │
│ │   │   └── SKILL.md                                                    │
│ │   └── ...                                                             │
│ └── custom/                        # 自定义技能(gitignored)            │
│     └── user-installed/                                                 │
│         └── SKILL.md                                                    │
└─────────────────────────────────────────────────────────────────────────┘

SKILL.md 格式:
┌─────────────────────────────────────────────────────────────────────────┐
│ ---                                                                      │
│ name: PDF Processing                                                     │
│ description: Handle PDF documents efficiently                            │
│ license: MIT                                                            │
│ allowed-tools:                                                          │
│   - read_file                                                           │
│   - write_file                                                          │
│   - bash                                                                │
│ ---                                                                      │
│                                                                          │
│ # Skill Instructions                                                     │
│ 内容会被注入到系统 prompt 中...                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 请求流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        请求流程示例                                       │
│                    用户向 agent 发送消息                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. Client → Nginx
   POST /api/langgraph/threads/{thread_id}/runs
   {"input": {"messages": [{"role": "user", "content": "Hello"}]}}

2. Nginx → LangGraph Server(2024)
   请求被代理至 LangGraph server

3. LangGraph Server
   a. 加载/创建 thread 状态
   b. 执行 middleware 链:
      - ThreadDataMiddleware:设置路径
      - UploadsMiddleware:注入文件列表
      - SandboxMiddleware:获取 sandbox
      - SummarizationMiddleware:检查 token 上限
      - TitleMiddleware:必要时生成标题
      - TodoListMiddleware:加载 todos(plan mode 下)
      - ViewImageMiddleware:处理图像
      - ClarificationMiddleware:检查是否需要澄清

   c. 执行 agent:
      - 模型处理消息
      - 可能调用工具(bash、web_search 等)
      - 工具通过 sandbox 执行
      - 结果加入消息

   d. 以 SSE 流式返回响应

4. Client 接收流式响应
```

## 数据流

### 文件上传流程

```
1. Client 上传文件
   POST /api/threads/{thread_id}/uploads
   Content-Type: multipart/form-data

2. Gateway 接收文件
   - 校验文件
   - 存储到 .deer-flow/threads/{thread_id}/user-data/uploads/
   - 若为文档:通过 markitdown 转为 Markdown

3. 返回响应
   {
     "files": [{
       "filename": "doc.pdf",
       "path": ".deer-flow/.../uploads/doc.pdf",
       "virtual_path": "/mnt/user-data/uploads/doc.pdf",
       "artifact_url": "/api/threads/.../artifacts/mnt/.../doc.pdf"
     }]
   }

4. 下一次 agent 执行
   - UploadsMiddleware 列出文件
   - 将文件列表注入到消息中
   - Agent 可通过 virtual_path 访问
```

### Thread 清理流程

```
1. Client 通过 LangGraph 删除对话
   DELETE /api/langgraph/threads/{thread_id}

2. Web UI 紧接着调用 Gateway 清理
   DELETE /api/threads/{thread_id}

3. Gateway 删除本地 DeerFlow 管理的文件
   - 递归删除 .deer-flow/threads/{thread_id}/
   - 目录不存在时视为 no-op
   - 非法 thread ID 在访问文件系统之前就会被拒绝
```

### 配置重载

```
1. Client 更新 MCP 配置
   PUT /api/mcp/config

2. Gateway 写入 extensions_config.json
   - 更新 mcpServers 字段
   - 文件 mtime 变化

3. MCP Manager 感知到变化
   - get_cached_mcp_tools() 检查 mtime
   - 若变化:重建 MCP client
   - 加载新的 server 配置

4. 下一次 agent 执行使用新工具
```

## 安全考量

### Sandbox 隔离

- Agent 代码在 sandbox 边界内执行
- 本地 sandbox:直接执行(仅开发用)
- Docker sandbox:容器隔离(生产推荐)
- 文件操作中预防路径穿越

### API 安全

- Thread 隔离:每个 thread 有独立的数据目录
- 文件校验:上传的路径安全检查
- 环境变量替换:机密不落盘到配置

### MCP 安全

- 每个 MCP 服务器运行在自己的进程中
- 环境变量在运行时解析
- 各 server 可独立开关

## 性能考量

### 缓存

- MCP 工具带 mtime 失效的缓存
- 配置一次性加载,文件变化时重载
- 技能在启动时解析一次并常驻内存

### 流式

- 使用 SSE 做实时响应流
- 降低首 token 延迟
- 长任务可见进度

### 上下文管理

- SummarizationMiddleware 在接近上限时压缩上下文
- 触发条件可配置:tokens、messages 或比例
- 在压缩旧消息的同时保留最近消息
