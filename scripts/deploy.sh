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

TARGET_VERSION="${1:-${GAMESMCP_VERSION:-}}"

if [ -z "${TARGET_VERSION}" ]; then
  if command -v git > /dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    TARGET_VERSION="$(git rev-parse HEAD)"
  else
    echo "ERROR: Production deployment version must be explicitly provided."
    echo "Usage: bash scripts/deploy.sh <COMMIT_SHA_OR_TAG>"
    exit 1
  fi
fi
export GAMESMCP_VERSION="${TARGET_VERSION}"
echo "    Deploying Version: ${GAMESMCP_VERSION}"

# [2/7] Pull images
echo "==> [2/7] Pulling prebuilt images from registry..."
if ! docker compose -f "${COMPOSE_FILE}" pull postgres; then
  echo "ERROR: Failed to pull PostgreSQL image"
  exit 1
fi

if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" = "true" ] && [ -n "${ISTAROTH_IMAGE:-}" ]; then
  echo "    Pulling Genshin Istaroth image..."
  if ! docker compose -f "${COMPOSE_FILE}" pull istaroth; then
    echo "ERROR: Failed to pull Genshin Istaroth image (${ISTAROTH_IMAGE})"
    exit 1
  fi
fi

if [ "${GAMESMCP_STARRAIL_ISTAROTH_ENABLED:-false}" = "true" ] && [ -n "${ISTAROTH_IMAGE:-}" ]; then
  echo "    Pulling StarRail Istaroth image..."
  if ! docker compose -f "${COMPOSE_FILE}" pull istaroth-starrail; then
    echo "ERROR: Failed to pull StarRail Istaroth image (${ISTAROTH_IMAGE})"
    exit 1
  fi
fi

if ! docker compose -f "${COMPOSE_FILE}" pull api worker web; then
  echo "ERROR: Failed to pull application images for version ${GAMESMCP_VERSION}."
  echo "       Deployment stopped to avoid running unverified or missing images."
  exit 1
fi

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
  echo "    Starting Genshin Istaroth provider..."
  docker compose -f "${COMPOSE_FILE}" up -d istaroth
fi
if [ "${GAMESMCP_STARRAIL_ISTAROTH_ENABLED:-false}" = "true" ] && [ -n "${ISTAROTH_IMAGE:-}" ]; then
  echo "    Starting StarRail Istaroth provider..."
  docker compose -f "${COMPOSE_FILE}" up -d istaroth-starrail
fi
if [ "${GAMESMCP_ISTAROTH_ENABLED:-false}" != "true" ] && [ "${GAMESMCP_STARRAIL_ISTAROTH_ENABLED:-false}" != "true" ]; then
  echo "    Istaroth providers disabled or not configured."
fi

# [5/7] Start application services
echo "==> [5/7] Starting core application services (API, Worker, Web)..."
docker compose -f "${COMPOSE_FILE}" up -d api worker web

# [6/7] Health check
echo "==> [6/7] Running post-deployment health verification..."
if ! bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "DEPLOYMENT HEALTH CHECK FAILED!"
  echo "Not recording ${GAMESMCP_VERSION} to .current_version."
  echo "To safely rollback, run: bash scripts/rollback.sh"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  exit 1
fi

# Record deployed version ONLY after health check passes
echo "${GAMESMCP_VERSION}" > .current_version

# [7/7] Complete
echo "==> [7/7] Deployment complete! Service is running and verified."
echo "    Web UI:  ${GAMESMCP_WEB_URL:-http://127.0.0.1:4173}"
echo "    API:     ${GAMESMCP_API_URL:-http://127.0.0.1:4100}"
echo "================================================================="
