---
name: market-intelligence-international
description: 国际能源市场态势深度分析 — 国际油气价格走势(JKM/TTF/HH/Brent/WTI)、全球 LNG 进出口量、全球天然气消费量(分区域)的查询与 MRTF 四维研判。底层走 NL2SQL 链路(智能体发现 → SQL 生成 → SQL 执行)。触发场景:用户问"近一月 JKM 走势"、"国际 LNG 现货"、"Brent 油价分析"、"亚欧价差"、"全球 LNG 进出口"、"全球天然气消费"等。输出含数据明细段 + MRTF 5 块分析段(M 宏观/R 政策/T 技术/F 基本面 + 综合研判)。
allowed-tools:
  - listAgentsToolCallback
  - nl2SqlToolCallback
  - executeSqlToolCallback
  - web_search
---

# 国际能源市场态势分析

> 用户画像:交易员(看 T 技术面)/ 市场分析师(看 M+T+F)/ 战略规划部门(看 F 基本面)/ 央企合规审计(看 R 政策面)/ 研究人员(看 M 宏观面)

## 一、何时使用本 skill

✅ 触发场景:
- 国际天然气价格(JKM / TTF / HH / Henry Hub)走势/对比/价差
- 国际原油(Brent / WTI)价格/价差/与天然气价差
- 国际 LNG 现货(东北亚 / 欧洲 / 北美)
- 全球 LNG 进出口贸易(分国家、年度)
- 全球天然气消费(分区域、亿立方米)
- 跨市场价差分析(JKM-TTF / Brent-WTI / 亚欧 LNG 溢价)

❌ 不适用 → 改用其他 skill:
- 国内 LNG 挂牌价 / 国内天然气消费 → `market-intelligence-domestic`
- 中海油经营数据 / LNG 进口长协 / 销售毛利 → `market-intelligence-company`
- 价格换算(JKM ↔ 元/吨 / 退税计算) → `market-intelligence-converter`
- 国际碳市场(EU ETS / China ETS / RGGI):不在统一 MCP 工具覆盖范围,如有需要请用 `web_search` 临时检索

## 二、共享资源(必先阅读)

执行任何用户请求前,**强制**读取以下共享资源:

```
read_file("/mnt/skills/public/market-intelligence-shared/references/output-format-rules.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/mrtf-framework.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/synthesis-template.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/output-self-check.md")
```

需要时再读:`input-parsing-guide.md`(输入解析的边界场景)。

## 三、工作流(严格顺序)

> **数据链路总览**:Step 1(query 清洗) → Step 2(`listAgentsToolCallback` 发现 agentId) → Step 3(`nl2SqlToolCallback` 生成 SQL) → Step 4(`executeSqlToolCallback` 执行 SQL 拿数据) → Step 5(数据明细段) → Step 6(MRTF 分析,若需) → Step 7(自检)。**Step 2-4 三个工具各调用 1 次,串行不并行**。

### Step 1:用户 query 预处理(LLM 内化,不输出 JSON)

把原始用户问句**就地清洗成一句完整、可直接作为 NL2SQL 自然语言入参 (`naturalQuery`) 的中文 query 字符串**。不再产出 `market_type` / `date_range` 等结构化字段(NL2SQL 智能体在生成 SQL 阶段自行解析时间和指标维度)。

清洗规则(详细见 `references/tool-routing.md`):

1. **指标别名翻译** — 把口语 / 别名映射到行业基准名:
   - `日韩基准 / Japan Korea Marker` → `JKM`
   - `欧洲基准 / 荷兰 TTF` → `TTF`
   - `美国天然气基准 / 亨利港` → `HH`(等同 Henry Hub)
   - `北海布伦特 / 布油` → `Brent`
   - `美国原油 / 西德州轻质` → `WTI`
