# team4-换算工具 — 流程编排

## 执行流程

### Step 0: 输入解析(共享模块)
- Agent: input_parser(_shared) — 提取 query_intent / market_type / date_range / region / granularity / metric_focus 等扩展字段,JSON 输出注入到后续 Agent 的 system_prompt 末尾

### Step 1: 换算分析师独立产出最终答案(单 Agent,非串行注入场景)
- Agent: sub-4-2-换算分析 — 直接基于 mcp_price_converter 工具(含 JKM/TTF/HH/Brent/WTI 实时基准价 + 9 大换算参数 + 4 套换算公式 + 退税计算)输出**精确换算结果 + 简明业务解读**

> **架构说明**:
> 1. 价格换算场景属于**确定性计算**(JKM 输入 → 公式套用 → 元/吨输出),mcp_price_converter 已直接返回完整换算结果(成本不含税 / 含税到岸 / 退税 / 出站价退税后),无需独立检索员两阶段拆分
> 2. 因此 team4 不存在 sub-4-1 检索员,**不适用「检索员 → 分析师」串行 + system_prompt 注入**模式(team1/team2/team3 适用)
> 3. sub-4-2 直接调用 mcp_price_converter 拿到完整换算表,展示换算结果 + 简明公式说明,不做 MRTF 4 维深度分析
