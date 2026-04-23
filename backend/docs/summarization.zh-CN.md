# 对话摘要压缩(Conversation Summarization)

DeerFlow 内置了自动对话摘要压缩功能,用于处理接近模型 token 限制的长对话。启用后,系统会自动压缩较早的消息,同时保留最近的上下文。

## 概览

该功能使用 LangChain 的 `SummarizationMiddleware` 监控对话历史,并在达到可配置阈值时触发摘要。触发时会：

1. 实时统计消息中的 token 数
2. 达到阈值时触发摘要
3. 保留最近消息,对较早的交互进行摘要
4. 保持 AI/Tool 消息配对,以维持上下文连贯性
5. 将摘要重新注入对话

## 配置

摘要在 `config.yaml` 的 `summarization` 字段配置：

```yaml
summarization:
  enabled: true
  model_name: null  # 使用默认模型,或指定一个轻量模型

  # 触发条件(OR 关系 —— 任一满足即触发)
  trigger:
    - type: tokens
      value: 4000
    # 其他触发条件(可选)
    # - type: messages
    #   value: 50
    # - type: fraction
    #   value: 0.8  # 模型最大输入 tokens 的 80%

  # 上下文保留策略
  keep:
    type: messages
    value: 20

  # 摘要调用的 token 裁剪
  trim_tokens_to_summarize: 4000

  # 自定义摘要 prompt(可选)
  summary_prompt: null
```

### 配置项

#### `enabled`
- **类型**：Boolean
- **默认**：`false`
- **说明**：是否启用自动摘要

#### `model_name`
- **类型**：String 或 null
- **默认**：`null`(使用默认模型)
- **说明**：用于生成摘要的模型。建议使用轻量、低成本的模型,例如 `gpt-4o-mini` 或同类。

#### `trigger`
- **类型**：单个 `ContextSize`,或 `ContextSize` 列表
- **必填**：启用时至少需指定一个
- **说明**:触发摘要的阈值。多个条件为 OR 关系 —— 任一阈值达到即触发。

**ContextSize 类型：**

1. **基于 token**:token 数达到指定值时触发
   ```yaml
   trigger:
     type: tokens
     value: 4000
   ```

2. **基于消息数**:消息数达到指定值时触发
   ```yaml
   trigger:
     type: messages
     value: 50
   ```

3. **基于比例**:token 使用量达到模型最大输入 tokens 的比例时触发
   ```yaml
   trigger:
     type: fraction
     value: 0.8  # 模型最大输入 tokens 的 80%
   ```

**多触发条件：**
```yaml
trigger:
  - type: tokens
    value: 4000
  - type: messages
    value: 50
```

#### `keep`
- **类型**:`ContextSize` 对象
- **默认**:`{type: messages, value: 20}`
- **说明**:摘要完成后需要保留多少最近对话历史。

**示例:**
```yaml
# 保留最近 20 条消息
keep:
  type: messages
  value: 20

# 保留最近 3000 tokens
keep:
  type: tokens
  value: 3000

# 保留模型最大输入 tokens 的 30%
keep:
  type: fraction
  value: 0.3
```

#### `trim_tokens_to_summarize`
- **类型**:Integer 或 null
- **默认**:`4000`
- **说明**:准备摘要调用时,最多携带多少 tokens 的消息。设置为 `null` 表示不裁剪(超长对话不建议)。

#### `summary_prompt`
- **类型**:String 或 null
- **默认**:`null`(使用 LangChain 默认 prompt)
- **说明**:生成摘要的自定义 prompt 模板。该 prompt 应引导模型提取最关键的上下文。

**默认 Prompt 行为:**
LangChain 默认 prompt 会指示模型:
- 抽取质量最高、最相关的上下文
- 聚焦对整体目标至关重要的信息
- 避免重复已完成的动作
- 仅返回抽取出的上下文

## 工作原理

### 摘要流程

1. **监控**:每次模型调用前,middleware 统计消息历史的 token 数
2. **触发检查**:任一阈值达到即触发
3. **消息划分**:消息被分成两部分:
   - 要被摘要的消息(超出 `keep` 阈值的较早消息)
   - 要保留的消息(`keep` 阈值内的最近消息)
4. **生成摘要**:模型对较早消息生成简明摘要
5. **替换上下文**:更新消息历史:
   - 移除所有被摘要的旧消息
   - 添加一条摘要消息
   - 保留最近消息
6. **AI/Tool 配对保护**:系统确保 AI 消息与其对应的 tool 消息不会被分开

### Token 计数

- 基于字符数的近似 token 计数
- Anthropic 模型:~3.3 字符 / token
- 其他模型:使用 LangChain 的默认估算
- 可通过自定义 `token_counter` 函数覆盖

### 消息保留

该 middleware 会智能地保留消息上下文:

