# Spark-Agent Linux 部署手册（离线 / 内网版）

目标环境：单台 **aarch64** Linux 服务器（BCLinux 21.10 / 鲲鹏 920），
部署机完全不出公网，仅能访问内网中间件与 LLM API。

## 0. 总览

整体路线：**在一台能出网的 aarch64 机器上"打包构建产物"→ 离线机 docker load → 启动**。

需要的机器：

1. **构建机**：能出公网、与部署机**同架构（aarch64）**、装好 Docker + compose v2。
2. **部署机**：目标 Linux 服务器，只能访问内网中间件。

已知中间件：


| 组件             | 地址                          | 凭证                                   |
| -------------- | --------------------------- | ------------------------------------ |
| PostgreSQL     | `10.88.24.91:5432`          | `postgres` / `Pg@123456`             |
| Redis          | `192.168.24.2:46381`        | password=`123456`                    |
| MinIO (S3 API) | `http://192.168.24.2:39000` | access=`datahub` secret=`datahub123` |


> 部署机要能 TCP 访问以上三个地址，且能调用 LLM API（OpenAI / DashScope / 内部 vLLM）。

---

## 1. 在**构建机**上准备离线包

### 1.1 基本依赖

```bash
# 如果构建机是 x86_64，必须用 buildx 做跨架构构建；
# 推荐直接找一台 aarch64 机器（云厂商的 ARM 实例最省事）。
uname -m    # 应输出 aarch64

curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
docker --version
```

### 1.2 装 Docker Compose v2 插件（aarch64）

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL \
  https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

# 顺便把这个二进制复制出来，稍后要拷到部署机
cp /usr/local/lib/docker/cli-plugins/docker-compose ~/offline/docker-compose-aarch64
```

### 1.3 拉代码 + 构建镜像

```bash
mkdir -p ~/offline && cd ~/offline
git clone <your-repo-url> spark-agent
cd spark-agent
make config                         # 生成 config.yaml / extensions_config.json
./scripts/deploy.sh build           # 只 build，不 start
```

构建完应有 3 个本地镜像：

```bash
docker images | grep deer-flow
# deer-flow-frontend    latest   ...
# deer-flow-gateway     latest   ...
# deer-flow-langgraph   latest   ...
```

搭配 `nginx:alpine` 一共 4 个要打包 —— **除非你采用 §6b 复用宿主 Nginx，
那就不需要 `nginx:alpine`，下面 3 个镜像就够**。

### 1.4 导出镜像 + 压缩资产

```bash
cd ~/offline
```

**A. 用自带 nginx 容器（默认 `:2026` 入口）—— 4 个镜像：**

```bash
# Apple Silicon Mac 默认 pull arm64；Intel Mac 必须加 --platform
docker pull nginx:alpine
# Intel Mac: docker pull --platform linux/arm64 nginx:alpine

docker save \
  nginx:alpine \
  deer-flow-frontend:latest \
  deer-flow-gateway:latest \
  deer-flow-langgraph:latest \
  | gzip -1 > spark-agent-images.tar.gz
```

**B. 复用宿主 Nginx（§6b 方案，入口 `:40009`）—— 3 个镜像，跳过 nginx:alpine：**

```bash
docker save \
  deer-flow-frontend:latest \
  deer-flow-gateway:latest \
  deer-flow-langgraph:latest \
  | gzip -1 > spark-agent-images.tar.gz
```

> 选 B 的原因：`docker-compose.override.yaml` 已经通过 `profiles: ["disabled"]`
> 禁用了 nginx 容器，compose 根本不会引用这个镜像；打进包里只是增加 ~80 MB 体积。

继续打包仓库源码：

```bash
# 部署机需要 docker-compose.yaml / scripts / nginx.conf 等
tar czf spark-agent-repo.tar.gz --exclude='.git' --exclude='node_modules' --exclude='.venv' spark-agent/

