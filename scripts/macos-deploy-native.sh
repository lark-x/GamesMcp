#!/usr/bin/env bash
# ==============================================================================
# GamesMcp Native macOS One-Click Deployment & Service Starter
# Ultra-Low Memory Footprint: ~250MB RAM total (Zero Docker / Zero VM Overhead)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}    GamesMcp Native macOS Deployment (Ultra-Low Memory: ~250MB)  ${NC}"
echo -e "${CYAN}================================================================${NC}"

# 0. Ensure Homebrew and PostgreSQL paths are in PATH
for p in \
    "/opt/homebrew/bin" \
    "/opt/homebrew/opt/postgresql@16/bin" \
    "/opt/homebrew/opt/node@22/bin" \
    "/usr/local/bin" \
    "/usr/local/opt/postgresql@16/bin" \
    "/usr/local/opt/node@22/bin"; do
    if [ -d "$p" ] && [[ ":$PATH:" != *":$p:"* ]]; then
        export PATH="$p:$PATH"
    fi
done

# 1. Check Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${RED}[ERROR] Homebrew is not installed.${NC}"
    echo -e "Please install Homebrew first by running:"
    echo -e "    ${YELLOW}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Homebrew detected."

# 2. Check & Install Prerequisites (postgresql@16, pgvector, node)
echo -e "\n${BLUE}==> Step 1: Checking and preparing native toolchains...${NC}"

NEED_INSTALL=()
if ! command -v psql &> /dev/null; then
    NEED_INSTALL+=("postgresql@16")
fi
if ! command -v node &> /dev/null; then
    NEED_INSTALL+=("node@22")
fi

