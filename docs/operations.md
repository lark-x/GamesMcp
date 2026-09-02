# 操作手册

## 评测与质量门

不依赖数据库的评测命令可在任意环境直接运行：

```bash
pnpm eval:search-core   # 搜索核心排序/解析基线（8 用例）
pnpm eval:mcp-tools     # MCP 结构化工具 KPI（7 用例，平均 1 次调用）
```

需要数据库的评测在 `pnpm db:up && pnpm db:migrate` 并导入样例数据后运行：

```bash
pnpm eval:retrieval     # 109 条检索 golden（ENFORCE_RETRIEVAL_TARGETS=1 强制达标）
pnpm eval:qa            # 证据 QA golden（ENFORCE_QA_TARGETS=1 强制达标）
```

发布前建议至少完整跑一轮上述命令并记录输出。

## Game Codex / Game MCP 工具面

- REST：`/api/games/:gameId/genshin/{characters,materials,weapons,artifacts,achievements,enemies}`
  为只读结构化接口，响应经共享 Zod 契约校验。
- MCP：`get_character`、`get_material`、`resolve_entity`、`search_dialogue`
  等游戏语义工具接受显示名，内部通过 `GameDomainService` 解析；旧的通用
  工具仍可用，计划在清理阶段（Phase 12）标记弃用。
- 结构化数据页：Web `#codex/<kind>`（角色/材料/武器/圣遗物/成就/敌人）。

## 日常启动

```bash
node --import tsx scripts/check-data-storage.ts
pnpm build
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

确认 API、搜索和 Worker readiness 都正常后再导入资料：

```bash
curl http://127.0.0.1:4100/api/ready
curl http://127.0.0.1:4100/api/ready/search
curl http://127.0.0.1:4100/api/ready/worker
```

开发启动脚本会自动检测端口；如果 4100 或 4173 被占用，会在附近寻找空闲端口，并在启动日志中打印实际地址。也可以手动指定端口：

```bash
API_PORT=14100 WEB_PORT=14173 pnpm dev
```

## 导入、审核和发布

### AnimeGameData 任务快照

任务转换器会读取外置盘上的固定 AnimeGameData Commit，并只把中英文均有明确标题、完整子任务和对话图的真实任务写入公开记录。隐藏、未发布、测试/占位、元数据-only 或双语不成对的记录会保留在 Manifest 的排除统计中，不会出现在公开 Revision。

```bash
pnpm data:convert:anime-quests -- --commit=26df1dfbdf05a82bbb1d97506859f3e1c40718d8 --game-version=7.0.0 --version-label=CNRELWin7.0.0
ANIME_GAME_CATEGORY=quest pnpm data:import:anime
```

转换器会先执行外置存储预检，并核对实际 Git HEAD；输出位于 `DATA_DIR/imports/normalized/anime-game-data/<commit>/quests/`。Manifest 的 `accounting.accountedCoverage` 必须为 1，`unexplainedMissing` 必须为空。

### 清理历史后重建

清理命令默认只展示将要清理的表；执行前请先 `pnpm data:backup`。由于该操作会同时删除业务历史和审计日志，必须显式提供两个确认值：

```bash
pnpm data:reset:history -- --dry-run=true
pnpm data:backup
pnpm data:reset:history -- --confirm=DELETE_ALL_HISTORY --audit-confirm=DELETE_AUDIT_LOG
pnpm db:migrate
pnpm db:seed
```

该命令不会删除 `platform.games`、能力配置、数据库结构或外置盘原始快照；数据库备份仍可用于恢复。生产环境会被拒绝执行。

1. 在 Web 的“数据管理”中选择已有来源，或创建 `local_json`、`local_markdown`、`local_text`、`local_directory` 来源。
2. 输入 API/Worker 都能读取的本地路径，发起导入。API 只创建 `pending` 批次和 PostgreSQL `parse_import` 任务。
3. Worker 领取任务并更新为 `running`，创建不可变快照、标准化记录、校验结果和 Diff。
4. 在 Diff 页面检查新增、修改、未变化、冲突、未解析和删除候选；删除候选默认不删除线上数据。刷新页面后可从“已有导入批次”选择之前的批次继续处理。
5. 审核时填写审核说明，只勾选确实确认删除的 `deletionCandidates`；批次变为 `review_required`。
6. 对 AnimeGameData 等带字段级出处的采集批次，先执行 `pnpm data:backup`；系统会校验备份清单和人工核验门禁后才允许发布。发布后创建新的 Dataset Revision，事务完成后才切换当前指针；全文重建和 Embedding 任务异步执行。
7. 在后台任务列表和 `/api/ready/search` 确认索引状态。刷新 Web 不会丢失批次或任务状态。

重复导入相同内容不会重复创建同一来源的 Snapshot；无变化批次发布为幂等操作，不创建新的 Dataset Revision。

## 回滚

在 Dataset Revisions 中选择目标版本并填写原因。回滚是当前指针切换，不删除后续版本；系统记录审计日志并排队索引切换。确认搜索结果的 `revision`、引用片段和实体详情均来自目标版本。

## 任务与故障处理

- `pending`：等待 Worker。
- `running`：Worker 持有租约；进程中断后租约过期可重新领取。
- `completed`：任务完成。
- `failed`：达到最大重试次数仍失败；导入批次保持失败，当前已发布版本不变。
- `cancel_requested`：预留的取消标记，不应被 Worker 领取。

Worker 只在心跳正常时被 `/api/ready/worker` 视为可用。Embedding 服务不可用时，语义任务失败不会使词法索引失效；LLM 不可用时检索和文档阅读继续工作。

## Provider operations

Provider tools are intentionally separate from local tools:

```text
search_game_knowledge
get_game_document
get_game_document_hierarchy
get_game_provider_status
```

Status:

```bash
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm check:istaroth-health
```

Real E2E:

```bash
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm test:istaroth-provider
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm test:starrail-provider
```

Benchmark:

```bash
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm benchmark:provider
PROVIDER_BENCHMARK_GAME=starrail GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm benchmark:provider
```

Failure behavior:

- Istaroth down returns `provider_timeout` or `provider_unavailable`.
- StarRail data path missing returns `provider_unavailable`.
- GamesMcp local tools and other providers continue to run.
- There is no silent fallback between games or providers.

Recovery:

```bash
docker compose restart istaroth
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm check:istaroth-health
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm test:istaroth-provider
```

The Istaroth client closes broken transports and retries once with a fresh MCP connection for timeout, unavailable, and protocol failures.

## 停止与升级

```bash
docker compose stop
docker compose up -d --build
pnpm db:migrate
```

升级前先备份数据库和 `DATA_DIR/snapshots/`，参见 [`backup-and-recovery.md`](./backup-and-recovery.md)。不要使用数据库集成测试清理默认 `gip` 数据库。

## 安全检查清单

- 生产设置 `NODE_ENV=production` 和随机 `ADMIN_TOKEN`。
- `CORS_ORIGINS` 只列出实际 Web origin。
- PostgreSQL、Worker 和 MCP stdio 不暴露公网。
- 只允许 API/Worker 读取导入目录；路径不写入普通 API 响应。
- 日志中不出现 API Key、Authorization Header、完整 Prompt、正文大段和绝对路径。
- 定期运行备份恢复演练，并在隔离数据库运行 `GIP_DB_TEST_URL=... pnpm test:db`。