2. **时间范围补全** — 用户用相对表达时,补成绝对 / 具名区间:
   - "近一月 / 过去一个月" → "过去一个月"
   - "今年以来" → "2026 年 1 月至今"
   - "上周 / 近一周" → "过去一周"
   - 未提到时间 → **不补**(让 NL2SQL 智能体默认取最新)
3. **歧义消除** — `天然气价格`未指定基准 → 沿用上下文最近基准;`价差`必须保留对比双方完整名称(如 `JKM 与 TTF 价差`,非 `亚欧价差`)
4. **保留原意,禁加约束** — 不擅自加 "≤ 5 条" / "仅工业用气" 等用户未提及的过滤;不擅自把"走势如何"改成"上涨原因"

示例:
- `"近一月 JKM 怎么走?"` → `"过去一个月 JKM 价格走势"`
- `"日韩基准 vs 欧洲基准 价差"` → `"JKM 与 TTF 价差走势"`
- `"2024 全球出口 LNG 排名"` → `"2024 年全球 LNG 出口量排名"`

### Step 2:发现 NL2SQL 智能体 ID(`listAgentsToolCallback`)

调用 `listAgentsToolCallback` 1 次,从已发布智能体里挑出最契合 query 主题的那个,抽取 `id` 字段作为后续 Step 3 / Step 4 的 `agentId`。

**调用参数**:
```json
{
  "agentListRequest": {
    "keyword": "<根据 query 主题选>",
    "status": "published"
  }
}
```

**`keyword` 选择策略**(按 query 域映射):
- 国际油气价格 / Brent / WTI / JKM / TTF / HH → `"油气"`
- LNG 现货 / 全球 LNG 进出口 → `"LNG"`(若无匹配回退 `"油气"`)
- 全球天然气消费 → `"天然气"`(若无匹配回退 `"油气"`)
- 跨域(如 Brent 油价 + 全球 LNG 贸易)→ 取主问题的关键词

**匹配规则**:
- 返回数组非空 → 取 `description` / `category` / `tags` 与 query 域最贴合的那个;并列时取最新 `updateTime`
- 返回 `[]`(空) → 退化为 `keyword=""` 再搜一次;仍为空则中止并输出"暂无可用智能体,数据查询不可用"
- **🚨 严禁**:LLM 凭空编造 `agentId`(如 `"1"` / `"2"`),必须从本次 `listAgents` 实际返回中读取

抽出 `id` 后,**所在 turn 内复用**(同一问题不要重复发现)。

### Step 3:生成 SQL(`nl2SqlToolCallback`)

调用 `nl2SqlToolCallback` 1 次,把 Step 2 拿到的 `agentId` + Step 1 清洗后的 query 传入,拿到 SQL 字符串。

**调用参数**:
```json
{
  "nl2SqlRequest": {
    "agentId": "<Step 2 抽取的 id,字符串形态>",
    "naturalQuery": "<Step 1 清洗后的 query>"
  }
}
```

**🚨 硬约束**:
- 该 SQL **仅作为 Step 4 的输入**,**严禁向用户回显**(即使在数据明细段或 MRTF 段)
- 若返回 SQL 包含明显错误(如空字符串 / `SELECT *` 无 WHERE / 引用不存在表名) → 中止 Step 4,输出"SQL 生成异常,请缩窄 query 范围或换种表述"
- 不要修改 SQL 字符串(LLM 不做 SQL 重写)

### Step 4:执行 SQL(`executeSqlToolCallback`)

调用 `executeSqlToolCallback` 1 次,传入同一 `agentId` + Step 3 SQL,拿回行数据。

**调用参数**:
```json
{
  "executeSqlRequest": {
    "agentId": "<同 Step 3>",
    "sql": "<Step 3 返回的 SQL 字符串>"
  }
}
```

**返回处理**:
- 行数 ≥ 3 → 进入 Step 5 用表格呈现
- 行数 ≤ 2 → 进入 Step 5 用自然语言句呈现
- 行数 = 0 → "未检索到对应数据,请调整时间/基准范围",**禁编造行**填充
- 工具报错 → "数据执行异常,可稍后重试"

