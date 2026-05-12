# team3-公司经营 — 流程编排

## 执行流程

### Step 0: 输入解析(共享模块)
- Agent: input_parser(_shared) — 提取 query_intent / market_type / date_range / region / granularity / metric_focus 等扩展字段,JSON 输出注入到后续 Agent 的 system_prompt 末尾

### Step 1: 取数(检索员先行,串行)
- Agent: sub-3-1-经营数据检索 — 调用 MCP 查询本平台公司经营数据(资源池价格、管道气价分大区、LNG 进口长协占比、销售毛利、罐容利用率、客户结构、市场份额等),按 GFM 标准 markdown 表格输出结构化数据明细

### Step 2: 分析(分析师串行,在检索员之后)
- 依赖: sub-3-1-经营数据检索
- Agent: sub-3-2-经营数据分析 — 联网搜索 + MRTF 四维深度分析 + 综合研判;**数据来源优先级**:① 检索员 sub-3-1 结构化数据明细(由 team_executor 注入到 system_prompt 末尾「## 检索员数据明细」段落,作为本平台数据第一来源,**经营数据敏感性下尤为关键**)② input_parser 注入的结构化字段(data_source / market_type / region / granularity 等)③ 联网搜索 mcp_iflytek_cbm 补充国资委 / 央企监管 / 行业资讯维度;若检索员数据缺失或返回为空,fallback 到「仅 input_parser 字段 + 联网搜索 + 方向性描述」模式,**严禁臆造毛利率 / EVA / 销量 / 长协占比等具体经营指标**

> **数据共享说明**:本 Team 已升级为「检索员 → 分析师」串行 + system_prompt 注入模式;sub-3-1 完成后,其结构化数据明细(markdown 表格)由 team_executor `_inject_retriever_outputs` 函数注入到 sub-3-2 system_prompt 末尾;sub-3-2 在 T 技术面 / F 基本面章节**必须**优先引用检索员数据明细,引用时使用 `[数据]` 标识标记本平台数据来源,联网搜索结果使用 `[来源]` 或 markdown link 标记;经营数据高度敏感,无检索员数据时一律改为方向性描述,不得自行编造数值。
