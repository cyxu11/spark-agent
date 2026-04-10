#!/usr/bin/env bash
# One-time migration: upload local .deer-flow files to MinIO
# Usage: MINIO_ENDPOINT=node-c:9000 MINIO_SECRET_KEY=xxx ./scripts/migrate-to-cluster.sh
set -euo pipefail

DEER_FLOW_HOME="${DEER_FLOW_HOME:-backend/.deer-flow}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:?MINIO_ENDPOINT required}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY required}"
BUCKET="deerflow-uploads"

echo "Migrating uploads from $DEER_FLOW_HOME to MinIO $MINIO_ENDPOINT/$BUCKET"

# Install mc (MinIO Client) if not present
if ! command -v mc &>/dev/null; then
  echo "mc not found. Install from: https://min.io/docs/minio/linux/reference/minio-mc.html"
  exit 1
fi

mc alias set deerflow "http://$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
mc mb --ignore-existing "deerflow/$BUCKET"
mc mirror "$DEER_FLOW_HOME/uploads/" "deerflow/$BUCKET/"

echo "Migration complete."
