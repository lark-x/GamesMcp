#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

TARGET_VERSION="${1:-${GAMESMCP_VERSION:-}}"
COMPOSE_FILE="docker-compose.prod.yml"

echo "================================================================="
echo "                GamesMcp Safe Image Update                      "
echo "================================================================="

if [ -z "${TARGET_VERSION}" ]; then
  echo "Usage: bash scripts/update.sh <target-version-or-sha>"
  echo "Example: bash scripts/update.sh 6bbf6c1"
  exit 1
fi

# Save current version for rollback
if [ -f ".current_version" ]; then
  cp .current_version .previous_version
  CURRENT_VERSION=$(cat .current_version)
  echo "==> Current running version: ${CURRENT_VERSION}"
else
  echo "latest" > .previous_version
fi

echo "==> Updating to version: ${TARGET_VERSION}"
export GAMESMCP_VERSION="${TARGET_VERSION}"

echo "==> Pulling target image version..."
docker compose -f "${COMPOSE_FILE}" pull api worker web || {
  echo "ERROR: Failed to pull target images for version ${TARGET_VERSION}"
  exit 1
}

echo "==> Applying updated containers..."
docker compose -f "${COMPOSE_FILE}" up -d api worker web

echo "==> Verifying health after update..."
if bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "${TARGET_VERSION}" > .current_version
  echo "==> Successfully updated to ${TARGET_VERSION}!"
else
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "UPDATE FAILED HEALTH VERIFICATION!"
  echo "To automatically rollback to previous version, run:"
  echo "  bash scripts/rollback.sh"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  exit 1
fi
