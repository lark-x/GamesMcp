# 原神剧情目录与对白共享存储：阶段二验收清单

更新日期：2026-09-23
目标：修复原神任务目录归类、对白完整性和版本发布物化耗时，同时保持现有 r13 可读、可回滚。
本文件记录代码实现与验证状态；不代表候选版本已发布。

## 当前结论

- [x] 地区仍为目录第一层；大型任务系列只在一个主要地区出现，任务详情仍保留任务自身地区。
- [x] 章节关系使用精确的 `MainQuest.chapterId → Chapter.id` 连接；章节 `groupId` 不再受锚点任务列表限制。
- [x] 目录投影具备系列／子系列／章节、稳定顺序、任务和地区身份字段；支持无可靠系列依据时作为地区下独立任务。
- [x] 同名不同主任务 ID 保持独立；对重复任务标题提供 ID 消歧展示。
- [x] 页面及 MCP 使用同一目录投影；类型与关键词筛选工作于最终目录树；页面不再把子任务铺成“剧情对白 1…N”阶段标签。
- [x] 目录对白数量读取真实关系表／共享正文表，不再把元数据占位数组误认为正文。
- [x] 新增不可变、按内容哈希寻址的共享任务内容表；新版本为任务文档建立 revision binding，内容未变时不重复插入段落、子任务、对白节点和对白边。
- [x] 正文、分页、全文搜索、引用段落、角色文本绑定和 MCP 的旧／新读取路径已适配；不带新 binding 的历史数据继续从旧表读取。
- [x] 新增固定目标 r13 的分块、事务级、幂等 backfill 命令，并设计了数据库检查点和旧／新关系数量核对。
- [x] 候选物化测试覆盖共享内容写入、页面正文／引用读取及内容复用；连续热候选没有增加共享对象、段落、对白节点或对白边数量。
- [ ] **尚未对 r13 执行 backfill：当前工作区 `.env` 解析到 `127.0.0.1:5432/gip`，该库没有 `knowledge.games` 表，也不包含目标 revision。** 为避免对错误／空数据库做迁移或导入，生产迁移与 r13 写入未执行。
- [ ] **尚未构建或发布新候选。** 源审计仍有 158 个公开世界叙事任务为对白部分解析、8 个说话人名称未解析，以及 1 个有 Talk 引用但没有对白资源的任务；另有 475 个公开世界任务叙事缺少可验证地区，当前位于“其他地区”。这些结果均不得包装为完整解析或正确归类。
- [ ] Web 服务与 MCP 运行实例的构建版本、数据版本尚未对真实 r13／候选执行验收。

## 源快照审计

审计来自项目固定的 AnimeGameData 快照；Wiki 只用于核对目录关系和顺序，不用于补写正文。

| 项目                         |                                      审计结果 |
| ---------------------------- | --------------------------------------------: |
| AnimeGameData commit         |    `26df1dfbdf05a82bbb1d97506859f3e1c40718d8` |
| 上游标记                     | `CNRELWin7.0.0_R47482070_S47579390_D47579390` |
| 主任务 ID                    |                                         4,372 |
| 审计任务语言记录             |                                         8,744 |
| 转换解析异常                 |                                             0 |
| 解析到任务对白关系的任务     |                                         3,184 |
| 公开中英记录                 |                                         4,972 |
| 隐藏／测试／未发布等排除记录 |                                         3,772 |
| 投影大型系列数               |                                            77 |
| 回退系列数                   |                                             0 |
| 公共剧情目录重复放置         |                                             0 |
| 公共目录孤立 aggregate       |                                             0 |
| 公共系列跨地区冲突           |                                             0 |
| 所有标题重复组               |                                           212 |

### 地区证据审计（本轮新增）

全量审计增加了地区来源、原始字段、采用原因和冲突证据。公开世界任务叙事 1,334 条中，251 条采用 `Chapter.cityId`、608 条由唯一且可识别的 `TalkExcel.performCfg` 路径归区，475 条仍没有可验证的唯一地区证据。未归区原因分布为：无有效章节地区或可识别对白路径 446 条、章节 `cityId` 暂无映射且没有唯一 Talk 地区 28 条、Talk 路径地区互相歧义或不支持 1 条。475 条中 463 条没有可信大型系列可继承地区，其余也没有同系列已归区成员可作为唯一继承依据；因此本轮没有按标题或任务 ID 猜地区。