- **最近消息**:按 `keep` 配置始终保留
- **AI/Tool 配对**:永不拆分 —— 如果截断点落在 tool 消息中,系统会调整以保持完整的 AI + Tool 消息序列
- **摘要格式**:摘要以 HumanMessage 形式注入,格式:
  ```
  Here is a summary of the conversation to date:

  [Generated summary text]
  ```

## 最佳实践

### 如何选择触发阈值

1. **基于 token 的触发**:适合大多数场景
   - 设为模型上下文窗口的 60-80%
   - 示例:8K 上下文,用 4000-6000 tokens

2. **基于消息数的触发**:适合控制对话长度
   - 面向很多短消息的应用
   - 示例:根据平均消息长度,50-100 条

3. **基于比例的触发**:适合多模型场景
   - 自动随各模型容量伸缩
   - 示例:0.8(模型最大输入 tokens 的 80%)

### 如何选择保留策略(`keep`)

1. **按消息数保留**:大多数场景的最佳选择
   - 保留自然的对话节奏
   - 建议:15-25 条

2. **按 token 数保留**:需要精确控制时使用
   - 便于管理精确的 token 预算
   - 建议:2000-4000 tokens

3. **按比例保留**:多模型组合场景
   - 自动随模型容量伸缩
   - 建议:0.2-0.4(最大输入的 20-40%)

### 模型选择

- **推荐**:用轻量、低成本的模型做摘要
  - 例如:`gpt-4o-mini`、`claude-haiku` 或同类
  - 摘要不需要最强模型
  - 高流量场景下显著节省成本

- **默认**:`model_name` 为 `null` 时使用默认模型
  - 成本可能更高,但风格更一致
  - 适合简单配置

### 优化小贴士

1. **平衡触发条件**:同时搭配 token 与消息触发,更稳健
   ```yaml
   trigger:
     - type: tokens
       value: 4000
     - type: messages
       value: 50
   ```

2. **保守的保留策略**:初期多保留一些消息,再根据效果下调
   ```yaml
   keep:
     type: messages
     value: 25  # 先设高,必要时再下调
   ```

3. **策略性裁剪**:限制发给摘要模型的 token 数
   ```yaml
   trim_tokens_to_summarize: 4000  # 避免昂贵的摘要调用
   ```

4. **监控并迭代**:跟踪摘要质量并不断调整

## 故障排查

### 摘要质量问题

**问题**:摘要丢失了重要上下文

**解决方案**:
1. 提高 `keep` 以保留更多消息
2. 降低触发阈值,更早开始摘要
3. 自定义 `summary_prompt`,突出关键信息
4. 使用能力更强的模型生成摘要

### 性能问题

**问题**:摘要调用耗时过长

**解决方案**:
1. 改用更快的摘要模型(例如 `gpt-4o-mini`)
2. 降低 `trim_tokens_to_summarize`,减少上下文
3. 提高触发阈值,降低摘要频率

### Token 上限错误

**问题**:即便开启摘要,仍触发 token 限制

**解决方案**:
1. 降低触发阈值,更早摘要
2. 降低 `keep`,少保留一些
3. 检查是否有单条消息本身就很大
4. 考虑改用基于比例的触发

## 实现细节

### 代码结构

- **配置**:`packages/harness/deerflow/config/summarization_config.py`
- **接入**:`packages/harness/deerflow/agents/lead_agent/agent.py`
- **Middleware**:使用 `langchain.agents.middleware.SummarizationMiddleware`

### Middleware 顺序

摘要在 ThreadData 与 Sandbox 初始化之后、Title 与 Clarification 之前运行:

1. ThreadDataMiddleware
2. SandboxMiddleware
3. **SummarizationMiddleware** ← 在此处
4. TitleMiddleware
5. ClarificationMiddleware

### 状态管理

- 摘要本身无状态 —— 配置在启动时一次性加载
- 摘要以普通消息形式加入到对话历史
- Checkpointer 会自动持久化摘要后的历史

## 示例配置

### 最小配置
```yaml
summarization:
  enabled: true
  trigger:
    type: tokens
    value: 4000
  keep:
    type: messages
    value: 20
```

### 生产配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini  # 轻量模型,更划算
  trigger:
    - type: tokens
      value: 6000
    - type: messages
      value: 75
  keep:
    type: messages
    value: 25
  trim_tokens_to_summarize: 5000
```

### 多模型配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini
  trigger:
    type: fraction
    value: 0.7  # 模型最大输入的 70%
  keep:
    type: fraction
    value: 0.3  # 保留最大输入的 30%
  trim_tokens_to_summarize: 4000
```

### 保守配置(高质量)
```yaml
summarization:
  enabled: true
  model_name: gpt-4  # 用满配模型生成高质量摘要
  trigger:
    type: tokens
    value: 8000
  keep:
    type: messages
    value: 40  # 保留更多上下文
  trim_tokens_to_summarize: null  # 不裁剪
```

## 参考

- [LangChain Summarization Middleware 文档](https://docs.langchain.com/oss/python/langchain/middleware/built-in#summarization)
- [LangChain 源码](https://github.com/langchain-ai/langchain)
