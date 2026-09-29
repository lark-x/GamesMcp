# 原神任务目录与对白解析：独立评审意见（响应 handoff 评审请求）

评审日期：2026-09-29
评审对象：分支 `codex/story-parser-topology-fix`（9d074a1）工作区实现 + 固定快照 AnimeGameData `26df1df` 审计数字
评审材料：`docs/genshin-quest-catalog-handoff-for-review.md`、`docs/genshin-phase2-release-checklist.md`、r14 两份逐任务审计、§7 所列实现文件
评审方式：只读代码取证（两个独立探查通道分别覆盖目录投影与对白管线），未执行任何数据库写入/迁移/发布；未改动原神源数据。

> 事实更正：handoff §5 末条"当前分支有未提交工作区改动；尚未提交/推送"已过时——工作区于 2026-09-29 以 `9d074a1` 提交并推送（提交信息明确标注原神部分为 WIP、未做数据操作）。审计 JSON 超过 GitHub 100MB 限制，`reports/genshin-quest-audit*.json` 已加入 `.gitignore`（被跟踪的基文件工作树 399MB 版本有意保持未提交）。

---

## 1. 结论摘要

**根因诊断基本找准，实现质量高于一般水准**：全链路坚持"精确证据制"（Talk id → initDialog → 资产对白图的 exact identity bridge、performCfg 精确正则、按 ID 的人工映射），审计状态机区分 5 类质量码且原因码可解释，共享正文三表模型（内容哈希 + revision binding + 双读）设计合理。方向不需要推翻。

**但发现 5 个实现级缺陷，其中 2 个直接与 handoff 自设约束冲突**，建议在下一轮候选生成前修复（均为小改动）：

| # | 缺陷 | 位置 | 后果 |
|---|------|------|------|
| D1 | **幽灵字段**：读取 `topology.childQuestIds`，该字段已从 `QuestTopology` 类型删除，恒为 `undefined` | `scripts/anime-game-data-quest-converter.ts:3021`（类型见 `packages/ingestion/src/anime-game-data/quest/types.ts:88-109`） | "从下游任务继承地区"的候选半边天然失效，是 475 条未归区中被掩盖的一部分可恢复量 |
| D2 | **违反自设约束的改写**：跨地区系列在"标题唯一或全 curated"时把**所有成员的 taskRegionId 改写**为最小 order 成员的地区 | converter:3824-3844 | 直接违反 handoff §2"任务自己的发生地区……不因目录归属而被改写"；跨地区系列（如巡官系列）成员的地区身份被抹掉 |
| D3 | **审计 gate 失效**：`duplicateQuestPlacements` 吃 task 级输入，看不到投影树内部跨容器重复 | 审计脚本:450-477 vs `public-story-audit.ts:31-34` | "公共目录重复放置=0"的门禁结论对该类风险实际不成立 |
| D4 | **classifier 判据缺口**：`cycle`、`graphHasNoRoot` 入参被传入但函数体从未使用 | `quest-classifier.ts:52-53,67,85` | 成环/无根对白图不计入 `graph_incomplete`，42 条的口径偏窄；环只留在 diagnostics |
| D5 | **不确定的兜底通道**：终排序 tie-break 用 `JSON.stringify` 的 localeCompare | `story-projection.ts:173-177` | 序列化顺序敏感，跨运行/跨语言可能产生不同的同级顺序 |

另有一个语义级风险：converter:1876-1890 会把"任意 2-20 个仅靠 `starts_after` 相连"的任务铸造成虚构"关联任务系列"（标题取章节名前缀）——这与 §2"没有可靠大型系列依据的真正独立任务，直接列在地区下，不为每个任务生成任务系列"存在张力，建议收紧为仅当组件内存在章节或系列锚点时才成立。

## 2. 逐项评审

**地区归属**：优先级链 chapter_city → reputation → talk_perform_cfg → curated_override → chapter_title(仅魔神) → inherited → unresolved，实现于 converter:2923-3058。总体可靠，但：cityId 映射仅 1-8 国（283-292），缺 nod-krai/snezhnaya（reputation iconName 同只 6 国，1071-1078）；`candidateRegionIds` 多于 1 个即整条作废（:390），无投票/版本仲裁；performCfg 最新实测 926 条（+reputation 220 + curated 180），证明该通道是主力，值得继续加宽而非重构。

