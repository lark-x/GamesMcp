# GamesMcp 星穹铁道数据解析完整整改计划

> 项目：`lark-x/GamesMcp`  
> 数据源：TurnBasedGameData  
> 优先级：P0  
> 目标：彻底解决星铁“只解析了一小部分数据”、Archive 数据严重不完整、剧情正文碎片化、材料/角色/光锥/遗器等结构化数据缺失的问题。  
> 核心方向：**数据源强校验 + Narrative/Structured 双流水线 + Archive Read Model + 真实数据质量 Gate。**

---

# 0. 给执行 Agent 的强制提醒

本次不要把任务理解成“补几个解析器”或“修前端数据显示”。

当前最容易误判的地方是：

```text
Corpus 有 1.5 万条
CI Green
MCP/Search 能用
```

这些都不能证明：

```text
Archive 已完整解析星铁数据
```

必须牢记：

1. `Corpus 完成 ≠ Archive 完成`。
2. `15,907 documents ≠ 15,907 条完整百科数据`。
3. `sr_item_lore ≠ Material 数据库`。
4. `sr_story ≠ 已正确挂到 Mission 的完整剧情正文`。
5. `Mission 文档存在 ≠ Mission 剧情完整`。
6. `Fixture 能跑通 ≠ Full Source 正常`。
7. 不允许通过 Mission ID 范围猜地区、章节。
8. 不允许所有 Quest 一律写成 `complete/public`。
9. 不允许把结构化 Story JSON 压成纯文本后，再从文本反猜 Dialogue。
10. 不允许以 `CI Green / Mock E2E Green / API 200` 宣布完成。
11. 本轮暂停非必要 UI 美化，重点只放在真实数据正确性和覆盖率。
12. 每阶段都必须输出真实数据数量、覆盖率、异常清单和 PASS/FAIL Gate。

---

# 1. 当前问题结论

星铁当前“只解析了一小部分”主要由以下问题叠加造成。

## P0-01：完整数据源缺失时静默 fallback 到 Fixture

当前 Ingest 会在真实 `sourceDir` 不存在时自动使用：

```text
data/fixtures/starrail
```

结果可能是：

```text
真实数据目录配置错误
↓
流程没有失败
↓
只解析 Fixture
↓
仍然显示执行成功
↓
数据库只有很少数据
```

### 要求

正式/生产 Ingest：

```text
sourceDir 不存在
→ 直接 FAIL
```

Fixture 只能通过显式：

```text
--fixture
```

或测试环境启用。

---

## P0-02：`--limit` 可以直接截断数据库

当前支持：

```text
--limit
```

并对 `allDocuments.slice(0, limit)` 写库。

### 要求

正式发布模式禁止 `--limit`。

检测到：

```text
production + --limit
```

直接失败。

---

## P0-03：当前只有 8 类 Narrative Extractor

当前主要解析：

```text
Mission
Story
Message
Train Visitor
Book
Character Story
Voice Line
Item Lore
```

这些主要服务：

```text
Search
MCP
QA
Text Browser
```

但 Archive 还需要正式结构化数据：

```text
Character
LightCone
Relic
Material
Enemy
Achievement
World
Chapter
Mission Graph
Dialogue
```

当前这些并没有完整实现。

---

## P0-04：Corpus 与 Archive Read Model 没有完整投影

当前主要数据模型是：

```text
GameKnowledgeDocument
```

适合：

```text
全文搜索
语义搜索
MCP
```

Archive 需要的是：

```text
StoryCatalogEntry
Quest
DialogueNode
World
Chapter
Character
LightCone
Relic
Material
Enemy
Achievement
```

这两层目前没有完整连接。

---

## P0-05：Inventory 没有完整审计上游

当前重点扫描：

```text
Config
ExcelOutput
Story
TextMap
```

而 `Stages` 没有进入完整 Audit。

### 要求

至少让：

```text
Stages
```

