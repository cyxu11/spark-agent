# Guardrails:工具调用前的授权层

> **背景:** [Issue #1213](https://github.com/bytedance/deer-flow/issues/1213) —— DeerFlow 有 Docker sandbox,也有通过 `ask_clarification` 的人工确认,但没有一个针对工具调用的确定性、策略驱动的授权层。运行多步自治任务的 agent 可以用任意参数调用已加载的任意工具。Guardrails 引入一个 middleware,在工具 **执行前** 对每一次调用按策略做评估。

## 为什么需要 Guardrails

```
没有 guardrails:                          有 guardrails:

  Agent                                    Agent
    │                                        │
    ▼                                        ▼
  ┌──────────┐                             ┌──────────┐
  │ bash     │──▶ 立即执行                 │ bash     │──▶ GuardrailMiddleware
  │ rm -rf / │                             │ rm -rf / │        │
  └──────────┘                             └──────────┘        ▼
                                                         ┌──────────────┐
                                                         │  Provider    │
                                                         │  按策略评估  │
                                                         └──────┬───────┘
                                                                │
                                                          ┌─────┴─────┐
                                                          │           │
                                                        ALLOW       DENY
                                                          │           │
                                                          ▼           ▼
                                                      正常执行   Agent 看到:
                                                                 "Guardrail denied:
                                                                  rm -rf blocked"
```

- **Sandbox 化** 提供进程隔离,但不是语义上的授权。被 sandbox 化的 `bash` 仍可 `curl` 数据外发
- **人工确认**(`ask_clarification`)要求每个动作都有人在回路上,自治场景不可行
- **Guardrails** 提供无需人工介入的、确定性的、策略驱动授权

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Middleware Chain                               │
│                                                                      │
│  1. ThreadDataMiddleware     ─── per-thread 目录                     │
│  2. UploadsMiddleware        ─── 文件上传跟踪                        │
│  3. SandboxMiddleware        ─── sandbox 获取                        │
│  4. DanglingToolCallMiddleware ── 修复不完整的工具调用                 │
│  5. GuardrailMiddleware ◄──── 评估每一次工具调用                     │
│  6. ToolErrorHandlingMiddleware ── 将异常转为消息                     │
│  7-12. (Summarization、Title、Memory、Vision、Subagent、Clarify)     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
           ┌──────────────────────────┐
           │    GuardrailProvider     │  ◄── 可插拔:任何实现了
           │    (在 YAML 中配置)       │      evaluate/aevaluate 的类
           └────────────┬─────────────┘
                        │
              ┌─────────┼──────────────┐
              │         │              │
              ▼         ▼              ▼
         内置          OAP Passport   自定义
         Allowlist     Provider       Provider
         (零依赖)      (开放标准)     (你自己的代码)
                        │
                  任意实现
                  (例如 APort,
                   或你自己的评估器)
```

`GuardrailMiddleware` 实现了 `wrap_tool_call` / `awrap_tool_call`(与 `ToolErrorHandlingMiddleware` 采用相同的 `AgentMiddleware` 模式)。它会:

1. 构造 `GuardrailRequest`,包含工具名、参数与 passport 引用
2. 调用所配置 provider 的 `provider.evaluate(request)`
3. **拒绝** 时:返回带理由的 `ToolMessage(status="error")` —— agent 看到拒绝信息并相应调整
4. **允许** 时:透传给真正的 tool handler
5. 若 **provider 出错** 且 `fail_closed=true`(默认):阻塞该调用
6. `GraphBubbleUp` 异常(LangGraph 控制信号)始终向上传播,永不吞掉

## 三种 Provider 方案

### 方案 1:内置 AllowlistProvider(零依赖)

最简单的方案,随 DeerFlow 一起发布。按名字黑/白名单控制工具。无额外包、无 passport、无网络。

**config.yaml:**
```yaml
guardrails:
  enabled: true
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:
      denied_tools: ["bash", "write_file"]
```

这会在所有请求中阻塞 `bash` 与 `write_file`,其他工具正常放行。

也可以用白名单(只放行这些工具):
```yaml
guardrails:
  enabled: true
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:
      allowed_tools: ["web_search", "read_file", "ls"]
```

**试一下:**
1. 将上述配置加入 `config.yaml`
2. 启动:`make dev`
3. 让 agent:"Use bash to run echo hello"
4. Agent 会看到:`Guardrail denied: tool 'bash' was blocked (oap.tool_not_allowed)`

### 方案 2:OAP Passport Provider(基于策略)

基于 [Open Agent Passport(OAP)](https://github.com/aporthq/aport-spec) 开放标准执行策略。OAP passport 是一份 JSON 文档,声明 agent 的身份、能力与运行上限。任何 **读取 OAP passport 并返回符合 OAP 规范决策** 的 provider 都可对接 DeerFlow。

```
┌─────────────────────────────────────────────────────────────┐
│                    OAP Passport(JSON)                        │
│                 (开放标准,任意 provider 可用)                │
│  {                                                           │
│    "spec_version": "oap/1.0",                                │
│    "status": "active",                                       │
│    "capabilities": [                                         │
│      {"id": "system.command.execute"},                       │
│      {"id": "data.file.read"},                               │
│      {"id": "data.file.write"},                              │
│      {"id": "web.fetch"},                                    │
│      {"id": "mcp.tool.execute"}                              │
│    ],                                                        │
│    "limits": {                                               │
│      "system.command.execute": {                             │
│        "allowed_commands": ["git", "npm", "node", "ls"],     │
│        "blocked_patterns": ["rm -rf", "sudo", "chmod 777"]   │
│      }                                                       │
│    }                                                         │
│  }                                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
               任意兼容 OAP 的 provider
          ┌────────────────┼────────────────┐
          │                │                │
      自研          APort(参考实现)   其他未来实现
      评估器
```

**手动创建 passport:**

OAP passport 就是一份 JSON 文件。你可以按照 [OAP spec](https://github.com/aporthq/aport-spec/blob/main/oap/oap-spec.md) 手工创建,并使用 [JSON schema](https://github.com/aporthq/aport-spec/blob/main/oap/passport-schema.json) 做校验。模板可见 [examples](https://github.com/aporthq/aport-spec/tree/main/oap/examples) 目录。

**用 APort 作为参考实现:**

[APort Agent Guardrails](https://github.com/aporthq/aport-agent-guardrails) 是一份开源(Apache 2.0)的 OAP provider 实现,负责生成 passport、本地评估,以及可选的托管 API 评估。

```bash
pip install aport-agent-guardrails
aport setup --framework deerflow
```

会创建:
- `~/.aport/deerflow/config.yaml` —— 评估器配置(本地或 API 模式)
- `~/.aport/deerflow/aport/passport.json` —— 带能力与上限的 OAP passport

**config.yaml(以 APort 作为 provider):**
```yaml
guardrails:
  enabled: true
  provider:
    use: aport_guardrails.providers.generic:OAPGuardrailProvider
```

**config.yaml(使用你自己的 OAP provider):**
```yaml
guardrails:
  enabled: true
  provider:
    use: my_oap_provider:MyOAPProvider
    config:
      passport_path: ./my-passport.json
```

任何接收 `framework` 关键字参数并实现 `evaluate`/`aevaluate` 的 provider 都可对接。OAP 标准定义了 passport 格式与决策码;DeerFlow 不关心具体由哪个 provider 读取。

**Passport 能控制哪些东西:**

| Passport 字段 | 作用 | 示例 |
|---|---|---|
| `capabilities[].id` | Agent 可用的工具类别 | `system.command.execute`、`data.file.write` |
| `limits.*.allowed_commands` | 允许的命令 | `["git", "npm", "node"]` 或 `["*"]` 表示全部 |
| `limits.*.blocked_patterns` | 始终拒绝的模式 | `["rm -rf", "sudo", "chmod 777"]` |
| `status` | 总开关 | `active`、`suspended`、`revoked` |

**评估模式(取决于 provider 实现):**

不同 OAP provider 可能支持不同评估模式。例如 APort 参考实现支持:

| 模式 | 工作方式 | 网络 | 延迟 |
|---|---|---|---|
| **本地** | 在本地(bash 脚本)评估 passport | 无 | ~300ms |
| **API** | 将 passport + 上下文发往托管评估器,返回签名的决策 | 需要 | ~65ms |

自定义 OAP provider 可以采用任意评估策略 —— DeerFlow middleware 不关心它是怎么得出决策的。

**试一下:**
1. 按上面步骤安装并配置
2. 启动 DeerFlow,让 agent:"Create a file called test.txt with content hello"
3. 然后:"Now delete it using bash rm -rf"
4. Guardrail 会拒绝:`oap.blocked_pattern: Command contains blocked pattern: rm -rf`

### 方案 3:自定义 Provider(自带实现)

任何实现了 `evaluate(request)` 与 `aevaluate(request)` 方法的 Python 类都可作为 provider。无需继承基类 —— 它是一个结构化协议。

```python
# my_guardrail.py

class MyGuardrailProvider:
    name = "my-company"

    def evaluate(self, request):
        from deerflow.guardrails.provider import GuardrailDecision, GuardrailReason

        # 示例:阻止包含 "delete" 的 bash 命令
        if request.tool_name == "bash" and "delete" in str(request.tool_input):
            return GuardrailDecision(
                allow=False,
                reasons=[GuardrailReason(code="custom.blocked", message="delete not allowed")],
                policy_id="custom.v1",
            )
        return GuardrailDecision(allow=True, reasons=[GuardrailReason(code="oap.allowed")])

    async def aevaluate(self, request):
        return self.evaluate(request)
```

**config.yaml:**
```yaml
guardrails:
  enabled: true
  provider:
    use: my_guardrail:MyGuardrailProvider
```

请确保 `my_guardrail.py` 在 Python path 上(例如放在 backend 目录或已安装为包)。

**试一下:**
1. 在 backend 目录下创建 `my_guardrail.py`
2. 加入该配置
3. 启动 DeerFlow,让 agent:"Use bash to delete test.txt"
4. 你自己的 provider 会拒绝它

## 如何实现 Provider

### 需要的接口

```
┌──────────────────────────────────────────────────┐
│              GuardrailProvider 协议               │
│                                                   │
│  name: str                                        │
│                                                   │
│  evaluate(request: GuardrailRequest)              │
│      -> GuardrailDecision                         │
│                                                   │
│  aevaluate(request: GuardrailRequest)   (async)   │
│      -> GuardrailDecision                         │
└──────────────────────────────────────────────────┘

┌──────────────────────────┐    ┌──────────────────────────┐
│     GuardrailRequest      │    │    GuardrailDecision      │
│                           │    │                           │
│  tool_name: str           │    │  allow: bool              │
│  tool_input: dict         │    │  reasons: [GuardrailReason]│
│  agent_id: str | None     │    │  policy_id: str | None    │
│  thread_id: str | None    │    │  metadata: dict           │
│  is_subagent: bool        │    │                           │
│  timestamp: str           │    │  GuardrailReason:         │
│                           │    │    code: str              │
└──────────────────────────┘    │    message: str           │
                                └──────────────────────────┘
```

### DeerFlow 工具名

Provider 在 `request.tool_name` 中将看到的工具名:

| 工具 | 作用 |
|---|---|
| `bash` | Shell 命令执行 |
| `write_file` | 创建/覆盖文件 |
| `str_replace` | 编辑文件(查找替换) |
| `read_file` | 读取文件内容 |
| `ls` | 列出目录 |
| `web_search` | 网页搜索 |
| `web_fetch` | 抓取 URL 内容 |
| `image_search` | 图片搜索 |
| `present_file` | 将文件展示给用户 |
| `view_image` | 显示图片 |
| `ask_clarification` | 向用户提问 |
| `task` | 委派给 subagent |
| `mcp__*` | MCP 工具(动态) |

### OAP 原因码

[OAP 规范](https://github.com/aporthq/aport-spec) 定义的标准码:

| Code | 含义 |
|---|---|
| `oap.allowed` | 工具调用已授权 |
| `oap.tool_not_allowed` | 工具不在允许名单 |
| `oap.command_not_allowed` | 命令不在 allowed_commands |
| `oap.blocked_pattern` | 命令匹配了 blocked pattern |
| `oap.limit_exceeded` | 超出某个上限 |
| `oap.passport_suspended` | Passport 状态为 suspended/revoked |
| `oap.evaluator_error` | Provider 崩溃(fail-closed) |

### Provider 加载

DeerFlow 通过 `resolve_variable()` 加载 provider —— 与模型、工具、sandbox provider 一致。`use:` 字段是 Python 类路径:`package.module:ClassName`。

若给出 `config:`,provider 实例化时会通过 `**config` 传入 kwargs,并始终注入 `framework="deerflow"`。接受 `**kwargs` 以保持前向兼容:

```python
class YourProvider:
    def __init__(self, framework: str = "generic", **kwargs):
        # framework="deerflow" 告诉你应该用哪个配置目录
        ...
```

## 配置参考

```yaml
guardrails:
  # 开/关 guardrail middleware(默认:false)
  enabled: true

  # Provider 抛异常时是否阻塞调用(默认:true)
  fail_closed: true

  # Passport 引用 —— 作为 request.agent_id 传给 provider。
  # 可以是文件路径、托管 agent ID,或 null(由 provider 从其自身配置解析)
  passport: null

  # Provider:通过 resolve_variable 按类路径加载
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:  # 可选的 kwargs,传给 provider.__init__
      denied_tools: ["bash"]
```

## 测试

```bash
cd backend
uv run python -m pytest tests/test_guardrail_middleware.py -v
```

25 个测试覆盖:
- AllowlistProvider:允许、拒绝、白+黑名单组合、异步
- GuardrailMiddleware:允许透传、带 OAP 码的拒绝、fail-closed、fail-open、passport 转发、空 reasons 回退、空 tool 名、protocol isinstance 检查
- 异步路径:`awrap_tool_call` 的允许、拒绝、fail-closed、fail-open
- GraphBubbleUp:LangGraph 控制信号正常向上传播(不被捕获)
- 配置:默认值、from_dict、singleton load/reset

## 文件

```
packages/harness/deerflow/guardrails/
    __init__.py              # 公共导出
    provider.py              # GuardrailProvider 协议、GuardrailRequest、GuardrailDecision
    middleware.py            # GuardrailMiddleware(AgentMiddleware 子类)
    builtin.py               # AllowlistProvider(零依赖)

packages/harness/deerflow/config/
    guardrails_config.py     # GuardrailsConfig Pydantic 模型 + singleton

packages/harness/deerflow/agents/middlewares/
    tool_error_handling_middleware.py  # 在链中注册 GuardrailMiddleware

config.example.yaml          # 三种 provider 方案均有示例
tests/test_guardrail_middleware.py  # 25 个测试
docs/GUARDRAILS.md           # 本文件
```
