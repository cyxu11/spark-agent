## Why

当前 Web 端首页（新建会话页 `/workspace/chats/new`）的欢迎区域过于简陋：仅显示一行标题 + 一行副标题，输入框浮在中央，缺乏视觉引导、功能分区和品牌感。基于 MasterGo 设计稿（[设计链接](https://mastergo.iflytek.com/file/180772848061727?fileOpenFrom=shared&devMode=true&page_id=7522%3A35836&layer_id=7561%3A27366)）对首页 UI 进行全面优化，提升用户首次使用时的视觉体验与功能可发现性。

## What Changes

- 重新设计 `Welcome` 组件：增加品牌 Logo/图标区域、主标题、副标题，布局更具层次感
- 新增「快捷功能入口」区域：在输入框上方展示常用功能卡片或快捷操作按钮（如深度搜索、代码生成、文档处理等），方便用户快速发起特定类型对话
- 新增「示例提示词」区域（Suggestion Pills）：在首页输入框下方或侧面展示可点击的示例提示，引导新用户上手
- 优化首页整体布局：调整欢迎区与输入区的间距、对齐方式和视觉权重，与设计稿保持一致
- 保持现有功能不变：输入模式切换（Flash/Thinking/Pro/Ultra）、附件上传、模型选择等功能不受影响

## Capabilities

### New Capabilities

- `homepage-welcome-section`: 重新设计的首页欢迎区，包含品牌标识、主副标题、快捷功能卡片和示例提示词展示

### Modified Capabilities

（无已有 Spec 变更）

## Impact

- **直接影响文件**:
  - `frontend/src/components/workspace/welcome.tsx` — 主要改动，重写欢迎区 UI
  - `frontend/src/app/workspace/chats/[thread_id]/page.tsx` — 可能调整 `isNewThread` 布局逻辑
  - `frontend/src/core/i18n/` — 新增 i18n key（中英文）
- **无 API 变更**，无 backend 影响
- **依赖设计稿**: 通过 `d2c-vue-ep-fetch` 拉取 MasterGo DSL 辅助分析具体尺寸/颜色规格，最终以 React + Tailwind CSS + Shadcn UI 实现（非 Vue 技术栈）
