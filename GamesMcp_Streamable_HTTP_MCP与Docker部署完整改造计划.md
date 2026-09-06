# GamesMcp Streamable HTTP MCP + Docker 部署完整改造计划

> 项目：`lark-x/GamesMcp`  
> 当前状态：MCP 已有真实 Tool / Resource 能力，但目前只通过 `StdioServerTransport` 暴露；`pnpm dev` 仅启动 Web + API + Worker；Dockerfile/Compose 尚未包含 GamesMcp 自身的 HTTP MCP Runtime。  
> 本轮目标：**保留现有 stdio MCP，同时新增 Streamable HTTP MCP，并把 MCP 正式纳入本地开发、Docker 部署、Nginx 代理、健康检查、鉴权和真实数据 E2E。**

---

# 0. 给执行 Agent 的强制提醒

这次不要把任务理解为：

```text
“给 MCP 随便加一个 HTTP 接口”
```

也不要做：

```text
POST /mcp/search
POST /mcp/tool
GET  /mcp/tools
```

这种自定义伪协议。

必须使用 MCP SDK 正式支持的：

```text
Streamable HTTP Transport
```

最终形成：

```text
GamesMcp MCP Tool Registry
        │
        ├─ stdio
        │   └─ 本地 Claude / Codex / OpenCode
        │
        └─ Streamable HTTP
            └─ Docker / LAN / Remote Agent
```

---

# 1. 当前项目现状

当前 MCP Server 已经独立存在：

```text
apps/mcp-server
```

并具备真实工具：

```text
list_games
get_game_capabilities

get_character
get_material
get_weapon
get_enemy
resolve_entity

search_dialogue
search_entities
search_lore
search_quests

get_quest
get_lore_document
get_relationships
get_entity_texts

search_items
get_item_text
search_mechanics

search_game_knowledge
get_game_document
get_game_document_hierarchy
get_game_provider_status
```

说明：

> MCP 本身已经有实际价值，本轮重点不是重新设计 Tools，而是把 Transport 和部署方式补完整。

当前入口：

```text
apps/mcp-server/src/index.ts
```

直接使用：

```text
StdioServerTransport
```

因此目前更适合：

```text
本地 MCP Client
→ 启动一个 GamesMcp 子进程
```

不适合：

```text
http://server:xxxx/mcp
```

远程接入。

---

# 2. 本轮最终目标

## 2.1 开发环境

以后项目根目录执行：

```bash
pnpm dev
```

应同时启动：

```text
Web
http://127.0.0.1:4173

API
http://127.0.0.1:4100

MCP
http://127.0.0.1:4200/mcp

Worker
running
```

---

## 2.2 stdio MCP 继续保留

本地 MCP Client 仍可：

```bash
pnpm --filter @gip/mcp-server start:stdio
```

或者保持兼容：

```bash
pnpm --filter @gip/mcp-server start
```

其中：

```text
start = stdio
```

不要改变旧客户端行为。

---

## 2.3 Docker

最终：

```bash
docker compose up -d
```

可得到：

```text
postgres
api
worker
web
mcp
```

如果启用 Provider：

```text
istaroth
istaroth-starrail
```

也一起运行。

---

## 2.4 最终访问方式

开发直连：

```text
http://127.0.0.1:4200/mcp
```

Docker 内部：

```text
http://mcp:4200/mcp
```

通过 Web Nginx：

```text
http://127.0.0.1:4173/mcp
```

生产：

```text
https://gamesmcp.example.com/mcp
```

---

# 3. 核心架构

最终：

```text
                      GamesMcp
                         │
                  createMcpServer()
                         │
               MCP Tools / Resources
                         │
              ┌──────────┴──────────┐
              │                     │
           stdio.ts               http.ts
              │                     │
     StdioServerTransport    Streamable HTTP
              │                     │
        Local Agent          LAN / Remote Agent
```

关键原则：

> Tool 注册只能有一套。

禁止复制：

```text
server-stdio.ts
server-http.ts
```

然后分别维护两套 Tool。

---

# 4. Phase 1：拆分 Runtime 和 Transport

建议目录：

