#!/usr/bin/env bash
# ==============================================================================
# GamesMcp Native macOS Stop Script
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Stopping GamesMcp service...${NC}"

STOPPED=false

# 1. Stop Native MCP Server
if [ -f ".mcp.pid" ]; then
    PID=$(cat .mcp.pid 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo -e "Stopping native MCP server process (PID ${PID})..."
        kill "$PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
        fi
        echo -e "${GREEN}[OK]${NC} Native GamesMcp server stopped."
        STOPPED=true
    fi
    rm -f .mcp.pid
fi

# 2. Stop Docker if docker-compose exists and was running
if command -v docker &> /dev/null && [ -f "docker-compose.runtime.yml" ]; then
    if docker compose -f docker-compose.runtime.yml ps --services --filter "status=running" 2>/dev/null | grep -q .; then
        echo -e "Stopping Docker runtime containers..."
        docker compose -f docker-compose.runtime.yml down
        echo -e "${GREEN}[OK]${NC} Docker containers stopped."
        STOPPED=true
    fi
fi

if [ "$STOPPED" = false ]; then
    echo -e "${YELLOW}[INFO] GamesMcp server is not currently running.${NC}"
fi

# 3. Optional: Stop Homebrew PostgreSQL if --all is requested
if [ "${1:-}" == "--all" ]; then
    echo -e "Stopping native PostgreSQL service..."
    brew services stop postgresql@16 2>/dev/null || brew services stop postgresql 2>/dev/null || true
    echo -e "${GREEN}[OK]${NC} PostgreSQL service stopped. All memory completely released."
fi
