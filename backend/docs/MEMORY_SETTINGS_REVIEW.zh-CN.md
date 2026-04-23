# Memory Settings 评审

在本地评审 Memory Settings 的新增/编辑流程时,可按本文档以尽量少的手动步骤完成。

## 快速评审

1. 使用你现有任意可用的开发方式,在本地启动 DeerFlow。

   示例：

   ```bash
   make dev
   ```

   或

   ```bash
   make docker-start
   ```

   如果你本地已经跑着 DeerFlow,直接复用现有进程即可。

2. 加载示例记忆 fixture：

   ```bash
   python scripts/load_memory_sample.py
   ```

3. 打开 `Settings > Memory`。

   本地默认 URL：
   - 应用：`http://localhost:2026`
   - 仅前端的本地回退：`http://localhost:3000`

## 最小手工测试

1. 点击 `Add fact`。
2. 新建一条事实：
   - 内容：`Reviewer-added memory fact`
   - 分类：`testing`
   - 置信度：`0.88`
3. 确认新事实立即出现,且来源(source)显示为 `Manual`。
4. 编辑示例中的事实 `This sample fact is intended for edit testing.`,改为：
   - 内容：`This sample fact was edited during manual review.`
   - 分类：`testing`
   - 置信度：`0.91`
5. 确认编辑后的事实立即更新。
6. 刷新页面,确认新增与编辑后的事实都仍然保留。

## 可选的健全性检查

- 搜索 `Reviewer-added`,确认能匹配到新事实
- 搜索 `workflow`,确认分类文本也能被搜到
- 在 `All`、`Facts`、`Summaries` 之间切换
- 删除一次性示例事实 `Delete fact testing can target this disposable sample entry.`,确认列表立即更新
- 清空所有记忆,确认页面进入 empty 状态

## Fixture 文件

- 示例 fixture：`backend/docs/memory-settings-sample.json`
- 默认本地运行时目标：`backend/.deer-flow/memory.json`

加载脚本在覆盖已有运行时记忆文件之前,会自动创建带时间戳的备份。
