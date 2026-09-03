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
echo -n "==> [3/5] Checking Database & Revision readiness (/api/ready)... "
ready_res=$(curl -s "${API_BASE_URL}/api/ready" || true)
if echo "${ready_res}" | grep -q '"database":"up"'; then
  echo "OK (database: up)"
else
  echo "WARNING: Database readiness returned: ${ready_res}"
fi

# 4. Check Search & Worker Readiness
echo -n "==> [4/5] Checking Search index and Worker heartbeat... "
search_res=$(curl -s "${API_BASE_URL}/api/ready/search" || true)
worker_res=$(curl -s "${API_BASE_URL}/api/ready/worker" || true)
echo "Done"
echo "    Search readiness: ${search_res}"
echo "    Worker readiness: ${worker_res}"

# 5. Check Optional Istaroth Provider (if enabled)
echo -n "==> [5/5] Checking Optional Provider status... "
if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" = "true" ]; then
  istaroth_url="${GAMESMCP_ISTAROTH_URL:-http://127.0.0.1:8000/mcp}"
  if curl -sf "${istaroth_url}" > /dev/null 2>&1; then
    echo "OK (Istaroth reachable)"
  else
    echo "WARNING: Istaroth is enabled but not responding at ${istaroth_url}"
  fi
else
  echo "SKIPPED (Istaroth disabled)"
fi

echo "==> All critical health checks passed successfully!"
exit 0
