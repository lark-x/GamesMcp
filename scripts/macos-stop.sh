#!/usr/bin/env bash
# ==============================================================================
# GamesMcp macOS Shutdown Script
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.runtime.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    if [ -f "docker/docker-compose.runtime.yml" ]; then
        COMPOSE_FILE="docker/docker-compose.runtime.yml"
    fi
fi

echo "Stopping GamesMcp runtime containers..."
docker compose -f "$COMPOSE_FILE" down
echo "GamesMcp has been stopped."