ls -lh
# spark-agent-images.tar.gz    ~1.5-2 GB (A) / ~1.4-1.9 GB (B)
# spark-agent-repo.tar.gz      ~50 MB
# docker-compose-aarch64       ~60 MB
```

把这三个文件通过 scp / U盘 / 跳板机挪到**部署机**。

---

## 2. 在**部署机**上安装 Docker（离线）

BCLinux 欧拉 21.10 一般预装了老的 docker-compose v5（独立二进制，不是我们要的 v2 插件）。
你截图里的 `docker` 自带足够用，我们只补装 compose v2 插件：

```bash
# 登机器后
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo install -m755 /tmp/docker-compose-aarch64 \
  /usr/local/lib/docker/cli-plugins/docker-compose

docker --version
docker compose version    # 应返回 Docker Compose version v2.29.7
```

> 如果部署机连 Docker Engine 都没装，那就得离线装 docker-ce。BCLinux 软件源里一般有，
> `sudo yum install -y docker-ce` 即可；没有就从构建机 `yumdownloader --resolve docker-ce`
> 把 rpm 下来一并拷过去 `rpm -ivh *.rpm`。

防火墙放通：

```bash
sudo firewall-cmd --permanent --add-port=2026/tcp
sudo firewall-cmd --reload
```

---

## 2b. 中间件初始化（一次性，可在任何能连上中间件的机器做）

### 2.1 PostgreSQL：建库建用户

在 PG 侧执行（或用 `psql -h 10.88.24.91 -U postgres` 连进去执行）：

```sql
CREATE ROLE deerflow LOGIN PASSWORD 'deerflow_app_pwd';
CREATE DATABASE deerflow OWNER deerflow;
CREATE DATABASE deerflow_events OWNER deerflow;   -- 事件日志（可选但推荐）
GRANT ALL PRIVILEGES ON DATABASE deerflow TO deerflow;
GRANT ALL PRIVILEGES ON DATABASE deerflow_events TO deerflow;
```

LangGraph checkpoint / Store 表会在首次运行自动建。

### 2.2 MinIO：建桶 + 放行匿名读

用 `mc` 或者 MinIO Console 建两个桶（生产建议分开）：

```bash
# 用 mc 举例
mc alias set dh http://192.168.24.2:39000 datahub datahub123
mc mb dh/deerflow-uploads
mc mb dh/deerflow-outputs

# outputs 桶匿名可读，这样导出的 HTML 报告分享链接可以直开
mc anonymous set download dh/deerflow-outputs
```

### 2.3 Redis：无需初始化

确认从部署机能连：

```bash
redis-cli -h 192.168.24.2 -p 46381 -a 123456 ping     # → PONG
```

---

## 3. 解压仓库 + 加载镜像（离线）

在部署机上：

```bash
mkdir -p /opt/spark-agent && cd /opt/spark-agent
# 假设 3 个离线文件已经拷到 /tmp
tar xzf /tmp/spark-agent-repo.tar.gz --strip-components=1
docker load < /tmp/spark-agent-images.tar.gz

docker images | grep -E "deer-flow|nginx"
# deer-flow-frontend    latest   ...
# deer-flow-gateway     latest   ...
# deer-flow-langgraph   latest   ...
# nginx                 alpine   ...
```

> `make config` 不用再跑，构建机上已经生成过 `config.yaml` / `extensions_config.json`
> 并打进了源码包（如果没打进来，仓库里的 `config.example.yaml` 也能 `cp config.example.yaml config.yaml` 来初始化）。

---

## 4. `config.yaml` 关键改动

编辑项目根目录 `config.yaml`，定位并替换以下段（未列出的保持默认）：

```yaml
# --- 状态持久化：Postgres checkpointer ---------------------------------
checkpointer:
  type: postgres
  connection_string: postgresql://deerflow:deerflow_app_pwd@10.88.24.91:5432/deerflow

