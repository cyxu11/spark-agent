#!/bin/bash
# ============================================================================
# spark-agent 前端版本发布与回滚管理脚本
#
# 用法:
#   ./release.sh build    [版本号]   - 本地构建并打包
#   ./release.sh deploy   [版本号]   - 部署指定版本到服务器
#   ./release.sh publish  [版本号]   - build + deploy 一步到位
#   ./release.sh rollback [版本号]   - 回滚到指定版本
#   ./release.sh list                - 列出服务器上所有版本
#   ./release.sh current             - 查看当前运行版本
# ============================================================================

set -e

SERVER="root@10.88.24.91"
PASSWORD='nh2p1rz%$}Xi'
REMOTE_PROJECT="/data/spark-agent"
REMOTE_RELEASES="${REMOTE_PROJECT}/releases"
CONTAINER="deer-flow-frontend"
LOCAL_FRONTEND="$(cd "$(dirname "$0")" && pwd)/frontend"
LOCAL_RELEASES="$(cd "$(dirname "$0")" && pwd)/releases"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

ssh_cmd() {
  sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER" "$@"
}

scp_cmd() {
  sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no "$@"
}

# 生成版本号：用户指定 或 自动生成 v{日期}.{序号}
resolve_version() {
  if [ -n "$1" ]; then
    echo "$1"
  else
    echo "v$(date +%Y%m%d.%H%M%S)"
  fi
}

# ============================================================================
# build - 本地构建并打包
# ============================================================================
do_build() {
  local VERSION=$(resolve_version "$1")
  local PACKAGE_NAME="frontend-${VERSION}.tar.gz"

  mkdir -p "$LOCAL_RELEASES"

  if [ -f "$LOCAL_RELEASES/$PACKAGE_NAME" ]; then
    err "版本 $VERSION 已存在: $LOCAL_RELEASES/$PACKAGE_NAME"
  fi

  echo ""
  echo "=========================================="
  echo " 构建前端版本: $VERSION"
  echo "=========================================="

  # 1. 安装依赖
  info "安装依赖..."
  cd "$LOCAL_FRONTEND"
  pnpm install --frozen-lockfile
  ok "依赖安装完成"

  # 2. 构建
  info "执行 Next.js 构建..."
  SKIP_ENV_VALIDATION=1 pnpm build
  ok "构建完成"

  # 3. 打包（包含构建产物 + 源码，源码用于保持服务器同步）
  info "打包版本..."
  cd "$LOCAL_FRONTEND"

  # 创建版本信息文件
  cat > /tmp/release-info.json << EOFINFO
{
  "version": "${VERSION}",
  "buildTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "buildHost": "$(hostname)",
  "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git branch --show-current 2>/dev/null || echo 'unknown')"
}
EOFINFO

  tar -czf "$LOCAL_RELEASES/$PACKAGE_NAME" \
    --exclude='.next/cache' \
    .next \
    src \
    public \
    -C /tmp release-info.json

  rm -f /tmp/release-info.json

  local SIZE=$(du -h "$LOCAL_RELEASES/$PACKAGE_NAME" | cut -f1)
  ok "版本包已创建: $LOCAL_RELEASES/$PACKAGE_NAME ($SIZE)"
  echo ""
}

# ============================================================================
# deploy - 部署指定版本到服务器
# ============================================================================
do_deploy() {
  local VERSION=$(resolve_version "$1")
  local PACKAGE_NAME="frontend-${VERSION}.tar.gz"
  local PACKAGE_PATH="$LOCAL_RELEASES/$PACKAGE_NAME"

  # 检查本地是否存在版本包
  if [ ! -f "$PACKAGE_PATH" ]; then
    # 检查服务器上是否存在
    if ssh_cmd "test -f ${REMOTE_RELEASES}/${PACKAGE_NAME}"; then
      info "本地不存在，但服务器上有此版本，直接从服务器部署"
      do_deploy_remote "$VERSION"
      return
    fi
    err "版本包不存在: $PACKAGE_PATH\n请先执行: ./release.sh build $VERSION"
  fi

  echo ""
  echo "=========================================="
  echo " 部署前端版本: $VERSION"
  echo "=========================================="

  # 1. 上传版本包到服务器
  info "上传版本包到服务器..."
  ssh_cmd "mkdir -p ${REMOTE_RELEASES}"
  scp_cmd "$PACKAGE_PATH" "${SERVER}:${REMOTE_RELEASES}/"
  ok "上传完成"

  do_deploy_remote "$VERSION"
}