```text
apps/mcp-server/src/
├─ server.ts
├─ runtime.ts
├─ stdio.ts
├─ http.ts
├─ auth.ts
├─ session-manager.ts
└─ tools/
```

---

# 5. `server.ts`

继续负责：

```text
createMcpServer(repository, options)
```

包括：

```text
Tool 注册
Resource 注册
GameDomainService
KnowledgeService
Provider Tool 注册
```

不要加入：

```text
HTTP listen
stdio connect
环境 shutdown
```

---

# 6. `runtime.ts`

新增共享依赖创建函数。

建议：

```ts
export async function createMcpRuntime() {
  const config = loadConfig();

  const pool = createPool(config.databaseUrl);

  const repository = new SqlKnowledgeRepository(
    createDatabase(pool),
    config.dataDir,
  );

  const providers = createProviderRegistry(config.providers);

  return {
    config,
    pool,
    repository,
    providers,
    async close() {
      await providers.close();
      await pool.end();
    },
  };
}
```

stdio/http 共用。

---

# 7. `stdio.ts`

把当前 `index.ts` 的 Transport 逻辑迁入：

```text
createMcpRuntime()
↓
createMcpServer()
↓
StdioServerTransport
↓
server.connect()
```

并保留：

```text
SIGINT
SIGTERM
```

关闭：

```text
server
providers
pool
```

---

# 8. `http.ts`

新增 HTTP MCP Entry。

职责：

```text
创建 HTTP Server
实现 /mcp
管理 Session
鉴权
健康检查
Ready 检查
优雅关闭
```

不要在这里重新注册 Tool。

---

# 9. Phase 2：接入 Streamable HTTP Transport

使用当前 `@modelcontextprotocol/sdk` 支持的正式 Streamable HTTP Server Transport。

目标 Endpoint：

```text
POST   /mcp
GET    /mcp
DELETE /mcp
```

必须遵守 MCP Client initialize/session 流程。

---

# 10. Session 模式

HTTP 与 stdio 不同。

stdio：

```text
一个进程
≈ 一个 Client Session
```

HTTP：

```text
一个 Server
→ 多客户端
→ 多 MCP Session
```

需要：

```ts
Map<string, SessionContext>
```

---

# 11. SessionContext

建议：

```ts
type SessionContext = {
  id: string;

  transport: StreamableHttpTransportType;
  server: McpServer;

  createdAt: number;
  lastActivityAt: number;
};
```

注意：

> 如果 SDK 的 Transport 生命周期要求一个 MCP Server 实例对应一个 Session，则每个 Session 创建自己的 `createMcpServer()`；如果 SDK 当前版本明确支持共享 server，则遵循 SDK 生命周期。Agent 必须以项目当前安装的 `@modelcontextprotocol/sdk` API 为准，不得凭印象硬写。

---

# 12. Session 初始化

逻辑：

```text
POST /mcp
↓
是否带合法 Session ID？
    │
    ├─ 否
    │   ↓
    │ initialize request
    │   ↓
    │ 创建 Session
    │
    └─ 是
        ↓
      查找 Session
        ↓
      处理 Request
```

---

# 13. Session 关闭

支持：

```text
DELETE /mcp
```

完成：

```text
transport.close()
server.close()
sessions.delete(id)
```

---

# 14. Session Idle Cleanup

增加：

```env
MCP_SESSION_IDLE_TIMEOUT_MS=1800000
```

默认：

```text
30 分钟
```

每隔：

```text
5 分钟
```

检查：

```text
Date.now() - lastActivityAt
```

超时清理。

---

# 15. 最大 Session

增加：

```env
MCP_MAX_SESSIONS=100
```

如果达到上限：

```text
503
mcp_session_limit_reached
```

禁止无限增长。

---

# 16. Phase 3：配置系统

`.env.example` 增加：

```env
# GamesMcp Streamable HTTP MCP
MCP_HTTP_ENABLED=true
MCP_HOST=127.0.0.1
MCP_PORT=4200
MCP_PATH=/mcp

# Localhost development may leave this empty.
# Production/LAN deployments should configure a strong token.
MCP_AUTH_TOKEN=

MCP_SESSION_IDLE_TIMEOUT_MS=1800000
MCP_MAX_SESSIONS=100
MCP_REQUEST_TIMEOUT_MS=30000
```