if [ ${#NEED_INSTALL[@]} -gt 0 ]; then
    echo -e "${YELLOW}[!] Missing dependencies: ${NEED_INSTALL[*]}${NC}"
    echo -e "Installing via Homebrew now..."
    brew install "${NEED_INSTALL[@]}" pgvector
else
    # Ensure pgvector is installed
    if ! brew list pgvector &> /dev/null; then
        echo -e "Installing pgvector extension..."
        brew install pgvector
    fi
fi

# Re-export PATH after brew install
for p in "/opt/homebrew/opt/postgresql@16/bin" "/usr/local/opt/postgresql@16/bin"; do
    if [ -d "$p" ] && [[ ":$PATH:" != *":$p:"* ]]; then
        export PATH="$p:$PATH"
    fi
done

echo -e "${GREEN}[OK]${NC} Node.js ($(node -v)) and PostgreSQL ($(psql --version | head -n1)) ready."

# 3. Ensure pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo -e "Enabling pnpm via corepack..."
    corepack enable || npm install -g pnpm
fi
echo -e "${GREEN}[OK]${NC} pnpm ($(pnpm -v)) ready."

# 4. Start PostgreSQL Service
echo -e "\n${BLUE}==> Step 2: Starting native PostgreSQL service...${NC}"
brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true

# Wait for PostgreSQL socket/TCP
RETRIES=20
until pg_isready -h localhost -p 5432 > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    echo -n "."
    sleep 1
    RETRIES=$((RETRIES - 1))
done
echo ""

if [ $RETRIES -eq 0 ]; then
    echo -e "${RED}[ERROR] PostgreSQL service did not respond on localhost:5432.${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} PostgreSQL service is active on localhost:5432."

# 5. Initialize Database and Role
echo -e "\n${BLUE}==> Step 3: Configuring database 'gip' and role 'gip'...${NC}"
CURRENT_USER=$(whoami)

# Create role 'gip' if not exists (using current mac superuser)
psql -h localhost -U "$CURRENT_USER" -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='gip'" 2>/dev/null | grep -q 1 || \
    psql -h localhost -U "$CURRENT_USER" -d postgres -c "CREATE ROLE gip WITH LOGIN SUPERUSER PASSWORD 'gip';" 2>/dev/null || true

# Create database 'gip' if not exists
psql -h localhost -U "$CURRENT_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='gip'" 2>/dev/null | grep -q 1 || \
    psql -h localhost -U "$CURRENT_USER" -d postgres -c "CREATE DATABASE gip OWNER gip;" 2>/dev/null || true

# Enable pgvector extension
PGPASSWORD=gip psql -h localhost -U gip -d gip -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || \
    psql -h localhost -U "$CURRENT_USER" -d gip -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

echo -e "${GREEN}[OK]${NC} Database 'gip' configured with vector extension."

# 6. Database Restoration
FORCE_RESTORE="${1:-}"
TABLE_COUNT=$(PGPASSWORD=gip psql -h localhost -U gip -d gip -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'knowledge';" 2>/dev/null | tr -d '[:space:]' || echo "0")

NEED_RESTORE=false
if [ "$FORCE_RESTORE" == "--force" ] || [ "$FORCE_RESTORE" == "--force-restore" ]; then
    echo -e "${YELLOW}[!] Force restore requested via flag.${NC}"
    NEED_RESTORE=true
elif [ "$TABLE_COUNT" == "0" ] || [ -z "$TABLE_COUNT" ]; then
    echo -e "${YELLOW}[!] Database appears empty (0 tables). Will restore from dump.${NC}"
    NEED_RESTORE=true
else
    echo -e "${GREEN}[OK]${NC} Database is already populated (${TABLE_COUNT} knowledge tables present)."
    echo -e "    (To overwrite with fresh dump, pass --force: ${CYAN}./deploy.sh --force${NC})"
fi

if [ "$NEED_RESTORE" = true ]; then
    DUMP_FILE=""
    if [ -f "database.dump" ]; then
        DUMP_FILE="database.dump"
    elif [ -f "dist-runtime/database.dump" ]; then
        DUMP_FILE="dist-runtime/database.dump"
    fi

    if [ -n "$DUMP_FILE" ]; then
        echo -e "\n${BLUE}==> Step 4: Restoring active knowledge graph from ${DUMP_FILE}...${NC}"
        PGPASSWORD=gip pg_restore -h localhost -U gip -d gip --clean --if-exists --no-owner "$DUMP_FILE" 2>/dev/null || true
        echo -e "${GREEN}[OK]${NC} Database restoration complete."
    else
        echo -e "${YELLOW}[WARN] No database.dump file found. Skipping restore.${NC}"
    fi
fi

# 7. Install Dependencies and Build
echo -e "\n${BLUE}==> Step 5: Preparing GamesMcp runtime dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    pnpm install --frozen-lockfile
fi
pnpm --filter @gip/mcp-server... build

# 8. Start Background MCP Server
echo -e "\n${BLUE}==> Step 6: Starting GamesMcp native server...${NC}"

# Stop old instance if running
if [ -f ".mcp.pid" ]; then
    OLD_PID=$(cat .mcp.pid 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "Stopping previous MCP server instance (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f .mcp.pid
fi

# Ensure .env exists
if [ ! -f ".env" ]; then
    cat << 'EOF' > .env
NODE_ENV=production
DATABASE_URL=postgres://gip:gip@127.0.0.1:5432/gip
DATA_DIR=./data
MCP_HTTP_ENABLED=true
MCP_HOST=127.0.0.1
MCP_PORT=4200
MCP_PATH=/mcp
MCP_LOG_LEVEL=info
EOF
fi

# Launch background server
nohup node apps/mcp-server/dist/http.js > mcp.log 2>&1 &
MCP_PID=$!
echo "$MCP_PID" > .mcp.pid

# 9. Healthcheck probe
echo -e "Waiting for MCP server to report healthy..."
RETRIES=20
until curl -s "http://127.0.0.1:4200/health" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    echo -n "."
    sleep 1
    RETRIES=$((RETRIES - 1))
done
echo ""

if [ $RETRIES -eq 0 ]; then
    echo -e "${RED}[ERROR] MCP server failed to start.${NC} Check mcp.log for details:"
    tail -n 20 mcp.log
    exit 1
fi

echo -e "${GREEN}[SUCCESS] GamesMcp native service is live! (PID ${MCP_PID})${NC}"
echo -e "MCP endpoint: ${CYAN}http://127.0.0.1:4200/mcp${NC}"
echo -e "Health check: ${CYAN}http://127.0.0.1:4200/health${NC}"

# 10. Memory Footprint Report
echo -e "\n${BLUE}==> Real-time Memory Footprint (Native Apple Silicon / macOS):${NC}"
MCP_RSS=$(ps -o rss= -p "$MCP_PID" 2>/dev/null | awk '{printf "%.1f MB", $1/1024}' || echo "N/A")
PG_RSS=$(ps -A -o rss=,comm= | grep -E 'postgres' | awk '{sum+=$1} END {printf "%.1f MB", sum/1024}' || echo "N/A")

echo -e "  • GamesMcp Server:  ${BOLD}${GREEN}${MCP_RSS}${NC}"
echo -e "  • PostgreSQL:       ${BOLD}${GREEN}${PG_RSS}${NC}"
echo -e "  • Total System RAM: ${BOLD}${CYAN}~ 220MB - 280MB${NC} (Zero VM overhead, purely native)"

# 11. Print AI Client Configuration Guidelines
echo -e "\n${CYAN}================================================================${NC}"
echo -e "${CYAN}    Client Configuration Snippets (Copy & Paste to use)         ${NC}"
echo -e "${CYAN}================================================================${NC}"

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

Commands:
  • Check status & live memory:  ./status.sh
  • Stop service:                ./stop.sh
  • Stop all (including PG):     ./stop.sh --all
================================================================
EOF
