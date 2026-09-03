#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker-compose.prod.yml"

echo "================================================================="
echo "       GamesMcp Production Deployment (Zero-Compile)            "
echo "================================================================="

# [1/7] Validate environment
echo "==> [1/7] Validating environment & persistent data..."
if [ ! -f ".env" ]; then
  echo "ERROR: .env file is missing. Please copy .env.example to .env and configure it."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${DATA_DIR:-}" ]; then
  echo "ERROR: DATA_DIR must be defined in .env"
  exit 1
fi

if [ ! -d "${DATA_DIR}" ]; then
  echo "==> Creating persistent data directory: ${DATA_DIR}"
  mkdir -p "${DATA_DIR}/postgres" "${DATA_DIR}/snapshots" "${DATA_DIR}/imports" "${DATA_DIR}/games"
fi

if [ ! -w "${DATA_DIR}" ]; then
  echo "ERROR: DATA_DIR (${DATA_DIR}) is not writable."
  exit 1
fi

if [ -z "${GAMESMCP_VERSION:-}" ]; then
  if command -v git > /dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    export GAMESMCP_VERSION="$(git rev-parse HEAD)"
  else
    export GAMESMCP_VERSION="latest"
  fi
fi
echo "    Deploying Version: ${GAMESMCP_VERSION}"

# [2/7] Pull images
echo "==> [2/7] Pulling prebuilt images from registry..."
docker compose -f "${COMPOSE_FILE}" pull postgres || true
if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" = "true" ] && [ -n "${ISTAROTH_IMAGE:-}" ]; then
  docker compose -f "${COMPOSE_FILE}" pull istaroth || true
fi
docker compose -f "${COMPOSE_FILE}" pull api worker web || {
  echo "WARNING: Prebuilt images for version ${GAMESMCP_VERSION} could not be pulled from registry."
  echo "         If deploying locally or before GHCR release, ensuring images are available..."
}

# [3/7] Start database
echo "==> [3/7] Starting database (PostgreSQL + pgvector)..."
docker compose -f "${COMPOSE_FILE}" up -d postgres
echo -n "    Waiting for PostgreSQL readiness..."
for ((i=1; i<=30; i++)); do
  if docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U gip -d gip > /dev/null 2>&1; then
    echo " Ready!"
    break
  fi
  sleep 1
done

# [4/7] Start providers (if configured)
echo "==> [4/7] Starting providers..."
if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" = "true" ] && [ -n "${ISTAROTH_IMAGE:-}" ]; then
  docker compose -f "${COMPOSE_FILE}" up -d istaroth
else
  echo "    Istaroth provider disabled or not configured."
fi

# [5/7] Start application services
echo "==> [5/7] Starting core application services (API, Worker, Web)..."
docker compose -f "${COMPOSE_FILE}" up -d api worker web

# Record deployed version
echo "${GAMESMCP_VERSION}" > .current_version

# [6/7] Health check
echo "==> [6/7] Running post-deployment health verification..."
if ! bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "DEPLOYMENT HEALTH CHECK FAILED!"
  echo "To safely rollback, run: bash scripts/rollback.sh"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  exit 1
fi

# [7/7] Complete
echo "==> [7/7] Deployment complete! Service is running and verified."
echo "    Web UI:  ${GAMESMCP_WEB_URL:-http://127.0.0.1:4173}"
echo "    API:     ${GAMESMCP_API_URL:-http://127.0.0.1:4100}"
echo "================================================================="
