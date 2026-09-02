# 当前实施状态

本文件只记录已经由代码、数据库或运行结果证明的状态，不把计划、接口占位或单项单元测试写成“全部完成”。

> **2026-09-02 更新：** Story / Text / Mechanism 里程碑（Sprint 0-30）已按
> docs/game-intelligence/story-scope.md 与 docs/game-intelligence/story-progress.md 执行并逐项记录证据。
> 本文件保留原重构阶段的登记口径；当前活跃状态以 story-progress.md 为准。

## 当前产品链路

正式采用以下版本模型：

`Source → Import → Candidate → immutable Build → Issue/Evidence → Patch → Build N+1 → Revision → current`

- Candidate 和 Build 是管理与预览状态，不会被 MCP 当作正式数据。
- Build、Manifest 和 Revision 都是不可变内容快照。
- 只有 `published + index ready + manifest present + isCurrent` 的 Revision 能成为 MCP 默认数据。
- 普通记录使用固定种子分层抽样（每类最多 30 条）；失败、冲突和版本异常全部额外进入审核队列，不占用抽样额度。
- 问题处理必须附带游戏内截图、游戏版本、语言和说明。

## 改造计划完成度

| 阶段                  | 当前状态                     | 可核对证据                                                                                                       |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0. 唯一集成基线       | 进行中                       | 当前工作区保留用户已有改动；尚未创建新的干净发布标签                                                             |
| 1. MCP 版本边界       | 已实现                       | MCP 只读取 published/current Revision；Candidate、Build、preparing 和未就绪 Revision 均被边界检查拒绝            |
| 2. 后端发布闭环       | 已实现                       | Manifest、校验和、截图证据、Patch、Build N+1、异步激活、回滚和旧 Revision 兼容均通过隔离数据库测试               |
| 3. 公开资料库         | 已实现                       | 首页聚合 API、游戏式分类、名称优先展示、公开任务过滤和首页轻量加载已实现；桌面/移动 E2E 通过                     |
| 4. 四个管理页面       | 已实现                       | 导入、预发布与发布、问题审核、正式版本历史流程及预发布剧情阅读已覆盖 E2E 测试                                    |
| 5. 可靠来源导入       | 转换完成，正式导入待执行     | 固定 AnimeGameData Commit 已生成新的双语、完整任务快照；正式库清理/导入因不可逆历史删除需要用户再次确认          |
| 6. 真实业务验收       | 自动化完成，客户端核验待完成 | 单元 90/90、Candidate、采集核验、备份门禁、数据库和 Playwright 18/18 均通过；尚未在 7.0.0 简中客户端完成截图抽样 |
| 7. 主工作区集成与终验 | 未完成                       | 需要确认历史清理、导入四类批次、生成/审核 Candidate、完成客户端抽样后再切换 Current                              |

## 当前真实数据状态

### genshin-db 预发布资料

- 固定上游 Commit：`8b15995fa220c88a4d0d7ffe1e21b041d0b32588`
- 来源等级：社区维护的 B 级来源，不是官方一手事实来源
- 代码许可：MIT；游戏内容权利仍归 HoYoverse/相关权利人
- 总数：1699 条
- 分类：角色 122、武器 249、圣遗物 63、材料 919、敌人 346
- 规范化失败和警告：0
- 当前 Candidate：`预发布 · genshin-db locked 2026-08-31 · 8b15995fa220`
- 当前 Build：Build 4，1699 条，已绑定 Manifest 和内容校验和
- 当前真实阻塞：1 条用户报告的 Amber 问题
- 正式 Revision：尚未发布；在没有真实客户端截图前不得绕过该问题

### AnimeGameData 历史资料

固定 Commit `26df1dfbdf05a82bbb1d97506859f3e1c40718d8`，版本标签 `CNRELWin7.0.0`，简体中文书籍、角色故事、物品描述共 2412 条。其旧核验工作流仍保留为历史数据与兼容测试，但新 Candidate 流程不再要求用户逐条审核全部记录。