进入 Inventory/Audit。

不代表所有内容都要进入 Archive，而是必须知道：

```text
有哪些
哪些使用
哪些忽略
为什么忽略
```

---

## P0-06：Item Lore 被误当成材料

当前 `extractItemLoreDocuments()` 主要读取：

```text
ItemName
ItemBGDesc
ItemDesc
Lore
```

这是：

```text
物品文案 / Lore Corpus
```

并不等于：

```text
材料分类
获取来源
使用角色
行迹用途
光锥晋阶用途
掉落来源
合成关系
```

### 要求

新增正式：

```text
StarRailMaterialExtractor
```

`sr_item_lore` 只能作为描述/背景故事来源之一。

---

## P0-07：Story/Discussion 没有完整挂回 Mission

当前大致是：

```text
Story/Mission/*
→ 部分 Mission 对白

Story/Discussion/*
→ 独立 sr_story 剧情片段
```

Archive 需要：

```text
MainMission
├─ SubMission
├─ Story/Mission
├─ Story/Discussion
├─ TalkSentence
├─ Player Options
└─ 正确顺序
```

大量 `sr_story` 目前只是孤立碎片。

---

## P0-08：地区/章节通过 Mission ID 范围猜测

禁止类似：

```text
101xxxx → 雅利洛-VI
102xxxx → 仙舟
103xxxx → 匹诺康尼
```

正确做法必须读取：

```text
WorldID
ChapterID
World Config
Chapter Config
TextMap
```

---

## P0-09：结构化 JSON → 文本 → 再猜 Dialogue

当前部分链路相当于：

```text
Story JSON
↓
Markdown / 文本 Corpus
↓
按行拆分
↓
看到“角色：文本”
↓
再生成 dialogue node
```

### 要求

改为：

```text
Raw Story JSON
├─→ Structured Dialogue Model
└─→ Narrative Corpus Text
```

两条输出并行生成。

---

## P0-10：Quest 被强制标为 complete/public

禁止：

```text
completeness = complete
visibility = public
```

无条件写死。

必须根据真实情况计算。

---

# 2. 当前参考基线

已有完整 Corpus 构建记录大致为：

```text
Tracked Source Files ≈ 134,375

Config       ≈ 126,586
ExcelOutput  ≈   2,185
Story        ≈   5,575
TextMap      ≈      29
```

8 类 Narrative Corpus 参考：

```text
sr_book             ≈ 1,103
sr_character_story  ≈   456
sr_item_lore        ≈ 3,232
sr_message          ≈   779
sr_mission          ≈ 2,166
sr_story            ≈ 2,779
sr_train_visitor    ≈    38
sr_voiceline        ≈ 5,354

Total               ≈ 15,907
```

这些数字只能说明 Narrative Corpus 规模，不代表 Archive 完成。

---

# 3. 最终目标架构

必须拆成两条正式流水线：

```text
                    TurnBasedGameData
                           │
              ┌────────────┴────────────┐
              │                         │
      Narrative Pipeline        Structured Pipeline
              │                         │
      Narrative Corpus          Archive Domain Model
              │                         │
      Search / MCP / QA         Story / Material / Data
              │                         │
              └────────────┬────────────┘
                           │
                     Generic API
                           │
                      Archive UI
```

---

# 4. Narrative Pipeline

保留现有：

```text
Mission
Story
Message
Book
Character Story
Voice
Visitor
Item Lore
```

继续服务：

```text
MCP
Search
QA
Text Browser
```

但要补：

```text
Source 强校验
Story 归属
Structured Dialogue 双输出
真实 completeness
```

---

# 5. Structured Pipeline

新增：

```text
StarRailWorldExtractor
StarRailChapterExtractor
StarRailMissionGraphExtractor
StarRailDialogueExtractor

StarRailCharacterExtractor
StarRailLightConeExtractor
StarRailRelicExtractor
StarRailMaterialExtractor
StarRailEnemyExtractor
StarRailAchievementExtractor
```

