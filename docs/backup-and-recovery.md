# 备份与恢复

恢复点必须同时对应 PostgreSQL 数据库和不可变来源快照。建议在导入前或发布后记录时间、当前 Dataset Revision、源文件目录和 Embedding Space（模型、版本、维度）。API Key 等 Secret 不进入备份。

## 必须备份

- PostgreSQL 数据库：游戏、来源、快照元数据、暂存批次、Dataset Revision、审计日志和任务状态。
- `DATA_DIR/snapshots/`：每次导入生成的原始快照文件。
- `.env` 的非敏感配置模板，例如 `.env.example`；Secret 使用独立的本机 Secret 管理。
- 当前 Embedding 模型 ID、版本、维度和 `SEARCH_INDEX_VERSION`。

可重建的向量索引、构建缓存和已过期任务日志不必单独保存，但必须保留模型信息和重建步骤。

## 备份

发布前的标准入口是：

```bash
pnpm data:backup
```

脚本会先执行外置盘预检，然后在 `DATA_DIR/backups/<UTC 时间>/` 写入数据库 custom dump、当前 AnimeGameData `manifest.json` 副本和 `backup-manifest.json`。主机没有 `pg_dump` 时会自动使用健康的 PostgreSQL Compose 容器；数据库 URL 会在清单中脱敏，原始 Secret 不会写入文件。清单包含每个备份文件的大小和 SHA-256，发布前应确认命令成功并保留该目录。采集批次发布时，系统还会把备份中的 Manifest SHA-256 与该批次来源快照记录的当前 Manifest 做比对；同一个 upstream Commit 的旧 Manifest 不能替代当前批次备份。

在数据库所在主机执行：

```bash
mkdir -p backups/2026-08-29
pg_dump --format=custom --file=backups/2026-08-29/gip.dump "$DATABASE_URL"
tar --create --file=backups/2026-08-29/gip-snapshots.tar -C "$DATA_DIR" snapshots
cp .env.example backups/2026-08-29/env.example
```

如果 PostgreSQL 在 Compose 中运行，可以使用：

```bash
docker exec gamesmcp-postgres-1 pg_dump -U gip --format=custom -d gip > backups/2026-08-29/gip.dump
tar --create --file=backups/2026-08-29/gip-snapshots.tar -C data snapshots
```

备份文件和数据库应使用同一时间点；先校验压缩包可读，再复制到离线或受保护的位置。

## 恢复

恢复到已停止应用的空数据库或隔离数据库：

```bash
docker compose stop api worker web
pnpm db:migrate
pg_restore --exit-on-error --clean --if-exists --dbname="$DATABASE_URL" backups/2026-08-29/gip.dump
tar --extract --file=backups/2026-08-29/gip-snapshots.tar --directory="$DATA_DIR"
docker compose start api worker web
```

然后检查：

```bash
curl --fail http://127.0.0.1:4100/api/health
curl --fail http://127.0.0.1:4100/api/ready
curl --fail http://127.0.0.1:4100/api/ready/search
curl --fail http://127.0.0.1:4100/api/ready/worker
```

若 Embedding 模型或维度改变，不在同一向量空间中混用旧向量。设置新的模型版本后重新发布/重建 Embedding；在模型不可用期间，词法检索仍应可用。

## 回滚与灾备验证

Dataset Revision 回滚只切换当前版本指针，不删除后续版本，并写入审计日志；回滚后等待 Worker 完成索引任务，再验证 `/api/ready/search` 和历史版本检索。

数据库集成测试必须使用明确命名的临时库，防止误清理真实库：

```bash
GIP_DB_TEST_URL=postgres://gip:gip@127.0.0.1:5432/gip_disposable_test pnpm test:db
```

不要把生产库或默认 `gip` 库传给 `GIP_DB_TEST_URL`。恢复演练应验证：导入快照可读取、当前版本可查询、引用片段可解析、Worker 可领取任务、回滚原因出现在审计日志中。
