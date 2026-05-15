## Why

现有 spark-agent 前端只覆盖桌面 web 端（`/workspace/chats/...`），在手机浏览器上交互拥挤、目标点击区域过小、侧边栏与右侧栏占用比例不合理,无法满足移动端用户使用「交易问答」「深度思考」与会话管理的诉求。需要在不破坏现有 web 端的前提下,新增一套独立的 H5 端入口,在小屏幕场景下提供与 web 端**功能与渲染逻辑完全一致**的交易问答和深度思考体验。

## What Changes

- 新增 H5 端路由命名空间 `/h5/chats` 与 `/h5/chats/[thread_id]`,与现有 `/workspace/chats/...` 并列存在,互不影响。
- H5 入口默认渲染极简单页布局:顶部 header(左：标题；右：「新建会话」按钮 + 「历史会话」按钮),主体为消息列表 + 输入框。
- H5 输入框复用现有 `InputBox` 的核心能力：**文件上传**、**模型选择**、**模式切换(交易问答 / 深度思考)**。其它桌面专属能力(命令面板、可调整面板、artifact 侧栏等)在 H5 端**默认隐藏**。
- H5 消息列表复用现有 `MessageList` / `message-list-item.tsx` 渲染逻辑,保证交易问答与深度思考的气泡、折叠卡、工具调用、数据卡片等渲染细节与 web 端**逐像素一致**(仅作 viewport/触控适配,不改业务渲染分支)。
- H5 历史会话面板复用 `useThreads` / `useDeleteThread` hook 与 `pathOfThread`/`titleOfThread` 工具,但以**抽屉 / 全屏遮罩**形式呈现,而非 web 端常驻侧栏。
- 顶层布局:为 H5 单独提供 `app/h5/layout.tsx`,不挂载 `WorkspaceSidebar`、`CommandPaletteClient`;保留 `QueryClientProvider`、`SubtasksProvider`、`ArtifactsProvider`、`PromptInputProvider`、`ThreadContext`、`Toaster`。
- 不变项(BREAKING 无):web 端路由、组件、hook 行为保持现状;`core/threads`、`core/messages`、`core/uploads` 等业务层零改动。

## Capabilities

### New Capabilities
- `h5-frontend`: 移动端 H5 入口,涵盖 H5 路由布局、H5 chat 页(交易问答 + 深度思考 + 文件上传 + 模型选择)、H5 历史会话抽屉、H5 新建会话按钮。

### Modified Capabilities
<!-- 无:本变更只新增独立的 H5 路由与 H5 专属组件,不修改已有 spec 行为 -->

## Impact

- 新增代码(主要):
  - `frontend/src/app/h5/layout.tsx`
  - `frontend/src/app/h5/chats/page.tsx`(重定向到 `/h5/chats/new` 或最近一条)
  - `frontend/src/app/h5/chats/[thread_id]/layout.tsx`
  - `frontend/src/app/h5/chats/[thread_id]/page.tsx`(H5 chat 页主体)
  - `frontend/src/components/h5/h5-header.tsx`(顶部 header:标题 + 新建 + 历史)
  - `frontend/src/components/h5/h5-history-drawer.tsx`(历史会话抽屉,复用 `useThreads`)
  - `frontend/src/components/h5/h5-input-box.tsx`(InputBox 的 H5 配置封装,默认隐藏桌面专属控件)
- 复用代码(零修改):
  - `core/threads/*`、`core/messages/*`、`core/uploads/*`、`core/settings/*`、`core/i18n/*`
  - `components/workspace/messages/*`(MessageList 与所有 item 渲染)
  - `components/workspace/input-box.tsx` 与其内部子组件
  - `components/ai-elements/*`、`components/ui/*`
- 依赖:无新增 npm 包;沿用 Next.js 16 App Router + Tailwind v4。
- 路由 / 流量:H5 路由独立于 `/workspace`,由前端自行判断或由网关侧后续可加 UA 重定向(本变更不引入 UA 重定向)。
- 配置 / 部署:nginx 与 `make dev` 无需调整,前端 Next.js 自动发现新路由。
- 测试范围:H5 端在 iPhone SE / iPhone 15 / 主流 Android(360/375/393/412 宽度)与桌面浏览器移动模拟下进行人工 UI 验收;复用业务逻辑由现有 e2e/手工流程覆盖。
