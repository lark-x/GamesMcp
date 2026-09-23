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

| 类别     | 工具                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| 平台     | `list_games` `get_game_capabilities`                                                                                |
| 实体     | `get_character` `get_material` `get_equipment`（原神武器 / 星铁光锥）`get_enemy` `resolve_entity`                   |
| 检索     | `search`（统一检索全部语料）`search_game_knowledge`                                                                 |
| 读取     | `get_quest` `get_document` `get_relationships` `get_entity_texts` `get_game_document` `get_game_document_hierarchy` |
| Provider | `get_game_provider_status` 及各游戏 provider 工具                                                                   |

Response budget：检索类工具只返回小结果 + excerpt；需要完整正文时再调用 `get_*` 读取。

`search` 是唯一的检索入口：入参 `game_id` / `query` / `limit`（默认 10，上限 50），
可选 `type`（`all`/`dialogue`/`quest`/`document`/`item`/`mechanism`/`structured`，默认 `all`）
与 `speaker`、`quest`、`locale` 筛选。每条结果带 `type` 标签与引用 id，
模型据此决定是否下钻 `get_quest` / `get_document` 读取完整正文。

### 语言（`locale`）

语料是双语的：原神每个任务同时存有中文与英文两份（对话节点内容各自独立），
因此默认必须限定语言，否则同一次检索会混入两种语言、或让英文查询命中英文副本。

- **默认 `zh-CN`**：不传 `locale` 时，全部检索面（对话 / 任务 / 文档 / 物品 / 机制）
  都只返回中文素材。
- **显式切换**：传 `locale: "en"` 即可检索英文素材，例如
  `search({ game_id, query: "Rite of Descension", locale: "en" })`。

星铁语料目前只有中文，该参数对其无影响。

### 结果配比与 `limit`

`limit` 就是页大小（默认 10，上限 50）：请求多少条就返回多少条，条数上限与
字节上限都随页大小等比放大。

每个命中面（对话 / 任务 / 文档 / 物品 / 机制 / 结构化）各自使用不同的打分区间
（结构化与文档可达 ~8.8，台词上限约 6.6）。若只按分数排序，高分面会用大量
相似条目把真正承载正文的面整个挤出结果，例如搜「水仙十字」时前排被同名卡牌
与教学文本占满，任务与台词一条都进不来。因此合并时先按面保留配额（页面的一半
均分给各命中面），剩余名额再按分数补足，展示顺序仍为分数优先。

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

`scripts/docker-stack.ts` 的完成标准：Compose 校验 → 构建 api/worker/mcp/web → PostgreSQL healthy → 四服务启动 → API `/api/health`、MCP `/health`、Web `/`、MCP `/ready` 全部通过 → `scripts/test-mcp-http.ts` 协议冒烟（initialize / tools/list / list_games）通过。

以上命令统一走 `node --import tsx scripts/docker-stack.ts <action>`，不依赖 bash。这样在 Windows 上不会误用 WSL 的 bash（它连的是 WSL 自带的 Docker 引擎，看不到 Docker Desktop 的容器，还会把 `F:/...` 当成相对路径），macOS / Linux 上行为完全一致。

必填的 `.env` 变量：

- `DATA_DIR`：持久化数据目录。各平台使用本机绝对路径（macOS 示例 `/Volumes/Lark/lark/GamesMcp/data`）。把 Windows 盘符路径带到 macOS 会被直接拒绝，而不是静默挂载到错误位置。
- `ISTAROTH_IMAGE`：compose 在解析阶段就要求非空，即使不启动 provider。只有 `pnpm docker:deploy:providers` 会真正拉取，届时必须替换为固定的 tag 或 digest。
- `MCP_AUTH_TOKEN`：仅 `docker:deploy` 强制要求（compose 固定以 production + `0.0.0.0` 启动 MCP，必然命中鉴权门禁）。

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

| 端点          | 含义                                      |
| ------------- | ----------------------------------------- |
| `GET /health` | 进程存活（不触库）                        |
| `GET /ready`  | 数据库可连 + 至少注册一个游戏（否则 503） |

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
