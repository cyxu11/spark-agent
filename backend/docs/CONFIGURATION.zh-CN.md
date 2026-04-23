# 配置指南

本指南说明如何为你的运行环境配置 DeerFlow。

## 配置版本化

`config.example.yaml` 中有一个 `config_version` 字段,用于跟踪 schema 变更。当示例版本高于你本地的 `config.yaml` 时,应用启动时会发出警告:

```
WARNING - Your config.yaml (version 0) is outdated — the latest version is 1.
Run `make config-upgrade` to merge new fields into your config.
```

- 本地配置**缺失 `config_version`** 会被视为版本 0
- 运行 `make config-upgrade` 可以自动合入缺失字段(保留你现有的值,并生成 `.bak` 备份)
- 变更 config schema 时,请在 `config.example.yaml` 中把 `config_version` 加一

## 配置项分节

### Models

配置 agent 可用的 LLM:

```yaml
models:
  - name: gpt-4                    # 内部标识
    display_name: GPT-4            # 面向用户的显示名
    use: langchain_openai:ChatOpenAI  # LangChain 类路径
    model: gpt-4                   # API 层的模型名
    api_key: $OPENAI_API_KEY       # API key(建议用环境变量)
    max_tokens: 4096               # 单请求最大 token 数
    temperature: 0.7               # 采样温度
```

**已支持的提供方:**
- OpenAI(`langchain_openai:ChatOpenAI`)
- Anthropic(`langchain_anthropic:ChatAnthropic`)
- DeepSeek(`langchain_deepseek:ChatDeepSeek`)
- Claude Code OAuth(`deerflow.models.claude_provider:ClaudeChatModel`)
- Codex CLI(`deerflow.models.openai_codex_provider:CodexChatModel`)
- 任意 LangChain 兼容的提供方

基于 CLI 的提供方示例:

```yaml
models:
  - name: gpt-5.4
    display_name: GPT-5.4 (Codex CLI)
    use: deerflow.models.openai_codex_provider:CodexChatModel
    model: gpt-5.4
    supports_thinking: true
    supports_reasoning_effort: true

  - name: claude-sonnet-4.6
    display_name: Claude Sonnet 4.6 (Claude Code OAuth)
    use: deerflow.models.claude_provider:ClaudeChatModel
    model: claude-sonnet-4-6
    max_tokens: 4096
    supports_thinking: true
```

**CLI 提供方的鉴权行为:**
- `CodexChatModel` 从 `~/.codex/auth.json` 加载 Codex CLI 的凭据
- Codex Responses 端点目前拒绝 `max_tokens` 与 `max_output_tokens`,因此 `CodexChatModel` 不暴露请求级别的 token 上限
- `ClaudeChatModel` 接受 `CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`、`CLAUDE_CODE_CREDENTIALS_PATH`,或明文的 `~/.claude/.credentials.json`
- 在 macOS 上,DeerFlow 不会自动探测 Keychain。需要时请用 `scripts/export_claude_code_oauth.py` 显式导出 Claude Code 凭据

在 LangChain 下使用 OpenAI 的 `/v1/responses` 端点,仍然使用 `langchain_openai:ChatOpenAI`,并设置:

```yaml
models:
  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
```

对于 OpenAI 兼容网关(例如 Novita、OpenRouter),仍使用 `langchain_openai:ChatOpenAI` 并设置 `base_url`:

```yaml
models:
  - name: novita-deepseek-v3.2
    display_name: Novita DeepSeek V3.2
    use: langchain_openai:ChatOpenAI
    model: deepseek/deepseek-v3.2
    api_key: $NOVITA_API_KEY
    base_url: https://api.novita.ai/openai
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled

  - name: minimax-m2.5
    display_name: MiniMax M2.5
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax 要求 temperature 落在 (0.0, 1.0]
    supports_vision: true

  - name: minimax-m2.5-highspeed
    display_name: MiniMax M2.5 Highspeed
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5-highspeed
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax 要求 temperature 落在 (0.0, 1.0]
    supports_vision: true
  - name: openrouter-gemini-2.5-flash
    display_name: Gemini 2.5 Flash (OpenRouter)
    use: langchain_openai:ChatOpenAI
    model: google/gemini-2.5-flash-preview
    api_key: $OPENAI_API_KEY
    base_url: https://openrouter.ai/api/v1
```

若你的 OpenRouter key 用的是另一个环境变量名,请显式指定 `api_key`(例如 `api_key: $OPENROUTER_API_KEY`)。

