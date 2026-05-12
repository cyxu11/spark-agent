# 输入解析指南(LLM 自己完成)

> 业务 skill 在执行 Step 1(数据检索)之前,需先从用户 query 提取结构化参数,作为后续工具调用的 filter 入参。**项目没有独立的 input_parser sub-agent**,这一步由当前 LLM 自己内化完成。

## 一、必出字段

| 字段 | 含义 | 取值方式 |
|------|------|---------|
| `current_date` | 当前系统日期 | 从系统提示 `<current_date>` 标签提取(已自动注入) |
| `data_source` | 数据源标识(隐含) | 从对话上下文「数据源:xxx」行或当前业务 skill 的工具路由表推断 |

## 二、可选字段(按 query 内容按需提取)

| 字段 | 含义 | 示例值 |
|------|------|-------|
| `query_intent` | 意图分类 | `趋势` / `对比` / `预测` / `异常` / `综合` |
| `market_type` | 市场/品种标识列表 | `["JKM", "TTF"]` / `["LNG", "管道气"]` |
| `date_range` | 查询时间范围 | `{start: "2025-01", end: "2026-03"}` |
| `region` | 地域范围列表(地理名词) | `["华东", "华南"]` |
| `sales_unit` | 销售/运营单位(集团/公司名) | `["中海油", "中石油"]` |
| `comparison_targets` | 对比目标列表 | `["JKM", "TTF"]` |
| `granularity` | 数据粒度 | `日` / `月` / `季度` / `年` |
| `metric_focus` | 关注指标列表 | `["价格", "涨跌幅", "毛利率"]` |
| `use_web_search` | 是否启用联网搜索 | `true` / `false` |
| `time_window_keyword` | 业务化时间表达 | `近 N 日` / `本月` / `同期 2025` / `保供季` |

## 三、缺字段处理策略

| 场景 | 处理方式 |
|------|---------|
| `date_range` 缺失 | 取最近 12 个月数据(下游按默认行为) |
| `market_type` 缺失 | 按数据源主品种查询 |
| `region` 缺失 | 按全部区域汇总 |
| `query_intent` 无法识别 | 默认 `趋势` |
| 所有字段均缺失 | 仅取必出字段(`current_date` + `data_source`) |

## 四、关键判断:`region` vs `sales_unit`

**易混淆场景**(R2.14-Patch2 T2-03 反例修复):

- **region(地理区域)**:华东 / 华南 / 华北 / 山东 / 河北 / 江苏 / 上海 / 北京 等地理名词
- **sales_unit(销售/运营单位)**:中海油 / 中石油 / 中石化 / 昆仑能源 / 申能 / 新奥 等公司/集团名

✅ 用户问"中海油 LNG 接收站近一周挂牌价" → `sales_unit=["中海油"]`(❌ `region=["全国"]`)
✅ 用户问"申能 LNG 价格" → `sales_unit=["申能"]`(❌ `region=["申能"]`)
✅ 用户问"华东和华南 LNG 价差" → `region=["华东","华南"]`

## 五、应用示例

### 示例 1(国际域)

**用户 query**:近期 JKM 价格走势如何
**提取**:`current_date=2026-05-11, query_intent=趋势, market_type=["JKM"], granularity=月, metric_focus=["价格","走势"]`

### 示例 2(国内域)

**用户 query**:对比华东和华南地区 LNG 挂牌价
**提取**:`current_date=2026-05-11, query_intent=对比, region=["华东","华南"], comparison_targets=["华东","华南"], metric_focus=["挂牌价","价差"]`

### 示例 3(公司经营域)

**用户 query**:中海油 2024 年澳大利亚 LNG 进口量
**提取**:`current_date=2026-05-11, sales_unit=["中海油"], date_range={start:"2024-01",end:"2024-12"}, source_country=["澳大利亚"], metric_focus=["进口量"]`

## 六、输出形态

**不需要**显式输出 JSON 给用户。这些结构化字段只在你内部记忆,直接用于:
1. 选择正确的 MCP 工具
2. 构造工具调用的 `filters` 参数
3. 决定输出粒度和时间窗口表达
