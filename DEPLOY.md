# Spark-Agent 完整部署方案

## 目录

1. [系统架构总览](#1-系统架构总览)
2. [前置条件](#2-前置条件)
3. [方案一：本地源码部署（开发/测试）](#3-方案一本地源码部署开发测试)
4. [方案二：Docker 单机部署（推荐生产）](#4-方案二docker-单机部署推荐生产)
5. [方案三：Docker + 中间件集群部署（高可用）](#5-方案三docker--中间件集群部署高可用)
6. [配置详解](#6-配置详解)
7. [LLM 模型接入](#7-llm-模型接入)
8. [验证与排障](#8-验证与排障)

---

## 1. 系统架构总览

```
用户浏览器
    │
    ▼
Nginx (port 2026)          ← 统一入口/反向代理
    ├── /api/langgraph/* → LangGraph Server (port 2024)  ← Agent 运行时
    ├── /api/*           → Gateway API     (port 8001)   ← 模型/MCP/技能/内存
    └── /*               → Frontend        (port 3000)   ← Next.js Web UI

可选中间件（集群模式）:
    PostgreSQL (port 5432)   ← 状态持久化 / Checkpoint
    Redis      (port 6379)   ← SSE 流桥接（多节点）
    MinIO      (port 9000)   ← 文件上传存储（多节点）
```

---

## 2. 前置条件

### 方案一（本地源码）需要安装

| 工具 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | >= 22 | https://nodejs.org |
| pnpm | 任意 | `npm install -g pnpm` |
| Python uv | 任意 | https://docs.astral.sh/uv/getting-started/installation/ |
| nginx | 任意 | macOS: `brew install nginx` / Ubuntu: `apt install nginx` |

### 方案二/三（Docker）只需要

| 工具 | 版本要求 |
|------|---------|
| Docker Engine | >= 24 |
| Docker Compose | >= 2.20 (插件版) |

---

## 3. 方案一：本地源码部署（开发/测试）

### 步骤 1：克隆代码

```bash
git clone <repo-url> spark-agent
cd spark-agent
```

### 步骤 2：检查依赖

```bash
make check
# 所有工具显示 OK 后继续
```

### 步骤 3：安装依赖

```bash
make install
```

### 步骤 4：生成配置文件

```bash
make config
# 生成 config.yaml 和 extensions_config.json
```

### 步骤 5：配置 LLM 模型（必须）

编辑 `config.yaml`，在 `models:` 下取消注释并填写至少一个模型，例如 OpenAI：

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY   # 或直接填写 key 字符串
    request_timeout: 600.0
    max_retries: 2
    supports_vision: true
```

在当前 shell 中导出 API Key（或写入 `.env` 文件）：

```bash
export OPENAI_API_KEY="sk-..."
# 或其他模型对应的环境变量
```

### 步骤 6：启动服务

```bash
# 开发模式（热重载）
make dev

# 生产模式（优化）
make start

# 后台运行（守护进程）
make start-daemon
```

### 步骤 7：访问

浏览器打开 `http://localhost:2026`

### 停止服务

```bash
make stop
```

---

## 4. 方案二：Docker 单机部署（推荐生产）

这是**最推荐**的部署方式，仅需 Docker，无需安装其他工具。

### 步骤 1：获取代码

```bash
git clone <repo-url> spark-agent
cd spark-agent
```

### 步骤 2：准备配置文件

```bash
# 从示例生成配置（首次）
cp config.example.yaml config.yaml
```

### 步骤 3：配置 LLM 模型

同上，编辑 `config.yaml` 的 `models:` 部分填写 API Key。

也可以在项目根目录创建 `.env` 文件统一管理密钥：

```bash
# .env（根目录）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
# 其他模型 key...
```

### 步骤 4：构建并启动

```bash
# 一键构建 + 启动（标准模式，含 LangGraph Server）
make up

# 或者 Gateway 模式（LangGraph 运行时嵌入 Gateway，更轻量）
make up-pro
```

### 步骤 5：访问

```
http://localhost:2026
```

### 常用管理命令

```bash
make down                              # 停止并删除容器
make up                                # 重新构建并启动（代码更新后用）
docker compose -p deer-flow logs -f    # 查看实时日志
```

---

## 5. 方案三：Docker + 中间件集群部署（高可用）

当需要**多进程并发、数据持久化、文件上传**时启用此方案。

### 步骤 1：启动中间件

```bash
# 设置中间件密码
cat > docker/.env << 'EOF'
POSTGRES_PASSWORD=your_strong_password
MINIO_SECRET_KEY=your_minio_password
EOF

# 启动 PostgreSQL + Redis + MinIO
docker compose -f docker/docker-compose.middleware.yaml up -d
```

验证中间件健康：

```bash
docker compose -f docker/docker-compose.middleware.yaml ps
# 所有服务应显示 healthy
```

### 步骤 2：配置 config.yaml 启用中间件

编辑 `config.yaml`，启用以下部分：

```yaml
# 1. 使用 PostgreSQL 持久化 Checkpoint（替换默认 sqlite）
checkpointer:
  type: postgres
  connection_string: postgresql://deerflow:your_strong_password@localhost:5432/deerflow

# 2. 启用 Redis 流桥接（多节点 SSE 分发）
stream_bridge:
  type: redis
  redis_url: redis://localhost:6379

# 3. 启用 MinIO 文件上传存储
uploads:
  backend: minio
  minio:
    endpoint: localhost:9000
    access_key: minioadmin
    secret_key: your_minio_password
    bucket: deerflow-uploads
    secure: false
```

### 步骤 3：配置应用环境变量

项目根目录 `.env` 文件：

```bash
# LLM 模型密钥
OPENAI_API_KEY=sk-...

# 中间件连接（传递给容器）
POSTGRES_DSN=postgresql://deerflow:your_strong_password@host.docker.internal:5432/deerflow
REDIS_URL=redis://host.docker.internal:6379
MINIO_ENDPOINT=host.docker.internal:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=your_minio_password
```

### 步骤 4：启动应用

```bash
make up
```

---

## 6. 配置详解

### config.yaml 关键字段

```yaml
# ── LLM 模型（必须配置至少一个）──
models:
  - name: gpt-4o           # 内部标识
    display_name: GPT-4o   # 前端显示名
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY

# ── 沙箱模式（选择一种）──
# 本地模式（默认，直接在主机执行）:
sandbox:
  use: deerflow.sandbox.local:LocalSandboxProvider
  allow_host_bash: false

# 容器隔离模式（需要 Docker）:
# sandbox:
#   use: deerflow.community.aio_sandbox:AioSandboxProvider

# ── 记忆存储（开箱即用）──
memory:
  enabled: true
  storage_path: memory.json

# ── 状态持久化 ──
# 单机 SQLite（默认）:
checkpointer:
  type: sqlite
  connection_string: checkpoints.db

# 多进程 PostgreSQL:
# checkpointer:
#   type: postgres
#   connection_string: postgresql://user:pass@host:5432/db
```

### 环境变量对照表

| 变量 | 说明 | 默认值 |
|------|------|-------|
| `DEER_FLOW_CONFIG_PATH` | config.yaml 路径 | `./config.yaml` |
| `DEER_FLOW_HOME` | 运行时数据目录 | `./backend/.deer-flow` |
| `BETTER_AUTH_SECRET` | 前端 Session 密钥 | 自动生成 |
| `PORT` | Nginx 监听端口 | `2026` |
| `POSTGRES_DSN` | PostgreSQL 连接串 | 空（使用 SQLite） |
| `REDIS_URL` | Redis 连接串 | 空（单节点模式） |

---

## 7. LLM 模型接入

支持的模型提供商（在 `config.yaml` 的 `models:` 中取消注释对应示例）：

| 提供商 | 环境变量 | 备注 |
|-------|---------|------|
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4 等 |
| Anthropic | `ANTHROPIC_API_KEY` | Claude 3.5 等 |
| DeepSeek | `DEEPSEEK_API_KEY` | 支持 Thinking 模式 |
| Google Gemini | `GEMINI_API_KEY` | 原生 SDK |
| 火山引擎（豆包） | `VOLCENGINE_API_KEY` | 国内推荐 |
| Moonshot (Kimi) | `MOONSHOT_API_KEY` | K2.5 等 |
| 本地 vLLM | 无需 Key | 指向本地接口地址 |
| 任意 OpenAI 兼容 | 自定义 | 配置 `base_url` 即可 |

---

## 8. 验证与排障

### 检查服务状态

```bash
# Docker 部署
docker compose -p deer-flow ps

# 本地部署
cat logs/*.log
```

### 健康检查端点

```bash
curl http://localhost:2026/api/models         # 返回可用模型列表
curl http://localhost:2026/api/langgraph/ok   # LangGraph 存活检查
```

### 常见问题

| 现象 | 排查方向 |
|------|---------|
| 无法访问 2026 端口 | 检查 nginx 是否启动；检查防火墙 |
| 模型列表为空 | `config.yaml` 的 `models:` 是否取消注释并填写 API Key |
| Agent 无响应 | 检查 LangGraph 容器日志（见下方） |
| 文件上传失败 | MinIO 是否启动；检查 `uploads:` 配置 |
| 容器间无法通信 | 确认均在 `deer-flow` Docker 网络中 |

### 查看日志

```bash
# 全部服务日志
docker compose -p deer-flow logs -f

# 单独服务
docker compose -p deer-flow logs -f gateway
docker compose -p deer-flow logs -f langgraph
docker compose -p deer-flow logs -f frontend
```

---

## 快速参考

```bash
# 首次部署（Docker，推荐）
git clone <repo> && cd spark-agent
cp config.example.yaml config.yaml   # 编辑填写模型 API Key
make up                               # 构建 + 启动
# 访问 http://localhost:2026

# 更新代码后重新部署
git pull
make down && make up

# 停止
make down
```