### Step 5:数据明细段输出(retriever 风格)

**S0 硬约束:数据原样回显零容忍**
- 你**只能**输出 Step 4 `executeSqlToolCallback` 实际返回的具体日期、价格、数量数值
- **强制原样回显**:Markdown 表格的每一行,必须**严格复制**工具返回的字段值
- **禁编造未来日期**:若执行结果最新日期是 `2026-04-14`,不准在表格里输出 `2026-04-15` 之后任何日期
- **禁编造价格**:若返回 JKM 价格 `12.586`,不准改写成 `16.39`

**禁自行聚合**:SQL 已经做完所需的过滤 / 排序 / 聚合(SUM / AVG / GROUP BY 由 NL2SQL 智能体生成),**严禁 LLM 再对返回行做算术汇总**(LLM 算术常幻觉,如把真实合计 192 算成 285)。如需聚合视图但 SQL 未给,直接呈现原始行,不要补算。

**输出格式**:
- ≥ 3 行结构化数据:GFM 标准 markdown 表格(表头中文 + `|---|---|` 分隔行)
- ≤ 2 行单点数据:自然语言段落(如 `当前 Brent 价格 82.15 美元/桶,2026-04-23,据国际天然气价格数据`)
- 末尾追加「据 XX 数据,共 N 条记录,呈现最近 K 条」
- 数值保留原始精度,**禁四舍五入**
- 数据点 > 5 时仅呈现最近 5 条

**禁止**:
- 暴露 SQL 字符串 / 表名 / `listAgents*` / `nl2Sql*` / `executeSql*` 工具名 / `mcp_*` / `agentId` 等内部标识
- 输出累计涨跌幅 / 趋势结论(那是 Step 6 分析段的工作)
- HTML `<table>` / 伪表格 / `#` 标题 / ` ``` ` 代码块

### Step 6:MRTF 分析段(analyst 风格)

**触发条件**:用户问题需要研判(如「走势如何」「趋势分析」「为什么」「研判」「分析」等)。
**跳过条件**:用户只要数据明细(如「给我近一周 JKM 数据」「列一下 Brent 价格」),不写 MRTF。

#### Step 6.1:联网搜索

调用本平台内置 `web_search` 工具,**仅 1 个核心关键词**(总结 query 主体后直接搜 1 次,不再拆 ≥ 3 关键词)获取最新市场资讯(覆盖 M / R 维度)。

#### Step 6.2:撰写 MRTF 5 块结构

按 `shared/references/mrtf-framework.md` 模板:

```
### 一、宏观面 (M-Macro)
(100-250 字。全球 GDP / 通胀 / 汇率(USD/RMB/EUR) / 利率 / 地缘 / 季节性 — 主要联网搜索;每处机构引用 markdown link `据 [机构](URL)`)

### 二、政策面 (R-Regulation)
(100-250 字。OPEC+ / 双碳目标 / 国家能源局 / 发改委 / IEA / 关税配额 — 主要联网搜索)

### 三、技术面 (T-Trend)
(100-250 字。价格走势方向 / 波动 / 支撑压力 / 价差结构(JKM-TTF / Brent-WTI 等) — 本平台数据;**至少 1 个 Markdown 表格,数据行 ≥ 3**)

[T 章节第一表格:严格复制 Step 5 数据明细前 N 行,N ≤ 10]

### 四、基本面 (F-Fundamental)
(100-250 字。供需 / 库存 / 产量 / 贸易流(进出口) / 消费结构 / 终端用户 — 本平台 + 联网补充;可用 Markdown 表格)