# 从服务器 releases 目录部署
do_deploy_remote() {
  local VERSION="$1"
  local PACKAGE_NAME="frontend-${VERSION}.tar.gz"

  # 2. 备份当前版本
  info "备份当前运行版本..."
  ssh_cmd << EOFBACKUP
CURRENT_VERSION=\$(docker exec $CONTAINER cat /app/frontend/.next/release-info.json 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
if [ "\$CURRENT_VERSION" != "$VERSION" ]; then
  echo "当前版本: \$CURRENT_VERSION"
fi
EOFBACKUP
  ok "备份检查完成"

  # 3. 解包并部署到容器
  info "部署到容器..."
  ssh_cmd << EOFCMD
set -e

# 解包到临时目录
TMPDIR=\$(mktemp -d)
cd \$TMPDIR
tar -xzf ${REMOTE_RELEASES}/${PACKAGE_NAME}

# 清理旧的构建产物，避免 CSS 缓存残留
docker exec ${CONTAINER} rm -rf /app/frontend/.next

# 替换容器内的构建产物和源码
docker cp \$TMPDIR/.next ${CONTAINER}:/app/frontend/
docker cp \$TMPDIR/src ${CONTAINER}:/app/frontend/

# 拷贝 public 资源（如有）
if [ -d \$TMPDIR/public ]; then
  docker cp \$TMPDIR/public ${CONTAINER}:/app/frontend/
fi

# 拷贝版本信息
if [ -f \$TMPDIR/release-info.json ]; then
  docker cp \$TMPDIR/release-info.json ${CONTAINER}:/app/frontend/.next/release-info.json
fi

# 同步到宿主机源码目录（下次 docker-compose build 时保持一致）
rm -rf ${REMOTE_PROJECT}/frontend/src
cp -a \$TMPDIR/src ${REMOTE_PROJECT}/frontend/src

rm -rf \$TMPDIR
echo "文件替换完成"
EOFCMD
  ok "容器内文件已更新"

  # 4. 重启容器
  info "重启容器..."
  ssh_cmd "docker restart ${CONTAINER}"
  ok "容器已重启"

  # 5. 等待并检查
  info "等待服务启动..."
  sleep 5
  ssh_cmd "docker ps --filter name=${CONTAINER} --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

  echo ""
  ok "版本 $VERSION 部署成功！"
  echo ""
  echo "  访问地址: http://10.88.24.91:3000"
  echo ""
}

# ============================================================================
# publish - build + deploy 一步到位
# ============================================================================
do_publish() {
  local VERSION=$(resolve_version "$1")
  do_build "$VERSION"
  do_deploy "$VERSION"
}

# ============================================================================
# rollback - 回滚到指定版本
# ============================================================================
do_rollback() {
  local VERSION="$1"

  if [ -z "$VERSION" ]; then
    echo ""
    warn "请指定要回滚的版本号，可用版本列表:"
    do_list
    echo ""
    echo "用法: ./release.sh rollback <版本号>"
    exit 1
  fi

  echo ""
  echo "=========================================="
  echo " 回滚到版本: $VERSION"
  echo "=========================================="

  # 检查服务器上是否有此版本
  local PACKAGE_NAME="frontend-${VERSION}.tar.gz"
  if ! ssh_cmd "test -f ${REMOTE_RELEASES}/${PACKAGE_NAME}"; then
    # 尝试匹配 baseline 包
    PACKAGE_NAME="${VERSION}.tar.gz"
    if ! ssh_cmd "test -f ${REMOTE_RELEASES}/${PACKAGE_NAME}"; then
      err "服务器上不存在版本: $VERSION\n请运行 ./release.sh list 查看可用版本"
    fi
  fi

  do_deploy_remote "$VERSION"
}

# ============================================================================
# list - 列出服务器上所有版本
# ============================================================================
do_list() {
  echo ""
  echo "=========================================="
  echo " 服务器上的版本列表"
  echo "=========================================="

  ssh_cmd << 'EOFLIST'
echo ""
printf "%-45s %8s  %s\n" "版本包" "大小" "上传时间"
printf "%-45s %8s  %s\n" "---" "---" "---"
cd /data/spark-agent/releases 2>/dev/null || { echo "releases 目录不存在"; exit 0; }
ls -lt *.tar.gz 2>/dev/null | while read perm links owner group size mon day time_or_year name; do
  printf "%-45s %8s  %s %s %s\n" "$name" "$(du -h "$name" | cut -f1)" "$mon" "$day" "$time_or_year"
done
echo ""
EOFLIST
}

# ============================================================================
# current - 查看当前运行版本
# ============================================================================
do_current() {
  echo ""
  echo "=========================================="
  echo " 当前运行版本"
  echo "=========================================="

  ssh_cmd << EOFCUR
RELEASE_INFO=\$(docker exec ${CONTAINER} cat /app/frontend/.next/release-info.json 2>/dev/null)
if [ -n "\$RELEASE_INFO" ]; then
  echo "\$RELEASE_INFO" | python3 -m json.tool 2>/dev/null || echo "\$RELEASE_INFO"
else
  BUILD_ID=\$(docker exec ${CONTAINER} cat /app/frontend/.next/BUILD_ID 2>/dev/null)
  echo "版本信息文件不存在（可能是初始部署版本）"
  echo "BUILD_ID: \$BUILD_ID"
fi
echo ""
echo "容器状态:"
docker ps --filter name=${CONTAINER} --format "  名称: {{.Names}}\n  状态: {{.Status}}\n  端口: {{.Ports}}"
EOFCUR
  echo ""
}

# ============================================================================
# 主入口
# ============================================================================
case "${1:-help}" in
  build)
    do_build "$2"
    ;;
  deploy)
    do_deploy "$2"
    ;;
  publish)
    do_publish "$2"
    ;;
  rollback)
    do_rollback "$2"
    ;;
  list)
    do_list
    ;;
  current)
    do_current
    ;;
  *)
    echo ""
    echo "spark-agent 前端版本管理工具"
    echo ""
    echo "用法:"
    echo "  $0 build    [版本号]  - 本地构建并打包（不指定则自动生成版本号）"
    echo "  $0 deploy   [版本号]  - 部署指定版本到服务器"
    echo "  $0 publish  [版本号]  - build + deploy 一步到位"
    echo "  $0 rollback <版本号>  - 回滚到指定版本"
    echo "  $0 list               - 列出服务器上所有版本"
    echo "  $0 current            - 查看当前运行版本"
    echo ""
    echo "示例:"
    echo "  $0 publish v1.1.0           # 构建并部署 v1.1.0"
    echo "  $0 publish                  # 自动版本号，构建并部署"
    echo "  $0 rollback v1.0.0_baseline_20260415113340  # 回滚到基线版本"
    echo ""
    ;;
esac