---

# 17. RuntimeConfig

`packages/config/src/index.ts` 增加：

```ts
mcp: {
  httpEnabled: boolean;

  host: string;
  port: number;
  path: string;

  authToken?: string;

  sessionIdleTimeoutMs: number;
  maxSessions: number;
  requestTimeoutMs: number;
};
```

---

# 18. 配置验证

必须验证：

```text
MCP_PORT
1~65535

MCP_PATH
必须以 / 开头

MCP_MAX_SESSIONS
> 0

MCP_SESSION_IDLE_TIMEOUT_MS
> 0
```

---

# 19. Production 安全 Gate

建议：

```text
NODE_ENV=production
+
MCP_HOST != 127.0.0.1
```

时：

```text
MCP_AUTH_TOKEN
必须存在
```

否则 HTTP MCP 启动失败。

开发 localhost：

```text
Token 可为空
```

---

# 20. Phase 4：Bearer Token Authentication

P0 使用简单 Bearer Token 即可满足：

```text
个人部署
LAN
私有服务器
Cloudflare Tunnel 后端
```

请求：

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

---

# 21. Auth 规则

`auth.ts`：

```ts
function verifyMcpAuth(
  request: IncomingMessage,
  config: RuntimeConfig["mcp"],
): boolean
```

---

# 22. Token 比较

使用恒定时间比较。

不要：

```ts
provided === expected
```

直接比较敏感 Token。

使用 Node Crypto：

```text
timingSafeEqual
```

---

# 23. Token 日志

任何日志：

```text
Authorization
MCP_AUTH_TOKEN
```

必须永远：

```text
[redacted]
```

---

# 24. P1：未来认证升级

公网多人使用时再考虑：

```text
OAuth 2.x / MCP Authorization
```

本轮不要为了 OAuth 拖死项目。

---

# 25. Phase 5：Health / Ready

HTTP MCP 增加：

```text
GET /health
GET /ready
```

---

# 26. `/health`

只表示：

```text
MCP Process Alive
```

响应：

```json
{
  "status": "ok",
  "service": "gamesmcp-mcp"
}
```

不访问数据库。

---

# 27. `/ready`

检查：

```text
PostgreSQL 可连接
至少有 Game
Repository 可读
```

推荐同时返回：

```json
{
  "status": "ready",
  "database": "ready",
  "games": 2
}
```

如果 Public Revision 尚未发布，可返回详细状态，但：

```text
HTTP Status
```

是否 503 取决于 MCP 是否要求“所有游戏都可搜索”。

建议：

```text
数据库不可用 → 503
服务有游戏但部分 Revision 不 ready → 200 + warning
```

避免一个游戏数据问题让整个 MCP health 永远红。

---

# 28. Phase 6：Package Scripts

当前：

```json
{
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js"
}
```

调整建议：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",

    "dev": "node --import tsx src/http.ts",
    "dev:http": "node --import tsx src/http.ts",
    "dev:stdio": "node --import tsx src/stdio.ts",

    "start": "node dist/stdio.js",
    "start:stdio": "node dist/stdio.js",
    "start:http": "node dist/http.js"
  }
}
```

---

# 29. 兼容要求

必须保留：

```bash
pnpm --filter @gip/mcp-server start
```

语义：

```text
stdio
```

避免现有本地客户端突然连接失败。

---

# 30. Phase 7：`pnpm dev` 同时启动 MCP

当前 `scripts/start-dev.ts` 管理：

```text
API
Web
Worker
```

增加：

```text
MCP
```

---

# 31. 开发端口

扩展：

```ts
const preferred = {
  api: 4100,
  web: 4173,
  mcp: 4200,
};
```

继续沿用：

```text
nextFree()
```

自动寻找：

```text
4200 ~ 4299
```

---

# 32. Dev Env

传给子进程：

```text
API_PORT
WEB_PORT
MCP_PORT
```

并：

```text
MCP_HTTP_ENABLED=true
```

---

# 33. 启动 Filter

最终：

```text
@gip/api
@gip/web
@gip/worker
@gip/mcp-server
```

共同：

```bash
pnpm --parallel ... dev
```

但：

> `@gip/mcp-server dev` 必须启动 HTTP Transport，绝对不能启动 stdio。

否则多个进程日志会污染 stdio MCP 协议。

---

# 34. 最终开发日志

建议：

```text
开发环境启动配置：

  API 服务：
  http://127.0.0.1:4100

  Web 页面：
  http://127.0.0.1:4173

  MCP 服务：
  http://127.0.0.1:4200/mcp

  Worker：
  running
