## ADDED Requirements

### Requirement: Welcome section displays brand identity
新建会话首页（`isNewThread=true`）SHALL 展示一个欢迎区块，包含品牌图标、主标题、副标题，布局层次清晰。

#### Scenario: New thread shows welcome section
- **WHEN** 用户打开 `/workspace/chats/new`（`isNewThread=true`）
- **THEN** 页面中央区域显示品牌图标、主标题和副标题

#### Scenario: Welcome section hides after first message
- **WHEN** 用户发送第一条消息（`isNewThread` 变为 `false`）
- **THEN** 欢迎区块以淡出动画消失，正常对话布局接管

---

### Requirement: Capability shortcut cards
欢迎区块 SHALL 展示至少 4 个快捷功能卡片（如深度研究、代码生成、文档处理、图像分析），每个卡片有图标 + 标题。

#### Scenario: Clicking a capability card fills input
- **WHEN** 用户点击某个快捷功能卡片
- **THEN** 输入框自动填入对应的示例提示词，并聚焦输入框

#### Scenario: Capability cards are not shown in existing thread
- **WHEN** 用户处于已有对话页（`isNewThread=false`）
- **THEN** 快捷功能卡片不可见

---

### Requirement: Suggestion pills on new thread homepage
`isNewThread=true` 时 SHALL 在输入框周围展示可点击的示例提示词 Suggestion Pills（复用现有 `SuggestionList` 逻辑）。

#### Scenario: Suggestion pill click fills and submits
- **WHEN** 用户点击一个 Suggestion Pill
- **THEN** 对应提示词填入输入框，输入框聚焦（与现有 `handleSuggestionClick` 行为一致）

#### Scenario: Suggestion pills hidden after submission
- **WHEN** 用户提交第一条消息后
- **THEN** Suggestion Pills 不再显示

---

### Requirement: Responsive layout
首页欢迎区 SHALL 在桌面端（≥768px）和移动端（<768px）均正常展示，不出现内容溢出或截断。

#### Scenario: Desktop layout
- **WHEN** 视口宽度 ≥ 768px
- **THEN** 快捷卡片以 2 列或 4 列网格排列，标题与副标题字号符合设计稿规格

#### Scenario: Mobile layout
- **WHEN** 视口宽度 < 768px
- **THEN** 快捷卡片以 2 列或单列排列，整体区块可滚动，无横向溢出

---

### Requirement: i18n support for all new copy
所有新增文案（标题、副标题、卡片标题、卡片描述）SHALL 通过 i18n 系统提供，并同时覆盖 `zh-CN` 和 `en-US`。

#### Scenario: Chinese locale displays correct copy
- **WHEN** 用户语言为 `zh-CN`
- **THEN** 欢迎区所有文字显示中文

#### Scenario: English locale displays correct copy
- **WHEN** 用户语言为 `en-US`
- **THEN** 欢迎区所有文字显示英文