**Thinking 模型:**
部分模型支持 "thinking" 模式用于复杂推理:

```yaml
models:
  - name: deepseek-v3
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

**通过 OpenAI 兼容网关使用带 thinking 的 Gemini:**

当你通过 OpenAI 兼容代理(Vertex AI 的 OpenAI 兼容端点、AI Studio,或第三方网关)调用 Gemini 并启用 thinking 时,API 会为每一次工具调用返回 `thought_signature`。之后每次把这些 assistant 消息重放回 API 的请求 **必须** 在对应的 tool-call 条目上把这些签名原样回传,否则 API 会返回:

```
HTTP 400 INVALID_ARGUMENT: function call `<tool>` in the N. content block is
missing a `thought_signature`.
```

标准的 `langchain_openai:ChatOpenAI` 在序列化消息时会默默丢掉 `thought_signature`。请改用 `deerflow.models.patched_openai:PatchedChatOpenAI` —— 它会把(来自 `AIMessage.additional_kwargs["tool_calls"]` 的)tool-call 签名重新注入每次出站 payload:

```yaml
models:
  - name: gemini-2.5-pro-thinking
    display_name: Gemini 2.5 Pro (Thinking)
    use: deerflow.models.patched_openai:PatchedChatOpenAI
    model: google/gemini-2.5-pro-preview   # 使用你的网关所要求的模型名
    api_key: $GEMINI_API_KEY
    base_url: https://<your-openai-compat-gateway>/v1
    max_tokens: 16384
    supports_thinking: true
    supports_vision: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

**不** 启用 thinking 时访问 Gemini(例如通过 OpenRouter 而未激活 thinking),使用普通的 `langchain_openai:ChatOpenAI` 并设置 `supports_thinking: false` 即可,不需要补丁。

### Tool Groups

将工具按逻辑分组:

```yaml
tool_groups:
  - name: web          # 网页浏览与搜索
  - name: file:read    # 只读文件操作
  - name: file:write   # 写文件操作
  - name: bash         # Shell 命令执行
```

### Tools

配置 agent 可用的具体工具:

```yaml
tools:
  - name: web_search
    group: web
    use: deerflow.community.tavily.tools:web_search_tool
    max_results: 5
    # api_key: $TAVILY_API_KEY  # 可选
```

**内置工具:**
- `web_search` —— 网页搜索(Tavily)
- `web_fetch` —— 抓取网页(Jina AI)
- `ls` —— 列出目录内容
- `read_file` —— 读取文件内容
- `write_file` —— 写入文件
- `str_replace` —— 文件内字符串替换
- `bash` —— 执行 bash 命令

### Sandbox

DeerFlow 支持多种 sandbox 执行模式,通过 `config.yaml` 配置:

**本地执行**(直接在宿主机上运行 sandbox 代码):
```yaml
sandbox:
   use: deerflow.sandbox.local:LocalSandboxProvider # 本地执行
   allow_host_bash: false # 默认;宿主机 bash 除非显式开启否则禁用
```

**Docker 执行**(在隔离的 Docker 容器内运行 sandbox 代码):
```yaml
sandbox:
   use: deerflow.community.aio_sandbox:AioSandboxProvider # 基于 Docker 的 sandbox
```

**Docker + Kubernetes 执行**(通过 provisioner 服务在 K8s Pod 中运行 sandbox 代码):

该模式在 **宿主机的集群** 上为每个 sandbox 分配独立的 Kubernetes Pod。需要 Docker Desktop K8s、OrbStack 或同类本地 K8s 环境。

```yaml
sandbox:
   use: deerflow.community.aio_sandbox:AioSandboxProvider
   provisioner_url: http://provisioner:8002
```

使用 Docker 开发(`make docker-start`)时,仅当你配置了 provisioner 模式,DeerFlow 才会启动 `provisioner` 服务;在纯本地或普通 Docker sandbox 模式下会跳过。

详细配置、前置条件与故障排查见 [Provisioner 配置指南](../../docker/provisioner/README.md)。

在本地执行与 Docker 隔离之间二选一:

**方案 1:本地 Sandbox**(默认,最简):
```yaml
sandbox:
  use: deerflow.sandbox.local:LocalSandboxProvider
  allow_host_bash: false
```

`allow_host_bash` 默认为 `false` 是有意为之。DeerFlow 的本地 sandbox 只是一种宿主机便捷模式,**不是** 一个安全的 shell 隔离边界。若你需要 `bash`,请优先使用 `AioSandboxProvider`。只有在完全可信的单用户本地场景下才可以设置 `allow_host_bash: true`。