**系列识别**：八级证据链（人工 override → 魔神收敛 → PERSONALLINE → chapter groupId → 源 series → aggregate → relation 连通分量 → fallback）证据优先级清晰，`requires` 边不参与系列判定（:1328-1333 注释明确）符合"前置条件不证明同系列"。风险点：同区同题不同 familyId 的正向合并（:3847-3856，测试显式断言）在两个不同系列恰好同名同区时会误并；`genshin:series:${seriesId ?? 本地化标题}`（:1854）使 zh/en 标题不同时双语分组不一致；chapter-group 优先于 series（:1834-1843），同系列跨两个 groupId 会拆散（森林书案例注释自认）。

**章节/任务排序**：章节顺序 chapterStoryOrder（第 N 幕 > 第 N 章，序章 50/间章 550/终章 9000）+ curated 覆盖合理；无显式顺序时派生 `(index+1)*100`（:3889-3968）可行。缺陷仅 D5 与"方向边不直接参与章节排序（只体现在拓扑入度）"。

**对白归属**：三层桥接（completeTalkIds → relation 边 → TalkExcel questId 精确匹配 + performCfg 正则禁裸数字前缀）是正确的证据制度；节点桥接两处（talk→initDialog→资产图；遗留 Talk→DialogExcel 的 `initDialog`/`${talkId}01` 约定）有明确 provenance 标记。质量状态机判定顺序（not_applicable → reference_missing → **ambiguous** → asset_missing → partial → text_missing → graph_incomplete → resolved）中 ambiguous 优先于 missing 是保守取向，正确。

**对白图完整性**：当前唯一判据是 dangling 边（见 D4）。另有两处解析器作用域问题：`getDlgRow`（converter:2579-2588）只在本 talkId scoped 行、全局 resolvedDialogById、DialogExcel 三处找，跨 talk 引用会悬空；`mergeDialogRows` 并集 nextDialogs（:2139-2150）可能把变体独有的 next 合入主行制造悬空。

**角色名称**：说话人解析面偏窄但制度正确（resolveDialogSpeakerName 六级：玩家角色 → 黑屏/占位 → talkRoleName hash → NPC 表 → 正文括号启发式 → intentionally_nameless → unresolved）。明确未利用的杠杆：`AvatarExcelConfigData` 已加载（:872）但本管线从未用于回退；npcDisplayName 无别名链；括号启发式只认全括号形式（:2073-2079）。

**正文质量门禁**：质量码 + 原因码 + Talk ID 的体系好；唯一实质问题是 D3（重复放置 gate 失效）与"内部 ID 泄露"检查范围（displayTitle 后缀 `（questId）` 是有意的消歧，需确认不算泄露口径）。

**性能/回填**：三表模型 contentHash 覆盖 segments/subquests/dialogueNodes(含 speaker/variants)/edges/mentions（不含标题与 revision，注释明确）；写侧只有新 hash 才写子行（`onConflictDoNothing returning` + newPacks，repository-revision-materialization.ts:546-629）；双读用 UNION + NOT EXISTS 互斥（read-models.ts:1104-1131、search-port.ts:382-426）；backfill 幂等键完整（content_hash 主键 + (revision_id, document_id) binding 主键 + checkpoint 游标 + verifyParity），默认 dry-run、显式 `--apply`、校验 revision/game/manifest。**设计达标，未发现正确性问题**；缺的只是真实 r13 上的 dry-run 计数（handoff 已自认）。

**页面/MCP 一致性**：目录投影为 Web 与 MCP 共用（story-projection 单一实现）；类型/关键词筛选对最终树生效；页面不再把子任务铺成阶段标签。未发现新的不一致点；真实环境的交叉验收仍待做（handoff 自认，合理）。

## 3. 更优的核心解析规则（在现有制度上修补，不推翻）