逐任务 ID、标题、系列、章节、原因、源路径证据和冲突见 [`reports/genshin-world-quest-region-audit-r14.md`](../reports/genshin-world-quest-region-audit-r14.md)。这是审计结果，不代表 475 条均已完成人工 Wiki 归区。可靠地区映射后续应按明确任务 ID 或已核验的精确对白路径版本化记录；对白文本仍只能来自固定 AnimeGameData 快照。

全量公开叙事（包括魔神、传说、世界、委托、活动和邀约等）：2,345 条简中任务记录，1,994 complete、339 partial dialogue、11 speaker unresolved、1 source missing，共 422,437 个对白节点。原因计数可以重叠：`dialogue_partial` 106、`dialogue_graph_incomplete` 108、`dialogue_dialogue_text_missing` 101、`dialogue_talk_asset_ambiguous` 28、`speaker_name_unresolved` 11，另有源缺失 1 条。

### 世界任务验收范围

按公开性与对白内容角色过滤后，公开的世界任务叙事共 **1,334** 条：

| 质量               |  数量 |
| ------------------ | ----: |
| complete           | 1,167 |
| partial dialogue   |   158 |
| speaker unresolved |     8 |
| source missing     |     1 |

不计入上述叙事数的任务记录仍会出现在元数据审计中，例如纯触发器、控制节点、隐藏／未发布任务、纯元数据任务；它们不能被误报成有对白但“解析失败”，也不能用伪正文补齐。158 条 partial dialogue 的原因码计数（同一任务可出现多个原因）为：`dialogue_partial` 62、`dialogue_graph_incomplete` 42、`dialogue_dialogue_text_missing` 41、`dialogue_talk_asset_ambiguous` 15。8 条 speaker unresolved 仍有正文，问题是名称映射；唯一 source missing 为任务 310。

逐任务的 ID、标题、质量、原因码和未解析 Talk ID 清单见 [`reports/genshin-world-quest-dialogue-audit-r14.md`](../reports/genshin-world-quest-dialogue-audit-r14.md)。

唯一公开世界任务叙事空正文例外：

- 主任务 ID：`310`，标题“招募新伙伴”。
- 明确引用 Talk ID：`31013`–`31019`、`41401`；8 项均未在当前固定源快照中解析到对白资源。
- `TalkExcelConfigData` 中存在相应配置行，但只指向 NPC Group／初始化 Dialog；NpcGroup 仅提供触发和可用性信息，并没有正文。精确 `Talk/Quest` 资源及对应正文节点缺失。
- 处理：保留 `source_missing` 和路径／ID 诊断；继续从同一源快照检查是否有可验证的精确桥接。不得从 Wiki 抄录对白；找不到上游正文时不得标记 complete。

## 目录分组、地区与排序

- [x] `chapterId` 只能精确连接章节 ID；`groupId` 是可靠章节集合证据，不能要求任务必须出现在 `beginQuestId` 锚点列表。
- [x] 原始系列、章节组、显式任务关系、起始任务和人工映射分开记录；`requires` 只表示前置，不单独用于系列归并。
- [x] 系列名称在系列级确定，不取遍历到的首条任务标题充当大系列名；差异较大的章节可作为子系列保留。
- [x] 使用章节编号和可靠方向边恢复顺序；任务 ID 及源顺序只作无强顺序证据时的稳定兜底。
- [x] 系列地区取明确的起始章节／任务地区；无起点且跨地区时不按任务数量投票。
- [x] 人工归类采用按 ID 的版本化映射；不使用模糊标题相似度合并。
- [ ] 发布前逐项确认重点映射：森林书章节同系列；“谐律上的咏叙诗”从序曲到终章顺序正确；“狮子奋迅”不同主任务 ID 保持独立；水仙十字关联任务归属有可靠源关系或人工证据。
- [ ] 对 212 组重名逐组抽查：标题相同不得合并；目录 displayTitle 仅在同一目录层级发生冲突时附带 ID。