P1 后续可继续：

```text
StarRailShopExtractor
StarRailRecipeExtractor
StarRailStageExtractor
StarRailActivityExtractor
StarRailRewardExtractor
```

---

# 6. Phase 0：数据源强校验

## 任务 0.1 禁止自动 Fixture fallback

正式 Ingest：

```text
sourceDir 不存在
→ FAIL
```

Fixture 只允许：

```text
--fixture
```

或 test 环境。

---

## 任务 0.2 Full Source Manifest

启动解析前检查至少：

```text
ExcelOutput/MainMission.json
ExcelOutput/SubMission.json
ExcelOutput/TalkSentenceConfig.json
TextMap/*
Story/Mission/
Story/Discussion/
```

以及后续 Structured Extractor 的必需表。

缺关键文件：

```text
BLOCK
```

---

## 任务 0.3 记录 Source 元数据

至少：

```text
sourcePath
sourceCommit
sourceVersion
fileCount
totalBytes
familyCounts
generatedAt
```

---

## 任务 0.4 限制 `--limit`

正式发布：

```text
limitApplied = false
```

生产模式带 `--limit`：

```text
FAIL
```

---

## Phase 0 Gate

必须输出：

```text
STAR_RAIL_SOURCE_MODE = full
fixtureFallback = false
limitApplied = false
sourceCommit != unknown
MainMission exists
SubMission exists
TalkSentenceConfig exists
Story/Mission count > 0
Story/Discussion count > 0
TextMap readable
```

---

# 7. Phase 1：Source Coverage Audit

新增：

```text
scripts/audit-starrail-source-coverage.ts
```

输出：

```text
artifacts/starrail-source-coverage.json
artifacts/starrail-source-coverage.md
```

每个重要数据集记录：

```text
path
rowCount
candidateDomain
extractor
status
reason
```

状态：

```text
USED
PLANNED
IGNORED_INTENTIONALLY
UNKNOWN
```

要求：

```text
UNKNOWN
```

不能大量存在。

---

# 8. Phase 2：Inventory 完整化

将：

```text
Stages
```

纳入 Inventory/Audit。

注意：

```text
纳入 Inventory
≠
全部导入 Archive
```

目的只是确保上游数据不再被“看不见”。

---

# 9. Phase 3：StarRailStoryResolver

新增正式：

```text
StarRailStoryResolver
```

它不是 Corpus Extractor，而是 Archive 剧情解析器。

---

# 10. StoryResolver 输入

至少：

```text
MainMission.json
SubMission.json
TalkSentenceConfig.json

Story/Mission/**
Story/Discussion/**

World Config
Chapter Config

NextTrackMainMission
DisplayPriority
TakeParam
MultiSequence
MissionPack
前置关系
```

Agent 必须先确认真实上游文件和字段，不允许凭印象硬编码。

---

# 11. StoryResolver 输出

建议：

```ts
type StarRailStoryQuest = {
  mainMissionId: number;
  title: string;

  type: string;

  worldId?: number;
  worldTitle?: string;

  chapterId?: number;
  chapterTitle?: string;

  previousMissionIds: number[];
  nextMissionIds: number[];

  sequence?: number;

  subMissions: StarRailSubMission[];
  dialogueNodes: StarRailDialogueNode[];

  completeness:
    | "complete"
    | "partial"
    | "metadata_only"
    | "unresolved";

  visibility:
    | "public"
    | "hidden"
    | "test"
    | "internal"
    | "unreleased"
    | "unknown";

  provenance: Record<string, unknown>;
};
```

---

# 12. World / Chapter 正式解析

删除所有 Mission ID 范围映射。

必须通过：

```text
WorldID
ChapterID
Config
TextMap
```

得到：

```text
worldTitle
chapterTitle
worldOrder
chapterOrder
```

---

# 13. 主线 canonical order

优先：

