---
name: market-intelligence-shared
description: 市场态势模块共享资源库 — 输出禁令清单、MRTF 四维模板、输入解析指南、输出自检清单。不直接响应用户问题,由 market-intelligence-international / market-intelligence-domestic / market-intelligence-company / market-intelligence-converter 四个市场态势 skill 通过 read_file 引用。命中触发关键词「市场态势 / 国际天然气 / 国内 LNG / 公司经营数据 / LNG 价格换算」时,先由对应业务 skill 接管,再读取本资源。
---

# 市场态势模块共享资源库

> ⚠️ **本 skill 不直接响应用户问题**。当用户问到能源市场态势相关问题时,优先匹配以下 4 个业务 skill 之一:
> - `market-intelligence-international` — 国际能源市场(JKM/TTF/HH/Brent/WTI/全球 LNG 贸易)
> - `market-intelligence-domestic` — 国内能源市场(国内 LNG 挂牌价/全国天然气消费)
> - `market-intelligence-company` — 中海油气电集团公司经营数据
> - `market-intelligence-converter` — LNG 价格换算(JKM↔元/吨↔元/m³↔元/GJ)
>
> 业务 skill 在执行时会通过 `read_file` 加载本目录下的引用资源。

## 引用资源清单

| 文件 | 用途 |
|------|------|
| `references/output-format-rules.md` | 7 道输出禁令 + R2.13 MRTF 豁免 — 全市场 skill 共享的输出格式权威源 |
| `references/mrtf-framework.md` | MRTF 四维框架详细模板(M 宏观/R 政策/T 技术/F 基本面 + 综合研判) |
| `references/input-parsing-guide.md` | 从用户 query 中提取结构化字段(data_source / market_type / date_range 等)的指引 |
| `references/synthesis-template.md` | 末位 U 形提示 — 工具检索后撰写最终答案的硬约束(首句即结论、≥3 处数值、[数据] 标识) |
| `references/output-self-check.md` | 输出前 LLM 自检清单(将原 post_hook 13 条正则规则转化为自检项) |

## 加载约定

业务 skill 在 Step 0 / Step 1 中按需 `read_file` 这些资源,**不要**把它们的完整内容复制到自己的 SKILL.md 里 — 共享单一权威源。

## 业务 skill 互斥规则

4 个市场态势业务 skill 的触发场景互斥:

| 用户 query 关键词 | 命中 skill |
|------------------|-----------|
| JKM / TTF / HH / Brent / WTI / 国际天然气 / 国际 LNG / 全球 LNG 贸易 / 全球天然气消费 / 碳价 | `market-intelligence-international` |
| 国内 LNG 挂牌价 / 全国天然气消费 / 国内消费结构 / 区域消费(华东/华南/华北等) | `market-intelligence-domestic` |
| 中海油经营 / 气电集团 / LNG 长协 / LNG 进口量 / 接收站罐存 / 资源池价格 / 管道气价 / 销售毛利 / 市场份额 | `market-intelligence-company` |
| LNG 价格换算 / JKM 换算 / 元/吨 / 元/m³ / 元/GJ / 退税计算 / 长协斜率 / 热值 / MMBtu 单位 | `market-intelligence-converter` |

若 query 跨多个域(如「中海油近期 LNG 进口跟 JKM 价格的关系」),优先命中 **company**(公司经营优先)。