**综合研判**:(150-300 字。方向性结论 + 风险机遇各 1-2 条 + 操作建议(交易员/规划/合规审计))
```

#### Step 6.3:强制约束(S0-S4 + 数据标识)

- **S0 数值幻觉零容忍**:T 表格严格复制 Step 5 数据明细,禁编造未来日期/价格
- **S1**:5 个 H3 标题中文数字编号(`一/二/三/四`),禁阿拉伯/罗马/英文
- **S2**:综合研判段 150-300 字 ±20%,三要素齐全
- **S3**:T/F 章节至少 1 个 markdown 表格,数据行 ≥ 3(双边对比 ≥ 2)
- **S4**:联网关闭场景(candidate_pool 为空)M/R 段标注「本段联网资讯未启用」且 ≥ 50 字,T+F 合计 ≥ 400 字
- **`**综合研判**` 前一字符必为 `\n` 或文档第 0 字符**
- **`[数据]` 标识硬约束**:每次引用本平台数据具体数值必须在末尾追加 `[数据]`(见 `shared/references/synthesis-template.md`)
- **机构引用真实性**:仅当联网工具实际返回某机构内容时,才能用 `据 [机构](URL)`;无真实工具返回 → 「据本平台数据」

### Step 7:输出前自检

按 `shared/references/output-self-check.md` 逐项核对。

## 四、关键反面教材(必读)

**实测 EVAL-T1-01(2026-05-07)**:用户问「近一个月 JKM 价格走势」,`executeSqlToolCallback` 实际返回 `2026-04-08 ~ 2026-04-14` 共 5 行(JKM 12.x 美元/MMBtu),LLM 错误输出:

```
| 2026-05-07 | JKM | 16.39 | -1.59% |   ← ❌ 编造未来日期 + 假价格
| 2026-05-06 | JKM | 16.13 | -1.95% |   ← ❌ 数据库无此日期
| 2026-05-05 | JKM | 15.81 | +3.74% |   ← ❌ 价格凭空捏造
```

→ **严重幻觉 → S0 整段重写**。正确做法:严格复制 `executeSqlToolCallback` 返回行中的 04-08 ~ 04-14 数据。

**额外反例**:
- ❌ 跳过 Step 2 直接用 `agentId="2"` 调用 NL2SQL — agentId 必须从 `listAgentsToolCallback` 实际返回中读取,凭空写死会在 agent 重新部署后失效
- ❌ 在数据明细段输出"执行的 SQL 是 `SELECT * FROM ...`" — SQL 字符串永远不向用户展示
- ❌ Step 4 返回 0 行后编造 5 行假数据补位

## 五、详细资源

- `references/tool-routing.md` — NL2SQL 链路 3 工具的 query 清洗 / agentId 发现 / SQL 处理规范
- `references/mrtf-examples-international.md` — 国际域 MRTF 正反例(联网开/联网关)

## 六、硬约束摘要(贴墙)

1. **数据链路 3 工具串行调用,各 1 次**:`listAgentsToolCallback` → `nl2SqlToolCallback` → `executeSqlToolCallback`;MRTF 阶段额外 1 次 `web_search`
2. **`agentId` 必须来自 Step 2 实际返回**,严禁 LLM 凭空编造
3. **SQL 字符串永不回显**(数据明细段 / MRTF 段都不准出现)
4. **数据段 S0**:严格复制 `executeSqlToolCallback` 返回行,禁编造日期/数值
5. **分析段 S1**:5 H3 中文数字编号
6. **分析段 S2**:综合研判 150-300 字,三要素齐全
7. **分析段 S3**:T/F 表格 ≥ 3 行
8. **分析段 S4**:联网关闭场景 M/R ≥ 50 字 + T/F 合计 ≥ 400 字
9. **`**综合研判**` 前必为 `\n`**
10. **本平台数据末尾 `[数据]` 标识**
11. **首句即结论 + ≥ 3 处具体数值**
12. **禁:SQL / 表名 / `listAgents*` / `nl2Sql*` / `executeSql*` / `agentId` / `mcp_*` / `team1` / `sub-1-*` / `/mnt/skills/...` 路径 / `read_file(...)` 调用语法 等内部组件名**