```text
NextTrackMainMission
TakeParam / prerequisite
MultiSequence
DisplayPriority
MissionPack
```

建立 Mission Graph。

执行：

```text
topological sort
```

出现：

```text
cycle
```

→ BLOCK。

出现冲突：

```text
ordering_conflict
```

→ 输出异常清单，不允许直接用 ID 覆盖。

---

# 14. 合并 Story/Mission 与 Story/Discussion

必须从：

```text
MainMission
```

向下建立：

```text
MainMission
├─ SubMission
├─ Story/Mission
├─ Story/Discussion
├─ TalkSentence
└─ Player Option
```

---

# 15. Discussion 归属策略

优先：

```text
1. Story JSON 显式 Mission/SubMission Reference
2. Group / Sequence Reference
3. Trigger Relation
4. Source Path Relation
5. Config Cross-reference
6. 无法确认 → orphan discussion
```

禁止：

```text
无法确认
→ 随机挂到某个 Mission
```

---

# 16. Structured Dialogue 直接解析

新增：

```text
StarRailDialogueExtractor
```

直接输出：

```ts
{
  nodeId
  nodeType
  speakerId
  speakerName
  body
  order
  options
  sourceFile
  sourcePath
}
```

禁止以纯文本行作为正式来源。

---

# 17. Narrative / Structured 双输出

正确流程：

```text
Story JSON
        │
        ├─→ Structured Dialogue
        │
        └─→ Search Corpus Text
```

Archive 使用 Structured Dialogue。

Search/MCP 继续使用 Corpus。

---

# 18. completeness 重新计算

定义：

```text
complete
= 标题 + World/Chapter + Mission Graph + 可用真实 Dialogue

partial
= 有真实内容，但 hierarchy/dialogue 不完整

metadata_only
= 只有 Mission metadata / objective

unresolved
= 无法可靠归档
```

---

# 19. visibility 重新计算

至少：

```text
public
hidden
test
internal
unreleased
unknown
```

`unknown` 默认不进入 Public Archive。

---

# 20. Phase 4：Character Extractor

新增：

```text
StarRailCharacterExtractor
```

至少解析：

```text
角色 ID
名称
稀有度
命途
属性
基础属性
技能
天赋
终结技
秘技
行迹
星魂
晋阶
```

同时关联：

```text
Character Story
Voice Line
Material Usage
```

---

# 21. Phase 5：LightCone Extractor

新增：

```text
StarRailLightConeExtractor
```

至少：

```text
光锥 ID
名称
命途
稀有度
基础属性
技能
叠影效果
晋阶
描述
背景故事
材料需求
```

---

# 22. Phase 6：Relic Extractor

新增：

```text
StarRailRelicExtractor
```

至少：

```text
遗器 ID
名称
套装
部位
套装效果
稀有度
描述
```

P1 后续：

```text
主词条
副词条
掉落来源
```

---

# 23. Phase 7：Material Extractor

新增：

```text
StarRailMaterialExtractor
```

不能用：

```text
sr_item_lore
```

代替。

---

# 24. Material Contract

建议：

```ts
type ArchiveMaterial = {
  id: string;
  name: string;
  category: string;
  rarity?: number;
  description?: string;

  sources: MaterialSource[];
  usages: MaterialUsage[];

  visibility: "public" | "hidden";
  provenance: Record<string, unknown>;
};
```

---

# 25. Material 分类

至少：

```text
character_ascension
trace
lightcone_ascension
enemy_drop
weekly_boss
currency
synthesis
consumable
mission
event
other
```

必须基于：

```text
Item Type
Promotion relation
Trace relation
Drop relation
Synthesis relation
```

禁止字符串模糊猜分类。

---

# 26. Material Usage

至少建立：

```text
Character Promotion → Material
Trace → Material
LightCone Promotion → Material
Craft/Synthesis → Material
```

---

# 27. Material Sources

优先解析：

