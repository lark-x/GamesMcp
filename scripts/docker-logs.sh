#!/usr/bin/env bash
# Follow Docker Compose logs; pass a service name to narrow the stream.
# Usage: ./scripts/docker-logs.sh [api|worker|mcp|web|postgres|istaroth]
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
SERVICE="${1:-}"

if [[ -n "$SERVICE" ]]; then
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml logs -f --tail=200 "$SERVICE"
else
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml logs -f --tail=200
fi
