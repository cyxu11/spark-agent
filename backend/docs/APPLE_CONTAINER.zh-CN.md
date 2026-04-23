# Apple Container 支持

DeerFlow 现已在 macOS 上将 Apple Container 作为首选容器运行时,并在不可用时自动回退到 Docker。

## 概览

从本版本起,DeerFlow 会在 macOS 上自动探测并使用 Apple Container,在以下情况回退到 Docker：
- 未安装 Apple Container
- 运行在非 macOS 平台

这在 Apple Silicon Mac 上能带来更好的性能,同时保持在所有平台上的兼容性。

## 优势

### 在支持 Apple Container 的 Apple Silicon Mac 上：
- **性能更好**：原生 ARM64 执行,无需经过 Rosetta 2 转译
- **资源占用更低**：比 Docker Desktop 更轻量
- **原生集成**：基于 macOS Virtualization.framework

### 回退到 Docker 时：
- 完整的向后兼容
- 可在所有平台上运行(macOS、Linux、Windows)
- 无需修改任何配置

## 前置要求

### Apple Container(仅 macOS)：
- macOS 15.0 或更高
- Apple Silicon(M1/M2/M3/M4)
- 已安装 Apple Container CLI

### 安装：
```bash
# 从 GitHub releases 下载
# https://github.com/apple/container/releases

# 验证安装
container --version

# 启动服务
container system start
```

### Docker(全平台)：
- Docker Desktop 或 Docker Engine

## 工作原理

### 自动探测

`AioSandboxProvider` 会自动探测可用的容器运行时：

1. 在 macOS：尝试 `container --version`
   - 成功 → 使用 Apple Container
   - 失败 → 回退到 Docker

2. 其他平台：直接使用 Docker

### 运行时差异

两种运行时的命令语法几乎完全相同：

**启动容器：**
```bash
# Apple Container
container run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image

# Docker
docker run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image
```

**清理容器：**
```bash
# Apple Container(已带 --rm)
container stop <id>  # 因为 --rm,会自动移除

# Docker(已带 --rm)
docker stop <id>     # 因为 --rm,会自动移除
```

### 实现细节

实现位于 `backend/packages/harness/deerflow/community/aio_sandbox/aio_sandbox_provider.py`：

- `_detect_container_runtime()`：在启动阶段探测可用的运行时
- `_start_container()`：使用探测到的运行时,并针对 Apple Container 跳过 Docker 特有选项
- `_stop_container()`：根据运行时使用对应的停止命令

## 配置

无需修改任何配置！系统会自动工作。

不过你可以通过日志确认当前在使用哪个运行时：

```
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Detected Apple Container: container version 0.1.0
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using container: ...
```

使用 Docker 时：
```
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Apple Container not available, falling back to Docker
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using docker: ...
```

## 容器镜像

两种运行时都使用 OCI 兼容的镜像,默认镜像在两者下都可用：

```yaml
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  image: enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest  # 默认镜像
```

请确保镜像支持对应架构：
- ARM64：Apple Silicon + Apple Container
- AMD64：Intel Mac + Docker
- 多架构镜像两者均可用

### 提前拉取镜像(推荐)

**重要**：容器镜像通常较大(≥500MB),并且只在首次使用时拉取,这会导致长时间无反馈的等待。

**最佳实践**：在安装阶段就把镜像拉下来：

```bash
# 从项目根目录执行
make setup-sandbox
```

该命令会：
1. 读取 `config.yaml` 中配置的镜像(或使用默认值)
2. 探测可用的运行时(Apple Container 或 Docker)
3. 带进度显示地拉取镜像
4. 校验镜像已可使用

**手动拉取**：

```bash
# 使用 Apple Container
container image pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest

# 使用 Docker
docker pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest
```

若跳过此步骤,镜像会在首次执行 agent 时自动拉取,根据网络速度可能耗时数分钟。

## 清理脚本

项目提供了统一的清理脚本,可同时处理两种运行时：

**脚本：** `scripts/cleanup-containers.sh`

**用法：**
```bash
# 清理所有 DeerFlow sandbox 容器
./scripts/cleanup-containers.sh deer-flow-sandbox

# 自定义前缀
./scripts/cleanup-containers.sh my-prefix
```

**与 Makefile 集成：**

`Makefile` 中的所有清理命令都会自动处理两种运行时：
```bash
make stop   # 停止所有服务并清理容器
make clean  # 完整清理,包含日志
```

## 测试

测试容器运行时探测：

```bash
cd backend
python test_container_runtime.py
```

该脚本会：
1. 探测可用的运行时
2. 可选地启动一个测试容器
3. 验证连通性
4. 清理资源

## 故障排查

### macOS 下未探测到 Apple Container

1. 检查是否安装：
   ```bash
   which container
   container --version
   ```

2. 检查服务是否运行：
   ```bash
   container system start
   ```

3. 查看探测日志：
   ```bash
   # 在应用日志中查找探测消息
   grep "container runtime" logs/*.log
   ```

### 容器未被清理

1. 手动查看在跑的容器：
   ```bash
   # Apple Container
   container list

   # Docker
   docker ps
   ```

2. 手动执行清理脚本：
   ```bash
   ./scripts/cleanup-containers.sh deer-flow-sandbox
   ```

### 性能问题

- Apple Container 在 Apple Silicon 上应当更快
- 若出现问题,可通过临时重命名 `container` 命令来强制使用 Docker：
   ```bash
   # 临时方案 —— 不建议长期使用
   sudo mv /opt/homebrew/bin/container /opt/homebrew/bin/container.bak
   ```

## 参考

- [Apple Container GitHub](https://github.com/apple/container)
- [Apple Container 文档](https://github.com/apple/container/blob/main/docs/)
- [OCI 镜像规范](https://github.com/opencontainers/image-spec)