# --- SSE 流桥接：Redis（多进程 / 多节点需要）---------------------------
stream_bridge:
  type: redis
  redis_url: redis://:123456@192.168.24.2:46381/0

# --- 事件日志：用同一个 PG 或独立 DB -----------------------------------
event_log:
  enabled: true
  connection_string: postgresql://deerflow:deerflow_app_pwd@10.88.24.91:5432/deerflow_events

# --- 上传 / 产物：统一走 MinIO ----------------------------------------
uploads:
  backend: minio
  minio:
    endpoint: 192.168.24.2:39000        # 不带 http://
    access_key: datahub
    secret_key: datahub123
    bucket: deerflow-uploads
    secure: false                        # HTTP 就 false

outputs:
  backend: minio
  minio:
    endpoint: 192.168.24.2:39000
    access_key: datahub
    secret_key: datahub123
    bucket: deerflow-outputs
    secure: false
```

其它要确认的：

- `models[]` 里填你的 LLM（`$OPENAI_API_KEY` 之类走环境变量）
- `sandbox.use` 生产建议用 `deerflow.community.aio_sandbox.AioSandboxProvider`（Docker 隔离）
- `memory.storage_path` 保持默认即可（落在 `DEER_FLOW_HOME` 里）

---

## 5. `.env` 文件

在仓库根目录新建 `.env`（供 `scripts/deploy.sh` + docker compose 读取）：

```bash
# 服务端口
PORT=2026

# 会话密钥（一定要改！至少 32 字节随机）
BETTER_AUTH_SECRET=$(openssl rand -hex 32)

# 中间件连接串（容器里读，用于环境变量占位解析 $VAR_NAME）
POSTGRES_DSN=postgresql://deerflow:deerflow_app_pwd@10.88.24.91:5432/deerflow
REDIS_URL=redis://:123456@192.168.24.2:46381/0
MINIO_ENDPOINT=192.168.24.2:39000
MINIO_ACCESS_KEY=datahub
MINIO_SECRET_KEY=datahub123

# LLM，二选一或都填
OPENAI_API_KEY=sk-xxxxxxxx
DASHSCOPE_API_KEY=sk-xxxxxxxx

# 可选：LangSmith 观测
LANGSMITH_TRACING=false
# LANGSMITH_API_KEY=
```

> 把 `openssl rand -hex 32` 的实际输出写进去，别真留 `$(...)`。

---

## 6. 启动服务（用离线镜像直接起）

```bash
cd /opt/spark-agent

# 关键：走 start 子命令，不会尝试重新 build / pull
./scripts/deploy.sh start

# 停止
./scripts/deploy.sh down
```

4 个容器全部 up：

```
deer-flow-nginx       2026:2026
deer-flow-frontend    3000
deer-flow-gateway     8001
deer-flow-langgraph   2024
```

访问 `http://<服务器IP>:2026` 即可。

> **注意容器到外部中间件的网络**：`10.88.24.91` 和 `192.168.24.2` 必须从容器内可达。
> 默认 compose 使用 bridge 网络，一般直接走宿主机的路由即可。
> 如果 Docker bridge 无法路由到这些 IP（双网卡 + 策略路由），把服务段改成
> `network_mode: host` 或配 iptables NAT。

> **docker pull 失败**：如果 deploy.sh 还是尝试去 pull `nginx:alpine`，确认
> `docker images | grep nginx` 里已经有本地 `alpine` tag；没有说明 `docker load`
> 漏了，回构建机重新 save 一次。

---

## 6b. 复用已有 Nginx（监听 `:40009`）

> 这台机器上已经有 Nginx 服务在 `40009` 端口工作，我们**不再启动仓库自带的
> nginx 容器**，把前端/网关/LangGraph 三个服务暴露到宿主机 `127.0.0.1`，
> 由外部 Nginx 反代过来。

### 6b.1 关掉容器 nginx，把服务端口露到宿主

在 `docker/` 目录新建 `docker-compose.override.yaml`（compose 会自动合并）：