```text
Enemy Drop
Stage / Calyx / Cavern
Weekly Boss
Shop
Synthesis
Reward
Mission
Event
```

不能可靠确认的来源：

```text
unresolved
```

不允许编造。

---

# 28. Phase 8：Enemy Extractor

新增：

```text
StarRailEnemyExtractor
```

至少：

```text
名称
类型
弱点
抗性
基础属性
掉落
```

Archive 当前不需要的超细字段可放 P1。

---

# 29. Phase 9：Achievement Extractor

新增：

```text
StarRailAchievementExtractor
```

至少：

```text
成就 ID
名称
分类
描述
奖励
隐藏状态
```

---

# 30. Phase 10：Archive Read Model

不要继续把所有结构塞进：

```text
documents.metadata
```

建议建立通用 Read Model：

```text
story_catalog_entries
story_dialogue_nodes

archive_characters
archive_weapons
archive_artifacts
archive_materials
archive_enemies
archive_achievements
```

用：

```text
game_id
```

区分 Genshin / StarRail。

---

# 31. Phase 11：Corpus → Archive Projection

明确映射：

```text
sr_book
→ Text Browser / Books

sr_character_story
→ Character Story

sr_voiceline
→ Character Voice

sr_message
→ Text Browser / Messages

sr_train_visitor
→ Text Browser

sr_item_lore
→ Item Lore / Material Description supplement

sr_mission
→ Search Corpus

sr_story
→ Search Corpus
```

原则：

```text
Corpus Category
≠
Archive Entity
```

---

# 32. Phase 12：Generic Archive Adapter

建立：

```ts
interface GameArchiveAdapter {
  getStoryCatalog(...)
  getStoryQuest(...)

  listCharacters(...)
  listMaterials(...)
  listWeapons(...)
  listArtifacts(...)
  listEnemies(...)
  listAchievements(...)

  getTerminology(...)
}
```

实现：

```text
GenshinArchiveAdapter
StarRailArchiveAdapter
```

StarRail 不得再进入：

```text
repository.genshin
```

---

# 33. Phase 13：逐层计数审计

新增：

```text
scripts/audit-starrail-pipeline.ts
```

每次发布输出：

```text
SOURCE
────────────────────────
Total Files
Config
ExcelOutput
Story
TextMap
Stages

NARRATIVE
────────────────────────
Mission
Story
Book
Character Story
Voice
Message
Item Lore
Visitor

STRUCTURED
────────────────────────
World
Chapter
Mission Graph
Dialogue
Character
LightCone
Relic
Material
Enemy
Achievement

DATABASE
────────────────────────
Documents
Segments
Story Entries
Dialogue Nodes
Characters
LightCones
Relics
Materials
Enemies
Achievements

ARCHIVE API
────────────────────────
Story Catalog
Readable Main Missions
Characters
Materials
LightCones
Relics
Enemies
Achievements
```

禁止只输出：

```text
Successfully ingested 15907
```

---

# 34. Phase 14：真实数据质量 Gate

## Source Gate

```text
fixtureFallback = 0
limitApplied = 0
sourceCommit known
required files present
```

---

## Story Gate

```text
MainMission title resolve >= 99%
World resolve >= 99%
Chapter resolve >= 99%

Mission graph cycle = 0
critical ordering conflict = 0

orphan Discussion
→ 必须给出真实数量和 allowlist

Structured Dialogue availability
→ 必须给出真实覆盖率

Objective-only Mission
→ 单独统计

Internal ID visible = 0
```

---

## Character Gate

```text
Character name resolve >= 99%
Path resolve >= 99%
Element resolve >= 99%
Rarity resolve >= 99%
```

---

## Material Gate

```text
Internal/Test item exposed = 0
obvious wrong category = 0

description coverage
source coverage
usage coverage
other category ratio
→ 必须有真实统计
```

---

## Cross-game Gate

StarRail Archive 禁止依赖：

