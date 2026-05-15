## 1. 设计稿分析

- [ ] 1.1 使用 `/d2c-vue-ep-fetch` 拉取 MasterGo DSL（URL: https://mastergo.iflytek.com/file/180772848061727?fileOpenFrom=shared&devMode=true&page_id=7522%3A35836&layer_id=7561%3A27366）
- [ ] 1.2 使用 `/d2c-vue-ep-analyze` 解析 DSL，提取颜色、字号、间距、组件变体等设计规格到 analysis.md
- [ ] 1.3 根据 analysis.md 将设计 Token 映射到项目现有 CSS 变量（`--primary`、`--muted-foreground` 等）

## 2. i18n 文案新增

- [ ] 2.1 在 `frontend/src/core/i18n/` 的 `zh-CN` 配置中新增 `homepage` 命名空间：主标题、副标题、快捷卡片标题/描述、Suggestion Pills 文案
- [ ] 2.2 在 `en-US` 配置中同步新增相同 key 的英文翻译
- [ ] 2.3 运行 `pnpm typecheck` 确认 i18n key 类型正确，无缺失

## 3. Welcome 组件重写

- [ ] 3.1 重写 `frontend/src/components/workspace/welcome.tsx`：移除旧的内联标题/副标题，改为包含品牌图标区、主标题、副标题的多层布局（参考 analysis.md 规格）
- [ ] 3.2 新增快捷功能卡片区（Capability Cards）：以 2×2 或 1×4 网格排列，每个卡片含图标（lucide-react）+ 标题，点击时调用 `onSuggestionClick` 回调填充输入框
- [ ] 3.3 添加 `isNewThread` prop 控制显示/隐藏，并用 Tailwind `transition-opacity duration-300` 实现淡出动画

## 4. ChatPage 布局调整

- [ ] 4.1 在 `frontend/src/app/workspace/chats/[thread_id]/page.tsx` 中将 `Welcome` 从 `InputBox` 的 `extraHeader` 移出，改为独立区块渲染在输入框容器上方
- [ ] 4.2 将欢迎区 + 输入框作为一个 flex 列整体垂直居中（替换现有的 `-translate-y-[calc(50vh-110px)]` 方案），确保居中计算稳定
- [ ] 4.3 在 `isNewThread=true` 时，在欢迎区下方（输入框上方）展示 `SuggestionList`（复用 `input-box.tsx` 中现有的 `SuggestionList` 组件）

## 5. 响应式与样式调整

- [ ] 5.1 确保快捷卡片在移动端（< 768px）以 2 列展示，桌面端以 4 列展示，使用 Tailwind `grid-cols-2 md:grid-cols-4`
- [ ] 5.2 调整欢迎区整体间距，与设计稿 analysis.md 中的 padding/gap 规格对齐
- [ ] 5.3 验证深色模式（dark mode）下配色符合设计稿要求

## 6. 验证

- [ ] 6.1 运行 `pnpm check`（lint + typecheck），确保无报错
- [ ] 6.2 本地启动开发服务器（`pnpm dev`），在浏览器中验证新建会话首页视觉效果
- [ ] 6.3 发送第一条消息，验证欢迎区淡出动画流畅，对话布局正常展开
- [ ] 6.4 验证移动端（375px 宽度）和桌面端（1440px 宽度）响应式表现
- [ ] 6.5 切换语言（zh-CN / en-US），确认所有新增文案正确显示
