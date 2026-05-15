---
name: market-intelligence-domestic
description: 国内能源市场态势深度分析 — 国内 LNG 挂牌价(14 区域)、全国天然气消费量(分气态/液态/管道气/国产气 + 区域)、消费结构(工业/发电/居民/化工)、区域消费(分省)的查询与 MRTF 四维研判。底层走 NL2SQL 链路(智能体发现 → SQL 生成 → SQL 执行)。触发场景:用户问"近一周国内 LNG 挂牌价"、"华东华南价差"、"全国天然气消费"、"国内消费结构变化"、"区域消费排名"等。输出含数据明细段 + MRTF 5 块分析段(M 宏观/R 政策/T 技术/F 基本面 + 综合研判)。
allowed-tools:
  - listAgentsToolCallback
  - nl2SqlToolCallback
  - executeSqlToolCallback
  - web_search
---

# 国内能源市场态势分析

> 用户画像:战略规划部门(看 F 基本面)/ 市场分析师(看 M+T+F)/ 央企合规审计(看 R 政策面)/ 政府关系(看 R 政策面)/ 销售部门(看 T 技术面)

## 一、何时使用本 skill

✅ 触发场景:
- 国内 LNG 挂牌价(14 区域日度)/ 区域价差 / 销售单位价格
- 全国天然气月度消费量(气态/液态/管道气/国产气 + 区域)
- 国内天然气消费结构(工业/发电/居民/化工 占比)
- 国内区域消费(分省份,亿立方米)
- 国内 LNG 与 JKM 价格传导

❌ 不适用 → 改用其他 skill:
- 国际天然气价格(JKM/TTF/HH)/ 全球 LNG 贸易 → `market-intelligence-international`
- 中海油 LNG 进口长协 / 销售毛利 / 接收站罐存 / 资源池价格 → `market-intelligence-company`
- 价格换算(JKM ↔ 元/吨) → `market-intelligence-converter`

## 二、共享资源(必先阅读)

```
read_file("/mnt/skills/public/market-intelligence-shared/references/output-format-rules.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/mrtf-framework.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/synthesis-template.md")
read_file("/mnt/skills/public/market-intelligence-shared/references/output-self-check.md")
```

## 三、工作流(严格顺序)

> **数据链路总览**:Step 1(query 清洗) → Step 2(`listAgentsToolCallback` 发现 agentId) → Step 3(`nl2SqlToolCallback` 生成 SQL) → Step 4(`executeSqlToolCallback` 执行 SQL 拿数据) → Step 5(数据明细段) → Step 6(MRTF 分析,若需) → Step 7(自检)。**Step 2-4 三个工具各调用 1 次,串行不并行**。

### Step 1:用户 query 预处理(LLM 内化,不输出 JSON)

把原始用户问句**就地清洗成一句完整、可直接作为 NL2SQL 自然语言入参 (`naturalQuery`) 的中文 query 字符串**。

清洗规则(详细见 `references/tool-routing.md`):

1. **🔴 关键区分:`地理区域` vs `销售/运营单位`**(沿袭 R2.14-Patch2 T2-03 反例)

   | 用户提到 | 应判定为 | 清洗示例 |
   |---------|---------|---------|
   | `华东` / `华南` / `江苏` / `上海` / `北京` 等地理名 | **地理区域** | "华东 LNG 挂牌价" → 保留"华东"作为地理筛选 |
   | `中海油` / `中石油` / `中石化` / `昆仑能源` / `申能` / `新奥` 等集团/公司名 | **销售/运营单位** | "中海油接收站挂牌价" → 清洗为"中海油销售单位 LNG 挂牌价",**严禁**改成"全国挂牌价"或"中海油地区挂牌价" |
   | "接收站 / 销售单位 / 集团 / 公司"类指代 | **销售/运营单位** | "申能 LNG 价格" → "申能销售单位 LNG 价格" |

2. **时间范围补全**:
   - "近一周" → "过去一周"
   - "今年以来" → "2026 年 1 月至今"
   - "去年" → "2025 年全年"
   - 未提到时间 → 不补,让 NL2SQL 智能体默认取最新