```text
Genshin Repository
Genshin Schema
AnimeGameData provenance fallback
```

---

# 35. Phase 15：真实 E2E

保留 Mock E2E，但新增：

```text
Real StarRail Archive E2E
```

使用：

```text
PostgreSQL
完整 TurnBasedGameData
真实 Dataset Revision
API
Web
```

---

# 36. Story E2E

至少覆盖：

```text
空间站
雅利洛-VI
仙舟
匹诺康尼
翁法罗斯
当前世界
```

每个至少抽 5 个 MainMission。

检查：

```text
标题
World
Chapter
正文
顺序
Previous / Next
角色名
玩家选项
无内部 ID
```

---

# 37. Material E2E

至少：

```text
角色晋阶材料
行迹材料
光锥晋阶材料
怪物掉落
周本素材
货币
```

检查：

```text
名称
分类
描述
来源
用途
Provenance
搜索
分页
分类统计
```

---

# 38. Data Browser E2E

真实测试：

```text
Character
LightCone
Relic
Enemy
Achievement
```

不能只测 Mock。

---

# 39. Phase 16：重新生成 Dataset Revision

完成修复后不要覆盖旧 Revision。

流程：

```text
Full Source
↓
Narrative Build
↓
Structured Build
↓
Candidate
↓
Pipeline Audit
↓
Quality Gate
↓
Real E2E
↓
Manual Sample
↓
Publish New Revision
```

---

# 40. Revision 必须记录

```text
sourceCommit
sourceVersion
sourceHash

narrativeParserVersion
structuredParserVersion
storyResolverVersion

recordCounts
qualityReport
generatedAt
```

---

# 41. Agent 禁止事项

禁止：

```text
❌ sourceDir 不存在 → 自动 Fixture
❌ 正式发布使用 --limit
❌ 把 15,907 Corpus 当 Archive 完成
❌ 把 sr_item_lore 当完整 Material
❌ 按 Mission ID 范围猜 World / Chapter
❌ 所有 Quest 强制 complete/public
❌ JSON → 文本 → 再猜 Dialogue
❌ Discussion 无法归属时随便挂 Mission
❌ 为了页面有内容硬编码地区/章节/材料来源
❌ 只凭 CI Green / Mock E2E Green 宣布完成
```

---

# 42. 推荐执行顺序

严格建议：

```text
Phase 0  Source 强校验
↓
Phase 1  Source Coverage Audit
↓
Phase 2  Inventory 完整化
↓
Phase 3  StoryResolver + Structured Dialogue
↓
Phase 4  Character
↓
Phase 5  LightCone
↓
Phase 6  Relic
↓
Phase 7  Material
↓
Phase 8  Enemy
↓
Phase 9  Achievement
↓
Phase 10 Database Read Model
↓
Phase 11 Corpus → Archive Projection
↓
Phase 12 Generic Adapter
↓
Phase 13 Pipeline Audit
↓
Phase 14 Quality Gate
↓
Phase 15 Real E2E
↓
Phase 16 发布新 Revision
```

---

# 43. 推荐 Commit 切分

```text
fix(starrail): fail fast when full source is unavailable

feat(starrail): add full source coverage audit and stages inventory

refactor(starrail): split narrative corpus from structured archive pipeline

feat(starrail): add world chapter and mission graph resolvers

feat(starrail): extract structured dialogue directly from story json

feat(starrail): connect discussions back to missions

feat(starrail): add structured character extractor

feat(starrail): add structured light cone extractor

feat(starrail): add structured relic extractor

feat(starrail): add structured material extractor and relations

feat(starrail): add enemy and achievement extractors

refactor(archive): add starrail archive read models and adapter

test(starrail): add full pipeline coverage and data quality gates

test(archive): add real starrail archive e2e

data(starrail): publish rebuilt verified starrail revision
```

---

# 44. 每阶段结果模板

Agent 每完成一个 Phase 必须提交：