```

---

# 35. Phase 8：Dockerfile 增加 MCP Build/Runtime

当前 Dockerfile 已有：

```text
api
worker
web
```

缺：

```text
mcp
```

---

# 36. MCP Build Stage

建议加入：

```dockerfile
# MCP build stage
FROM pkg-source AS mcp-source
WORKDIR /app
COPY apps/mcp-server/ ./apps/mcp-server/

FROM mcp-source AS mcp-build
WORKDIR /app
RUN pnpm --filter @gip/mcp-server... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @gip/mcp-server deploy --legacy --prod /prod/mcp
```

---

# 37. MCP Runtime Stage

```dockerfile
FROM node:22-bookworm-slim AS mcp-runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=mcp-build /prod/mcp /app

EXPOSE 4200

CMD ["node", "dist/http.js"]
```

---

# 38. Docker Cache 要求

不要重做当前 Docker 多阶段结构。

当前 manifests 已包含：

```text
apps/mcp-server/package.json
```

继续复用。

---

# 39. Phase 9：docker-compose 增加 `mcp`

建议：

```yaml
  mcp:
    build:
      context: .
      dockerfile: docker/Dockerfile
      target: mcp-runtime

    env_file:
      - .env

    environment:
      NODE_ENV: production

      DATABASE_URL: postgres://gip:gip@postgres:5432/gip
      DATA_DIR: /app/data

      MCP_HTTP_ENABLED: "true"
      MCP_HOST: 0.0.0.0
      MCP_PORT: 4200
      MCP_PATH: /mcp

      GAMESMCP_ISTAROTH_URL: http://istaroth:8000/mcp
      GAMESMCP_GENSHIN_ISTAROTH_URL: http://istaroth:8000/mcp
      GAMESMCP_STARRAIL_ISTAROTH_URL: http://istaroth-starrail:8000/mcp

      GAMESMCP_STARRAIL_DATA_DIR: /app/data/games/starrail/turn-based-game-data

    depends_on:
      postgres:
        condition: service_healthy

    ports:
      - "127.0.0.1:4200:4200"

    volumes:
      - "${DATA_DIR:?DATA_DIR must point to a persistent external data directory}:/app/data"

    restart: unless-stopped

    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:4200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 15s
      timeout: 5s
      retries: 10
