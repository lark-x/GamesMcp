# Game Intelligence Platform

独立部署的《原神》叙事知识平台，提供本地资料导入、审核发布、版本化检索、证据式问答、Web 阅读和 MCP stdio 接口。

## 开发启动

要求 Node.js 22+、pnpm 11+、Docker。

Windows 原生运行和数据迁移说明见 [`docs/windows.md`](docs/windows.md)。

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

API 默认监听 `http://127.0.0.1:4100`，Web 默认监听 `http://127.0.0.1:4173`。

## 阶段

实现顺序和验收门禁见 [`docs/implementation-status.md`](docs/implementation-status.md)。数据模型、导入格式、部署和备份说明位于 `docs/`。

AnimeGameData 首阶段的固定 Commit、确定性转换、出处核验和游戏内抽样步骤见
[`docs/anime-game-verification.md`](docs/anime-game-verification.md)。采集和转换不需要安装游戏；只有最终人工抽样需要客户端。

导入并发布 `data/fixtures/genshin.sample.json` 后，可以运行 `pnpm eval:retrieval` 检查 109 条黄金查询，运行 `pnpm eval:qa` 检查 12 条证据问答，运行 `GAME_ID=<uuid> pnpm benchmark:search` 检查实体/全文/混合检索延迟。完整部署、异步 Worker 导入、操作、备份和恢复见 [`docs/deployment.md`](docs/deployment.md)、[`docs/operations.md`](docs/operations.md) 和 [`docs/backup-and-recovery.md`](docs/backup-and-recovery.md)。

## 数据边界

完整原始资料只放在外置盘上的 `data/upstream/`、不可变快照目录或配置的本地目录，不提交 Git。首版只注册 `genshin-impact`，不依赖 SthStart、AkashaTerminal、Redis 或 MinIO。
