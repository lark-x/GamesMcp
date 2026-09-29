#!/usr/bin/env bash
# ==============================================================================
# GamesMcp macOS One-Click Runtime Deployment & Service Starter
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}    GamesMcp Runtime Deployment for macOS             ${NC}"
echo -e "${CYAN}======================================================${NC}"

# 1. Check Docker environment
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker command not found.${NC}"
    echo -e "Please install OrbStack (recommended, ultra-fast and lightweight):"
    echo -e "    ${YELLOW}https://orbstack.dev${NC}"
    echo -e "Or Docker Desktop for Mac:"
    echo -e "    ${YELLOW}https://www.docker.com/products/docker-desktop/${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}[ERROR] Docker daemon is not running.${NC}"
    echo -e "Please open OrbStack or Docker Desktop, wait for it to start, and re-run this script."
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Docker environment is active."

# 2. Check compose file and environment
COMPOSE_FILE="docker-compose.runtime.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    if [ -f "docker/docker-compose.runtime.yml" ]; then
        COMPOSE_FILE="docker/docker-compose.runtime.yml"
    else
        echo -e "${RED}[ERROR] docker-compose.runtime.yml not found.${NC}"
        exit 1
    fi
fi

if [ ! -f ".env.runtime" ] && [ -f ".env" ]; then
    cp .env .env.runtime
fi

# 3. Start PostgreSQL container
echo -e "\n${BLUE}==> Step 1: Starting PostgreSQL container...${NC}"
docker compose -f "$COMPOSE_FILE" up -d postgres

echo -e "Waiting for PostgreSQL to be ready..."
RETRIES=30
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U gip -d gip > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    echo -n "."
    sleep 1
    RETRIES=$((RETRIES - 1))
done
echo ""

if [ $RETRIES -eq 0 ]; then
    echo -e "${RED}[ERROR] PostgreSQL failed to start in time.${NC}"
    docker compose -f "$COMPOSE_FILE" logs postgres
    exit 1
fi
echo -e "${GREEN}[OK]${NC} PostgreSQL is healthy and accepting connections."

# 4. Check if database restoration is needed
FORCE_RESTORE="${1:-}"
NEED_RESTORE=false

# Check if tables exist
TABLE_COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U gip -d gip -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'knowledge';" | tr -d '[:space:]' || echo "0")

if [ "$FORCE_RESTORE" == "--force" ] || [ "$FORCE_RESTORE" == "--force-restore" ]; then
    echo -e "${YELLOW}[!] Force restore requested via flag.${NC}"
    NEED_RESTORE=true
elif [ "$TABLE_COUNT" == "0" ] || [ -z "$TABLE_COUNT" ]; then
    echo -e "${YELLOW}[!] Knowledge database appears empty (0 tables). Will restore from dump.${NC}"
    NEED_RESTORE=true
else
    echo -e "${GREEN}[OK]${NC} Database is already populated (${TABLE_COUNT} knowledge tables present)."
    echo -e "    (To overwrite with a fresh dump, pass --force: ${CYAN}./deploy.sh --force${NC})"
fi

if [ "$NEED_RESTORE" = true ]; then
    DUMP_FILE=""
    if [ -f "database.dump" ]; then
        DUMP_FILE="database.dump"
    elif [ -f "gip_slim.dump" ]; then
        DUMP_FILE="gip_slim.dump"
    elif [ -f "dist-runtime/database.dump" ]; then
        DUMP_FILE="dist-runtime/database.dump"
    fi

    if [ -n "$DUMP_FILE" ]; then
        echo -e "\n${BLUE}==> Step 2: Restoring database from ${DUMP_FILE}...${NC}"
        # We restore with --clean and --if-exists into database gip
        docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore -U gip -d gip --clean --if-exists < "$DUMP_FILE" || true
        echo -e "${GREEN}[OK]${NC} Database restore complete."
    else
        echo -e "${YELLOW}[WARN] No database.dump file found in package. Skipping restore.${NC}"
    fi
fi

# 5. Build and Start MCP Server Container
echo -e "\n${BLUE}==> Step 3: Starting GamesMcp Server container...${NC}"
docker compose -f "$COMPOSE_FILE" up -d --build mcp

echo -e "Waiting for MCP server to report healthy..."
RETRIES=30
MCP_PORT=$(grep -E '^MCP_PORT=' .env.runtime 2>/dev/null | cut -d '=' -f2 || echo "4200")
MCP_PORT=${MCP_PORT:-4200}

until curl -s "http://127.0.0.1:${MCP_PORT}/health" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    echo -n "."
    sleep 1
    RETRIES=$((RETRIES - 1))
done
echo ""

if [ $RETRIES -eq 0 ]; then
    echo -e "${RED}[ERROR] MCP server health check failed.${NC}"
    docker compose -f "$COMPOSE_FILE" logs mcp
    exit 1
fi

echo -e "${GREEN}[SUCCESS] GamesMcp service is live!${NC}"
echo -e "MCP endpoint: ${CYAN}http://127.0.0.1:${MCP_PORT}/mcp${NC}"
echo -e "Health check: ${CYAN}http://127.0.0.1:${MCP_PORT}/health${NC}"

# 6. Current Memory Usage
echo -e "\n${BLUE}==> Current Resource Utilization:${NC}"
docker stats --no-stream gamesmcp-postgres gamesmcp-mcp 2>/dev/null || true

# 7. Print AI Client Configuration Guidelines
echo -e "\n${CYAN}======================================================${NC}"
echo -e "${CYAN}    Client Configuration Snippets                     ${NC}"
echo -e "${CYAN}======================================================${NC}"

cat << 'EOF'
[Claude Desktop Configuration]
File: ~/Library/Application Support/Claude/claude_desktop_config.json

{
  "mcpServers": {
    "gamesmcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-proxy",
        "http://127.0.0.1:4200/mcp"
      ]
    }
  }
}

[Cursor / Windsurf / Generic SSE or Streamable HTTP Client]
Endpoint URL:
  http://127.0.0.1:4200/mcp

To stop services at any time, run:
  ./stop.sh
======================================================
EOF