```md
## Phase X Result

### Commit
<sha>

### Source Used
path:
commit:
version:
fileCount:

### Before
...

### After
...

### Parsed Counts
...

### Unresolved
...

### Skipped
...

### Real Samples
...

### Tests
...

### Remaining Issues
...

### Gate
PASS / FAIL
```

---

# 45. 最终验收

只有全部满足后才允许：

```text
STARRAIL_FULL_ARCHIVE_PIPELINE_COMPLETE = true
```

## 数据源

- [ ] 不允许静默 Fixture fallback
- [ ] 正式发布无 `--limit`
- [ ] Source Commit 可追踪
- [ ] Source Inventory 完整
- [ ] Stages 已纳入 Audit

## Story

- [ ] World / Chapter 不再按 ID 猜
- [ ] MainMission Graph 已建立
- [ ] Discussion 可归属 Mission
- [ ] Structured Dialogue 直接解析
- [ ] Objective 与 Dialogue 分离
- [ ] completeness 真实计算
- [ ] visibility 真实计算
- [ ] Internal ID 不暴露

## Structured Data

- [ ] Character Extractor
- [ ] LightCone Extractor
- [ ] Relic Extractor
- [ ] Material Extractor
- [ ] Enemy Extractor
- [ ] Achievement Extractor

## Material

- [ ] Item Lore 不再冒充材料
- [ ] 分类真实
- [ ] Source 有真实关系
- [ ] Usage 有真实关系
- [ ] 内部/测试物品不进入 Public

## Archive

- [ ] StarRail Archive 不再依赖 Genshin Repository
- [ ] Corpus 与 Archive Projection 明确
- [ ] Generic Adapter 完整
- [ ] Story / Data / Material 都可真实读取

## 测试

- [ ] Source Coverage Audit
- [ ] Pipeline Audit
- [ ] Story Quality Gate
- [ ] Material Quality Gate
- [ ] Cross-game Isolation
- [ ] Real DB Integration
- [ ] Real Archive E2E

---

# 46. 最终 Agent 报告必须包含

```text
Commit SHA:

Source Path:
Source Commit:
Source Version:
Source Files:

Fixture Fallback:
Limit Applied:

Narrative Corpus Documents:

Structured Worlds:
Structured Chapters:
Structured MainMissions:
Structured Dialogue Nodes:

Characters:
LightCones:
Relics:
Materials:
Enemies:
Achievements:

Mission Title Resolve:
World Resolve:
Chapter Resolve:
Dialogue Availability:

Orphan Discussions:
Mission Graph Cycles:
Ordering Conflicts:

Material Description Coverage:
Material Source Coverage:
Material Usage Coverage:
Material Other Ratio:
Filtered Internal/Test Items:

Wrong Cross-game Data:
Internal ID Leaks:

Real Integration:
Real E2E:
CI:

Published Revision:

STARRAIL_FULL_ARCHIVE_PIPELINE_COMPLETE = true / false
```

如果最终报告只有：

```text
CI Green
Corpus 15907
E2E Passed
```

但没有 Structured Archive 指标，则直接视为：

```text
FAIL
```

---

# 47. 最终目标

修复完成后的星铁数据链：

```text
TurnBasedGameData
│
├─ Narrative Corpus
│  ├─ Mission text
│  ├─ Story
│  ├─ Message
│  ├─ Book
│  ├─ Character Story
│  ├─ Voice
│  └─ Item Lore
│
└─ Structured Archive
   ├─ World
   ├─ Chapter
   ├─ Mission Graph
   ├─ Dialogue
   ├─ Character
   ├─ LightCone
   ├─ Relic
   ├─ Material
   ├─ Enemy
   └─ Achievement
```

最终原则：

> **Corpus 负责“能搜索和回答什么”，Structured Archive 负责“游戏数据是什么、如何组织、如何正确展示”。**

两者共用同一份真实 TurnBasedGameData，但不再互相冒充。