```yaml
# docker/docker-compose.override.yaml
services:
  nginx:
    profiles: ["disabled"]   # 不参与默认启动
    deploy:
      replicas: 0

  frontend:
    ports:
      - "127.0.0.1:3000:3000"

  gateway:
    ports:
      - "127.0.0.1:8001:8001"

  langgraph:
    ports:
      - "127.0.0.1:2024:2024"
```

> 绑 `127.0.0.1` 是防止三个后端端口直接暴露外网；只让本机 nginx 访问。
> 如果 nginx 所在主机与 Docker 不在同机，把 `127.0.0.1` 改成 `0.0.0.0`
> 并用防火墙限制源 IP。

重启：

```bash
cd /opt/spark-agent
./scripts/deploy.sh down
./scripts/deploy.sh start
docker ps         # 应只有 3 个容器，没有 deer-flow-nginx
```

### 6b.2 在宿主 Nginx 增加 server 段

在你已有 nginx 的 `/etc/nginx/conf.d/` 放一个 `spark-agent.conf`：

```nginx
server {
    listen 40009;
    server_name _;

    client_max_body_size 100M;

    # CORS（由前置 nginx 统一处理）
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, PATCH, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' '*' always;
    if ($request_method = 'OPTIONS') { return 204; }

    # ── LangGraph Server（standard 模式下必需）────────────────────────
    location /api/langgraph/ {
        rewrite ^/api/langgraph/(.*) /$1 break;
        proxy_pass http://127.0.0.1:2024;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        chunked_transfer_encoding on;
    }

    # ── Gateway LangGraph-compat（前端 useStream 走这个）───────────────
    location /api/langgraph-compat/ {
        rewrite ^/api/langgraph-compat/(.*) /api/$1 break;
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        chunked_transfer_encoding on;
    }

    # ── 会话事件 SSE 长连接（必须在 /api/threads 通配之前）─────────────
    location ~ ^/api/threads/[^/]+/runs/[^/]+/events/stream {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        chunked_transfer_encoding on;
    }

    # ── 文件上传（关闭请求缓冲，避免大文件先落 nginx 临时目录）─────────
    location ~ ^/api/threads/[^/]+/uploads {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_request_buffering off;
        client_max_body_size 100M;
    }

    # ── 其它 /api/*（models / mcp / skills / memory / exports …）───────
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # ── 其余走 Next.js 前端 ───────────────────────────────────────────
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 600s;
    }
}
```

```bash
sudo nginx -t && sudo nginx -s reload
sudo firewall-cmd --permanent --add-port=40009/tcp
sudo firewall-cmd --reload
```

### 6b.3 前端无需改环境变量

前端默认 `NEXT_PUBLIC_LANGGRAPH_BASE_URL=/api/langgraph-compat`、
`NEXT_PUBLIC_BACKEND_BASE_URL=""`，都是相对路径，浏览器自动走当前访问的
`:40009`，无需重新构建。

### 6b.4 路由对照（排错用）


| 前端访问路径                                | 反代到     | 用途                             |
| ------------------------------------- | ------- | ------------------------------ |
| `/api/langgraph-compat/*`             | `:8001` | agent 执行 / SSE 流式消息            |
| `/api/threads/*/runs/*/events/stream` | `:8001` | SessionEvents 事件 SSE           |
| `/api/threads/*/uploads`              | `:8001` | 文件上传                           |
| `/api/threads/*/exports/*`            | `:8001` | HTML 报告导出 / 分享链接               |
| `/api/*`（其余）                          | `:8001` | Models / MCP / Skills / Memory |
| `/api/langgraph/*`                    | `:2024` | LangGraph Server（standard 模式）  |
| `/*`                                  | `:3000` | Next.js UI                     |


---

## 7. 验证

> 下面把 `:2026` 替换成你实际的入口端口（自带 nginx 就是 `:2026`，
> 复用本机已有 nginx 就是 `:40009`）。

