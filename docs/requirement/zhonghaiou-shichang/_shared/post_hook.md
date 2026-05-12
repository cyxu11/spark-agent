---
name: output_formatter
description: 后置格式化钩子，对所有 Agent 输出进行文本规范化，确保 Markdown 在前端正确渲染
version: 1.0.0
enabled: true
# 规则执行顺序锚定 — judgment_section_independent (#11) 必须在 bold_newline (#6) 之后；
# bold_newline 处理"前面已有 \n"的场景（升级 \n 为 \n\n），
# judgment_section_independent 处理"前面是任意非换行字符"的场景（补 \n\n 独立成段），二者互补。
# 后续维护者勿调整顺序，否则可能导致重复补 \n 触发段落间距异常。
#
# R2.13 兼容性已核查（2026-04-28 16:00）：11 条规则与 sub-X-2 MRTF 输出形态（H3 5 块 + Markdown 表格 + 综合研判末段）零冲突，
# 0 条需扩展正则、0 条需禁用、0 条需新增；详见文件末尾 §R2.13 兼容性核对小节。
rules:
  - id: heading_space
    description: "修复标题缺少空格：####标题 → #### 标题"
    pattern: "(#{1,6})([^\\s#\\n])"
    replacement: "\\1 \\2"
    flags: "gm"
  - id: heading_newline_before
    description: "确保标题前有空行"
    pattern: "([^\\n])(\\n#{1,6}\\s)"
    replacement: "\\1\\n\\n\\2"
    flags: "g"
  - id: heading_inline_break
    description: "标题与前文同行无换行：句号。#### 趋势 → 强制插入空行让 marked 解析（修复 2026-04-25 用户截图问题）"
    pattern: "([^\\n])(#{1,6}\\s)"
    replacement: "\\1\\n\\n\\2"
    flags: "g"
  - id: em_dash_bullet
    description: "将行首破折号/em-dash/en-dash转为标准列表符"
    pattern: "^[–—－]\\s+"
    replacement: "- "
    flags: "gm"
  - id: chinese_ordered_list
    description: "将中文编号列表转为标准 Markdown 有序列表：1、2、→ 1. 2."
    pattern: "^(\\d+)[、。]\\s*"
    replacement: "\\1. "
    flags: "gm"
  # R2.13 兼容性已核查：本规则对 sub-X-2 MRTF 末段 **综合研判**: 加粗节名同样适用，
  # 5 块 MRTF 输出末段无需额外正则；正则 (\\n\\*\\*[^*]+\\*\\*[：:]) 通用匹配所有 **粗体**: 节名。
  - id: bold_newline
    description: "确保粗体标题前后有空行（如 **建议一：xxx**、**综合研判**:） — R2.13 兼容"
    pattern: "([^\\n])(\\n\\*\\*[^*]+\\*\\*[：:])"
    replacement: "\\1\\n\\n\\2"
    flags: "g"
  - id: table_placeholder_row
    description: "移除 LLM 占位符表格行：每格仅含 em-dash/省略号/空格或为空，保留合法 --- 分隔行"
    pattern: "^\\|((?:[ \\t]*[─—–－…][─—–－… \\t]*|[ \\t]*)\\|)+[ \\t]*$"
    replacement: ""
    flags: "gm"
  - id: table_blank_line
    description: "清除表格行之间因删除占位符行遗留的空行"
    pattern: "\\n[ \\t]*\\n([ \\t]*\\|)"
    replacement: "\\n\\1"
    flags: "g"
  - id: chinese_ordinal_list_1
    description: "将行首中文一~十编号（一、二、…十、）转为阿拉伯数字有序列表"
    pattern: "^[一二三四五六七八九十][、]\\s*"
    replacement: "- "
    flags: "gm"
  - id: chinese_paren_ordinal
    description: "将行首括号中文编号（（一）（二）…）转为 Markdown 列表项"
    pattern: "^（[一二三四五六七八九十]）\\s*"
    replacement: "- "
    flags: "gm"
  - id: trailing_whitespace
    description: "清理行尾多余空格"
    pattern: "[ \\t]+$"
    replacement: ""
    flags: "gm"
  # R2.13 兼容性已核查：本规则正则 (市场|经营|换算|综合)研判 已含「综合」，
  # 4 个 sub-X-2 末段「**综合研判**:」自动适配，无需扩展正则；
  # 同时兜住 R2.13 MRTF 5 块输出中末段「综合研判」加粗节名前可能漏前置 \\n 的偶发场景。
  - id: judgment_section_independent
    description: "**(市场|经营|换算|综合)研判** 前面紧贴非换行字符时,强制 \\n\\n 独立成段(兜住 LLM 偶发漏前置空行 — R2.9 patch3,与 bold_newline #6 互补:后者要求加粗前已有 \\n,本条覆盖前面是任意非换行字符的情况;R2.13 兼容 sub-X-2 MRTF 末段「综合研判」)"
    pattern: "([^\\n])[ \\t]*(\\*\\*(?:市场|经营|换算|综合)研判[:：]?\\*\\*[ \\t]*[:：]?)"
    replacement: "\\1\n\n\\2"
    flags: "g"
  # 检索员→分析师串行 + system_prompt 注入模式下,sub-X-2 引用「## 检索员数据明细」时使用 `[数据]` 标识,
  # 引用联网 candidate_pool 时使用 `[来源]` 标识。本规则把 LLM 偶发产出的非标变体规范化为方括号标准形式,
  # 便于前端 marked 渲染后通过 CSS 给两类标识独立配色(本平台数据 vs 联网来源)。
  - id: data_marker_normalize
    description: "把分析师正文中 LLM 偶发产出的【数据】/(数据)/（数据） 规范化为 [数据] 标准形式(标识本平台数据来源,串行注入「## 检索员数据明细」段落)"
    pattern: "[【(（]\\s*数据\\s*[】)）]"
    replacement: "[数据]"
    flags: "g"
  - id: source_marker_normalize
    description: "把分析师正文中 LLM 偶发产出的【来源】/(来源)/（来源） 规范化为 [来源] 标准形式(标识联网搜索来源,与 [数据] 形成对照,前端可通过 CSS 区分配色)"
    pattern: "[【(（]\\s*来源\\s*[】)）]"
    replacement: "[来源]"
    flags: "g"
