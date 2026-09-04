#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${GAMESMCP_API_URL:-http://127.0.0.1:4100}"
WEB_BASE_URL="${GAMESMCP_WEB_URL:-http://127.0.0.1:4173}"
MAX_RETRIES="${HEALTH_CHECK_MAX_RETRIES:-30}"
RETRY_INTERVAL="${HEALTH_CHECK_INTERVAL_SEC:-2}"

echo "==> Running GamesMcp Health Checks..."
echo "    API Base URL: ${API_BASE_URL}"
echo "    Web Base URL: ${WEB_BASE_URL}"

# 1. Check API Liveness
echo -n "==> [1/5] Checking API liveness (/api/health)... "
api_healthy=false
for ((i=1; i<=MAX_RETRIES; i++)); do
  if curl -sf "${API_BASE_URL}/api/health" > /dev/null 2>&1; then
    api_healthy=true
    echo "OK"
    break
  fi
  sleep "${RETRY_INTERVAL}"
done

if [ "${api_healthy}" != "true" ]; then
  echo "FAILED: API is not responding at ${API_BASE_URL}/api/health"
  exit 1
fi

# 2. Check Web Liveness & Proxy
echo -n "==> [2/5] Checking Web entrypoint & reverse proxy... "
if curl -sf "${WEB_BASE_URL}/" > /dev/null 2>&1 && curl -sf "${WEB_BASE_URL}/api/health" > /dev/null 2>&1; then
  echo "OK"
else
  echo "FAILED: Web front-end or reverse proxy not responding at ${WEB_BASE_URL}"
  exit 1
fi

# 3. Check Database Readiness (/api/ready)
echo -n "==> [3/6] Checking Database readiness (/api/ready)... "
ready_res=$(curl -s "${API_BASE_URL}/api/ready" || true)
if echo "${ready_res}" | grep -q '"database":"up"'; then
  echo "OK (database: up)"
else
  echo "FAILED: Database is not ready. Response: ${ready_res}"
  exit 1
fi

# 4. Check Worker Heartbeat (/api/ready/worker)
echo -n "==> [4/6] Checking Worker heartbeat (/api/ready/worker)... "
worker_res=$(curl -s "${API_BASE_URL}/api/ready/worker" || true)
if echo "${worker_res}" | grep -q '"worker":"up"'; then
  echo "OK (worker: up)"
else
  echo "FAILED: Worker heartbeat missing. Response: ${worker_res}"
  exit 1
fi

# 5. Check Optional Search Index (/api/ready/search)
echo -n "==> [5/6] Checking Search index status (/api/ready/search)... "
search_res=$(curl -s "${API_BASE_URL}/api/ready/search" || true)
if echo "${search_res}" | grep -q '"search":"ready"'; then
  echo "OK (search: ready)"
else
  echo "WARNING: Search index is still building or pending (non-blocking). Response: ${search_res}"
fi

# Helper function to check MCP Streamable HTTP endpoint
check_mcp_endpoint() {
  local url="$1"
  local payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"gamesmcp-health","version":"0.1.0"}}}'
  local res
  res=$(curl -s -m 10 -X POST "${url}" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -d "${payload}" 2>/dev/null || true)
  if echo "${res}" | grep -q '"protocolVersion"'; then
    return 0
  fi
  return 1
}

# 6. Check Optional Providers (if enabled)
echo "==> [6/6] Checking Configured Providers..."
if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" = "true" ]; then
  istaroth_url="${GAMESMCP_ISTAROTH_URL:-http://127.0.0.1:8000/mcp}"
  echo -n "    Checking Genshin Istaroth provider (${istaroth_url})... "
  if check_mcp_endpoint "${istaroth_url}"; then
    echo "OK"
  else
    echo "FAILED: Genshin Istaroth provider not responding"
    exit 1
  fi
else
  echo "    Genshin Istaroth: disabled"
fi

if [ "${GAMESMCP_STARRAIL_ISTAROTH_ENABLED:-false}" = "true" ]; then
  starrail_url="${GAMESMCP_STARRAIL_ISTAROTH_URL:-http://127.0.0.1:8001/mcp}"
  echo -n "    Checking StarRail Istaroth provider (${starrail_url})... "
  if check_mcp_endpoint "${starrail_url}"; then
    echo "OK"
  else
    echo "FAILED: StarRail Istaroth provider not responding"
    exit 1
  fi
else
  echo "    StarRail Istaroth: disabled"
fi

echo "==> All critical health checks passed successfully!"
exit 0
