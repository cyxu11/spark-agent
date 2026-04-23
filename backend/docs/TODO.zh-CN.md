# TODO 清单

## 已完成功能

- [x] 仅在首次调用文件系统或 bash 工具时再启动 sandbox
- [x] 为整个流程加入 Clarification 澄清机制
- [x] 实现 Context Summarization 机制,避免上下文爆炸
- [x] 集成 MCP(Model Context Protocol)以支持可扩展工具
- [x] 支持文件上传,并自动做文档格式转换
- [x] 实现自动 thread 标题生成
- [x] 引入 Plan Mode 与 TodoList middleware
- [x] 通过 ViewImageMiddleware 支持视觉模型
- [x] 基于 SKILL.md 格式的 Skills 系统

## 规划中功能

- [ ] 对 sandbox 资源做池化,以减少 sandbox 容器数量
- [ ] 加入鉴权/授权层
- [ ] 实现限流
- [ ] 加入指标与监控
- [ ] 上传功能支持更多文档格式
- [ ] Skill marketplace / 远程技能安装
- [ ] 优化 agent 热路径中的异步并发(IM 渠道多任务场景)
  - 将 `packages/harness/deerflow/tools/builtins/task_tool.py` 中的 `time.sleep(5)`(subagent 轮询)替换为 `asyncio.sleep()`
  - 将 `packages/harness/deerflow/sandbox/local/local_sandbox.py` 中的 `subprocess.run()` 替换为 `asyncio.create_subprocess_shell()`
  - 在社区工具(tavily、jina_ai、firecrawl、infoquest、image_search)中将同步 `requests` 替换为 `httpx.AsyncClient`
  - 在 title_middleware 与 memory updater 中将同步 `model.invoke()` 替换为异步 `model.ainvoke()`
  - 对剩余的阻塞式文件 I/O,考虑用 `asyncio.to_thread()` 包装
  - 生产环境建议使用 `langgraph up`(多 worker)替代 `langgraph dev`(单 worker)

## 已解决的问题

- [x] 确保 `state.artifacts` 中没有重复文件
- [x] 长时间 thinking 但内容为空(答案夹在 thinking 过程中)