### AnimeGameData 任务剧情 dry-run

- 固定上游 Commit：`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`
- 版本标签：`CNRELWin7.0.0`
- 语言：`zh-CN`、`en`
- 输出目录：`data/imports/normalized/anime-game-data/26df1dfbdf05a82bbb1d97506859f3e1c40718d8/quests/`
- 真实 dry-run：通过，blocking failures 为 0，`accountedCoverage=1`，`unexplainedMissing=0`
- 发现文档：8744 个（4372 个 MainQuest × 2 语言）
- 明确排除：6644 个（隐藏、未发布、测试/占位、元数据-only、不完整双语或不属于公开首版范围）
- 生成公开文档：2100 个，双语各 1050 个；每条记录均为 `visibility=public`、`completeness=complete` 且正文非空
- 子任务：24266 个；对话节点：42288 个；对话边：6492 条
- 类型分布：魔神 464、传说 380、世界 1062、活动 194（每种数量包含中英合计）
- 中英文任务集合完全一致：1050 个主任务，稳定键无重复
- Manifest schema：2；转换器版本：`anime-game-data-quests-v1`

已实现内容包括任务合约、数据库结构化表、MCP `search_quests/get_quest`、REST 正式任务接口、Web 正式 Revision 剧情阅读器、真实字段转换器、fixture、命令行 quest 导入、自动 Candidate/Build 生成、admin preview quest API、Web 预发布剧情视图和自动化测试。

新的 quest 快照已经生成，但尚未写入当前正式数据库：

- 输出目录：`data/imports/normalized/anime-game-data/26df1dfbdf05a82bbb1d97506859f3e1c40718d8/quests/`
- Manifest 与记录保留在外置数据盘，不提交 Git；正式导入前须再次核对 Manifest 哈希
- 现有数据库仍保留旧 Revision，未执行历史清理、旧数据删除或 Current 切换
- 已完成外置盘数据库备份：`data/backups/20260901T005322Z/gip.dump`
- dump SHA-256：`25b6bcf392f32c31081939baedff2db180781c4250ed6677dfa914350c1290f1`
- backup Manifest 根哈希：`6f40de0871250973a426f8fc9659754f1a6030b9452f5b900f62bf76111467fe`
- 历史清理命令已实现 dry-run 和双确认保护，但本次未执行，未删除任何数据

游戏内抽样核验仍需在 Windows 上使用 `7.0.0 + 简体中文` 客户端完成；客户端不可访问的条目应标记为不可解锁并保留截图证据。

当前本机数据库状态：已支持通过 `STORAGE_RUNTIME_VOLUME_PATH=/Volumes/Lark` 把运行余量门禁切到外置 APFS 卷。迁移、重启恢复和 Candidate 流程已验证；生产数据仍未清理或切换。

## 验收命令

静态与自动化检查：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:candidate-flow:local
pnpm exec tsx scripts/with-disposable-test-db.ts scripts/test-database.ts
pnpm exec tsx scripts/with-disposable-test-db.ts scripts/test-acquisition-review.ts
pnpm exec tsx scripts/with-disposable-test-db.ts scripts/test-backup-gate.ts
pnpm data:validate:genshin-db
pnpm data:convert:anime-quests -- --commit=26df1dfbdf05a82bbb1d97506859f3e1c40718d8 --game-version=7.0.0 --version-label=CNRELWin7.0.0
```

Candidate 全链路必须使用隔离数据库：

```powershell
pnpm test:candidate-flow
```

本机没有配置 `GIP_DB_TEST_URL` 时，可以从已配置的 `DATABASE_URL` 创建随机临时数据库运行，并在结束后删除：

```powershell
pnpm test:candidate-flow:local
```

更详细的数据验收边界见 [data-acceptance.md](./data-acceptance.md)。
