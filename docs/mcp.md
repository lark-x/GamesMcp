# GamesMcp MCP 接入文档

GamesMcp 通过 MCP（Model Context Protocol）对外提供原神与星穹铁道的知识能力。工具注册只有一套（`apps/mcp-server/src/server.ts`），两种 Transport 共享：

```
GamesMcp MCP
      │
   createMcpServer()
      │
 ┌────┴─────────┐
 stdio       Streamable HTTP
 本地 Agent    Docker / LAN / 远程 Agent
```

## Tool 一览

| 类别 | 工具 |
| --- | --- |
| 平台 | `list_games` `get_game_capabilities` |
| 实体 | `get_character` `get_material` `get_equipment`（原神武器 / 星铁光锥）`get_weapon`（`get_equipment` 别名）`get_enemy` `resolve_entity` |
| 检索 | `search_dialogue` `search_quests` `search_lore` `search_entities` `search_items` `search_mechanics` `search_game_knowledge` |
| 读取 | `get_quest` `get_lore_document` `get_relationships` `get_entity_texts` `get_item_text` `get_game_document` `get_game_document_hierarchy` |
| Provider | `get_game_provider_status` 及各游戏 provider 工具 |

Response budget：检索类工具只返回小结果 + excerpt；需要完整正文时再调用 `get_*` 读取。

## 本地开发（stdio）

```bash
pnpm --filter @gip/mcp-server start        # stdio（默认，兼容旧客户端）
pnpm --filter @gip/mcp-server start:stdio  # 显式 stdio
```

stdio 模式下一个进程对应一个客户端会话，stdout 专用于协议。本地 MCP 客户端（Codex / Claude Desktop / OpenCode）配置示例：

```json
{
  "mcpServers": {
    "gamesmcp": {
      "command": "pnpm",
      "args": ["--filter", "@gip/mcp-server", "start"],
      "cwd": "F:/Project/GamesMcp"
    }
  }
}
```

## 本地开发（HTTP）

```bash
pnpm dev
```

同时启动 Web / API / Worker / MCP：

```text
Web  http://127.0.0.1:4173
API  http://127.0.0.1:4100
MCP  http://127.0.0.1:4200/mcp
```

端口被占用时自动顺延（+1 至 +99），启动日志会打印实际端口。开发环境 `MCP_AUTH_TOKEN` 可为空。

仅启动 HTTP MCP：

```bash
pnpm --filter @gip/mcp-server dev          # = dev:http
pnpm --filter @gip/mcp-server dev:stdio    # 仅调试 stdio
```

## 配置

```env
MCP_HTTP_ENABLED=true          # HTTP 入口开关（pnpm dev 自动注入 true）
MCP_HOST=127.0.0.1             # 生产/容器为 0.0.0.0
MCP_PORT=4200
MCP_PATH=/mcp
MCP_AUTH_TOKEN=                # 本地可空；生产非回环绑定必须配置
MCP_SESSION_IDLE_TIMEOUT_MS=1800000
MCP_MAX_SESSIONS=100
MCP_REQUEST_TIMEOUT_MS=30000
```

安全规则：`NODE_ENV=production` 且 `MCP_HOST` 非回环地址时，未配置 `MCP_AUTH_TOKEN` 会直接拒绝启动。Token 使用恒定时间比较，日志永不输出 Authorization 内容。

## 鉴权

HTTP MCP 使用 Bearer Token：

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

远程客户端只需要 **URL + Token**，无需本地 Node/pnpm/数据库。

## Docker 部署

```bash
pnpm docker:deploy              # 构建 + 启动 + 健康检查 + MCP 协议冒烟
pnpm docker:deploy:providers    # 同时启动 istaroth / istaroth-starrail
pnpm docker:status              # compose ps + /health + /ready
pnpm docker:logs [service]      # 跟踪日志（mcp/api/web/worker/postgres）
pnpm docker:stop                # down（保留数据卷）
```

`docker-deploy.sh` 的完成标准：Compose 校验 → 构建 api/worker/mcp/web → PostgreSQL healthy → 四服务启动 → API `/api/health`、MCP `/health`、Web `/`、MCP `/ready` 全部通过 → `scripts/test-mcp-http.ts` 协议冒烟（initialize / tools/list / list_games）通过。

MCP 容器暴露策略：默认 `127.0.0.1:4200`。需要 LAN 接入时改为 `0.0.0.0:4200` 并必须配置 `MCP_AUTH_TOKEN`。

## 访问拓扑

```text
http://127.0.0.1:4173/       → Web（nginx 静态）
http://127.0.0.1:4173/api/   → API
http://127.0.0.1:4173/mcp    → MCP（nginx 代理，proxy_buffering off）
http://127.0.0.1:4200/mcp    → MCP 直连
```

生产反向代理（Caddy/Nginx/Cloudflare）只需把流量交给 Web 容器，`/mcp` 由内置 nginx 继续转发到 `mcp:4200`；不要把 4200 直接裸暴露公网。

## 会话管理

- 每个客户端 `initialize` 产生一个独立会话（SDK 生成的 session id，经 `Mcp-Session-Id` 头复用）。
- `DELETE /mcp` 关闭会话；空闲超过 `MCP_SESSION_IDLE_TIMEOUT_MS` 自动回收；上限 `MCP_MAX_SESSIONS`（超限返回 503 `mcp_session_limit_reached`）。
- 会话状态在内存中，多实例部署需要粘性会话。

## 健康检查

| 端点 | 含义 |
| --- | --- |
| `GET /health` | 进程存活（不触库） |
| `GET /ready` | 数据库可连 + 至少注册一个游戏（否则 503） |

## 验证命令

```bash
pnpm test:mcp:http:smoke   # 协议冒烟：initialize/tools/list/list_games + 负向（401/404）
pnpm test:mcp:http:e2e     # 真实数据 E2E：双游戏角色/装备/任务/对白/物品
```

E2E 覆盖：原神（钟离 / 护摩之杖 / 魔神任务 / 摩拉）与星铁（黄泉 / 行于流逝的岸 / 可可利亚对白 / 混乱行至深处）。带 Token 时对 4201 之类受保护实例自动加入 401 负向用例。

已知 Windows 小坑：冒烟脚本在所有门禁 PASS 后退出时，偶发 libuv `async.c` 断言（SDK 客户端关闭竞态），不影响验证结论；CI/deploy 若遇到重跑即可。

## Troubleshooting

- **MCP 没起来**：确认 `MCP_HTTP_ENABLED=true`（`pnpm dev` 会自动注入；手动启动 http.ts 时需显式设置）。
- **401 Unauthorized**：客户端未带或带错 `Authorization: Bearer`。
- **404 Session not found**：服务重启后 session id 失效，重新 initialize。
- **503 mcp_session_limit_reached**：调大 `MCP_MAX_SESSIONS` 或等待空闲回收。
- **工具报 game_id_required**：注册了多个游戏时需显式传 `game_id`（可用 `list_games` 获取）。
- **星铁工具无数据**：确认 `GAMESMCP_STARRAIL_*` 配置与 `data:starrail:ingest` 已执行。