## 解析器与正文质量门禁

- [x] 任务身份以 MainQuest 主任务 ID 为准；Talk 归属采用明确 questId／mainQuestId／子任务映射／精确路径和节点桥接，不通过数字相似度猜测。
- [x] 叙事 Talk、控制触发、聚合任务分开判定；不把 NpcGroup 触发文本误当公开对白。
- [x] 对话节点、节点边、选项、说话人、分支和语言状态进入内容哈希；正文缺失与角色缺失分开记录。
- [x] 审计输出区分 `complete`、`partial_dialogue`、`speaker_unresolved`、`metadata_only`、`source_missing`，保留原因码和精确 Talk ID。
- [ ] 对 158 条世界任务 partial dialogue 完成分原因清单：逐条看缺失 Talk、文本节点或图边是否能从同一快照内恢复；否则保留可解释 partial，不得用 Wiki 对白填补。
- [ ] 对 8 条 speaker unresolved 核对 NPC／角色表与别名回退；不得因说话人缺失而丢弃正文。
- [ ] `310 招募新伙伴` 确认上游无正文后作为明确例外记录；若源快照找到精确正文桥接，须有测试证明唯一归属。
- [ ] 候选发布前重新生成一次冻结源快照审计；有对白源的公开任务不能生成空正文；所有 source missing／partial 必须逐项有原因。

## 数据库共享内容、r13 兼容与性能

- [x] Migration `0008_shared_quest_content.sql` 新增内容对象、正文段、任务阶段、对白节点／边、实体提及、revision binding 和 backfill checkpoint。
- [x] 内容 hash 按 gameId 隔离，并包含实际 locale 及影响正文读取的段落、子任务、节点、边、实体提及；不含仅影响目录位置的地区／系列投影和 parser release 标记。
- [x] 内容表只追加；revision 文档保留自己的标题、地区、类型和版本元数据。新 binding 缺失时走旧表，支持新旧版本双读。
- [x] 单次候选流程测试验证首次物化；热候选断言共享对象与各内容子表行数不变，只新增 revision binding。
- [x] r13 backfill 工具固定目标 ID `3ac03918-78d9-4f9c-bf89-754fb5cdc337`，另检查版本 13、published/current、游戏 slug、manifest；默认 dry-run，只有 `--apply` 才分块写入。每批一个事务，写入完成位置和计数检查点，可续跑。
- [ ] 为避免跑错环境，只有确认数据库连接指向包含目标 r13 的正式数据时才运行迁移和 dry-run；本工作区目前连到空的本地 `gip`，所以没有执行任何实际数据库写操作。
- [ ] 正式 dry-run 应记录 r13 可回填任务数、排除的 claim-evidence 文件、当前已有 binding 和预计新增对象数；人工确认数字后再运行 `--apply`。
- [ ] Backfill 后确认 r13 的段落、子任务、对白节点、对白边数量与旧表逐文档一致；text binding 全部能映射，至少抽查完整正文、分页、搜索和引用；r13 仍为 `current/published`。
- [ ] 分别记录 r13 冷启动基线用时与热候选用时；验收标准是未变化内容没有重复插入。没有实测前不承诺分钟数或具体节省比例。

推荐执行顺序（不能将 dry-run 省略）：

```powershell
pnpm db:migrate
pnpm data:backfill:quest-content --revision=3ac03918-78d9-4f9c-bf89-754fb5cdc337
pnpm data:backfill:quest-content --revision=3ac03918-78d9-4f9c-bf89-754fb5cdc337 --apply
```

## 自动化与人工验证

