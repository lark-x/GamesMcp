# 部署与私有访问

Game Intelligence Platform 是独立部署的私有知识库。运行组件只有 PostgreSQL + pgvector、API、Web、Worker 和 MCP stdio server；不需要 SthStart、AkashaTerminal、Redis、Kafka 或 MinIO。

## 本地开发

要求 Node.js 22、pnpm 11 和 Docker：

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

访问 `http://127.0.0.1:4173`。API 默认是 `http://127.0.0.1:4100`，MCP 客户端按 [`mcp-client-config.json`](./mcp-client-config.json) 以 stdio 启动。开发时 `pnpm dev` 会同时启动 API、Web 和 Worker；Worker 必须运行，异步导入才会从 `pending` 进入 `running` 和 `review_required`。

本地导入建议把资料放在 `data/imports/`，并提交相对于当前机器的实际路径。导入任务只在 PostgreSQL 中保存任务元数据；原始不可变快照写入 `DATA_DIR/snapshots/`。

## Docker Compose

创建 `.env` 后执行：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4100/api/health
```

Compose 中 API、Web 和 PostgreSQL 只绑定到本机回环地址；Worker 没有宿主机端口。容器导入路径必须对 API 和 Worker 都可见，默认使用 `./data:/app/data`，因此 Docker 模式应使用容器内路径，例如 `/app/data/imports/lore.json`。停止服务：

```bash
docker compose stop
docker compose start
```

生产环境设置随机 `ADMIN_TOKEN`，并将 `NODE_ENV=production`。所有 `/api/admin/*` 请求必须带：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

普通阅读、检索和 MCP 查询不需要管理 token；MCP stdio 仍应只在本机可信用户下启动。

## 健康检查与故障行为

| 端点                    | 用途                                    |
| ----------------------- | --------------------------------------- |
| `GET /api/health`       | API liveness，只证明进程存活            |
| `GET /api/ready`        | 数据库和当前 Dataset Revision readiness |
| `GET /api/ready/search` | 当前全文/版本检索是否可用               |
| `GET /api/ready/llm`    | LLM 是否已配置；不代表每次请求都成功    |
| `GET /api/ready/worker` | 最近 30 秒是否有 Worker heartbeat       |

导入或回滚后的索引任务未完成时，系统保留上一个可搜索版本；Worker 重启后租约过期任务可以再次领取。LLM 不可用时阅读和检索仍可用，问答返回明确错误；Embedding 不可用时保留词法检索。

## Caddy + Cloudflare Access

`docker/Caddyfile` 只把 Web 作为唯一入口，Web 的 nginx 再将 `/api/` 反向代理到 API。将 Cloudflare Tunnel 的服务地址指向 Caddy，而不是 PostgreSQL 或 Worker；MCP stdio 不经过 Tunnel：

```text
Cloudflare Access → Cloudflare Tunnel → Caddy → Web/nginx → API
```

部署时：

1. 在 Cloudflare Zero Trust 中创建 Tunnel，并把公开 hostname 的 service 指向 Caddy 的 `80` 端口。
2. 为该 hostname 创建 Access 应用，只允许自己的身份/邮箱组访问。
3. 在 API 的 `.env` 中设置 `NODE_ENV=production`、随机 `ADMIN_TOKEN` 和明确的 `CORS_ORIGINS`（例如 `https://knowledge.example.com`）。
4. 防火墙只允许 Caddy/API 所需端口；不要把 PostgreSQL、Worker 或 MCP 暴露到公网。
5. 通过 `/api/ready`、`/api/ready/search` 和 `/api/ready/worker` 验证数据库、索引、LLM 配置和 Worker 状态。

## 日志与安全边界

允许记录 request ID、路由、耗时、状态码、任务 ID、Dataset Revision 和错误码。禁止记录 API Key、完整 Authorization Header、完整 LLM Prompt、大段正文、导入本地绝对路径或完整问答上下文。API 错误响应统一使用 `error.code/message/requestId`，不会回显数据库错误详情。