---

# 输出格式后置处理钩子

本钩子在每个子 Agent 完成输出后，对完整文本执行正则规范化，确保 Markdown 语法正确，避免前端渲染乱码。

## 规则说明

| 规则 ID | 问题 | 修复 |
|---------|------|------|
| heading_space | `####标题` | `#### 标题` |
| heading_newline_before | `文字\n####` | `文字\n\n####` |
| em_dash_bullet | `– 条目` | `- 条目` |
| chinese_ordered_list | `1、条目` | `1. 条目` |
| bold_newline | `文字\n**粗体：` | `文字\n\n**粗体：` |
| table_placeholder_row | `\| --- \|` 或 `\| ——— \|` 占位符行 | 删除该行 |
| table_blank_line | 删除行后残留空行破坏表格 | 收拢为单换行 |
| chinese_ordinal_list_1 | `一、条目` | `- 条目` |
| chinese_paren_ordinal | `（一）条目` | `- 条目` |
| trailing_whitespace | `文字   ` | `文字` |
| judgment_section_independent | `文字 **市场研判**:` | `文字\n\n**市场研判**:` |
| data_marker_normalize | `【数据】` / `(数据)` / `（数据）` | `[数据]`(本平台数据标识,标记检索员数据明细引用) |
| source_marker_normalize | `【来源】` / `(来源)` / `（来源）` | `[来源]`(联网来源标识,与 `[数据]` 对照,前端可独立配色) |

## 扩展说明

如需新增规则，在 frontmatter 的 `rules` 列表中添加新条目即可，无需修改代码。

---

## §R2.13 兼容性核对小节(2026-04-28 16:00)

**核心结论**:11 条规则与 R2.13 sub-X-2 MRTF 输出形态(H3 5 块 + Markdown 表格 + 综合研判末段)**零冲突,0 条需扩展正则,0 条需禁用,0 条需新增**。仅 #6 / #11 加注释提示 R2.13 兼容性。

| 规则编号 | 规则 ID | 对 R2.13 sub-X-2 输出影响 | 处理方案 |
|---------|--------|-----------------------|---------|
| 1 | heading_space | `### 一、宏观面` 已含空格,正向兼容;偶发缺空格自动修复 | 不动 |
| 2 | heading_newline_before | H3 块前自然需要空行,正向兼容 | 不动 |
| 3 | heading_inline_break | H3 块独立成段,兜住 LLM 偶发把 H3 紧贴上文 | 不动 |
| 4 | em_dash_bullet | R2.13 不主动用 em-dash,正向修复偶发 | 不动 |
| 5 | chinese_ordered_list | 正则 `^\d+[、。]` 仅匹配阿拉伯数字,**不会误匹配** `### 一、`(`一` 是中文字符) | 不动 |
| 6 | bold_newline | 对 `**综合研判**:` 加粗节名同样适用,正向兼容 | 加注释 ✓ |
| 7 | table_placeholder_row | R2.13 sub-X-2 允许标准 GFM 表格(数据行 ≥ 3),占位符行清理仍生效 | 不动 |
| 8 | table_blank_line | R2.13 表格仍需此规则保证 GFM 渲染 | 不动 |
| 9 | chinese_ordinal_list_1 | 正则 `^[一二三四五六七八九十][、]\\s*` 行首是 `#`(`### 一、`)→ **不匹配,无误伤**;若 LLM 偶发漏 `### ` 由 sub-X-2 skill.md 自检兜底 | 不动,LLM 端兜底 |
| 10 | chinese_paren_ordinal | R2.13 用 `### 一、` 不用 `（一）`,无影响 | 不动 |
| 11 | judgment_section_independent | 正则 `(市场\|经营\|换算\|综合)研判` 已含「综合」,自动适配 | 加注释 ✓ |

**R2.13 输出形态升级对 post_hook 11 条规则零冲突 + 正向收益**(#2/#3/#6/#11 主动兜底 LLM 偶发漏空行/漏 H3/漏前置 `\n` 场景)。
支持的 `flags`: `g`（全局）、`m`（多行）、`gm`（全局+多行）。