1. **地区候选仲裁取代一票作废**：`candidateRegionIds.length !== 1` 时，引入确定性仲裁——(a) 版本 token 越新优先（performCfg 的 V6.5 类前缀已解析即弃，:333-335，应保留为仲裁权重）；(b) 与任务章节数量/已知成员地区的一致性投票；(c) 仍冲突才 unresolved 并保留候选列表进 conflict 字段。预期把 608 条 performCfg 通道中的一部分多候选恢复为可靠归属。
2. **恢复地区继承链**：修 D1（`childQuestIds` 改用 relation edges 的 aggregate_of/starts_after 下游，或恢复该字段入 `QuestTopology` 类型），继承时带 `provenance="inherited_from_child"` 与一跳限制。
3. **地区身份与目录放置分离（修 D2）**：删除 3824-3844 的成员 regionId 改写；目录放置用 family 主地区的**引用**，任务详情保留各自 taskRegionId。
4. **系列合并证据升级**：同区同题 family 合并（:3847-3856）要求 familyId 或 curated 证据一致，仅 title 相同不再足以合并；`genshin:series:` 锚定到稳定 ID（seriesId/groupId），标题只作展示。
5. **relation 连通分量收紧**：虚构"关联任务系列"仅当组件内存在章节锚点或 override 锚点；纯 starts_after 链回落为独立任务挂地区。
6. **对白图判据补全（修 D4）**：`cycle>0` 或 rootless 组件计入 `graph_incomplete`（诊断已有，classifier 补两行判定）；`getDlgRow` 增加第 4 层"跨 talk 已解析资产"候选层，命中时标注 `cross_talk_reference` provenance 而非立即 dangling；`mergeDialogRows` 保留变体独有 next 于 variants 元数据而非并集进主行。
7. **说话人回退扩展**：npcDisplayName 无命中 → AvatarExcel 名称表回退 → 正文半括号形式 → 仍无则保留 unresolved。不动"未知不丢弃正文"原则。

## 4. 对 475 / 158 / 8 / 1 的处置方法

**475 未归区**——按可恢复性分批，全部走"一次审计 → 分类 → 修规则 → 一次候选"：
1. 修 D1 + 重跑审计：先量化幽灵字段影响了多少条（childQuestIds 相关继承全部缺失）。
2. performCfg 多候选仲裁（规则 1）：预计恢复一部分；每条带候选列表与仲裁依据。
3. reputation iconName 补 nod-krai/snezhnaya 映射（28 条 cityId 无映射的已知子集可顺带覆盖）。
4. 引入 TaskGuide/ScenePoint/quest sceneId 作**低置信候选层**（当前完全未读取，取证确认零命中），仅当与其他证据一致时采用，否则记 candidate 字段。
5. 剩余任务保留"其他地区"+原因码。**不设清零目标**：源无证据的保留是对的，按标题/关键词臆测违反约束。

**158 partial**——按原因码分治：
- 62 `dialogue_partial`：机械改进空间最大（遗留桥只有 `initDialog`/`${talkId}01` 两候选、歧义瀑布要求"恰好唯一"无邻接评分）。加跨-Talk 邻接重叠评分后重审计。
- 42 `graph_incomplete`：先按 D4 补判据重分类，再拆"dangling 目标存在于其他 talk 已解析资产"（解析器作用域，可修）与"id 在快照任何地方不存在"（真实缺失，保留）。
- 41 `text_missing`：TextMap 已合并 CHS/EN+Medium 且有 Proxy 回退（:885-894, :2842-2848）仍无命中 → **源真实缺失，保留标记**。
- 15 `talk_asset_ambiguous`：registry 已证同一 talkId 多内容签名共存且瀑布用尽精确证据 → **强行挑选会引入错误归属，保留 ambiguous**；唯一例外路径是未来发现新的区分性证据（如版本化路径字典）。

**8 speaker unresolved**：按 §3.7 扩回退后重跑；Avatar/别名仍无命中的保留（形态是 TALK_ROLE_NPC + 名字 hash 不在 TextMap，非空 speaker）。

**1 source missing（310 招募新伙伴）**： TalkExcel 31013-31019+41401 有 questId=310 叙事证据但快照无对应资产，NPC Group 仅为 availability 证据；r14 报告已明确不用 Wiki 补。**当前实现已把 310 特判为 control/not_applicable（converter:3278-3280 `isSpecialControl310`），这是有证据的人工策展决定，认可保留**；建议把该特判从硬编码迁入 curated 映射文件，与 212 组重复标题抽查共用同一版本化机制。

