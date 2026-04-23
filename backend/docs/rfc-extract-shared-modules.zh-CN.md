# RFC：将 Skill Installer 与 Upload Manager 抽取到 Harness 共享层

## 1. 问题

Gateway(`app/gateway/routers/skills.py`、`uploads.py`)与 Client(`deerflow/client.py`)各自独立实现了同一套业务逻辑：

### 技能安装(Skill Installation)

| 逻辑 | Gateway(`skills.py`) | Client(`client.py`) |
|-------|----------------------|---------------------|
| Zip 安全检查 | `_is_unsafe_zip_member()` | 内联 `Path(info.filename).is_absolute()` |
| Symlink 过滤 | `_is_symlink_member()` | 解压后通过 `p.is_symlink()` 删除 |
| Zip bomb 防御 | `total_size += info.file_size`(声明值) | `total_size > 100MB`(声明值) |
| macOS 元数据过滤 | `_should_ignore_archive_entry()` | 无 |
| Frontmatter 校验 | `_validate_skill_frontmatter()` | `_validate_skill_frontmatter()` |
| 重复检测 | `HTTPException(409)` | `ValueError` |

**两套实现、行为不一致**：Gateway 通过流式写入并累计真实解压字节数;Client 则累加声明的 `file_size`。Gateway 在解压过程中跳过 symlink;Client 全量解压后再遍历并删除 symlink。

### 上传管理(Upload Management)

| 逻辑 | Gateway(`uploads.py`) | Client(`client.py`) |
|-------|----------------------|---------------------|
| 目录访问 | `get_uploads_dir()` + `mkdir` | `_get_uploads_dir()` + `mkdir` |
| 文件名安全 | 内联 `Path(f).name` + 手工检查 | 无检查,直接用 `src_path.name` |
| 重名处理 | 无(直接覆盖) | 无(直接覆盖) |
| 列表 | 内联 `iterdir()` | 内联 `os.scandir()` |
| 删除 | 内联 `unlink()` + 越权检查 | 内联 `unlink()` + 越权检查 |
| 路径穿越检查 | `resolve().relative_to()` | `resolve().relative_to()` |

**同一个穿越检查被写了两遍** —— 任何安全修复都必须在两处同时打。

## 2. 设计原则

### 依赖方向

```
app.gateway.routers.skills  ──┐
app.gateway.routers.uploads ──┤── 调用 ──→  deerflow.skills.installer
deerflow.client             ──┘              deerflow.uploads.manager
```

- 共享模块位于 harness 层(`deerflow.*`),纯业务逻辑,不依赖 FastAPI
- Gateway 负责 HTTP 适配(`UploadFile` → bytes、异常 → `HTTPException`)
- Client 负责本地适配(`Path` → 复制、异常 → Python 异常)
- 满足 `test_harness_boundary.py` 约束:harness 永不 import app

### 异常策略

| 共享层抛出的异常 | Gateway 映射为 | Client |
|----------------------|-----------------|--------|
| `FileNotFoundError` | `HTTPException(404)` | 直接透传 |
| `ValueError` | `HTTPException(400)` | 直接透传 |
| `SkillAlreadyExistsError` | `HTTPException(409)` | 直接透传 |
| `PermissionError` | `HTTPException(403)` | 直接透传 |

这样就把基于字符串匹配的分发(`"already exists" in str(e)`)替换成了基于异常类型的匹配(`SkillAlreadyExistsError`)。

## 3. 新增模块

### 3.1 `deerflow.skills.installer`

```python
# Safety checks
is_unsafe_zip_member(info: ZipInfo) -> bool     # Absolute path / .. traversal
is_symlink_member(info: ZipInfo) -> bool         # Unix symlink detection
should_ignore_archive_entry(path: Path) -> bool  # __MACOSX / dotfiles

# Extraction
safe_extract_skill_archive(zip_ref, dest_path, max_total_size=512MB)
  # Streaming write, accumulates real bytes (vs declared file_size)
  # Dual traversal check: member-level + resolve-level

# Directory resolution
resolve_skill_dir_from_archive(temp_path: Path) -> Path
  # Auto-enters single directory, filters macOS metadata

# Install entry point
install_skill_from_archive(zip_path, *, skills_root=None) -> dict
  # is_file() pre-check before extension validation
  # SkillAlreadyExistsError replaces ValueError

# Exception
class SkillAlreadyExistsError(ValueError)
```

### 3.2 `deerflow.uploads.manager`

```python
# Directory management
get_uploads_dir(thread_id: str) -> Path      # Pure path, no side effects
ensure_uploads_dir(thread_id: str) -> Path   # Creates directory (for write paths)

# Filename safety
normalize_filename(filename: str) -> str
  # Path.name extraction + rejects ".." / "." / backslash / >255 bytes
deduplicate_filename(name: str, seen: set) -> str
  # _N suffix increment for dedup, mutates seen in place

# Path safety
validate_path_traversal(path: Path, base: Path) -> None
  # resolve().relative_to(), raises PermissionError on failure

# File operations
list_files_in_dir(directory: Path) -> dict
  # scandir with stat inside context (no re-stat)
  # follow_symlinks=False to prevent metadata leakage
  # Non-existent directory returns empty list
delete_file_safe(base_dir: Path, filename: str) -> dict
  # Validates traversal first, then unlinks

# URL helpers
upload_artifact_url(thread_id, filename) -> str   # Percent-encoded for HTTP safety
upload_virtual_path(filename) -> str               # Sandbox-internal path
enrich_file_listing(result, thread_id) -> dict     # Adds URLs, stringifies sizes
```