**方案 2:Docker Sandbox**(隔离,更安全):
```yaml
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  port: 8080
  auto_start: true
  container_prefix: deer-flow-sandbox

  # 可选:额外挂载
  mounts:
    - host_path: /path/on/host
      container_path: /path/in/container
      read_only: false
```

如果你配置了 `sandbox.mounts`,DeerFlow 会把这些 `container_path` 写入 agent 的 prompt,这样 agent 能够发现并直接操作挂载目录,不会误以为一切都必须在 `/mnt/user-data` 下。

### Skills(技能)

配置技能目录以承载专用工作流:

```yaml
skills:
  # 宿主机路径(可选,默认 ../skills)
  path: /custom/path/to/skills

  # 容器内挂载路径(默认 /mnt/skills)
  container_path: /mnt/skills
```

**技能的工作方式:**
- 技能存放于 `deer-flow/skills/{public,custom}/`
- 每个技能带一份 `SKILL.md` 元数据
- 技能自动被发现与加载
- 通过路径映射,在本地与 Docker sandbox 下都可使用

**按 agent 过滤技能:**
自定义 agent 可以通过其 `config.yaml`(路径 `workspace/agents/<agent_name>/config.yaml`)中的 `skills` 字段限制要加载哪些技能:
- **省略或 `null`**:加载所有全局启用的技能(默认回退)
- **`[]`(空列表)**:对此 agent 禁用所有技能
- **`["skill-name"]`**:仅加载显式列出的技能

### 标题生成

自动对话标题生成:

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null  # 使用列表中第一个模型
```

### GitHub API Token(GitHub Deep Research 技能可选项)

默认的 GitHub API 频率限制较严。若你经常做项目调研,建议配置一个具有只读权限的 personal access token(PAT)。

**配置步骤:**
1. 在 `.env` 中取消注释 `GITHUB_TOKEN` 并填入你的 PAT
2. 重启 DeerFlow 服务以使其生效

## 环境变量

DeerFlow 支持通过 `$` 前缀做环境变量替换:

```yaml
models:
  - api_key: $OPENAI_API_KEY  # 从环境读取
```

**常见环境变量:**
- `OPENAI_API_KEY` —— OpenAI API key
- `ANTHROPIC_API_KEY` —— Anthropic API key
- `DEEPSEEK_API_KEY` —— DeepSeek API key
- `NOVITA_API_KEY` —— Novita API key(OpenAI 兼容端点)
- `TAVILY_API_KEY` —— Tavily 搜索 API key
- `DEER_FLOW_CONFIG_PATH` —— 自定义配置文件路径

## 配置文件位置

配置文件应当放在 **项目根目录**(`deer-flow/config.yaml`),不要放在 backend 目录下。

## 配置文件查找优先级

DeerFlow 按以下顺序查找配置:

1. 代码中显式传入的 `config_path` 参数
2. `DEER_FLOW_CONFIG_PATH` 环境变量指向的路径
3. 当前工作目录下的 `config.yaml`(通常是运行时的 `backend/`)
4. 上级目录下的 `config.yaml`(项目根目录:`deer-flow/`)

## 最佳实践

1. **将 `config.yaml` 放在项目根目录** —— 而非 `backend/`
2. **永远不要提交 `config.yaml`** —— 已在 `.gitignore` 中
3. **用环境变量承载机密** —— 不要硬编码 API key
4. **保持 `config.example.yaml` 同步更新** —— 记录所有新增选项
5. **本地先测通配置修改** —— 再部署
6. **生产环境使用 Docker sandbox** —— 隔离与安全性更好

## 故障排查

### "Config file not found"
- 确认 `config.yaml` 存在于 **项目根目录**(`deer-flow/config.yaml`)
- 后端默认会在父目录查找,因此推荐放在根目录
- 或者设置 `DEER_FLOW_CONFIG_PATH` 指向自定义位置

### "Invalid API key"
- 检查环境变量是否正确设置
- 确认使用了 `$` 前缀引用环境变量

### "Skills not loading"
- 确认 `deer-flow/skills/` 目录存在
- 确认技能有合法的 `SKILL.md`
- 使用自定义路径时检查 `skills.path` 配置

### "Docker sandbox fails to start"
- 确认 Docker 正在运行
- 检查端口 8080(或配置端口)是否被占用
- 确认 Docker 镜像可拉取

## 示例

完整配置示例见 `config.example.yaml`。
