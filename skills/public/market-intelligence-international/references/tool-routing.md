# 国际域 NL2SQL 链路调用指南

> 国际域数据查询底层走 **3 工具串行链路**:agent 发现 → NL2SQL 生成 → SQL 执行。本文聚焦每个环节的入参 / 出参 / 异常处理规范。

## 一、工具链概览

| 顺序 | 工具名 | 入参 | 返回 | 单次调用 |
|------|-------|-----|------|---------|
| Step 2 | `listAgentsToolCallback` | `{agentListRequest: {keyword, status}}` | 智能体数组(含 `id` / `name` / `description` / `category` / `tags`) | 每问题 1 次 |
| Step 3 | `nl2SqlToolCallback` | `{nl2SqlRequest: {agentId, naturalQuery}}` | SQL 字符串 | 每问题 1 次 |
| Step 4 | `executeSqlToolCallback` | `{executeSqlRequest: {agentId, sql}}` | 行数据(JSON 数组) | 每问题 1 次 |

辅助工具:`web_search`(本平台内置联网搜索)仅在 Step 6.1 MRTF 分析阶段调用 1 次,用于 M / R 维度。

## 二、Step 1 query 清洗规则

### 2.1 指标别名翻译

| 用户口语 / 别名 | 标准名 |
|----------------|-------|
| 日韩基准 / Japan Korea Marker / 日韩 LNG | JKM |
| 欧洲基准 / 荷兰 TTF / 欧洲气价 | TTF |
| 美国天然气基准 / 亨利港 / Henry Hub | HH |
| 北海布伦特 / 布油 | Brent |
| 美国原油 / 西德州轻质 / 西得克萨斯 | WTI |
| 日本 LNG / 东北亚现货 | 东北亚 LNG 现货 |
| 欧洲 LNG / 西北欧现货 | 欧洲 LNG 现货 |
| 美湾 LNG / 北美现货 | 北美 LNG 现货 |
| 全球进口 / 各国进口 LNG | 全球 LNG 进口量 |
| 全球出口 / 出口国排名 | 全球 LNG 出口量 |
| 区域天然气消费 / 各地天然气用量 | 全球天然气消费(分区域) |

### 2.2 时间范围补全

| 用户表达 | 清洗后 |
|---------|-------|
| 近一月 / 过去一个月 / 最近一个月 | 过去一个月 |
| 近一周 / 上周 / 最近一周 | 过去一周 |
| 今年以来 / 年初至今 / 2026 年以来 | 2026 年 1 月至今 |
| 去年 / 2025 年全年 | 2025 年 1 月至 12 月 |
| 最近 / 当前 / 现在 | (不补,让 NL2SQL 智能体默认取最新) |
| 未提及时间 | (不补) |

### 2.3 歧义消除

- "天然气价格"未指明基准 → 沿用对话上下文最近基准(若无,默认 JKM)
- "价差" / "差价" → 必须保留**对比双方完整名称**,如 `JKM 与 TTF 价差`(不写"亚欧价差")
- "走势" / "趋势" → 保留原意,**不**改写成"上涨原因 / 下跌驱动"
- "排名" / "TOP N" → 保留具体数字 N

### 2.4 清洗示例

| 原始用户问句 | 清洗后 query |
|-------------|------------|
| 近一月 JKM 怎么走? | 过去一个月 JKM 价格走势 |
| 日韩基准 vs 欧洲基准 价差 | JKM 与 TTF 价差走势 |
| 2024 全球出口 LNG 排名 | 2024 年全球 LNG 出口量排名 |
| 布油最新报价 | Brent 当前价格 |
| 亚太天然气消费占比 | 亚太地区天然气消费量 |

## 三、Step 2 智能体发现规范

### 3.1 keyword 选择策略

按 query 主题域选关键词:

| Query 主题 | keyword | 备注 |
|-----------|--------|------|
| 国际油气价格 / Brent / WTI / JKM / TTF / HH | `"油气"` | 当前主用智能体类别 |
| LNG 现货 / 全球 LNG 进出口 | `"LNG"` | 若无匹配回退 `"油气"` |
| 全球天然气消费 | `"天然气"` | 若无匹配回退 `"油气"` |
| 跨域(如 Brent + 全球 LNG 贸易) | 取主问题关键词 | 不要拆 2 次调用 |