3. **气态类型识别**:`气态` / `液态` / `管道气` / `国产气` 保留原词(消费量场景的关键维度)

4. **消费领域识别**:`工业` / `发电` / `居民` / `化工`(消费结构场景的关键维度)

5. **保留原意,禁加约束**:不擅自加 "≤ 5 条" / "仅 LNG 不含管道气" 等用户未提及的过滤

示例:
- `"近一周国内 LNG 挂牌价"` → `"过去一周国内 LNG 挂牌价"`
- `"中海油接收站近期挂牌价"` → `"过去一周中海油销售单位 LNG 挂牌价"`(销售单位识别)
- `"华东华南价差"` → `"过去一周华东与华南 LNG 挂牌价价差"`
- `"2024 工业用气占比"` → `"2024 年工业用气消费占比"`

### Step 2:发现 NL2SQL 智能体 ID(`listAgentsToolCallback`)

调用 `listAgentsToolCallback` 1 次,挑出最契合 query 主题的智能体,抽取 `id` 作为 `agentId`。

**调用参数**:
```json
{
  "agentListRequest": {
    "keyword": "国内",
    "status": "published"
  }
}
```

**`keyword` 选择说明**:本 skill 固定用 `"国内"`,匹配未来 MCP 网关里以"国内"命名/描述/标签的智能体(如"国内天然气分析智能体"、"国内 LNG 智能体")。**如需改 keyword**:同时改本文 + `references/tool-routing.md § Step 2`。

**匹配规则**:
- 返回数组非空 → 取 `description` / `category` / `tags` 与 query 域最贴合的一项;并列时取最新 `updateTime`
- 返回 `[]` → 回退 `keyword=""` 再搜;仍为空中止,输出"暂无可用智能体,数据查询不可用"
- **🚨 严禁**:LLM 凭空编造 `agentId`,必须从本次 `listAgents` 实际返回中读取

抽出 `id` 后,**所在 turn 内复用**。

### Step 3:生成 SQL(`nl2SqlToolCallback`)

```json
{
  "nl2SqlRequest": {
    "agentId": "<Step 2 抽取的 id,字符串形态>",
    "naturalQuery": "<Step 1 清洗后的 query>"
  }
}
```

**🚨 硬约束**:
- 返回的 SQL **仅作为 Step 4 的输入**,**严禁向用户回显**(数据明细段 / MRTF 段都不允许)
- 若返回 SQL 异常(空字符串 / 缺 WHERE / 不存在表名) → 中止 Step 4,输出"SQL 生成异常,请缩窄 query 范围或换种表述"
- 不要修改 SQL 字符串

### Step 4:执行 SQL(`executeSqlToolCallback`)

```json
{
  "request": {
    "agentId": "<同 Step 3>",
    "sql": "<Step 3 返回的 SQL 字符串>"
  }
}
```

**返回处理**:
- 行数 ≥ 3 → 进入 Step 5 用表格呈现
- 行数 ≤ 2 → 进入 Step 5 用自然语言句呈现
- 行数 = 0 → "未检索到对应数据,请调整时间/区域/销售单位范围",**禁编造行**填充
- 工具报错 → "数据执行异常,可稍后重试"

### Step 5:数据明细段输出(retriever 风格)

**🚨 流程硬门控(Output-Gate)**
- Step 5 **必须作为完整独立段先于 Step 6 任何 MRTF 章节输出**(数据表格 + 末尾的"据 XX 数据,共 N 条"统计行)
- **严禁**省略 Step 5 直接进入"M-宏观面/R-政策面..."等 MRTF 章节
- **严禁**把 Step 5 数据表格合并 / 移动 / 改写到 Step 6 T-Trend 表格里 — T-Trend 是数据的**二次引用**用于分析语境,不能替代 Step 5
- 若用户只要数据明细(不要研判),Step 5 输出完即停止;若用户要研判,Step 5 + Step 6 都要有,顺序不可调换
- 工程检测点:回答首屏必须先看到表格 / 数据段,再看到"### 一、宏观面"等 H3 标题;否则视为 S0 违规重写

