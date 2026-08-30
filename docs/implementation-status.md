# 实施状态与验收顺序

项目严格按用户提供的 Phase 0 至 Phase 8 顺序推进。每个阶段完成后运行：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

本地最小闭环：

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

导入 `data/fixtures/genshin.sample.json` 后，依次调用管理接口审核和发布；Worker 会处理异步解析、全文重建和 Embedding 任务，并把发布版本标记为可搜索。

## 当前实现状态

| 阶段    | 状态   | 已交付内容                                                                                                                       |
| ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | 已完成 | pnpm Monorepo、配置校验、PostgreSQL/pgvector Migration、API/Web/Worker、Docker Compose、CI、健康检查                             |
| Phase 1 | 已完成 | 游戏能力、来源快照、实体/别名、文档/片段/提及、关系、Claim/Evidence、Dataset Revision                                            |
| Phase 2 | 已完成 | JSON/Markdown/文本/目录导入、不可变快照、Worker 异步解析、标准化、校验、Diff、人工审核、原子发布、Tombstone 候选、回滚、Job 租约 |
| Phase 3 | 已完成 | 名称/别名/中文文本/trigram/可选 pgvector 实体与片段检索、混合结果、调试字段、109 条黄金查询和评测 CLI                            |
| Phase 4 | 已完成 | 响应式首页、搜索、实体、文档、来源过滤、问答和数据管理流程；Playwright 桌面/移动 smoke test                                      |
| Phase 5 | 已完成 | 证据上下文、无 LLM 证据摘要、OpenAI-compatible LLM、引用标记校验、证据不足拒答                                                   |
| Phase 6 | 已完成 | MCP stdio、7 个 Tool、4 个 Resource Template、参数/大小限制、客户端配置样例                                                      |
| Phase 7 | 已完成 | 错误脱敏、API 限流、Worker readiness、备份恢复与操作手册、Caddy/Cloudflare Access 部署文档、分 profile 检索基准脚本              |
| Phase 8 | 已完成 | 同名实体、独立 Revision、能力与检索跨游戏隔离的数据库集成测试；正式数据仍只注册《原神》                                          |

## AnimeGameData 首阶段状态

首阶段已完成程序化采集、转换、外置盘存储和导入准备：上游固定 Commit 为
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`，版本标签为 `CNRELWin7.0.0`，简体中文三类记录共
2412 条（书籍 288、角色故事 958、物品描述 1166）。Manifest 的三类 accounted coverage 均为
100%，未解释缺失为 0；最新三条数据库批次均为 `review_required`，每类各有 30 条固定种子样本。

当前唯一未自动完成的门禁是游戏事实一致性：必须由用户在同版本、简体中文客户端逐条处理抽样项，
每类取得至少 10 条 `game_client + exact_match`，异常项上传截图后，系统才允许发布。操作步骤见
[`anime-game-verification.md`](./anime-game-verification.md)。

转换、校验、导入、备份以及根目录 `pnpm dev` 都会在执行前检查外置 APFS 卷；路径覆盖不能把原始数据、规范化记录或备份写到系统盘。部分失败批次也会保留成功记录的 Source Observation，失败记录继续留在显式错误清单中。

导入脚本默认读取上游 checkout 当前 Commit 对应的规范化快照，并在导入前校验 Manifest 的 Commit、版本和语言；后续版本会写入新的 Commit 目录，不会静默复用 7.0.0 快照。按类别导入时，转换失败只会进入所属类别的批次错误和核验项。

发布门禁的集成测试还覆盖了异常项缺截图、旧快照开放冲突、Manifest 完整性和 Manifest 绑定备份：
`pnpm test:acquisition`、`pnpm test:backup-gate` 会验证冲突不会因换批次而被绕过，不完整的三类 records/Manifest 不能发布，且同一 upstream Commit 的旧 Manifest 不能冒充当前批次备份。真正的 `publishImport` 也会在发布边界重新执行这些检查。

历史观察也可以用 `pnpm data:reconcile:anime` 回填冲突索引；该命令会校正已有 provenance 中合法但过期的观察哈希，并把同版本同语言的重复观察分类为一致、格式差异或真实冲突。

冲突裁决会持久化 `selectedObservationId`；真实文本冲突必须选择采用的来源观察，且该观察的标题/正文必须与待发布批次一致，否则发布门禁拒绝。备份脚本会跟随当前 checkout Commit 选择 Manifest；无法唯一确定快照时直接停止。最新备份已在隔离数据库恢复演练中验证，恢复后观察数为 4824、冲突数为 2412，且 2412 个冲突均保留采用来源。

最新状态报告还会把每个 AnimeGameData 快照与 Manifest 的 canonical key 集合逐项对账，记录缺失/多出 key、版本和语言；当前书籍、角色故事、物品描述三个最新快照均为完整覆盖，观察层哈希与 lineage 审计通过，开放冲突为 0。报告保存在
`data/verification/reports/latest-anime-status.json`，可用 `pnpm data:status:anime:write` 重新生成。
报告同时输出 `blockingReasons`（并在 `releaseGate` 下重复提供），把尚未满足的门禁具体到批次、类别和数量，便于按清单逐项完成人工核验。
管理页面的数据管理区域现在会读取这份缓存报告，并显示 Manifest、渠道覆盖、观察层、冲突、备份和人工核验六项门禁；
刷新页面前先运行 `pnpm data:status:anime:write`，页面不会自行扫描上游目录。

核验台会在“尚未解锁”后按固定种子自动补抽替代记录；跨版本同 key 会保存为
`version_difference`，同版本真实冲突可在管理端展开查看各来源正文、哈希和出处后裁决。

计划中的 Recall、问答引用精度和性能数值属于真实资料集和目标机器相关指标。当前 Fixture 提供 109 条检索与 12 条问答评测入口；接入完整本地资料后，用 `pnpm eval:retrieval`、`pnpm eval:qa` 和 `pnpm benchmark:search` 作为发布门禁。完整语料指标不会被样本结果替代。

## 阶段门禁

- Phase 0：服务骨架、配置校验、Migration 和健康检查通过。
- Phase 1：Fixture 能写入完整实体、文档、关系、Claim 和 Evidence。
- Phase 2：导入、快照、Diff、审核、发布、回滚、异步 Worker 和任务租约通过。
- Phase 3：检索黄金集达到计划指标，中文和别名查询单独统计。
- Phase 4：Web 搜索、阅读、管理及移动端流程通过。
- Phase 5：引用完整性、拒答和冲突证据评测通过。
- Phase 6：MCP stdio、七个 Tool、四个 Resource Template 和契约测试通过。
- Phase 7：备份恢复、故障行为、Worker heartbeat、脱敏和分 profile 性能基准通过。
- Phase 8：多游戏隔离 Fixture 数据库测试通过，不导入第二款游戏正式数据。
