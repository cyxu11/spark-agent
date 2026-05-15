## Context

spark-agent 前端是基于 Next.js 16 App Router 的桌面 web。chat 主页面位于 `app/workspace/chats/[thread_id]/page.tsx`,由 `WorkspaceLayout` 提供 `SidebarProvider` + `WorkspaceSidebar` + `CommandPaletteClient` + `Toaster`,由 `chats/[thread_id]/layout.tsx` 提供 `SubtasksProvider` + `ArtifactsProvider` + `PromptInputProvider`。

核心业务行为(交易问答 / 深度思考 / 文件上传 / 模型选择 / 历史会话)由 `core/threads`、`core/messages`、`core/uploads`、`core/settings` 等 hook + `components/workspace/*` 组件实现。其中:

- `useThreadChat` 管理 `threadId` 与 `isNewThread`。
- `useThreadStream` 提供 SSE 流、`thread.messages`、`thread.values`、`thread.stop()`、`isUploading`、`currentRunId`。
- `MessageList` + `message-list-item.tsx` 已支持 task/summary/data-card 等折叠分支与 deep-thinking 渲染。
- `InputBox` 内部:模型选择(`ModelSelector`)、模式切换(`context.mode`:`trade-qa` / `deep-thinking`)、文件上传(`useUploadAttachment`)、Followups 展示等。
- 历史会话:`useThreads()` 列表 + `useDeleteThread()` 删除 + `pathOfThread()` 跳转 url。

H5 端必须复用上述业务,差异仅在**布局容器、header、历史会话展示形式、移动端断点适配**。

约束:
- 不破坏 web 端任何已有路径、布局、组件签名。
- 业务渲染逻辑必须**1:1** 复用现有 `MessageList`,禁止 fork 一份"H5 版本"。
- H5 默认不显示桌面专属控件:`WorkspaceSidebar`、`CommandPalette`、`ArtifactTrigger` 侧栏切换、`ResizablePanelGroup` 等。
- H5 仍需 `ArtifactsProvider`(部分消息渲染依赖 context 存在,即便面板隐藏)。

## Goals / Non-Goals

**Goals:**
- 提供独立的 `/h5/chats/[thread_id]` 路由,在 H5 viewport 下做到内容铺满、触控友好、单手可达。
- 在 H5 单页同时支持:发送交易问答消息、切换深度思考模式、选择模型、上传文件、查看消息流(含工具调用/数据卡片/折叠摘要等已支持的渲染分支)。
- 在 H5 顶部右上角提供"新建会话"按钮(直接跳 `/h5/chats/new`)与"历史会话"按钮(打开抽屉,内含搜索 + 列表 + 删除)。
- 渲染逻辑与 web 端完全一致:同一份 `MessageList` 与 `InputBox` 子树,只调整外层容器宽度/间距/可见性。

**Non-Goals:**
- 不引入 UA 自动重定向(`/workspace` ↔ `/h5`),保持显式路由。
- 不实现 Artifact 编辑器、Command Palette、Token Usage Indicator、Export、Session Events 等桌面专属能力。
- 不引入 React Native / Capacitor / PWA 安装清单(本变更不属于 native 化)。
- 不调整 backend / Gateway / nginx 路由。
- 不修改任何 `core/*` 业务 hook 与 `components/workspace/messages/*` 渲染分支。
- 不实现移动端独立的国际化文案(沿用现有 `core/i18n`)。

## Decisions

### D1. H5 路由独立挂载在 `/h5/*` 而非通过 UA 切换桌面路由

选择独立路由,理由:
- 与现有 `/workspace/*` 解耦,改动可被审查、可回滚、不影响桌面用户。
- 历史会话 URL 可以被分享给桌面用户(`/workspace/chats/<id>`)与移动用户(`/h5/chats/<id>`),链接含义清晰。
- 避免在 `WorkspaceLayout` 里塞入移动端分支逻辑导致单文件膨胀。

替代方案(已否决):
- *方案 A:在 `workspace/layout.tsx` 内根据 `useMediaQuery` 切换两套布局*——单文件膨胀,SSR 首屏闪烁,且 `WorkspaceSidebar` 在 layout 顶层难以条件挂载。
- *方案 B:在 nginx 层做 UA 重定向*——后端配置复杂,部署相关,移动桌面切换不便调试。

### D2. 业务渲染 1:1 复用 `MessageList` + `InputBox`,只做"配置式"参数

H5 端在 `/h5/chats/[thread_id]/page.tsx` 内部:
- 直接 `import { MessageList } from "@/components/workspace/messages"` 与 `import { InputBox } from "@/components/workspace/input-box"`,**禁止**新增 `MobileMessageList` / `MobileInputBox`。
- 通过 props/CSS 类调整外层容器(全屏铺满 / 100dvh / safe-area-inset-bottom)。
- 通过新建 `h5-input-box.tsx` 仅做一层薄封装:传入 H5 默认禁用项(例如不显示 followups 横向列表的滚动溢出,或减小 footer 高度),内部仍渲染原 `InputBox`。

理由:用户明确要求"功能和渲染逻辑要保持和 web 端一模一样"。任何 fork 都会随时间漂移。