### 3.2 调用模板

```json
{
  "agentListRequest": {
    "keyword": "油气",
    "status": "published"
  }
}
```

### 3.3 匹配 / 抽取规则

- 返回数组非空 → 取 `description` / `category` / `tags` 与 query 域最贴合的那个;并列时取最新 `updateTime`
- 抽取的 **`id` 字段(字符串形态)即后续 `agentId`**
- 返回 `[]` → 退化为 `keyword=""` 再搜一次;仍为空则中止,输出"暂无可用智能体,数据查询不可用"

### 3.4 禁止动作

- ❌ LLM 凭空写 `agentId="1"` / `"2"` 等固定值(智能体重新部署后 ID 会变)
- ❌ 同一问题多次调 `listAgentsToolCallback`(发现 1 次后 turn 内复用)
- ❌ 用 `status="draft"` 拉草稿智能体(默认 `"published"`,生产慎用 draft)

## 四、Step 3 NL2SQL 调用规范

### 4.1 调用模板

```json
{
  "nl2SqlRequest": {
    "agentId": "<Step 2 抽出的 id>",
    "naturalQuery": "<Step 1 清洗后的 query>"
  }
}
```

### 4.2 返回处理

- 返回纯 SQL 字符串(可能含 SELECT / FROM / WHERE 等关键字)→ 直接作为 Step 4 入参,**不改写**
- 返回空字符串 / 明显错误(`SELECT *` 无 WHERE / 引用不存在表名) → 中止 Step 4,输出"SQL 生成异常,请缩窄 query 范围或换种表述"

### 4.3 安全约束

- **🚨 SQL 字符串永不向用户展示**:数据明细段、MRTF 段都不准出现 SQL 文本
- **🚨 不要把 SQL 解析后改写**:LLM 不充当 SQL 优化器,原样透传

## 五、Step 4 SQL 执行规范

### 5.1 调用模板

```json
{
  "executeSqlRequest": {
    "agentId": "<同 Step 3>",
    "sql": "<Step 3 返回的 SQL 字符串>"
  }
}
```

### 5.2 返回处理

- 返回 JSON 行数组(每行字段名由 SQL 列名决定)→ 进入 Step 5 数据明细段
- 行数 ≥ 3 → markdown 表格呈现
- 行数 ≤ 2 → 自然语言句呈现
- 行数 = 0 → "未检索到对应数据,请调整时间/基准范围",**禁编造行**
- 执行报错 → "数据执行异常,可稍后重试",**禁回退到上次结果**

### 5.3 禁自行聚合(LLM 算术幻觉防护)

SQL 已经决定是否聚合(SUM / AVG / GROUP BY 由 NL2SQL 智能体生成):

- ✅ 如果返回行已经是聚合结果(单行汇总值) → 直接呈现
- ✅ 如果返回行是明细行 → 直接呈现明细,不补汇总
- ❌ **严禁**自行对返回行做 SUM / AVG / 排名(LLM 算术常幻觉,如把真实合计 192 算成 285)

## 六、判断算法(简化版)

```
1. 接收用户原句 → §2 清洗为 naturalQuery
2. listAgentsToolCallback(keyword=按主题选, status="published")
   ├─ 非空 → 取最契合的 id → 缓存为 agentId
   └─ 空 → 回退 keyword="" 再搜
           ├─ 非空 → 取首项 id
           └─ 空 → 中止,输出"暂无可用智能体"
3. nl2SqlToolCallback(agentId, naturalQuery) → 拿到 SQL
   ├─ 正常 SQL → 继续
   └─ 空/异常 → 中止,输出"SQL 生成异常"
4. executeSqlToolCallback(agentId, sql) → 拿到行数据
   ├─ 行数 > 0 → Step 5 数据明细段
   ├─ 行数 = 0 → "未检索到对应数据"
   └─ 异常 → "数据执行异常"
5. 若用户问题需研判 → Step 6 MRTF(web_search 调 1 次)
```
