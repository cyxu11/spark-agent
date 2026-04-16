#!/bin/bash
# 修复 nginx 请求体大小限制问题

echo "=== 检查当前 nginx 配置 ==="
echo "1. 检查主配置文件："
grep -n "client_max_body_size" /etc/nginx/nginx.conf || echo "主配置文件中未找到 client_max_body_size"

echo -e "\n2. 检查所有配置文件："
grep -r "client_max_body_size" /etc/nginx/ 2>/dev/null || echo "所有配置文件中未找到 client_max_body_size"

echo -e "\n3. 检查项目 nginx 配置："
if [ -f /data/spark-agent/docker/nginx/nginx.conf ]; then
    grep -n "client_max_body_size" /data/spark-agent/docker/nginx/nginx.conf || echo "项目配置中未找到 client_max_body_size"
fi

echo -e "\n=== 修复配置 ==="

# 备份配置文件
BACKUP_DIR="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp /etc/nginx/nginx.conf "$BACKUP_DIR/" 2>/dev/null
[ -f /data/spark-agent/docker/nginx/nginx.conf ] && cp /data/spark-agent/docker/nginx/nginx.conf "$BACKUP_DIR/"
echo "配置文件已备份到: $BACKUP_DIR"

# 修改主配置文件
echo -e "\n修改 /etc/nginx/nginx.conf..."
if grep -q "client_max_body_size" /etc/nginx/nginx.conf; then
    # 如果已存在，修改值
    sed -i 's/client_max_body_size [^;]*;/client_max_body_size 100M;/g' /etc/nginx/nginx.conf
    echo "✓ 已更新 client_max_body_size 为 100M"
else
    # 如果不存在，添加到 http 块中
    sed -i '/http {/a \    client_max_body_size 100M;' /etc/nginx/nginx.conf
    echo "✓ 已添加 client_max_body_size 100M"
fi

# 修改项目配置文件（如果存在）
if [ -f /data/spark-agent/docker/nginx/nginx.conf ]; then
    echo -e "\n修改项目 nginx 配置..."
    if grep -q "client_max_body_size" /data/spark-agent/docker/nginx/nginx.conf; then
        sed -i 's/client_max_body_size [^;]*;/client_max_body_size 100M;/g' /data/spark-agent/docker/nginx/nginx.conf
        echo "✓ 已更新项目配置"
    else
        # 在 server 或 http 块中添加
        sed -i '/server {/a \    client_max_body_size 100M;' /data/spark-agent/docker/nginx/nginx.conf
        echo "✓ 已添加到项目配置"
    fi
fi

echo -e "\n=== 验证配置 ==="
nginx -t

if [ $? -eq 0 ]; then
    echo -e "\n✓ 配置验证成功"
    echo -e "\n=== 重启 nginx ==="
    systemctl restart nginx
    if [ $? -eq 0 ]; then
        echo "✓ nginx 重启成功"
    else
        echo "✗ nginx 重启失败，尝试 docker 方式..."
        cd /data/spark-agent && docker-compose restart nginx
    fi

    echo -e "\n=== 验证修改结果 ==="
    echo "主配置文件："
    grep -n "client_max_body_size" /etc/nginx/nginx.conf

    if [ -f /data/spark-agent/docker/nginx/nginx.conf ]; then
        echo -e "\n项目配置文件："
        grep -n "client_max_body_size" /data/spark-agent/docker/nginx/nginx.conf
    fi

    echo -e "\n✓ 修复完成！配置已永久生效"
else
    echo -e "\n✗ 配置验证失败，请检查语法错误"
    echo "备份文件位置: $BACKUP_DIR"
fi
