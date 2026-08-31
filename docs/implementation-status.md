# 当前实施状态

本文件只记录已经由代码、数据库或运行结果证明的状态，不把计划、接口占位或单项单元测试写成“全部完成”。

## 当前产品链路

正式采用以下版本模型：

`Source → Import → Candidate → immutable Build → Issue/Evidence → Patch → Build N+1 → Revision → current`

- Candidate 和 Build 是管理与预览状态，不会被 MCP 当作正式数据。
- Build、Manifest 和 Revision 都是不可变内容快照。
- 只有 `published + index ready + manifest present + isCurrent` 的 Revision 能成为 MCP 默认数据。
- 普通记录不要求逐条人工核对；只有系统检测或用户报告的问题进入审核队列。
- 问题处理必须附带游戏内截图、游戏版本、语言和说明。

## 改造计划完成度

| 阶段                  | 当前状态           | 可核对证据                                                                                                                                           |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. 唯一集成基线       | 进行中             | 集成分支保留主工作区改动；同来源重复导入产生的 1699 个虚假冲突已从真实 Candidate 清理                                                                |
| 1. MCP 版本边界       | 已实现，待全量复验 | MCP current 资源拒绝 preview/preparing/无 Manifest/索引未就绪 Revision；契约测试覆盖                                                                 |
| 2. 后端发布闭环       | 已实现，待全量复验 | Manifest、校验和、截图证据、Patch、Build N+1、门禁、异步激活、回滚已由隔离数据库流程覆盖                                                             |
| 3. 公开资料库         | 已实现，待视觉复验 | 同页版本选择、预发布分类/搜索/分页/详情/来源展示已实现                                                                                               |
| 4. 四个管理页面       | 已实现，待视觉复验 | 导入、预发布与发布、问题审核、正式版本历史；完整流程说明仅出现在发布和问题页面                                                                       |
| 5. 可靠来源导入       | 已完成预发布导入   | 固定 genshin-db Commit 的 1699 条记录、固定 AnimeGameData Commit 的 8208 条 quest 记录均已生成预发布 Build                                           |
| 6. 真实业务验收       | 部分完成           | 隔离数据库已通过 Candidate→Issue→Evidence→Patch→Build→Revision→rollback；quest preview API 已在真实 Build 上搜索/分页读取；真实 Amber 仍等待真实截图 |
| 7. 主工作区集成与终验 | 未完成             | 必须在全量测试、构建、桌面/移动视觉检查及安全合并后更新                                                                                              |

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
- 真实 dry-run：通过，blocking failures 为 0
- 显式排除：268 个上游 `MainQuest` 记录，原因是缺失或不属于首版任务类型
- 生成文档：8208 个，双语各 4104 个
- 子任务：33064 个
- 对话节点：53748 个
- 对话边：9552 条
- 完整度：`complete` 2930、`partial` 1560、`metadata_only` 3718
- 标题 fallback：1617 个文档使用另一语言标题 fallback；236 个标题仍是上游双语缺失，已在 metadata 中标记 `titleUnresolved`

已实现内容包括任务合约、数据库结构化表、MCP `search_quests/get_quest`、REST 正式任务接口、Web 正式 Revision 剧情阅读器、真实字段转换器、fixture、命令行 quest 导入、自动 Candidate/Build 生成、admin preview quest API、Web 预发布剧情视图和自动化测试。

真实 quest 数据库链路已完成实跑并发布为 Current Revision：

- ImportBatch：`212a83f9-be7f-4c14-b317-dfbf0a132b4c`
- SourceSnapshot：`6ba10e13-c046-40a4-8517-134b164f70d6`
- Candidate：`58c2b561-cf1c-4dcf-a57d-2d360dc16bd7`
- Build：`1dc59f50-bc13-47d4-a865-aca2ee034dc3`
- Revision：`e8f33f7d-e682-4bc6-883a-303baa86d9f4`，`r2`，`published`，`is_current=true`，`index_status=ready`
- 状态：`review_required` ImportBatch、`promoted` Candidate、`ready` Build、`ready` index
- Manifest record count：8208
- Source Observation：8208
- API 实跑：`/api/admin/previews/:buildId/quests` 搜索返回 3 条；`/api/admin/previews/:buildId/quests/:questId` 分页读取返回 2 个节点和 `preview:1` citation
- 正式 API 实跑：`/api/games/:gameId/quests?q=魔神&locale=zh-CN&limit=3` 返回 3 条；`/api/games/:gameId/quests/:questId?locale=zh-CN&limit=2` 返回 2 个节点、`r2` citation 和下一页游标
- MCP 实跑：内存 transport 调用真实 Repository，工具数 9，`search_quests/get_quest` 返回正式 `r2` quest citation
- 发布后结构化表：`quest_subquests=33064`、`quest_dialogue_nodes=53748`、`quest_dialogue_edges=9552`、`document_segments=58888`、重复 subquest/node/edge 均为 0
- 修复项：双语 quest 文档的结构化唯一约束改为 document-scoped；重复 dialogue edge 在 converter 和物化层确定性去重；同一 source 的多次 observation 刷新不再作为跨渠道冲突阻塞发布
- 当前备份：`backups/20260831T133516Z/gip.dump`，同时保存 quest source manifest，`datasetManifestRootHash=6f40de0871250973a426f8fc9659754f1a6030b9452f5b900f62bf76111467fe`，状态报告确认 `backupAvailable=true`、`matchesCurrentManifest=true`
- 状态报告：`openConflicts=0`、`observationIntegrity=true`、`sourceCoverageComplete=true`；quest source coverage 已按四类任务 observation 归并验证为 `8208/8208`
- 剧情节点核验清单：`data/verification/checklists/quest-node-verification-r2-zh-CN.md` 已生成，包含 12 个具体节点核验点，覆盖四类任务、玩家选项、长台词、动态变体以及 `partial` / `metadata_only` 风险项
- 剩余 `releaseGate.ready=false` 是因为历史书籍、角色故事、物品描述的人工核验仍未处理

尚未完成游戏内抽样核验和视觉回归截图；这些需要在 Windows 上使用 `7.0.0 + 简体中文` 客户端人工核对。

当前本机数据库状态：已支持通过 `STORAGE_RUNTIME_VOLUME_PATH=/Volumes/Lark` 把 10 GiB 运行余量门禁切到外置 APFS 卷。`pnpm predev`、`pnpm db:up`、`pnpm db:migrate`、`pnpm db:seed`、PostgreSQL bind mount 写入/重启/恢复查询、`pnpm test:candidate-flow:local` 已在本机通过；PostgreSQL bind mount 仍位于 `DATA_DIR/postgres`。如果 Docker/OrbStack 实际运行缓存没有迁移到外置盘，不应设置该变量。

## 验收命令

静态与自动化检查：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm data:validate:genshin-db
pnpm data:convert:anime-quests -- --upstream=data/upstream/AnimeGameData --commit=26df1dfbdf05a82bbb1d97506859f3e1c40718d8 --commit-date=2026-08-01T00:00:00.000Z --game-version=7.0.0 --version-label=CNRELWin7.0.0 --output=data/imports/normalized/anime-game-data/26df1dfbdf05a82bbb1d97506859f3e1c40718d8/quests
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
