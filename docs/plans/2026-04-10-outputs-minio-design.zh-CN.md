# Outputs → MinIO 集成设计

**日期**：2026-04-10  
**状态**：已批准

## 问题

Agent 产生的文件（`/mnt/user-data/outputs/`）目前仅存储在本地文件系统。在多节点集群中,生成文件的节点可能并不是通过 artifacts API 对外提供下载的节点,从而导致 404 错误。

## 范围之外

| 领域 | 决策 | 原因 |
|---|---|---|
| Workspace（`/mnt/user-data/workspace/`） | 共享卷 | bash 写入无法干净地被拦截 |
| 技能（`skills/custom/`） | 共享卷 | 已由部署方案覆盖 |
| 上传文件 | 已完成 | 上一期已修复 |

## 设计

### Push：`present_file_tool.py`

`present_files` 是 agent 向用户"明确示意某个文件已准备好"的唯一显式信号,这是 outputs 在 Python 层面唯一干净的钩子。

在完成文件路径归一化（现有逻辑）之后,将每个文件上传至 MinIO：

- **对象键（Object key）**：`{thread_id}/outputs/{relative_path}` —— 加上 `outputs/` 命名空间前缀,以便与上传文件（`{thread_id}/{filename}`）区分
- **Bucket**：复用 `deerflow-uploads` bucket,通过 `uploads_config` 配置
- **错误处理**：非致命 —— 失败时记录 warning,不打断工具返回
- **依赖**：复用 `deerflow.uploads.backends.minio` 中的现有 `MinioUploadBackend`（harness 内部,不存在跨层导入）

### Pull：`artifacts.py`（兜底）

当调用 `GET /api/threads/{id}/artifacts/mnt/user-data/outputs/{path}` 时：

```
本地文件存在                     → 直接本地返回（行为不变）
本地文件不存在 + MinIO 已配置    → 从 MinIO 拉取,返回内容
本地文件不存在 + 未配置 MinIO    → 404（行为不变）
```

对象键推导：将虚拟路径中的 `/mnt/user-data/` 前缀剥离,即得到 `outputs/{relative_path}`。

## 数据流

```
Agent
  └─ bash 将文件写入 → /mnt/user-data/outputs/（本地磁盘）
  └─ present_files(["outputs/report.xlsx"])
       ├─ 归一化路径 → /mnt/user-data/outputs/report.xlsx
       ├─ 上传到 MinIO：deerflow-uploads / {thread_id}/outputs/report.xlsx
       └─ 返回 Command(artifacts=[...])

用户下载文件
  └─ GET /api/threads/{id}/artifacts/mnt/user-data/outputs/report.xlsx
       ├─ 检查本地磁盘 → 找到 → 直接返回（快速路径）
       └─ 未找到 → MinIO.load({thread_id}, "outputs/report.xlsx") → 返回
```

## 涉及变更的文件

| 文件 | 变更 |
|---|---|
| `packages/harness/deerflow/tools/builtins/present_file_tool.py` | 路径归一化后追加 MinIO 上传 |
| `app/gateway/routers/artifacts.py` | 在 404 分支中加入 MinIO 兜底 |

无新增文件,无 schema 变更,无配置项变更。
