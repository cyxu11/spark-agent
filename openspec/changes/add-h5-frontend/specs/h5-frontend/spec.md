## ADDED Requirements

### Requirement: H5 路由命名空间存在且与桌面路由共存

系统 SHALL 提供独立的 H5 路由命名空间 `/h5/chats` 与 `/h5/chats/[thread_id]`。该命名空间与现有 `/workspace/chats/...` 路由并存,互不重定向、互不覆盖。

#### Scenario: 访问 H5 chat 新建会话路径
- **WHEN** 用户在移动浏览器访问 `/h5/chats/new`
- **THEN** 系统渲染 H5 chat 页空态(welcome + 输入框居中),不渲染 `WorkspaceSidebar` 与 `CommandPalette`

#### Scenario: 桌面路由不受影响
- **WHEN** 任意用户访问 `/workspace/chats/new`
- **THEN** 系统仍按现状渲染桌面 chat 页(含 `WorkspaceSidebar`、`CommandPalette`、`ArtifactTrigger`、`ExportTrigger`、`SessionEvents`、`TokenUsageIndicator`)

#### Scenario: H5 路由可被独立部署回滚
- **WHEN** 仓库回滚到本变更之前的提交
- **THEN** `/h5/chats/*` 返回 Next.js 404,`/workspace/chats/*` 行为完全不变

### Requirement: H5 chat 页支持交易问答与深度思考的发送、接收与渲染

系统 SHALL 在 H5 chat 页支持用户发送消息、接收 SSE 流式响应,并使用与桌面端**完全相同的渲染组件**(`MessageList` 及其 item 渲染分支)展示交易问答与深度思考的全部消息类型,包括但不限于:普通文本气泡、深度思考折叠卡、tool-call 卡片、data-card(SQL 结果)、task 折叠卡、summary 折叠卡。

#### Scenario: 发送交易问答消息
- **WHEN** 用户在 H5 输入框输入文本并点击发送
- **THEN** 系统通过 `useThreadStream` 创建 thread 并发起 SSE,首条 AI 回复以与桌面端一致的气泡组件渲染

#### Scenario: 切换深度思考模式后发送
- **WHEN** 用户在 H5 输入框打开"深度思考"模式开关并发送消息
- **THEN** 系统将 `context.mode` 保存到 `useThreadSettings`,并以与桌面端一致的深度思考折叠卡渲染响应

#### Scenario: 渲染折叠类消息
- **WHEN** AI 响应包含 element=task / element=summary / element=data-card 类型片段
- **THEN** H5 端复用桌面 `message-list-item.tsx` 的同一折叠卡组件渲染,文本、图标、颜色、可展开/折叠交互与桌面完全一致

### Requirement: H5 输入框支持模型选择与文件上传

H5 chat 页 SHALL 在输入框区域提供模型选择控件与文件上传控件,且二者行为与桌面 `InputBox` 完全一致(包括上传进度、错误提示、模型列表来源、selectedModel 持久化策略)。

#### Scenario: 选择模型
- **WHEN** 用户在 H5 输入框点击模型选择控件并选中一个模型
- **THEN** 选择结果通过与桌面端相同的 hook 持久化,后续发送的消息使用该模型

#### Scenario: 上传文件
- **WHEN** 用户在 H5 输入框点击文件上传按钮并选择一个文件
- **THEN** 文件通过桌面端相同的 `useUploadAttachment` 路径上传,`isUploading=true` 期间发送按钮置灰,完成后附件出现在输入框附件区

#### Scenario: 上传失败
- **WHEN** 文件上传请求返回非 2xx
- **THEN** H5 端通过同一 `Toaster`(`sonner`)弹出错误,文案沿用 `core/i18n` 的 zh-CN 文案

### Requirement: H5 顶部 header 提供新建会话与历史会话入口

H5 chat 页 SHALL 在屏幕顶部固定 header 中提供两个右上角按钮:**新建会话**与**历史会话**。这两个按钮的可点击区域 SHALL 不小于 44×44 CSS 像素以满足移动端触控目标尺寸。

