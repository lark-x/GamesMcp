#!/usr/bin/env bash
# Print the GamesMcp Docker stack state plus the live health/ready endpoints.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"

docker compose --env-file "$ENV_FILE" -f docker-compose.yml ps

echo
echo "Health:"
curl -fsS --max-time 3 http://127.0.0.1:4100/api/health || true
echo
curl -fsS --max-time 3 http://127.0.0.1:4200/health || true
echo
curl -fsS --max-time 5 http://127.0.0.1:4200/ready || true
echo