替代方案(已否决):
- *复制一份 `MobileInputBox` / `MobileMessageList`*——双倍维护成本,渲染分支(task / summary / data-card 等)极易随后期改动出现 desync。

### D3. H5 顶部 header 自研、不复用 `WorkspaceHeader`

H5 顶部需要的元素:左侧标题(可省略,仅在折叠态显示)、右侧两个 icon button(新建会话 + 历史抽屉),与桌面 `WorkspaceHeader` 的 `ThreadTitle + TokenUsage + Export + ArtifactTrigger + SessionEvents` 完全不同。新建 `components/h5/h5-header.tsx`,采用固定 48px 高度,贴顶,`backdrop-blur`。

### D4. 历史会话以抽屉(Sheet)形式呈现,数据层零改动

新建 `components/h5/h5-history-drawer.tsx`,使用 `components/ui/sheet.tsx`(若已存在)或 Radix `Dialog`(full-screen 变体)。内部布局复刻 `app/workspace/chats/page.tsx` 的搜索 + 列表 + 删除确认逻辑,**直接复用** `useThreads`、`useDeleteThread`、`titleOfThread`、`pathOfThread`、`formatTimeAgo`、`useI18n`。

避免新建一个 `useMobileThreads`,业务 hook 零改动。

### D5. H5 layout 复用 chat 所需 Provider,但**不**挂载 `SidebarProvider`/`WorkspaceSidebar`/`CommandPalette`

`app/h5/layout.tsx`(顶层):
- 挂载 `QueryClientProvider`、`Toaster`。
- 不挂载 `SidebarProvider`、`WorkspaceSidebar`、`CommandPaletteClient`。

`app/h5/chats/[thread_id]/layout.tsx`(thread 级):
- 挂载 `SubtasksProvider`、`ArtifactsProvider`、`PromptInputProvider`(完全照抄现有 `workspace/chats/[thread_id]/layout.tsx`,保持 message context 一致)。

### D6. 文件上传与模型选择沿用 `InputBox` 内置实现,不另起一套

`InputBox` 已经把模型选择、文件上传、模式切换合在一个组件内。H5 端通过外层 `<h5-input-box>` 控制宽度 + safe-area,内部行为不动。

### D7. 移动端断点策略

- viewport meta 在 `app/h5/layout.tsx`(或 `metadata.viewport`)中显式声明 `width=device-width, initial-scale=1, viewport-fit=cover` 以支持 iOS notch safe-area。
- 用 Tailwind 内置断点(`sm:`/`md:`)+ `100dvh`/`100svh` 处理 iOS 地址栏抖动。
- 不引入新的 mobile detection 库。

### D8. `isNewThread` 与 URL 同步沿用桌面策略

桌面在 `onStart` 中使用 `history.replaceState(null, "", '/workspace/chats/<id>')` 避免 next router 重挂。H5 端使用相同模式,只是 URL 改为 `/h5/chats/<id>`。

## Risks / Trade-offs

- **Risk: H5 端长期与 web 端 ChatPage 出现行为分叉(漏接新 prop / 新事件)** → Mitigation: 通过 D2 强制复用 `MessageList`/`InputBox`,任何 H5 端自有"业务"代码必须通过 code review 拒绝。
- **Risk: `ArtifactsProvider` 在 H5 端虽挂载但无 trigger,可能产生死代码体感** → Mitigation: 在 design.md 与 spec 中明确记录"H5 不暴露 artifact 入口,但 provider 必须存在,因为 `MessageList` 子组件读取 context"。
- **Risk: 历史会话抽屉与 thread 流式渲染共享 React Query cache,关闭抽屉时若意外触发 refetch 影响 SSE 流** → Mitigation: 抽屉关闭不调用 `invalidateQueries`,只 unmount。
- **Risk: iOS Safari 软键盘弹出时 `100vh` 抖动覆盖输入框** → Mitigation: 使用 `100dvh` + `position: sticky` + `env(safe-area-inset-bottom)`,在主流机型实测验收。
- **Risk: 新增路由对桌面 e2e 测试无影响,但容易被遗漏在部署前的 smoke test** → Mitigation: 在 tasks 中加入 `pnpm build` 校验产物含 `/h5/chats/[thread_id]` 静态 manifest。
- **Trade-off: H5 端故意不暴露 artifact / token-usage / export / session-events,移动用户能力 < 桌面用户**。本期产品意图明确:"H5 暂时只实现 web 的两类功能",权衡接受。

## Migration Plan

- 上线:无数据迁移,无 backend / config 改动;`make dev` 启动后即可访问 `/h5/chats/new`。
- 回滚:删除 `app/h5/` 与 `components/h5/` 两个目录,仓库回到 web-only 状态;桌面用户零感知。
- 灰度策略(可选,后续 change):未来若需自动 UA 重定向,新增一个独立 change `add-h5-ua-redirect`,与本变更解耦。

## Open Questions

- H5 端是否需要在历史抽屉之外提供"切换到桌面版"链接?当前默认:**否**,通过浏览器地址栏切换;若后续产品提需求,作为独立 change 处理。
- 输入框上方 Followups 在 H5 是否需要折叠/隐藏?当前默认:**保持显示**(渲染逻辑一致原则);若实测拥挤,可在 H5 InputBox 封装中开关,但默认沿用桌面行为。