## 5. 具体建议的数据结构

现有 provenance/quality/confidence 体系已覆盖大半，建议增量补四点：

1. `regionEvidence` 增加 `candidates: [{regionId, source, weight, versionToken}]` 与 `arbitration: {rule, chosen, alternatives}` —— 把现在"多候选即弃"的信息留存为审计资产。
2. `storyFamily` 增加 `anchoredBy: "override"|"chapter"|"archon"|"personalline"|"series"|"aggregate"|"component"|null` 与 `titleKey`（稳定 ID）+ `displayTitle`（本地化标题）分离。
3. `dialogueDiagnostics` 的 cycle/rootless/disconnected 计数提升为 quality 判定输入（配合 D4），并加 `crossTalkReferences: [{fromTalkId, toTalkId, dialogId}]`。
4. 人工映射（`genshin-story-family-overrides.json` / 310 特判 / 章节顺序）统一 schema：`{targets by stable id, reason, evidenceUrl?, addedIn, reviewedBy}` —— handoff §2"带来源、理由和版本"的落地。

## 6. 测试与验收门槛

现有测试覆盖主路径正例较好，负向/边界缺口按价值排序补（取证列了 10 项，前 6 项为门禁级）：
1. performCfg 多候选 → unresolved + conflict 字段断言（当前零测试）。
2. **跨地区系列不改写成员 regionId**（D2 的回归锁）。
3. region 继承链正例 + 一跳限制 + provenance 标注。
4. `usableChapterGroups` 混合 cityId/style 拒绝分支负例。
5. **投影树内部跨容器重复 → 审计 gate 必须能报出**（D3：给 audit 喂投影后树而非 task 级行，或加树内去重计数断言）。
6. classifier：cycle / rootless / dangling 三者各自独立触发 `graph_incomplete`。
次级：同标题 family 跨地区分离、`appendUnique` 合并语义、`(order, questId)` 确定性 tie-break、displayTitle 后缀、`(index+1)*100` 派生排序。

发布前门禁（在 handoff §6 离线验证之上）：冻结快照全量审计数字逐项有解释（每条 partial/source-missing 带原因码与 Talk ID）→ 共享正文 backfill 真实 r13 dry-run 计数与对象复用率 → 候选 revision 的 duplicate-placement/region-rewrite/内部-ID 泄露三 gate 全零 → Web/API/MCP 对候选 revision 的只读交叉验收 → 才谈发布。

## 7. 低耗时执行顺序

```
1. 修 D1-D5（全部是小 diff：类型恢复/删改写块/audit 喂树/classifier 两行/排序键替换）
2. 补第 6 节前 6 项回归测试               ← 一次提交
3. 一次源审计（事件/单次等待，禁止逐任务导入与高频轮询；
   现有 checkpoint 机制已支持断点，审计脚本本身是单进程全量）
4. 汇总分类：475/158/8/1 按第 4 节分桶出清单
5. 集中修规则/映射（含 curated 文件统一 schema）
6. 一次候选转换 + 全量审计 + 三 gate + parity 校验
7. Web/API/MCP 只读交叉验收 → 人工抽样（森林书顺序、谐律咏叙诗、狮子奋迅、水仙十字）
8. 发布新 revision（旧 r13 保留可回滚）
```

## 8. 风险与回滚

- 本评审未执行任何 DB/发布操作；475/158/8/1 的处置全部在候选流水线内进行，现有 r13 与用户数据不动。
- D2 修复会改变部分任务的 regionId → 属数据正确性修复，需在审计报告 diff 中单独列出受影响任务清单（预计为跨地区系列成员，可枚举）。
- D4 补判据会使 42 条 graph_incomplete 口径变宽（部分 resolved 会改判 incomplete）→ 预期内的数字上升，不是质量回退，发布报告需说明。
- performCfg 仲裁改变部分归属 → 有 conflict 字段与候选列表可追溯，回滚即恢复"多候选作废"旧行为。
- 310 特判迁入 curated 文件 → 行为等价迁移，迁移前后审计数字应完全一致（以此作迁移正确性断言）。
- 工作区安全边界：审计 JSON 大文件已被 ignore 保护；分支 `codex/story-parser-topology-fix` 的未推历史已全部推送，无重置/清理动作。