```bash
# 1. 健康检查
curl -sf http://localhost:40009/health             # gateway
curl -sf http://localhost:40009/api/langgraph/info # langgraph

# 2. 测试 Postgres 建表
docker logs deer-flow-gateway 2>&1 | grep -i "checkpointer\|store"

# 3. 测试 MinIO 通路
docker exec deer-flow-gateway sh -c \
  'curl -sf http://192.168.24.2:39000/minio/health/live'

# 4. 打开 Web，新建会话跑一条消息；
#    进历史会话页检查创建时间、状态徽章；
#    进一个 .md 报告点"导出 HTML 网页"，看能否拿到分享链接
```

---

## 8. 常见问题


| 现象                                     | 排查                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ERR_INCOMPLETE_CHUNKED_ENCODING` 刷新报错 | Redis 连通不上。`docker exec deer-flow-gateway redis-cli -h 192.168.24.2 -p 46381 -a 123456 ping` |
| `/threads/search` 很慢                   | 检查 `checkpointer` 是否真的用上 PG；首次 Phase 2 扫描会慢，后续自动收敛                                           |
| 导出 HTML 的分享链接打不开                       | `deerflow-outputs` 桶忘开匿名读；`mc anonymous set download dh/deerflow-outputs`                    |
| 上传文件 403 / 空白                          | MinIO 凭证错 或 桶不存在；gateway 日志会打 `MinioUploadBackend` 错误                                        |
| 前端 CORS / 404                          | 走 nginx 入口 `:2026`，别直连前端 `:3000`；检查 `nginx.conf` 挂载                                          |
| LLM 请求超时                               | 部署机需出网；确认 `config.yaml` 里模型的 `base_url` 可达                                                   |


日志位置：

```bash
docker logs -f deer-flow-gateway
docker logs -f deer-flow-langgraph
docker logs -f deer-flow-frontend
docker logs -f deer-flow-nginx
```

---

## 9. 升级（离线）

升级走"在构建机重新打包 → 增量传到部署机 → 重新 load"的流程：

**构建机：**

```bash
cd ~/offline/spark-agent
git pull
./scripts/deploy.sh build

# 只导变更的镜像即可（gateway/langgraph 后端改了就这俩；frontend 动了就加 frontend）
docker save deer-flow-gateway:latest deer-flow-langgraph:latest \
  | gzip -1 > ~/offline/spark-agent-images-upgrade.tar.gz

# 如果 config.example.yaml 有新字段，把最新的仓库也打包给部署机参考
tar czf ~/offline/spark-agent-repo.tar.gz --exclude='.git' --exclude='node_modules' --exclude='.venv' spark-agent/
```

**部署机：**

```bash
cd /opt/spark-agent
./scripts/deploy.sh down

# 加载新镜像
docker load < /tmp/spark-agent-images-upgrade.tar.gz

# 如果需要更新源码（nginx.conf / scripts / docker-compose.yaml 改了）：
tar xzf /tmp/spark-agent-repo.tar.gz --strip-components=1
# 保留原 config.yaml / .env 不动；如果 example 有新字段：
#   diff config.yaml config.example.yaml  自己手动合并

./scripts/deploy.sh start
```

`config.yaml` 新字段可能需要补：

```bash
make config-upgrade         # 合并 example 新字段到现有 config.yaml
```

---

## 10. 安全加固（上生产前）

1. `BETTER_AUTH_SECRET` 必须强随机。
2. MinIO `deerflow-uploads` **保持私有**（不 anonymous download），仅 outputs 桶开读。
3. 对外只暴露 `:2026`，`:3000 / :8001 / :2024` 用防火墙挡掉。
4. 前面加 TLS：建议再套一层 Nginx / Caddy 做 HTTPS，`proxy_pass http://localhost:2026`。
5. `config.yaml` 含明文密钥，注意文件权限 `chmod 600 config.yaml .env`。

