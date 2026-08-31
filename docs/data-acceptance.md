# 数据链路隔离验收

验收必须在隔离测试数据库中进行。不得向真实数据库写业务记录、发布真实 Candidate，亦不得用伪造截图替代客户端证据。

## 固定 genshin-db 快照

`data/imports/normalized/genshin-db/manifest.json` 锁定 commit
`8b15995fa220c88a4d0d7ffe1e21b041d0b32588`，来源级别为社区整理（B 级），代码许可为 MIT，游戏内容权利仍为 `HoYoverse/third-party`。快照应为 1699 条：`122/249/63/919/346`，且 `failures` 为零。

先运行：

```powershell
pnpm data:validate:genshin-db
```

该命令读取 `records.json`，经 `local_json` adapter 和领域校验链路 dry-run；它不会创建 API 批次或写数据库。

## 端到端验收顺序

在隔离数据库执行现有集成测试：

```powershell
pnpm test:database
pnpm test:acquisition
pnpm test:backup-gate
```

验收记录应逐项覆盖：导入 → Candidate/Build → 预览 → Issue → Evidence → Patch → Build N+1 → readiness → Revision → MCP → rollback。测试应证明失败门禁不会发布、回滚后 readiness 恢复，并保留审计历史。未有同版本客户端逐条核验及真实截图前，Amber 问题必须保持开放，不能写成“全部完成”。