**S0 硬约束:数据原样回显零容忍**
- 你**只能**输出 Step 4 `executeSqlToolCallback` 实际返回的具体日期、价格、消费量、省份、销售单位值
- **强制原样回显**:Markdown 表格的每一行,必须**严格复制**工具返回的字段值
- **禁编造未来日期 / 未返回的省份 / 未返回的销售单位**:若执行结果最新日期是 `2026-04-14`,不准在表格里输出 `2026-04-15` 之后任何日期
- **禁编造价格 / 消费量数值**

**禁自行聚合**:SQL 已经决定是否聚合(SUM / AVG / GROUP BY 由 NL2SQL 智能体生成)。**严禁 LLM 再对返回行做算术汇总**(LLM 算术常幻觉,如把真实合计 192 算成 285)。如需聚合视图但 SQL 未给,直接呈现原始行,不要补算。

**输出格式**:
- ≥ 3 行结构化数据:GFM 标准 markdown 表格(表头中文 + `|---|---|` 分隔行)
- ≤ 2 行单点数据:自然语言段落(如 `2026-04-23 华东 LNG 挂牌价 4860 元/吨,据国内 LNG 挂牌价数据`)
- 末尾追加「据国内 LNG 挂牌价数据 / 据全国天然气消费数据,共 N 条记录,呈现最近 K 条」
- 数值保留原始精度,**禁四舍五入**
- 数据点 > 5 时仅呈现最近 5 条

**禁止**:
- 暴露 SQL 字符串 / 表名 / `listAgents*` / `nl2Sql*` / `executeSql*` 工具名 / `mcp_*` / `agentId` 等内部标识
- 输出累计涨跌幅 / 趋势结论(那是 Step 6 分析段的工作)
- HTML `<table>` / 伪表格 / `#` 标题 / ` ``` ` 代码块

### Step 6:MRTF 分析段(analyst 风格)

**触发条件**:用户问题需要研判(如「走势如何」「趋势分析」「为什么」「研判」「分析」等)。
**跳过条件**:用户只要数据明细(如「给我近一周 LNG 挂牌价」),不写 MRTF。

#### Step 6.1:联网搜索

调用本平台内置 `web_search` 工具,**仅 1 个核心关键词**(总结 query 主体后直接搜 1 次),获取国家能源局 / 发改委 / NDRC 政策与宏观资讯。

#### Step 6.2:MRTF 5 块(国内域)

```
### 一、宏观面 (M-Macro)
(100-250 字。国内 GDP / PPI / CPI / 汇率(USD/RMB)/ LPR / RRR / 工业景气 / 季节性 — 主要联网)

### 二、政策面 (R-Regulation)
(100-250 字。**国家能源局 / 发改委 / NDRC 政策**、保供季、价格管制、双碳目标、清洁能源替代、配气价改革 — 主要联网)

### 三、技术面 (T-Trend)
(100-250 字。国内 LNG 挂牌价走势 / 区域价差 / 季节性波动 / 与国际 JKM 的传导 — 本平台数据)

[T 章节第一表格:**对 Step 5 数据明细的二次引用**(N ≤ 10 行),用于支撑技术面分析语境;**不替代 Step 5 独立数据段** — Step 5 必须在本章之前已经独立输出]

### 四、基本面 (F-Fundamental)
(100-250 字。国内消费量 / 消费结构 / 区域分布 / 进口依存度 / 储气库填充)

| 终端结构 | 占比 | 同比变化 | 备注 |
| 至少 3 行 |

