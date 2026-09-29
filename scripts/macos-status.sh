#!/usr/bin/env bash
# ==============================================================================
# GamesMcp macOS Status & Real-time Memory Monitor
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}    GamesMcp Runtime Status & Memory Monitor          ${NC}"
echo -e "${CYAN}======================================================${NC}"

RUNNING=false

# 1. Check Native Process
if [ -f ".mcp.pid" ]; then
    PID=$(cat .mcp.pid 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo -e "Status: ${BOLD}${GREEN}RUNNING (Native macOS Process)${NC}"
        echo -e "PID:    ${PID}"
        RUNNING=true

        # Probe health endpoint
        HEALTH=$(curl -s -m 2 http://127.0.0.1:4200/health 2>/dev/null || echo "offline")
        echo -e "Health: ${HEALTH}"

        # Real-time memory
        MCP_RSS=$(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.1f MB", $1/1024}' || echo "N/A")
        PG_RSS=$(ps -A -o rss=,comm= 2>/dev/null | grep -E 'postgres' | awk '{sum+=$1} END {printf "%.1f MB", sum/1024}' || echo "N/A")

        echo -e "\n${BOLD}Current Memory Footprint:${NC}"
        echo -e "  • GamesMcp Server:  ${BOLD}${GREEN}${MCP_RSS}${NC}"
        echo -e "  • PostgreSQL:       ${BOLD}${GREEN}${PG_RSS}${NC}"
        echo -e "  • Total System RAM: ${BOLD}${CYAN}~ 220MB - 280MB${NC}"
    fi
fi

# 2. Check Docker if not native
if [ "$RUNNING" = false ] && command -v docker &> /dev/null && [ -f "docker-compose.runtime.yml" ]; then
    if docker compose -f docker-compose.runtime.yml ps --services --filter "status=running" 2>/dev/null | grep -q .; then
        echo -e "Status: ${BOLD}${GREEN}RUNNING (Docker Container)${NC}"
        RUNNING=true
        docker stats --no-stream gamesmcp-postgres gamesmcp-mcp 2>/dev/null || true
    fi
fi

if [ "$RUNNING" = false ]; then
    echo -e "Status: ${YELLOW}STOPPED${NC}"
    echo -e "Start native service:  ${CYAN}./deploy.sh${NC}"
fi
echo -e "${CYAN}======================================================${NC}"
