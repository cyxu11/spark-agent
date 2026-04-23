# 安装指南

DeerFlow 的快速安装说明。

## 配置文件安装

DeerFlow 使用一个 YAML 配置文件,它应当放在**项目根目录**下。

### 步骤

1. **进入项目根目录**：
   ```bash
   cd /path/to/deer-flow
   ```

2. **复制示例配置**：
   ```bash
   cp config.example.yaml config.yaml
   ```

3. **编辑配置**：
   ```bash
   # 方式 A：设置环境变量(推荐)
   export OPENAI_API_KEY="your-key-here"

   # 方式 B：直接编辑 config.yaml
   vim config.yaml  # 或你常用的编辑器
   ```

4. **验证配置**：
   ```bash
   cd backend
   python -c "from deerflow.config import get_app_config; print('✓ Config loaded:', get_app_config().models[0].name)"
   ```

## 重要说明

- **位置**：`config.yaml` 应当放在 `deer-flow/`(项目根目录)下,而不是 `deer-flow/backend/`
- **Git**：`config.yaml` 已默认被 git 忽略(包含敏感信息)
- **优先级**：如果 `backend/config.yaml` 和 `../config.yaml` 同时存在,backend 下的版本优先

## 配置文件查找顺序

后端按以下顺序查找 `config.yaml`：

1. `DEER_FLOW_CONFIG_PATH` 环境变量(如果已设置)
2. `backend/config.yaml`(在 backend/ 目录下运行时的当前目录)
3. `deer-flow/config.yaml`(上级目录 —— **推荐位置**)

**推荐做法**：将 `config.yaml` 放在项目根目录(`deer-flow/config.yaml`)。

## Sandbox 准备工作(可选但建议执行)

如果你计划使用基于 Docker/Container 的 sandbox(在 `config.yaml` 的 `sandbox.use: deerflow.community.aio_sandbox:AioSandboxProvider` 中配置),强烈建议提前拉取容器镜像：

```bash
# 从项目根目录执行
make setup-sandbox
```

**为什么要提前拉取？**
- Sandbox 镜像(≥500MB)会在首次使用时拉取,会造成较长等待
- 提前拉取可以看到清晰的进度指示
- 避免首次使用 agent 时的困惑

如果跳过此步骤,镜像会在首次执行 agent 时自动拉取,根据你的网络速度可能耗时数分钟。

## 故障排查

### 找不到配置文件

```bash
# 查看后端正在查找的路径
cd deer-flow/backend
python -c "from deerflow.config.app_config import AppConfig; print(AppConfig.resolve_config_path())"
```

如果仍然找不到：
1. 确认已将 `config.example.yaml` 复制为 `config.yaml`
2. 确认你在正确的目录
3. 检查文件是否存在：`ls -la ../config.yaml`

### 权限被拒绝

```bash
chmod 600 ../config.yaml  # 保护敏感配置
```

## 参见

- [配置指南](CONFIGURATION.md) —— 详细配置项
- [架构概览](../CLAUDE.md) —— 系统架构
