## Context

**当前状态**: 新建会话页（`/workspace/chats/new`）的首页体验由三个部分组成：
1. `Welcome` 组件 — 浮于 `InputBox` 顶部的 `extraHeader`，仅含一行标题 + 一行副标题
2. `InputBox` — 通过 `-translate-y-[calc(50vh-110px)]` 居中显示在视口
3. `SuggestionList`（`InputBox` 内）— 可点击的示例提示，但 `isNewThread=true` 时未显示

**约束**:
- 技术栈固定为 React 19 + Next.js 16 + TypeScript 5.8 + Tailwind CSS 4 + Shadcn UI
- 设计稿来自 MasterGo，通过 `d2c-vue-ep-fetch` 拉取 DSL 辅助分析尺寸/颜色规格（最终产出为 React 组件，非 Vue）
- 不破坏现有的 `isNewThread` → `isExistingThread` 布局切换动画
- i18n 须同步更新中英文（`zh-CN` / `en-US`）

---

## Goals / Non-Goals

**Goals:**
- 重写 `Welcome` 组件，实现设计稿中的欢迎区 UI（品牌图标、主副标题、快捷功能卡片）
- 在新建会话首页输入框上方或附近展示可点击的示例提示词（Suggestion Pills）
- 保证 `isNewThread → false` 切换时动画平滑，不引起布局跳动
- 确保响应式表现（移动端和桌面端均可用）
- 新增 i18n key 并提供中英文文案

**Non-Goals:**
- 不修改 InputBox 的模式选择、模型选择、附件上传等功能逻辑
- 不修改已有对话（非新建）的页面布局
- 不对 backend/LangGraph 做任何更改
- 不引入新的第三方 UI 库（在 Shadcn/Tailwind 体系内实现）

---

## Decisions

### D1: Welcome 组件重写为独立布局区块

**决策**: 将 `Welcome` 从 `InputBox` 的 `extraHeader` prop 内移出，改为在 `ChatPage` 中以独立 `div` 渲染在输入框上方，通过 `isNewThread` 控制显示/隐藏。

**理由**: `extraHeader` 被定位为 `absolute`，空间受限，无法容纳设计稿中的多区块布局（图标 + 标题 + 快捷卡片）。独立渲染可自由控制高度、间距，也更容易做隐藏动画。

**备选方案**: 保留 `extraHeader` 扩展高度 → 会破坏 `InputBox` 自身的布局计算，排除。

---

### D2: 快捷功能卡片数据驱动

**决策**: 快捷功能卡片（Capability Cards）以静态数组定义在 i18n 文件中（同现有 `t.inputBox.suggestions`），不从 backend 拉取。

**理由**: 功能卡片是固定的产品引导，无需动态化；与现有 `suggestions` 模式保持一致，降低实现复杂度。

**备选方案**: 从 Gateway API 拉取 → 增加网络依赖，首屏加载延迟，不值得，排除。

---

### D3: 示例提示词复用现有 SuggestionList 逻辑

**决策**: 在 `isNewThread=true` 时，在 `Welcome` 区块下方渲染 `SuggestionList`（已在 `input-box.tsx` 中定义），通过 prop 控制其在新建会话时显示。

**理由**: `SuggestionList` 已包含「Surprise me」+ 分类提示，复用可避免重复实现点击填充输入框的逻辑。

---

### D4: 过渡动画用 CSS transition + opacity/transform

**决策**: 当 `isNewThread` 变为 `false` 时，欢迎区以 `opacity-0 scale-95 pointer-events-none` 淡出，避免使用 JS 动画库。

**理由**: 与现有 InputBox 的 `transition-all duration-300 ease-out` 保持风格一致；Tailwind 已有完整过渡工具类，无需引入 Framer Motion 等。

---

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| MasterGo DSL 中使用了特定字体/颜色变量，React 侧无直接对应 | 通过 `d2c-vue-ep-fetch` + `d2c-vue-ep-analyze` 提取规格后，映射到现有 CSS 变量（`--primary`、`--muted-foreground` 等） |
| 欢迎区高度影响 InputBox 的垂直居中计算（`-translate-y-[calc(50vh-110px)]`） | 将欢迎区与输入框作为一个整体 flex 列，整体垂直居中，替换现有 translate 方案 |
| i18n key 新增后需同时更新 zh-CN / en-US，遗漏会导致显示 key 字符串 | tasks 中显式列出 i18n 更新步骤，lint/typecheck 会捕获缺失 key |

---

## Migration Plan

1. 在 feature 分支上开发，不影响 main
2. 修改 `Welcome` 组件（纯 UI，无 API 变更），再调整 `ChatPage` 中的布局
3. 运行 `pnpm check`（lint + typecheck）确认无报错
4. 人工在浏览器中验证新建会话首页、发送消息后的切换动画、移动端响应式
5. 回滚策略：`git revert` 对应 commit，无数据库/API 变更，回滚风险极低

## Open Questions

- MasterGo 设计稿中快捷功能卡片的具体图标是哪些（需 `d2c-vue-ep-fetch` 后确认）？实现时先用 lucide-react 现有图标占位。
- 首页是否需要展示用户头像/姓名（个性化欢迎）？当前无用户认证，暂不实现。