**综合研判**:(150-300 字。方向性结论 + 风险机遇 + 操作建议(规划/销售/合规审计))
```

#### Step 6.3:强制约束(S0-S4 + 数据标识)

- **S0 数值幻觉零容忍**:T 表格严格复制 Step 5 数据明细,禁编造未来日期 / 省份 / 价格 / 消费量
- **S1**:5 个 H3 标题中文数字编号(`一/二/三/四`),禁阿拉伯/罗马/英文
- **S2**:综合研判段 150-300 字 ±20%,三要素齐全
- **S3**:T/F 章节至少 1 个 markdown 表格,数据行 ≥ 3(双边对比 ≥ 2)
- **S4**:联网关闭场景(candidate_pool 为空)M/R 段标注「本段联网资讯未启用」且 ≥ 50 字,T+F 合计 ≥ 400 字
- **`**综合研判**` 前一字符必为 `\n` 或文档第 0 字符**
- **`[数据]` 标识硬约束**:每次引用本平台数据具体数值必须在末尾追加 `[数据]`
- **机构引用真实性**:仅当 `web_search` 实际返回某机构内容时,才能用 `据 [国家能源局](URL)`;无真实工具返回 → 「据本平台数据」

### Step 7:输出前自检

按 `shared/references/output-self-check.md` 逐项核对。

## 四、关键反面教材(必读)

**实测(2026-05-07)**:用户问「近一周国内 LNG 挂牌价」,`executeSqlToolCallback` 实际返回 `2026-04-08 ~ 2026-04-14` 数据,LLM 错误编造:
- `2026-05-XX` 等未来日期 ❌
- 不在 SQL 返回中的省份(如返回了华东/华南,LLM 又补出"四川"/"新疆") ❌
- 不在 SQL 返回中的销售单位(如返回了"中海油",LLM 又补出"中石油"/"申能") ❌

→ **严重幻觉 → S0 整段重写**。

**额外反例**:
- ❌ 跳过 Step 2 直接用 `agentId="2"` 调用 NL2SQL — agentId 必须从 `listAgentsToolCallback` 实际返回中读取
- ❌ 在数据明细段输出"执行的 SQL 是 `SELECT * FROM lng_listing ...`" — SQL 字符串永远不向用户展示
- ❌ Step 4 返回 0 行后编造 5 行假数据补位
- ❌ 把"中海油"识别成地理区域 → SQL 命中失败

## 五、详细资源

- `references/tool-routing.md` — NL2SQL 链路 3 工具的 query 清洗(含 region vs sales_unit) / agentId 发现 / SQL 处理规范
- `references/mrtf-examples-domestic.md` — 国内域 MRTF 正反例(联网开/联网关 + 区域价差场景)

## 六、硬约束摘要(贴墙)

1. **数据链路 3 工具串行调用,各 1 次**:`listAgentsToolCallback` → `nl2SqlToolCallback` → `executeSqlToolCallback`;MRTF 阶段额外 1 次 `web_search`
2. **Step 5 数据明细段必须独立成段输出在 MRTF 任何章节之前**;严禁合并到 Step 6 T-Trend 表格、严禁省略 Step 5 直接进 MRTF
3. **`agentId` 必须来自 Step 2 实际返回**,严禁 LLM 凭空编造
4. **SQL 字符串永不回显**(数据明细段 / MRTF 段都不允许)
5. **`地理区域` vs `销售/运营单位` 严格区分**(集团/公司名 → 销售单位,不是 region)
6. **数据段 S0**:严格复制 `executeSqlToolCallback` 返回行,禁编造日期 / 省份 / 销售单位 / 数值
7. **分析段 S1**:5 H3 中文数字编号
8. **分析段 S2**:综合研判 150-300 字,三要素齐全
9. **分析段 S3**:T/F 表格 ≥ 3 行
10. **分析段 S4**:联网关闭场景 M/R ≥ 50 字 + T/F 合计 ≥ 400 字
11. **`**综合研判**` 前必为 `\n`**
12. **本平台数据末尾 `[数据]` 标识**
13. **首句即结论 + ≥ 3 处具体数值**
14. **禁:SQL / 表名 / `listAgents*` / `nl2Sql*` / `executeSql*` / `agentId` / `mcp_*` / `team2` / `sub-2-*` / `/mnt/skills/...` 路径 / `read_file(...)` 调用语法 等内部组件名**
