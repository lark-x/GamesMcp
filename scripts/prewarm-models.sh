#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DATA_DIR="${DATA_DIR:-./data}"
ISTAROTH_IMAGE="${ISTAROTH_IMAGE:-isundaylee/istaroth:latest}"

echo "==> Pre-warming Istaroth & Model Caches..."
echo "    Persistent DATA_DIR: ${DATA_DIR}"
echo "    Istaroth Image:      ${ISTAROTH_IMAGE}"

# Ensure directories exist
mkdir -p "${DATA_DIR}/istaroth/checkpoint/chs"
mkdir -p "${DATA_DIR}/istaroth/models/hf"
mkdir -p "${DATA_DIR}/istaroth/cache"

# Pre-pull container image
if command -v docker > /dev/null 2>&1; then
  echo "==> Pre-pulling Istaroth image: ${ISTAROTH_IMAGE}..."
  docker pull "${ISTAROTH_IMAGE}" || {
    echo "WARNING: Could not pull ${ISTAROTH_IMAGE}. Ensure internet connection or check image tag."
  }
fi

echo "==> Prewarm step completed successfully."