- [x] `pnpm typecheck` 通过。
- [x] `pnpm lint` 通过。
- [x] 目录投影与 UI 文本测试通过。
- [x] 共享内容哈希、locale 隔离及段落／提及引用测试通过。
- [x] 数据库仓储测试通过。
- [x] disposable PostgreSQL 候选流程通过：内容物化、MCP／页面模型读取、共享内容复用和旧 revision 回滚路径。
- [x] 新增 checkpoint migration 后，disposable PostgreSQL 候选流程通过，确认迁移可从空库重建、首次物化／热版本共享内容复用、正文与引用读取、旧 revision 回退。
- [ ] 在含真实 r13 数据库执行 backfill 和新旧读取逐项验收。
- [x] 自动化跨游戏回归通过；星铁 provider/API/MCP 隔离测试和旧类型兼容测试通过。真实发布数据库上的跨游戏读验收仍未执行。
- [ ] 真实服务检查：Web API 代码版本、运行镜像版本、当前数据 revision 一致；世界任务筛选只含 world quest，目录与 MCP 归属一致。
- [ ] **尚不能冻结发布候选：** 475 个公开世界任务仍缺少可验证地区映射，158 个对白部分解析等问题也尚未逐项核验；完成规则和映射审查后再生成一次原神候选。星铁不重解析。

## 相关实现文件

- `scripts/anime-game-data-quest-converter.ts`：原神转换、来源证据和任务投影。
- `data/curated/genshin-story-family-overrides.json`：可审计、基于任务 ID 的人工归类。
- `packages/ingestion/src/anime-game-data/quest/story-projection.ts`：共享目录投影及排序。
- `packages/database/src/migrations/0008_shared_quest_content.sql`：共享正文迁移。
- `packages/database/src/quest-content-sharing.ts`：内容规范化和哈希寻址。
- `packages/database/src/repository-revision-materialization.ts`：候选版本内容复用物化。
- `packages/database/src/repository-read-models.ts`、`packages/database/src/search-port.ts`：新旧读取、目录和搜索。
- `scripts/backfill-quest-content.ts`：r13 只读预览／分块幂等回填。
- `scripts/audit-anime-game-data-quests.ts`：源数据诊断及审计输出。

## 既有 r12／r13 发布记录（历史基线，保留）

以下内容来自原验收记录，描述当时完成的发布与运行时回归；本轮新增的共享内容存储和源数据重新审计尚未部署到该真实服务，因此不能把历史 Web/API 结果当成本轮新版本的验收结果。

- r12（revision `0313d9a1-5584-4588-b13d-f6d492061395`）曾发布 4,972 条任务记录，全部使用 Story Projection schema v2。
- 完整目录候选 `000ecfc7-90a0-4175-b112-2662c3f65f90`，构建 `33f87e97-dd5a-4cda-9a63-251719298b86`，含 14,075 条可检索文档、26,054 条结构化资料、4,972 条任务记录。
- r13（revision `3ac03918-78d9-4f9c-bf89-754fb5cdc337`）曾发布并成为当时 current；旧 revision 保留为回滚点。
- 当时真实数据库/API 报告 10 个地区，中英各 2,347 个公开剧情条目；`world_quest` 筛选 1,334 条；水仙十字系列 12 个指定任务同系列；任务 74001 有 653 个对白节点，按每页 300 条读取三页后无重复。
- 当时的 API 回归包括跨游戏隔离、魔神任务地区映射、材料分类和材料搜索；候选发布前 `test-real-data-archive.ts`、三平台 CI、数据库、候选、页面及剧情门禁通过。
- 当时发布记录的旧审计给出简中完整 3,173、部分 425、仅元数据 330；Talk ID 预期 25,044、解析 24,620、未解析 424、歧义 43；关系图 cycle 从早期 682 降到 26。完整旧报告路径为 `reports/genshin-quest-audit-phase2-final.md`，报告 JSON 不纳入仓库。
- r12 全量物化约 2 小时 50 分钟，写入 854,308 个正文段落和 844,874 个对白节点；旧记录据此提出按内容哈希复用。本轮实现的共享内容层即为这一后续优化，需在原数据环境上实测确认。

历史审计与当前 r14 审计的可见叙事分类口径不同：当前审计将公开世界任务叙事 `310 招募新伙伴` 单独判为 `source_missing`。在固定快照复核该源缺口并通过新的候选门禁前，不沿用旧报告中“有明确对白源却为空正文为 0”的表述作为当前结论。