#### Scenario: 点击新建会话
- **WHEN** 用户点击 H5 header 右上角"新建会话"按钮
- **THEN** 系统导航至 `/h5/chats/new`,输入框居中、消息列表为空、(若有)welcome 区显示

#### Scenario: 点击历史会话打开抽屉
- **WHEN** 用户点击 H5 header 右上角"历史会话"按钮
- **THEN** 系统以从右侧或全屏滑入的抽屉展示历史会话列表,列表数据来自 `useThreads()`,与桌面 `/workspace/chats` 页同一来源

#### Scenario: 关闭历史抽屉
- **WHEN** 用户在历史抽屉内点击关闭、按下系统返回手势、或点击遮罩
- **THEN** 抽屉关闭,SSE 流(若 H5 当前 thread 正在生成)不被中断

### Requirement: H5 历史会话抽屉支持搜索、跳转与删除,复用桌面业务 hook

历史会话抽屉 SHALL 复用 `useThreads`、`useDeleteThread`、`titleOfThread`、`pathOfThread`、`formatTimeAgo`、`useI18n`,**禁止** fork 一份移动端专用 hook 或工具函数。

#### Scenario: 在抽屉内搜索
- **WHEN** 用户在抽屉顶部搜索框输入关键字
- **THEN** 列表按 `titleOfThread` 的小写包含匹配过滤,行为与 `/workspace/chats` 页一致

#### Scenario: 在抽屉内点击会话跳转
- **WHEN** 用户在抽屉列表中点击一条历史会话
- **THEN** 系统跳转到 `/h5/chats/<thread_id>`(由 `pathOfThread` 返回值改写为 H5 前缀,或通过路由约定映射),关闭抽屉

#### Scenario: 在抽屉内删除会话
- **WHEN** 用户点击列表项右侧删除按钮并在确认对话框点击"删除"
- **THEN** 系统调用与桌面相同的 `useDeleteThread` mutation,成功后 toast 提示,失败后弹出错误文案

### Requirement: H5 端不暴露桌面专属能力

H5 chat 页 SHALL **不**渲染 `WorkspaceSidebar`、`CommandPaletteClient`、`ArtifactTrigger`、`ExportTrigger`、`SessionEventsSheet`、`TokenUsageIndicator`、`ResizablePanelGroup`(用于 chat ↔ artifact 分屏)等桌面专属组件。`ArtifactsProvider` 仍 SHALL 被挂载以保证 `MessageList` 子组件可读取 context。

#### Scenario: H5 chat 页不挂载 WorkspaceSidebar
- **WHEN** H5 chat 页渲染完成
- **THEN** DOM 中不存在 `data-slot="sidebar"` 之类的 sidebar 根节点,viewport 宽度被主内容 100% 占用

#### Scenario: H5 chat 页不挂载 ArtifactTrigger / 分屏
- **WHEN** thread 包含 artifacts
- **THEN** H5 端不渲染分屏控件或 artifact 列表入口;`ArtifactsProvider` 仍存在以避免 context 错误

### Requirement: H5 viewport 与触控适配

H5 chat 页 SHALL 显式声明移动端 viewport,并在主流移动断点(宽度 360 / 375 / 393 / 412 px)下保证:输入框不被软键盘遮挡、安全区(notch / home indicator)留白、消息列表可正常滚动、点击/长按反馈正常。

#### Scenario: viewport meta 正确声明
- **WHEN** 在移动浏览器加载 `/h5/chats/<id>`
- **THEN** 文档 head 中含 `viewport=width=device-width, initial-scale=1, viewport-fit=cover`(或等价 Next `metadata.viewport`)

#### Scenario: 软键盘弹出不遮挡输入框
- **WHEN** iOS Safari 用户点击 H5 输入框触发软键盘
- **THEN** 输入框仍可见于视口底部,通过 `100dvh` + `env(safe-area-inset-bottom)` 适配
