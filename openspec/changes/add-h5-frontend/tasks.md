## 1. 调研与基线确认

- [x] 1.1 阅读 `app/workspace/layout.tsx`、`app/workspace/chats/[thread_id]/layout.tsx`、`app/workspace/chats/[thread_id]/page.tsx`,记录 H5 必须保留 / 必须移除的 Provider 与组件清单
- [x] 1.2 列出 `InputBox` 当前对外 props 与内部子能力(模型选择 / 文件上传 / mode 切换 / Followups),确认 H5 端无需对其内部源码做修改即可复用
- [ ] 1.3 在桌面浏览器移动模拟下基线录屏当前 `/workspace/chats/new` + 一次完整深度思考对话作为渲染对照样本 _(人工:需用户在浏览器中执行)_

## 2. H5 顶层路由与 Layout

- [x] 2.1 新增 `frontend/src/app/h5/layout.tsx`:仅挂载 `QueryClientProvider` + `Toaster`;**不**挂载 `SidebarProvider` / `WorkspaceSidebar` / `CommandPaletteClient`;声明 `viewport=width=device-width, initial-scale=1, viewport-fit=cover`
- [x] 2.2 新增 `frontend/src/app/h5/chats/page.tsx`:重定向到 `/h5/chats/new`
- [x] 2.3 新增 `frontend/src/app/h5/chats/[thread_id]/layout.tsx`:挂载 `SubtasksProvider` + `ArtifactsProvider` + `PromptInputProvider`(照抄 `workspace/chats/[thread_id]/layout.tsx`)
- [x] 2.4 新增 `frontend/src/app/h5/chats/[thread_id]/page.tsx`:渲染 H5 chat 主体(下一节实现的组件组合)

## 3. H5 专属组件:Header / History Drawer / Input Box 封装

- [x] 3.1 新增 `frontend/src/components/h5/h5-header.tsx`:固定 48px 高度、`backdrop-blur`,左侧标题(可省略)、右侧两个 icon button("新建会话" → 跳 `/h5/chats/new`;"历史会话" → 打开抽屉);两个 button 可点击区 ≥ 44×44px
- [x] 3.2 新增 `frontend/src/components/h5/h5-history-drawer.tsx`:复用 `useThreads` / `useDeleteThread` / `titleOfThread` / `pathOfThread`(路径前缀映射到 `/h5/chats/<id>`) / `formatTimeAgo` / `useI18n`;布局含搜索框 + 列表 + 删除确认;关闭抽屉不触发 `invalidateQueries`
- [x] 3.3 新增 `frontend/src/components/h5/h5-input-box.tsx`:薄封装现有 `InputBox`,默认隐藏桌面专属边距、注入 H5 容器宽度与 `env(safe-area-inset-bottom)`,内部仍渲染原 `InputBox`(模型选择、文件上传、模式切换全部复用)

## 4. H5 chat 页主体组合

- [x] 4.1 在 `app/h5/chats/[thread_id]/page.tsx` 内组合:`ThreadContext.Provider` 包裹 `<H5Header /> + <MessageList />(复用 `components/workspace/messages` 的 `MessageList`,不 fork) + <H5InputBox />`
- [x] 4.2 复用桌面 `useThreadChat` / `useThreadStream` / `useThreadSettings` / `useNotification`;`onStart` 中使用 `history.replaceState(null, "", '/h5/chats/<id>')`(URL 前缀 = `/h5/chats`),保证不会触发 next router 重挂
- [x] 4.3 `<H5HistoryDrawer />` 由 `<H5Header />` 中的"历史会话"按钮控制开合,关闭不影响当前 SSE
- [x] 4.4 处理 `isUploading` 期间 InputBox 的 disabled 行为,与桌面行为完全一致

## 5. 触控与移动端适配

- [x] 5.1 主容器使用 `100dvh` + flex 列布局,header 顶贴 + InputBox 底贴;消息列表在中间区域内部滚动
- [x] 5.2 InputBox 与 H5 输入框区底部 padding 加 `env(safe-area-inset-bottom)`,适配 iPhone 全面屏
- [x] 5.3 header 与 InputBox 区域使用 `backdrop-blur` + 半透明背景,避免与消息流冲突
- [x] 5.4 长按 / 滑动手势不被屏蔽(不在主滚动容器外层使用 `touch-action: none`)

## 6. 验收与回归

- [x] 6.1 `pnpm typecheck` 与 `pnpm lint` 通过,无新增 warning(typecheck 0 错误;lint 仅 8 个已存在错误 + 7 个已存在 warning,均不在新增文件中)
- [x] 6.2 `pnpm build` 通过,产物 manifest 中含 `/h5/chats/[thread_id]` 与 `/h5/chats` 路由(已验证 next 路由表输出含两条 `/h5/chats*`)
- [ ] 6.3 桌面浏览器移动视图(iPhone SE 375×667、iPhone 15 393×852、Android 412×915)下人工跑通:发送交易问答、切换深度思考、上传文件、切换模型、新建会话、打开历史抽屉、删除一条历史、跳转一条历史 _(人工:需在浏览器中执行)_
- [ ] 6.4 桌面浏览器访问 `/workspace/chats/new` 验证桌面行为零回归(sidebar、command palette、artifact、export、session events、token usage 全部正常) _(人工:需在浏览器中执行)_
- [ ] 6.5 视觉对照:从一次相同的深度思考会话对比 H5 与桌面端在折叠卡(task / summary / data-card)上的文字、颜色、icon、可展开/折叠行为一致 _(人工:需在浏览器中执行)_

## 7. 文档与提交

- [ ] 7.1 在 PR 描述中粘贴 H5 端三种典型机型截图(空态 / 流式中 / 历史抽屉) _(待 PR 创建时执行)_
- [ ] 7.2 PR 描述中显式说明:**桌面路由零修改**,变更仅新增 `app/h5/*` 与 `components/h5/*` _(待 PR 创建时执行)_
- [ ] 7.3 PR 合并前 review 检查清单:无新增 `MobileMessageList` / `MobileInputBox` 等 fork 组件;`core/*` 无修改;`components/workspace/*` 无修改 _(待 review 时执行;已通过 `git status` 自检 → 仅新增 app/h5/* + components/h5/*,workspace/core 无修改)_
