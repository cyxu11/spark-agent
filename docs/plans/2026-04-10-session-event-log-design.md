# Session Event Log — Design Document

**Date**: 2026-04-10  
**Status**: Approved

## Problem

SSE 流式事件（`values`、`messages-tuple`、`updates`、`metadata`、`error`、`end`）在 run 结束后即丢失，无法事后回溯，也无法让第二个客户端实时订阅正在进行的 run。

## Goals

1. 持久化所有 SSE 事件到 PostgreSQL
2. 提供 REST API 查询历史事件
3. 提供 SSE 端点支持实时订阅（回放 + live 追加）
4. 前端在 chat 页面内展示 session 事件面板

## Non-Goals

- 不支持跨 thread 的消息全文搜索
- 不提供事件数据导出（CSV / PDF）
- 不对事件内容做结构化索引（只存原始 JSONB）

---

## Architecture

### 方案：装饰器包装 StreamBridge

```
publish(run_id, event, data)
  ├─→ 原 StreamBridge（内存/Redis，SSE 用）
  └─→ PostgresEventLog（异步落库 + PG NOTIFY）
```

`LoggingStreamBridge` 包裹现有 bridge，零侵入原有 SSE 逻辑。

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS run_event_log (
    id          BIGSERIAL PRIMARY KEY,
    run_id      TEXT        NOT NULL,
    thread_id   TEXT        NOT NULL,
    event       TEXT        NOT NULL,
    data        JSONB       NOT NULL,
    seq         TEXT        NOT NULL,     -- 来自 StreamEvent.id（格式: "{ts}-{seq}"）
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rel_run    ON run_event_log (run_id, id);
CREATE INDEX IF NOT EXISTS idx_rel_thread ON run_event_log (thread_id, id);
```

- `run_id` + `id` 保证回放顺序
- `thread_id` 冗余存储，支持按 thread 查询所有 run 的事件
- `data` 用 JSONB，支持按 event 类型过滤
- PostgreSQL `LISTEN/NOTIFY` channel 名：`run_events`，payload 为 `run_id`

---

## Components

### 1. `PostgresEventLog`（harness 层）

**文件**：`backend/packages/harness/deerflow/runtime/event_log/postgres.py`

```python
class PostgresEventLog:
    def __init__(self, *, connection_string: str) -> None: ...

    async def append(
        self, run_id: str, thread_id: str, event: str, data: Any, seq: str
    ) -> None:
        # INSERT INTO run_event_log + NOTIFY run_events, '<run_id>'

    async def list_events(
        self,
        *,
        run_id: str | None = None,
        thread_id: str | None = None,
        after_id: int = 0,
        event_types: list[str] | None = None,
        limit: int = 500,
    ) -> list[dict]: ...

    async def subscribe_live(
        self, run_id: str, *, after_id: int = 0
    ) -> AsyncIterator[dict]:
        # LISTEN run_events; 等待 NOTIFY，每次拉取新行 yield
```

**错误处理**：`append` 失败只记录 warning，不阻断 SSE 流。

### 2. `LoggingStreamBridge`（harness 层）

**文件**：`backend/packages/harness/deerflow/runtime/stream_bridge/logging_bridge.py`

```python
class LoggingStreamBridge(StreamBridge):
    def __init__(
        self,
        *,
        inner: StreamBridge,
        event_log: PostgresEventLog,
        run_registry: Callable[[str], str | None],  # run_id → thread_id
    ) -> None: ...

    async def publish(self, run_id: str, event: str, data: Any) -> None:
        await self._inner.publish(run_id, event, data)
        thread_id = self._run_registry(run_id) or ""
        await self._log.append(run_id, thread_id, event, data, seq=...)

    async def publish_end(self, run_id: str) -> None:
        await self._inner.publish_end(run_id)
        thread_id = self._run_registry(run_id) or ""
        await self._log.append(run_id, thread_id, "__end__", None, seq=...)

    def subscribe(self, run_id, *, last_event_id=None, heartbeat_interval=15.0):
        return self._inner.subscribe(
            run_id, last_event_id=last_event_id, heartbeat_interval=heartbeat_interval
        )

    async def cleanup(self, run_id, *, delay=0):
        await self._inner.cleanup(run_id, delay=delay)
```

### 3. `make_stream_bridge` 工厂更新

在 `async_provider.py` 中，当 `event_log_config.enabled = true` 时自动用 `LoggingStreamBridge` 包裹返回的 bridge。

### 4. Gateway API

**文件**：`backend/app/gateway/routers/run_events.py`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/threads/{thread_id}/runs/{run_id}/events` | 历史查询（分页） |
| GET | `/api/threads/{thread_id}/runs/{run_id}/events/stream` | SSE 实时订阅 |
| GET | `/api/threads/{thread_id}/events` | thread 下所有事件 |

**历史查询参数**：`after_id`（游标）、`limit`（默认 200）、`event_type`（可多值）

**响应结构**：
```json
{
  "events": [
    {
      "id": 42,
      "run_id": "...",
      "thread_id": "...",
      "event": "messages-tuple",
      "data": { ... },
      "seq": "1700000000-0",
      "created_at": "2026-04-10T12:00:00Z"
    }
  ],
  "next_after_id": 42
}
```

**SSE 流逻辑**：
1. 先回放 `after_id` 之后已有事件
2. 切换到 `LISTEN run_events`，实时推送新事件
3. 收到 `__end__` 事件后关闭连接

### 5. 前端组件

**目录**：`frontend/src/components/workspace/session-events/`

| 文件 | 职责 |
|------|------|
| `session-events-sheet.tsx` | Sheet 容器 + 工具栏触发按钮 |
| `event-log-list.tsx` | 事件列表（虚拟滚动） |
| `event-item.tsx` | 单条事件渲染（badge + 折叠 JSON） |
| `use-event-log.ts` | 数据 hook（历史查询 + SSE 追加） |

**数据 hook**：
```typescript
useEventLog(threadId: string, runId: string) → {
  events: RunEvent[],
  isLive: boolean,
  isLoading: boolean,
}
```

首次加载调 `GET /events?limit=200`；run 进行中切换到 SSE 追加。

**UI 交互**：
- chat 工具栏加"事件日志"图标按钮，点击滑出 Sheet
- Sheet 内 Tabs 按 run 切换（最近 run 默认选中）
- 时间线样式列表，event 类型 badge + 时间戳，点击展开原始 JSON
- event 类型筛选器（`messages-tuple` / `values` / `updates` / 其他）
- run 进行中时顶部显示实时指示器

---

## Configuration

`config.yaml` 新增节（可选，默认禁用）：

```yaml
event_log:
  enabled: false
  connection_string: $POSTGRES_DSN   # 与 checkpointer 共用同一 DSN
```

---

## Error Handling

- `append` 失败：`logger.warning`，不阻断 SSE 主流程
- `subscribe_live` 连接断开：客户端通过 `Last-Event-ID` 重连，从断点继续
- PG 不可用：`LoggingStreamBridge` 降级为透传（event log 静默禁用）

---

## Testing

- `tests/test_postgres_event_log.py`：单元测试 append / list / subscribe_live
- `tests/test_logging_stream_bridge.py`：mock PostgresEventLog，验证 publish 触发 append
- 前端：`use-event-log.ts` 的 hook 测试（mock fetch + EventSource）