## 4. 变更

### 4.1 Gateway 瘦身

**`app/gateway/routers/skills.py`**：
- 移除 `_is_unsafe_zip_member`、`_is_symlink_member`、`_safe_extract_skill_archive`、`_should_ignore_archive_entry`、`_resolve_skill_dir_from_archive_root`(约 80 行)
- `install_skill` 路由变成一次 `install_skill_from_archive(path)` 调用
- 异常映射:`SkillAlreadyExistsError → 409`、`ValueError → 400`、`FileNotFoundError → 404`

**`app/gateway/routers/uploads.py`**：
- 移除内联的 `get_uploads_dir`(由 `ensure_uploads_dir` / `get_uploads_dir` 替代)
- `upload_files` 改用 `normalize_filename()`,取代内联安全检查
- `list_uploaded_files` 改用 `list_files_in_dir()` + 富化
- `delete_uploaded_file` 改用 `delete_file_safe()` + 同名 markdown 清理

### 4.2 Client 瘦身

**`deerflow/client.py`**：
- 移除 `_get_uploads_dir` 静态方法
- 移除 `install_skill` 中约 50 行内联 zip 处理
- `install_skill` 委托给 `install_skill_from_archive()`
- `upload_files` 改用 `deduplicate_filename()` + `ensure_uploads_dir()`
- `list_uploads` 改用 `get_uploads_dir()` + `list_files_in_dir()`
- `delete_upload` 改用 `get_uploads_dir()` + `delete_file_safe()`
- `update_mcp_config` / `update_skill` 现在会将 `_agent_config_key` 重置为 `None`

### 4.3 读/写路径分离

| 操作 | 函数 | 是否创建目录？ |
|-----------|----------|:------------:|
| 上传(写) | `ensure_uploads_dir()` | 是 |
| 列表(读) | `get_uploads_dir()` | 否 |
| 删除(读) | `get_uploads_dir()` | 否 |

读路径不再带有 `mkdir` 副作用 —— 目录不存在时直接返回空列表。

## 5. 安全性改进

| 项目 | 之前 | 之后 |
|-------------|--------|-------|
| Zip bomb 检测 | 声明值 `file_size` 累加 | 流式写入,累计真实字节 |
| Symlink 处理 | Gateway 跳过 / Client 解压后删除 | 统一跳过并记录日志 |
| 穿越检查 | 仅 member 级别 | member 级别 + `resolve().is_relative_to()` |
| 文件名反斜杠 | Gateway 检查 / Client 不检查 | 统一拒绝 |
| 文件名长度 | 未检查 | 拒绝 > 255 字节(OS 限制) |
| thread_id 校验 | 无 | 拒绝不安全的文件系统字符 |
| 列表 symlink 泄露 | `follow_symlinks=True`(默认) | `follow_symlinks=False` |
| 409 状态分发 | `"already exists" in str(e)` | `SkillAlreadyExistsError` 类型匹配 |
| Artifact URL 编码 | URL 中直接使用原始文件名 | `urllib.parse.quote()` |

## 6. 备选方案

| 方案 | 否决原因 |
|-------------|---------|
| 逻辑留在 Gateway,Client 通过 HTTP 调用 Gateway | 给嵌入式 Client 加上网络依赖,违背 `DeerFlowClient` 作为进程内 API 的初衷 |
| 用抽象基类 + Gateway/Client 子类 | 对纯函数而言过度设计,不需要多态 |
| 全部搬到 `client.py`,由 Gateway 导入它 | 破坏 harness/app 边界 —— Client 位于 harness,而 Gateway 特有的(Pydantic 响应)模型应留在 app 层 |
| Gateway 与 Client 合并为一个模块 | 它们服务不同消费者(HTTP vs 进程内),适配需求不同 |

## 7. 破坏性变更

**无**。所有公共 API(Gateway HTTP 端点、`DeerFlowClient` 方法)签名与返回格式保持不变。`SkillAlreadyExistsError` 是 `ValueError` 的子类,现有的 `except ValueError` 仍能捕获到。

## 8. 测试

| 模块 | 测试文件 | 条数 |
|--------|-----------|:-----:|
| `skills.installer` | `tests/test_skills_installer.py` | 22 |
| `uploads.manager` | `tests/test_uploads_manager.py` | 20 |
| `client` 加固 | `tests/test_client.py`(新增用例) | ~40 |
| `client` 端到端 | `tests/test_client_e2e.py`(新文件) | ~20 |

覆盖范围：不安全 zip / symlink / zip bomb / frontmatter / 重复 / 扩展名 / macOS 过滤 / normalize / deduplicate / 穿越 / 列表 / 删除 / agent 失效 / 上传生命周期 / thread 隔离 / URL 编码 / config 污染。
