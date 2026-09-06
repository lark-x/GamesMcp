#!/usr/bin/env bash
# Local-build Docker deployment for GamesMcp: builds api/worker/mcp/web images
# from source via docker-compose.yml, boots PostgreSQL first, then the app
# stack, and refuses to report success until every health check and the MCP
# protocol smoke pass. The zero-compile registry flow lives in deploy.sh.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker 未安装"

docker compose version >/dev/null 2>&1 \
  || fail "docker compose 不可用"

[[ -f "$COMPOSE_FILE" ]] \
  || fail "找不到 $COMPOSE_FILE"

[[ -f "$ENV_FILE" ]] \
  || fail "找不到 $ENV_FILE，请先由 .env.example 创建"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[[ -n "${DATA_DIR:-}" ]] \
  || fail "DATA_DIR 未配置"

mkdir -p "$DATA_DIR"

if [[ "${NODE_ENV:-production}" == "production" ]]; then
  [[ -n "${MCP_AUTH_TOKEN:-}" ]] \
    || fail "生产部署要求 MCP_AUTH_TOKEN（HTTP MCP 绑定非回环地址时必须鉴权）"
fi

WITH_PROVIDERS=false
for arg in "$@"; do
  case "$arg" in
    --with-providers)
      WITH_PROVIDERS=true
      ;;
    *)
      fail "未知参数: $arg"
      ;;
  esac
done

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

log "检查 Compose 配置"
compose config >/dev/null

log "构建 API / Worker / MCP / Web"
compose build api worker mcp web

log "启动 PostgreSQL"
compose up -d postgres

log "等待 PostgreSQL 健康"
for i in $(seq 1 30); do
  STATUS="$(docker inspect \
    --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$(compose ps -q postgres)" \
    2>/dev/null || true)"

  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi

  if [[ "$i" == "30" ]]; then
    compose logs postgres
    fail "PostgreSQL 未进入 healthy"
  fi

  sleep 2
done

log "启动 GamesMcp 核心服务"
compose up -d api worker mcp web

if [[ "$WITH_PROVIDERS" == "true" ]]; then
  log "启动 Provider（istaroth / istaroth-starrail）"
  compose up -d istaroth istaroth-starrail
fi

log "等待 API / MCP / Web"

wait_http() {
  local url="$1"
  local name="$2"

  for i in $(seq 1 40); do
    if curl --fail --silent --show-error \
      --max-time 3 \
      "$url" >/dev/null 2>&1; then
      log "$name ready: $url"
      return 0
    fi

    sleep 2
  done

  return 1
}

wait_http "http://127.0.0.1:4100/api/health" "API" \
  || {
    compose logs api
    fail "API health check 失败"
  }

wait_http "http://127.0.0.1:4200/health" "MCP" \
  || {
    compose logs mcp
    fail "MCP health check 失败"
  }

wait_http "http://127.0.0.1:4173/" "Web" \
  || {
    compose logs web
    fail "Web health check 失败"
  }

log "检查 MCP Ready"

if ! curl --fail --silent --show-error \
  --max-time 5 \
  "http://127.0.0.1:4200/ready" >/dev/null; then

  compose logs mcp
  fail "MCP ready check 失败"
fi

log "运行 MCP 协议冒烟（initialize / tools/list / list_games）"
MCP_SMOKE_URL="${MCP_SMOKE_URL:-http://127.0.0.1:4200/mcp}" \
MCP_SMOKE_TOKEN="${MCP_AUTH_TOKEN:-}" \
  node --import tsx scripts/test-mcp-http.ts \
  || {
    compose logs mcp
    fail "MCP 协议冒烟失败"
  }

printf '\n'
printf '%s\n' "GamesMcp 部署完成："
printf '%s\n' "  Web: http://127.0.0.1:4173/"
printf '%s\n' "  API: http://127.0.0.1:4100/api/"
printf '%s\n' "  MCP: http://127.0.0.1:4200/mcp"
printf '%s\n' "  MCP via Web: http://127.0.0.1:4173/mcp"
