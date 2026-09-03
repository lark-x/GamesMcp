#!/usr/bin/env sh
set -eu

: "${ISTAROTH_DIR:?Set ISTAROTH_DIR to a lark-x/istaroth checkout}"
: "${STARRAIL_CHECKPOINT_DIR:?Set STARRAIL_CHECKPOINT_DIR to the checkpoint path}"

PORT="${STARRAIL_ISTAROTH_PORT:-8001}"
HOST="${STARRAIL_ISTAROTH_HOST:-127.0.0.1}"
PID_FILE="${STARRAIL_ISTAROTH_PID_FILE:-/tmp/istaroth-starrail.pid}"
TIMEOUT_SECS="${STARRAIL_ISTAROTH_TIMEOUT_SECS:-120}"

if [ ! -d "${STARRAIL_CHECKPOINT_DIR}" ]; then
  echo "ERROR: Checkpoint dir not found: ${STARRAIL_CHECKPOINT_DIR}" >&2
  exit 1
fi

export ISTAROTH_GAME_PROFILE="starrail"
export ISTAROTH_MCP_LANGUAGE="CHS"
export ISTAROTH_DOCUMENT_STORE_SET="CHS:${STARRAIL_CHECKPOINT_DIR}"
export ISTAROTH_TRAINING_DEVICE="cpu"
export ISTAROTH_DEVICE="cpu"
export ISTAROTH_EMBEDDINGS="local"
export ISTAROTH_EMBEDDING_MODEL="BAAI/bge-small-zh-v1.5"
export ISTAROTH_EMBEDDINGS_MODEL="BAAI/bge-small-zh-v1.5"

cd "${ISTAROTH_DIR}"

PYTHON_BIN="python"
FASTMCP_BIN="fastmcp"
if command -v uv >/dev/null 2>&1 && [ -f "${ISTAROTH_DIR}/pyproject.toml" ]; then
  FASTMCP_CMD="uv run fastmcp"
else
  FASTMCP_CMD="fastmcp"
fi

echo "Starting Istaroth MCP server for StarRail on ${HOST}:${PORT}..."
nohup $FASTMCP_CMD run scripts/mcp_server.py --transport=streamable-http --host="${HOST}" --port="${PORT}" > /tmp/istaroth-starrail.log 2>&1 &
echo $! > "${PID_FILE}"

echo "Waiting for Istaroth MCP to be ready on http://${HOST}:${PORT}/mcp (timeout ${TIMEOUT_SECS}s)..."
START_TIME=$(date +%s)
READY=0

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECS" ]; then
    echo "ERROR: Timed out waiting for Istaroth MCP after ${TIMEOUT_SECS}s." >&2
    echo "--- Istaroth log tail ---" >&2
    tail -n 30 /tmp/istaroth-starrail.log >&2 || true
    exit 1
  fi

  if GAMESMCP_ISTAROTH_URL="http://${HOST}:${PORT}/mcp" node --import tsx "${GAMESMCP_DIR:-.}/scripts/check-istaroth-health.ts" >/dev/null 2>&1; then
    READY=1
    break
  fi

  sleep 2
done

echo "Istaroth MCP is ready and healthy!"
exit 0
