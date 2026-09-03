# GamesMcp (Game Intelligence Platform)

GamesMcp 是一个独立部署的多游戏叙事知识平台与 Codex 档案库系统。提供游戏本地资料导入、版本化管理、全字段与语义检索、证据链问答、高密度 Web 档案阅读器以及标准 MCP (Model Context Protocol) 接口。

---

## 目录

- [核心架构](#核心架构)
- [快速开始（本地开发）](#快速开始本地开发)
- [生产环境部署](#生产环境部署)
  - [方式一：Docker Compose 全栈部署（推荐）](#方式一docker-compose-全栈部署推荐)
  - [方式二：Node.js 原生部署 / Systemd](#方式二nodejs-原生部署--systemd)
  - [反向代理与私网安全（Caddy / Cloudflare Access）](#反向代理与私网安全caddy--cloudflare-access)
  - [健康检查与就绪探针](#健康检查与就绪探针)
- [档案库模块 (Archive Codex)](#档案库模块-archive-codex)
- [MCP 客户端接入](#mcp-客户端接入)
- [测试与质量验证](#测试与质量验证)
- [数据边界与备份恢复](#数据边界与备份恢复)

---

## 核心架构

系统由以下应用与核心模块组成，整体仅依赖 PostgreSQL (支持 pgvector)，无需额外引入 Redis、Kafka、MinIO 等重型中间件：

- **`apps/web`**：基于 React 19 + Vite 的 Web 档案库与管理端前端。内置剧情连续正文阅读器 (Story Browser)、全游戏通用材料百科 (Material Browser) 以及文献文本阅读器 (Text Browser)。
- **`apps/api`**：基于 Fastify 的核心 REST API 服务，暴露游戏元数据、知识库检索、Codex 统一数据接口及管理端审核发布流。
- **`apps/worker`**：后台异步任务处理进程，负责资料异步解析导入、结构化抽取、向量嵌入与全文索引构建。
- **`apps/mcp-server`**：提供基于 stdio 与 HTTP 传输协议的 MCP 接口，可直接接入 Claude Desktop、Cursor、Windsurf 等 IDE 与大模型客户端。
- **`packages/*`**：包含 `contracts` (Zod 数据契约)、`domain` (领域逻辑与检索服务)、`database` (PostgreSQL + Drizzle ORM)、`retrieval` (向量与混合检索)、`search` (全文检索与分词)、`qa` (证据问答评估)、`providers` (外部多游戏 Provider 适配)。

---

## 快速开始（本地开发）

### 环境要求

- **Node.js**: `22.x`+ (`<26`)
- **pnpm**: `11.1.2`+
- **Docker** / Docker Compose（用于本地 PostgreSQL 与 pgvector）

### 启动步骤

1. **安装依赖与配置环境变量**：

   ```bash
   cp .env.example .env
   pnpm install
   pnpm build
   ```

2. **启动本地数据库并迁移初始化**：

   ```bash
   pnpm db:up       # 通过脚本启动本地 pgvector/pgvector:pg16 容器
   pnpm db:migrate  # 执行 Drizzle 数据库迁移
   pnpm db:seed     # 写入初始种子数据（包含默认游戏与示例数据）
   ```

3. **启动全栈开发服务**：
   ```bash
   pnpm dev
   ```
   该命令将并发启动 API、Web 以及 Worker 进程：
   - **Web 前端**：`http://127.0.0.1:4173`
   - **API 服务**：`http://127.0.0.1:4100`
   - **Worker**：后台自动轮询并执行异步导入与索引任务

---

## 生产环境部署

### 方式一：Docker Compose 容器化部署

#### 1. 开发与本地构建环境 (`docker-compose.yml`)

采用统一 Multi-stage Dockerfile 与 BuildKit pnpm 依赖缓存挂载，并隔离了 `apps/web`、`apps/api` 与 `apps/worker` 的源码构建层。日常修改任意前端代码不会重编后端与重新下载 npm 依赖：

```bash
# 本地构建并后台启动开发容器集群
docker compose up -d --build

# 快速查看容器运行状态与健康探针
docker compose ps
```

#### 2. 生产环境零编译部署 (`docker-compose.prod.yml`)

生产环境严禁在宿主机上重新执行 `pnpm install` 或 `docker build` 编译源码。通过预构建并发布于 GitHub Container Registry (`ghcr.io`) 的不可变镜像直接拉取启动：

```bash
# 一键生产拉取与健康检查启动（自动校验持久化目录与依赖）
bash scripts/deploy.sh

# 平滑更新指定版本镜像
bash scripts/update.sh <commit-sha-or-version>

# 异常时一键秒级回滚
bash scripts/rollback.sh

# 随时执行系统与探针健康检查
bash scripts/health-check.sh

# （可选）预热外部 Istaroth 镜像与模型缓存
bash scripts/prewarm-models.sh
```

#### 3. 容器数据持久化结构

`${DATA_DIR}` 挂载给 API 与 Worker，其持久化结构如下：

```text
${DATA_DIR}/
├── postgres/           # PostgreSQL 数据持久化
├── snapshots/          # 不可变原始资料快照
├── imports/            # 待导入的原始文件放置目录
├── games/              # 多游戏静态解包资源与缓存
└── istaroth/           # （可选）Istaroth checkpoint 与模型缓存
```

---

### 方式二：Node.js 原生部署 / Systemd

如需在宿主机直接以守护进程运行，可按以下步骤操作：

#### 1. 构建构建产物

```bash
pnpm install --frozen-lockfile
pnpm build
```

#### 2. 配置 Systemd 服务

- **API 服务 (`/etc/systemd/system/gamesmcp-api.service`)**:

  ```ini
  [Unit]
  Description=GamesMcp API Service
  After=network.target postgresql.service

  [Service]
  Type=simple
  User=gamesmcp
  WorkingDirectory=/opt/GamesMcp
  EnvironmentFile=/opt/GamesMcp/.env
  ExecStart=/usr/bin/node apps/api/dist/server.js
  Restart=always
  RestartSec=5

  [Install]
  WantedBy=multi-user.target
  ```

- **Worker 进程 (`/etc/systemd/system/gamesmcp-worker.service`)**:

  ```ini
  [Unit]
  Description=GamesMcp Async Worker
  After=network.target gamesmcp-api.service

  [Service]
  Type=simple
  User=gamesmcp
  WorkingDirectory=/opt/GamesMcp
  EnvironmentFile=/opt/GamesMcp/.env
  ExecStart=/usr/bin/node apps/worker/dist/index.js
  Restart=always
  RestartSec=5

  [Install]
  WantedBy=multi-user.target
  ```

- **Web 静态文件**:
  `apps/web/dist` 产物可直接交由宿主机 Nginx 代理，并反向代理 `/api/` 路径至 `127.0.0.1:4100`。

---

### 反向代理与私网安全（Caddy / Cloudflare Access）

生产环境强烈建议将 GamesMcp 部署于私有网络内，通过 Cloudflare Tunnel 或 Tailscale 提供私有可信访问。

`docker/Caddyfile` 提供了默认安全代理配置：

```text
Cloudflare Access → Cloudflare Tunnel → Caddy / Nginx (Port 80) ──> Web (静态文件)
                                                                 └──> API (反代 /api/*)
```

1. **权限隔离**：除 Web 端口（80/443）外，PostgreSQL (5432)、API (4100)、Worker 以及 MCP 端口严禁直接暴露到公网。
2. **管理员令牌认证**：所有 `/api/admin/*` 管理端写操作必须携带请求头：
   ```http
   Authorization: Bearer <ADMIN_TOKEN>
   ```

---

### 健康检查与就绪探针

| 端点                    | 检查用途                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `GET /api/health`       | 基础存活探针 (Liveness)，仅证明 HTTP 进程响应正常                  |
| `GET /api/ready`        | 全局就绪探针 (Readiness)，检查 PostgreSQL 连接与当前版本数据集状态 |
| `GET /api/ready/search` | 检索服务就绪状态（检查词法与混合索引状态）                         |
| `GET /api/ready/worker` | Worker 心跳检查（检查最近 30 秒内是否有 Worker 活跃心跳）          |
| `GET /api/ready/llm`    | 检查上游 LLM 与 Embedding 配置就绪情况                             |

---

## 档案库模块 (Archive Codex)

平台内置沉浸式知识档案库浏览体验，支持三大板块：

1. **剧情档案 (Story Browser - `#story`)**：
   - **通用目录分层树**：支持多级系列、章节、任务的折叠与无障碍导航。
   - **连续正文阅读**：正文采用连贯叙事流排版，替代气泡式对话展示；支持游标无缝分页。
   - **Inspector 证据链**：显示出场角色、前置后置任务与数据来源版本，支持引用台词平滑滚动定位与黄色高亮。
   - **历史栈同步**：任务切换与浏览器前进/后退完全同步，支持 URL 深链分享（如 `/#story/quest%2F1000`）。
2. **材料百科 (Material Browser - `#archive/materials`)**：
   - **跨游戏通用材料分类**：全面兼容原神特产、星铁行迹材料等各品类数据。
   - **全字段模糊过滤**：支持对材料名称、描述、产出途径 (sources) 及适用角色/光锥 (usedBy) 的跨字段即时检索。
   - **超百项分页**：内置标准翻页组件，单次支持超大体量材料的高效分页拉取。
3. **文献文本 (Text Browser - `#text/books`)**：
   - **多卷书架阅读**：分卷浏览游戏内书籍、文献、日志。
   - **精确 Deep Link 优先**：严格优先匹配 `bookId` + `chapterId`，无损恢复阅读进度。

---

## MCP 客户端接入

GamesMcp 支持标准 MCP 协议，供大模型智能体直接调用游戏知识工具。

在 Claude Desktop / Cursor / Windsurf 的配置文件（例如 `claude_desktop_config.json`）中添加：

```json
{
  "mcpServers": {
    "gamesmcp": {
      "command": "node",
      "args": ["/绝对路径/GamesMcp/apps/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgres://gip:gip@127.0.0.1:5432/gip"
      }
    }
  }
}
```

平台暴露的标准 MCP 工具包括：

- `search_game_knowledge`：混合搜索剧情、书籍、实体知识库
- `get_game_document`：获取特定文献/正文完整段落
- `get_game_document_hierarchy`：获取知识层级树与章节结构
- `get_game_provider_status`：查询外部多游戏 Provider 状态

---

## 测试与质量验证

项目保持 100% CI 绿色门禁，可在提交前在本地执行完整验证流水线：

```bash
# 1. 验证 Prettier 代码风格
pnpm format:check

# 2. 验证 ESLint 代码规范
pnpm lint

# 3. TypeScript 全工程编译类型检查
pnpm typecheck

# 4. 运行全量 Vitest 单元与集成测试（包含合约测试、领域测试等 42+ 测试套件）
pnpm test

# 5. 编译全量 Workspace 构建产物
pnpm build

# 6. 运行 Playwright 端到端测试（涵盖桌面端与移动端 20 项端到端流程）
pnpm playwright test apps/web/tests/archive.spec.ts
```

---

## 数据边界与备份恢复

1. **冷数据隔离**：原始完整未清洗的解包数据仅存放于外部存储目录或配置的 `DATA_DIR` 中，不计入 Git 仓库跟踪。
2. **灾难恢复与备份**：通过 `pnpm data:backup` 可对已发布的 Dataset Revision、快照引用及元数据创建一致性备份，详细操作指南参考 [`docs/backup-and-recovery.md`](docs/backup-and-recovery.md)。
