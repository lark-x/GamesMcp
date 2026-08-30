# 操作手册

## 日常启动

```bash
node --import tsx scripts/check-data-storage.ts
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

如果 4100 或 4173 已被本机其他项目占用，可以同时改 API 端口、Web 端口和 Vite 代理：

```bash
API_PORT=14100 WEB_PORT=14173 pnpm dev
```

## 导入、审核和发布

1. 在 Web 的“数据管理”中选择已有来源，或创建 `local_json`、`local_markdown`、`local_text`、`local_directory` 来源。
2. 输入 API/Worker 都能读取的本地路径，发起导入。API 只创建 `pending` 批次和 PostgreSQL `parse_import` 任务。
3. Worker 领取任务并更新为 `running`，创建不可变快照、标准化记录、校验结果和 Diff。
4. 在 Diff 页面检查新增、修改、未变化、冲突、未解析和删除候选；删除候选默认不删除线上数据。刷新页面后可从“已有导入批次”选择之前的批次继续处理。
5. 审核时填写审核说明，只勾选确实确认删除的 `deletionCandidates`；批次变为 `review_required`。
6. 对 AnimeGameData 等带字段级出处的采集批次，先执行 `pnpm data:backup`；系统会校验备份清单后才允许发布。发布后创建新的 Dataset Revision，事务完成后才切换当前指针；全文重建和 Embedding 任务异步执行。
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