```

---

# 40. Provider 注意事项

当前 MCP 启动时也会：

```text
createProviderRegistry(config.providers)
```

所以 MCP Container 需要和 API 一样拿到：

```text
GAMESMCP_ISTAROTH_URL
GAMESMCP_GENSHIN_ISTAROTH_URL
GAMESMCP_STARRAIL_ISTAROTH_URL
GAMESMCP_STARRAIL_DATA_DIR
```

否则：

```text
DB Tool 正常
Provider Tool 失败
```

---

# 41. Docker 暴露端口策略

开发 / 私有机器：

```text
127.0.0.1:4200:4200
```

默认安全。

局域网：

```text
0.0.0.0:4200:4200
```

只有明确需要 LAN Client 时才开启，并要求：

```text
MCP_AUTH_TOKEN
```

---

# 42. Phase 10：Nginx 代理 `/mcp`

当前 Web Nginx 只代理：

```text
/api/
```

增加：

```nginx
location /mcp {
    proxy_pass http://mcp:4200;

    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Request-Id $request_id;

    proxy_buffering off;

    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

---

# 43. 为什么关闭 Proxy Buffer

Streamable MCP 可能使用流式响应。

如果 Nginx 缓冲：

```text
Agent 请求
↓
MCP 已经产生数据
↓
Nginx 继续攒
↓
客户端迟迟收不到
```

因此：

```nginx
proxy_buffering off;
```

必须作为重点测试项。

---

# 44. Web Container 依赖 MCP

Compose `web`：

```yaml
depends_on:
  - api
  - mcp
```

确保 Nginx Upstream 名称存在。

---

# 45. 最终 Docker 单入口

最终推荐：

```text
http://127.0.0.1:4173/
→ Web

http://127.0.0.1:4173/api/
→ API

http://127.0.0.1:4173/mcp
→ MCP
```

外部可以不直接暴露 4200。

---

# 46. Phase 11：Docker 部署脚本

本轮 Agent 必须新增实际部署脚本：

```text
scripts/docker-deploy.sh
```

不要只把命令写 README。

---

# 47. `scripts/docker-deploy.sh`

建议完整实现：

```bash
#!/usr/bin/env bash

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
    || fail "生产部署要求 MCP_AUTH_TOKEN"
fi

log "检查 Compose 配置"
docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  config >/dev/null

log "构建 API / Worker / MCP / Web"
docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  build \
  api \
  worker \
  mcp \
  web

log "启动 PostgreSQL"
docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d postgres

log "等待 PostgreSQL 健康"

for i in $(seq 1 30); do
  STATUS="$(docker inspect \
    --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q postgres)" \
    2>/dev/null || true)"

  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi

  if [[ "$i" == "30" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs postgres
    fail "PostgreSQL 未进入 healthy"
  fi

  sleep 2
done

log "启动 GamesMcp 核心服务"
docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d \
  api \
  worker \
  mcp \
  web

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
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs api
    fail "API health check 失败"
  }

wait_http "http://127.0.0.1:4200/health" "MCP" \
  || {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs mcp
    fail "MCP health check 失败"
  }

wait_http "http://127.0.0.1:4173/" "Web" \
  || {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs web
    fail "Web health check 失败"
  }

log "检查 MCP Ready"

if ! curl --fail --silent --show-error \
  --max-time 5 \
  "http://127.0.0.1:4200/ready"; then

  docker compose \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    logs mcp

  fail "MCP ready check 失败"
fi

printf '\n'
printf '%s\n' "GamesMcp 部署完成："
printf '%s\n' "  Web: http://127.0.0.1:4173/"
printf '%s\n' "  API: http://127.0.0.1:4100/api/"
printf '%s\n' "  MCP: http://127.0.0.1:4200/mcp"
printf '%s\n' "  MCP via Web: http://127.0.0.1:4173/mcp"
```

---

# 48. 部署脚本说明

这个脚本的职责：

```text
检查 Docker
↓
检查 .env
↓
检查 DATA_DIR
↓
生产模式检查 MCP Token
↓
验证 Compose
↓
Build
↓
启动 PostgreSQL
↓
等待 DB
↓
启动 API/Worker/MCP/Web
↓
检查 API
↓
检查 MCP
↓
检查 Web
↓
检查 MCP Ready
↓
成功
```

禁止：

```text
docker compose up -d
```

执行完就直接输出：

```text
部署成功
```

---

# 49. 可选 Provider 部署

如果：

```text
GAMESMCP_GENSHIN_ISTAROTH_ENABLED=true
```

或者：

```text
GAMESMCP_STARRAIL_PROVIDER=istaroth
```

脚本需要增加：

```text
provider mode
```

推荐支持：

```bash
./scripts/docker-deploy.sh --with-providers
```

然后额外启动：

```text
istaroth
istaroth-starrail
```

---

# 50. Provider 模式注意

当前 Compose 使用：

```text
ISTAROTH_IMAGE
```

并要求固定镜像。

正式部署：

```env
ISTAROTH_IMAGE=repository/image:明确版本
```

不要自动 fallback：

```text
latest
```

---

# 51. 建议增加 Provider 参数解析

脚本开头：

```bash
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
```

启动：

```bash
if [[ "$WITH_PROVIDERS" == "true" ]]; then
  docker compose ... up -d istaroth istaroth-starrail
fi
```

---

# 52. Phase 12：Docker 停止脚本

新增：

```text
scripts/docker-stop.sh
```

内容：

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  down
```

注意：

> 不加 `-v`。

禁止默认删除 PostgreSQL/Data Volume。

---

# 53. Phase 13：Docker 状态脚本

新增：

```text
scripts/docker-status.sh
```

建议：

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  ps

echo
echo "Health:"
curl -fsS http://127.0.0.1:4100/api/health || true
echo
curl -fsS http://127.0.0.1:4200/health || true
echo
curl -fsS http://127.0.0.1:4200/ready || true
echo
```

---

# 54. Phase 14：Docker 日志脚本

新增：

```text
scripts/docker-logs.sh
```

内容：

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

if [[ -n "$SERVICE" ]]; then
  docker compose \
    --env-file .env \
    -f docker-compose.yml \
    logs -f --tail=200 "$SERVICE"
else
  docker compose \
    --env-file .env \
    -f docker-compose.yml \
    logs -f --tail=200
fi
```

使用：

```bash
./scripts/docker-logs.sh mcp
```

---

# 55. Phase 15：Docker MCP Protocol Smoke

`/health` 正常不等于：

```text
MCP Protocol 正常
```

新增：

```text
scripts/test-mcp-http.ts
```

实际建立 MCP Client：

```text
Streamable HTTP Client
↓
initialize
↓
tools/list
↓
call list_games
```

---

# 56. 部署脚本最终必须调用 MCP Smoke

在部署成功前：

```bash
pnpm test:mcp:http:smoke
```

或容器化版本。

最低：

```text
initialize
PASS

tools/list
PASS

list_games
PASS
```

---

# 57. 根 package scripts

新增：

```json
{
  "scripts": {
    "test:mcp:http:smoke": "node --import tsx scripts/test-mcp-http.ts",

    "docker:deploy": "bash scripts/docker-deploy.sh",
    "docker:deploy:providers": "bash scripts/docker-deploy.sh --with-providers",
    "docker:stop": "bash scripts/docker-stop.sh",
    "docker:status": "bash scripts/docker-status.sh",
    "docker:logs": "bash scripts/docker-logs.sh"
  }
}
```

---

# 58. Windows 注意

如果 Windows 主要通过：

```text
WSL
Git Bash
```

运行项目，上述 Bash 脚本可直接继续使用。

如果项目要求纯 PowerShell，再 P1 增加：

```text
scripts/docker-deploy.ps1
```

本轮不必同时维护两份部署逻辑。

---

# 59. Phase 16：MCP Tool 多游戏语义修复

本轮 HTTP 化后 MCP 会正式成为产品入口。

因此顺便收口明显的：

```text
Genshin-only
```

描述。

当前：

```text
get_character
get_material
get_weapon
get_enemy
```

Description 中仍有：

```text
Genshin
```

应改 Generic。

---

# 60. `get_weapon`

为了兼容：

```text
get_weapon
```

暂时保留。

新增：

```text
get_equipment
```

Generic Tool。

内部：

```text
Genshin → Weapon
StarRail → LightCone
```

后续：

```text
get_weapon
```

标 Deprecated。

---

# 61. Item Material Enrichment

当前一些 Item enrichment 仍可能：

```text
repository.genshin.getMaterial()
```

必须改：

```text
GameDomainService / Archive Adapter
```

否则 HTTP MCP 星铁使用时仍会串 Genshin 数据。

---

# 62. Phase 17：MCP Response Budget

继续保留：

```text
DEFAULT_MCP_RESPONSE_BUDGET
shapeForBudget()
```

原则：

```text
Search Tool
→ 小结果 + excerpt

需要完整正文
→ Agent 再调用 get_document
```

禁止 HTTP 化后为了“方便”：

```text
一次返回全库
```

---

# 63. Phase 18：HTTP 协议测试

必须测试：

```text
initialize
tools/list
tools/call
resources/read
session reuse
session delete
session timeout
invalid session
auth missing
auth invalid
```

---

# 64. Phase 19：stdio 回归

必须继续：

```bash
pnpm --filter @gip/mcp-server start:stdio
```

并执行现有：

```bash
pnpm eval:mcp-tools
pnpm eval:mcp-story
```

---

# 65. Phase 20：原神真实 MCP E2E

Published Revision：

```text
list_games

get_character
→ 钟离

get_material

search_quests

search_dialogue
→ 指定原神剧情文本

get_entity_texts

search_mechanics
```

---

# 66. Phase 21：星铁真实 MCP E2E

```text
list_games

get_character
→ 黄泉

resolve_entity
→ 可可利亚

search_quests

search_dialogue
→ 可可利亚 + 星核

get_entity_texts

search_game_knowledge
```

---

# 67. Phase 22：Client Compatibility

至少验证：

```text
Codex
Claude / Claude Desktop
OpenCode / 标准 MCP Client
```

目标：

HTTP Client 最终只需要：

```text
URL
Token
```

不需要：

```text
本地项目路径
Node
pnpm
DATABASE_URL
```

---

# 68. Phase 23：生产反向代理

生产：

```text
Cloudflare / Nginx / Traefik
↓
HTTPS
↓
GamesMcp Web Nginx
↓
/mcp
↓
mcp:4200
```

禁止直接把：

```text
4200
```

裸暴露互联网。

---

# 69. Phase 24：AI 接入页面

P1。

Web 增加：

```text
AI 接入
```

但不要恢复 Admin。

显示：

```text
MCP 状态

Transport
Streamable HTTP

地址
https://xxx/mcp

游戏
原神 / 星铁

Tools
N 个

[复制地址]
```

不要在网页直接暴露完整：

```text
MCP_AUTH_TOKEN
```

---

# 70. Phase 25：文档

新增：

```text
docs/mcp.md
```

包含：

```text
架构
stdio
HTTP
pnpm dev
Docker
Codex
Claude
OpenCode
LAN
Remote
Auth
Troubleshooting
```

---

# 71. 推荐执行顺序

严格建议：

```text
Phase 1
Runtime / Transport 拆分
↓
Phase 2
Streamable HTTP
↓
Phase 3
Config
↓
Phase 4
Auth
↓
Phase 5
Health / Ready
↓
Phase 6
Package Script
↓
Phase 7
pnpm dev
↓
Phase 8
Dockerfile
↓
Phase 9
Compose
↓
Phase 10
Nginx
↓
Phase 11
Docker Deploy Script
↓
Phase 12~14
Stop / Status / Logs
↓
Phase 15
Protocol Smoke
↓
Phase 16
跨游戏 Tool 修复
↓
Phase 17
Response Budget
↓
Phase 18
HTTP Tests
↓
Phase 19
stdio Regression
↓
Phase 20~21
Real Data E2E
↓
Phase 22
Client Compatibility
↓
Phase 23
Production Proxy
↓
Phase 24
AI 接入页面
↓
Phase 25
Docs
```

---

# 72. 建议 Commit 切分

```text
refactor(mcp): separate runtime from stdio transport
```

```text
feat(mcp): add streamable http transport
```

```text
feat(config): add mcp http runtime settings
```

```text
feat(mcp): add bearer auth health readiness and session cleanup
```

```text
feat(dev): start http mcp in development stack
```

```text
feat(docker): add mcp runtime target and compose service
```

```text
feat(proxy): expose mcp through web nginx
```

```text
feat(deploy): add docker deploy status logs and stop scripts
```

```text
refactor(mcp): remove genshin-only public tool semantics
```

```text
test(mcp): add http protocol and real-data e2e gates
```

```text
docs(mcp): document stdio http docker and client setup
```

---

# 73. Agent 禁止事项

```text
❌ 删除 stdio MCP

❌ 把 MCP Tool 复制两套

❌ 自定义伪 MCP HTTP API

❌ pnpm dev 启动 stdio MCP

❌ production 0.0.0.0 无 Token

❌ Token 打日志

❌ Docker build 重新变成单阶段大镜像

❌ MCP HTTP 与 API 合并成一个进程

❌ search tool 一次返回超大正文

❌ Docker up 后不做 health 就说成功

❌ 只测 /health 不测 MCP initialize

❌ Fixture E2E Green 就宣布完成

❌ StarRail MCP 继续走 repository.genshin
```

---

# 74. Docker 部署验收

执行：

```bash
pnpm docker:deploy
```

必须依次成功：

```text
Compose Validation
PASS

Build API
PASS

Build Worker
PASS

Build MCP
PASS

Build Web
PASS

Postgres Healthy
PASS

API Health
PASS

MCP Health
PASS

MCP Ready
PASS

Web Health
PASS

MCP Protocol Initialize
PASS

tools/list
PASS

list_games
PASS
```

---

# 75. 本地开发验收

执行：

```bash
pnpm dev
```

必须看到：

```text
API
http://127.0.0.1:4100

Web
http://127.0.0.1:4173

MCP
http://127.0.0.1:4200/mcp

Worker
running
```

---

# 76. stdio 验收

```bash
pnpm --filter @gip/mcp-server start:stdio
```

MCP Client：

```text
initialize
PASS

tools/list
PASS
```

说明 HTTP 改造没有破坏本地 stdio。

---

# 77. Docker 最终拓扑

```text
                         Host
                          │
                    127.0.0.1:4173
                          │
                        Nginx
                  ┌───────┼────────┐
                  │       │        │
                  /      /api     /mcp
                  │       │        │
                 Web     API      MCP
                          │        │
                          └────┬───┘
                               │
                           PostgreSQL
                               │
                    ┌──────────┴──────────┐
                    │                     │
                  Genshin              StarRail
```

Provider：

```text
MCP/API
  │
  ├─ Istaroth Genshin
  └─ Istaroth StarRail
```

---

# 78. 最终 Release Gate

必须全部：

```text
MCP_STDIO_PASS=true
MCP_HTTP_PASS=true

MCP_HTTP_AUTH_PASS=true
MCP_SESSION_CLEANUP_PASS=true

MCP_DEV_STACK_PASS=true

MCP_DOCKER_BUILD_PASS=true
MCP_DOCKER_DEPLOY_PASS=true

MCP_NGINX_PROXY_PASS=true

MCP_GENSHIN_REAL_DATA_PASS=true
MCP_STARRAIL_REAL_DATA_PASS=true

MCP_CODEX_CLIENT_PASS=true
MCP_CLAUDE_CLIENT_PASS=true

MCP_RESPONSE_BUDGET_PASS=true

CI_GREEN=true
```

最终才能：

```text
MCP_HTTP_RELEASE_VERIFIED=true
```

---

# 79. Agent 最终报告必须包含

```text
Commit SHA:

stdio MCP:
HTTP MCP:

MCP URL:
MCP Port:
MCP Path:

Auth:
Session:
Idle Timeout:
Max Sessions:

Health:
Ready:

pnpm dev:
Docker Build:
Docker Deploy:
Nginx Proxy:

Genshin Tools:
StarRail Tools:

Provider Tools:

Protocol Initialize:
tools/list:
resources/read:

Codex:
Claude:
OpenCode:

Real Genshin E2E:
Real StarRail E2E:

Response Budget:

CI:

MCP_HTTP_RELEASE_VERIFIED = true / false
```

---

# 80. 最终目标

本轮完成后，GamesMcp 应该从：

```text
只有本机 stdio MCP
```

升级成：

```text
                 GamesMcp MCP
                       │
            ┌──────────┴──────────┐
            │                     │
          stdio               Streamable HTTP
            │                     │
       本地 Agent            Docker / LAN / Remote
            │                     │
            └──────────┬──────────┘
                       │
                 Game Knowledge
                 ┌─────┴─────┐
                 │           │
               原神          星铁
```

同时：

```bash
pnpm dev
```

负责开发栈；

```bash
pnpm docker:deploy
```

负责 Docker 部署；

远程 Agent 只需要：

```text
MCP URL
+
MCP Token
```

即可使用 GamesMcp 的原神和星铁知识能力。
