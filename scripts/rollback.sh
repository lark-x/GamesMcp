#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker-compose.prod.yml"

echo "================================================================="
echo "                GamesMcp Safe Rollback                           "
echo "================================================================="

TARGET_ROLLBACK_VERSION="${1:-}"

if [ -z "${TARGET_ROLLBACK_VERSION}" ]; then
  if [ -f ".previous_version" ]; then
    TARGET_ROLLBACK_VERSION="$(cat .previous_version)"
  else
    echo "ERROR: No target version specified and .previous_version file not found."
    echo "Usage: bash scripts/rollback.sh <rollback-version-or-sha>"
    exit 1
  fi
fi

echo "==> Rolling back to version: ${TARGET_ROLLBACK_VERSION}"
export GAMESMCP_VERSION="${TARGET_ROLLBACK_VERSION}"

echo "==> Ensuring target rollback images are present..."
docker compose -f "${COMPOSE_FILE}" pull api worker web || true

echo "==> Restarting services with rollback version..."
docker compose -f "${COMPOSE_FILE}" up -d api worker web

echo "==> Verifying health after rollback..."
if bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "${TARGET_ROLLBACK_VERSION}" > .current_version
  echo "==> Rollback to ${TARGET_ROLLBACK_VERSION} completed successfully!"
else
  echo "ERROR: Health check failed after rollback. Check container logs with:"
  echo "  docker compose -f docker-compose.prod.yml logs api worker web"
  exit 1
fi
