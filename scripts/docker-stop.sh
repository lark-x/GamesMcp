#!/usr/bin/env bash
# Stop the GamesMcp Docker stack. Volumes are intentionally preserved:
# PostgreSQL data and the persistent DATA_DIR must survive a stop.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"

[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: 找不到 $ENV_FILE" >&2
  exit 1
}

docker compose --env-file "$ENV_FILE" -f docker-compose.yml down
