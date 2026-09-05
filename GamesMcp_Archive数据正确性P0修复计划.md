# GamesMcp Archive 数据正确性 P0 修复计划

> 适用仓库：`lark-x/GamesMcp`  
> 当前审查基线：`main` / `8a105e63eddf78c8f35b6f2bc969a99d0d590bda`  
> 文档目的：将当前“UI 已成型、真实数据完成度较低”的 Archive，修复到**真实可用、数据可信、跨游戏不串数据**的状态。  
> 优先级：**P0 / Data Correctness First**

---

# 0. 给执行 Agent 的第一条提示

**不要把这次任务理解成前端 Bug 修复。**

当前 GamesMcp 最大的问题不是 UI，而是：

- Story Browser 与真实剧情数据没有完整接通；
- StarRail Provider 与 Archive Read Model 基本是两套系统；
- Story 地区 / 世界没有正式建模；
- Material 的分类、来源、用途、过滤都不完整；
- `/codex/*` 虽然名字是 Generic，底层仍大量依赖 Genshin Repository / Schema；
- 当前大量 E2E 使用的是 Mock 理想数据，只能证明“前端收到正确数据时能显示”，不能证明真实数据正确；
- 前端存在硬编码假内容和错误的数据来源 fallback；
- 当前 CI Green **不能作为 Archive 数据正确性的证明**。

## Agent 必须遵守

在本计划完成之前：

1. **暂停所有非必要 UI 美化。**
2. 不新增动画、卡片、Landing Page Demo、视觉优化。
3. 不用前端 fallback 掩盖后端数据缺失。
4. 不要看到 `CI Green` 就判断任务完成。
5. 不要看到 `/api/games/:gameId/codex/*` 就认为已经实现多游戏。
6. 不允许通过硬编码 `TurnBasedGameData`、`AnimeGameData`、地区名、任务名等方式“让页面看起来正常”。
7. 真实数据为空时，可以显示“暂无数据”；**不能制造假数据填充页面。**
8. Mock E2E 继续保留，但最终验收必须加入**真实数据库 + 当前 Published Revision** 的数据质量测试。
9. 修复 Converter / Adapter 后，不要继续沿用已经污染的旧 Revision，应重新生成 Candidate / Revision。
10. 每完成一个阶段，必须提供：修改文件清单、数据链变化说明、真实数据样例、测试结果、尚未解决的问题、是否达到该阶段 Gate。

---

# 1. 当前版本重新评估

当前 Archive 更准确的状态是：

> **Archive UI Shell 基本完成，但 Archive Data Product 仍处在中期。**

当前相对完成的内容：

- Archive App Shell；
- 路由；
- Deep Link；
- Story / Material / Text / Data 页面结构；
- Inspector；
- Loading / Error / Empty；
- 分页组件；
- 搜索输入；
- 基本 E2E UI 测试；
- 视觉设计。

当前明显未完成的内容：

- 真实 Story Catalog；
- StarRail Archive Story Read Model；
- Story Region / World 建模；
- 完整剧情正文；
- Material 公共数据过滤；
- Material 分类正确性；
- Material Sources；
- Material UsedBy；
- StarRail Material；
- 真正的跨游戏 Codex；
- Provenance 正确展示；
- 全量分类统计；
- 真实全字段搜索；
- 真实数据质量 Gate；
- 真实数据 E2E。

**综合真实可用完成度暂按 35%～45% 评估。**

---

# 2. 当前已确认的问题清单

## P0-01 剧情正文根本不显示

当前 Story Browser 主要依赖 `quest.dialogueNodes`。如果 `dialogueNodes` 为空，即使 `Document.body` 或 `documentSegments` 中有正文，前端仍会显示“暂无正文”。

### 根因

当前 Story Reader 将“是否存在结构化 Dialogue Nodes”错误地等价成“是否存在剧情正文”。

### 必须修复

Story Detail 必须支持两种正文来源：

```text
优先：Structured Dialogue Nodes
回退：Document Body / Document Segments
```

这里的“回退”是**后端正式 Read Model 能力**，不是前端猜数据。

---

## P0-02 StarRail Provider 与 Archive Story 没有真正接通

当前 StarRail Provider 主要能力：

- `knowledge_search`
- `keyword_search`
- `document_read`

主要返回 `GameKnowledgeDocument[]`，而 Archive Story 使用的是：

- `QuestRecordPayload`
- `QuestSubquest`
- `QuestDialogueNode`
- `QuestDialogueEdge`

这是两套数据链。

### 结果

```text
StarRail MCP / Search 能工作
≠
StarRail Archive Story 已完成
```

### 必须修复

建立正式链路：

```text
StarRail Source
→ StarRail Story Adapter
→ Archive Story Read Model
→ Database / Read API
→ Story Browser
```

不能让 Archive 直接依赖 Search Corpus。

---

## P0-03 当前 Story 模型没有正式的 Region / World

当前 Quest 结构主要有 `series / chapter / order`，缺少正式：

- region
- regionId
- world
- worldId
- parent hierarchy

因此“未知地区”不是简单 UI 显示 Bug，而是 Domain Contract 缺字段。

### 已知可用数据

Genshin 有：

```text
ChapterExcelConfigData.cityId
```

StarRail 有：

```text
MainMission.WorldID
ChapterID
```

数据源有能力解决，问题在 Converter / Adapter / Contract 链路。

---

## P0-04 Genshin Material 来源和用途实际上没有实现

当前 Converter 中存在：

```ts
sources: [],
usedBy: [],
```

因此页面的“获取方式”和“用途”虽然 UI 已存在，但真实数据天然为空。

### 必须修复

从真实数据中建立：

```text
Material
← Drop / Reward / Shop / Domain / Enemy / Collection Source
← Character Ascension Usage
← Talent Usage
← Weapon Ascension Usage
← Craft / Recipe Usage
```

至少先完成当前数据源能够可靠建立的关系。

---

## P0-05 Material 分类算法过于粗糙

当前 Material 分类主要依赖字符串包含判断，无法可靠区分：

- 角色突破素材；
- 天赋材料；
- 武器突破；
- 地区特产；
- 怪物掉落；
- 周本素材；
- 锻造；
- 食材；
- 货币；
- 任务道具；
- 活动物品；
- 内部物品；
- 系统物品。

### 必须修复

改为：

```text
Upstream enum / config relation
→ 游戏专属 Adapter
→ 统一 Archive Category
```

不再依赖模糊字符串猜测。

---

## P0-06 “莫名其妙的材料内容”缺少 Public Material Filter

`MaterialExcelConfigData` 并不等于“适合公开展示的材料百科”。其中可能包含任务物品、活动物品、临时物品、内部测试数据、系统道具、不可正常获取内容、占位记录等。

### 必须增加

```text
MaterialVisibility
```

至少区分：

```text
public
hidden
internal
test
event_only
unreleased
unknown
```

Public Archive 默认只返回 `public`。不确定内容不得默认混入主列表。

---

## P0-07 Generic Codex 只是“接口名字 Generic”

当前 `/api/games/:gameId/codex/materials` 内部仍会进入 Genshin Repository；Characters / Weapons / Enemies / Achievements 等 API 也仍大量使用 `genshin*Schema`。

### 必须修复

Generic 层不能依赖具体游戏 Repository。

目标：

```text
Codex API
    ↓
Game Archive Service
    ↓
Game Adapter
   ↙      ↘
Genshin   StarRail
```

而不是：

```text
Codex API
    ↓
Genshin Repository
```

---

## P0-08 Material 搜索“全字段”是假的

前端声称搜索 name / description / sources / usedBy，但请求会先把 `q` 发给后端，而后端当前主要按 `normalized_name` 过滤。

例如搜索“模拟宇宙”，材料名称不含“模拟宇宙”时，后端已经返回 0 条，前端根本没有机会匹配 `sources`。

### 必须修复

搜索逻辑归一到后端：

```text
name
description
sources
usedBy
aliases
```

并明确返回：

```text
searchFields
match
score
```

---

## P0-09 Material 分类数量只统计当前分页

当前 Material Browser 每页加载有限记录，然后前端对当前页做 Category Count。这会产生“角色培养素材 37”，但全库实际可能有 350 条。

### 必须修复

Backend 返回真实聚合结果：

```json
{
  "total": 1200,
  "categories": [
    {
      "key": "character_development",
      "label": "角色培养素材",
      "count": 350
    }
  ],
  "materials": [],
  "nextOffset": 100
}
```

前端禁止用当前 page 推导全库数量。

---

## P0-10 Provenance 目前存在错误硬编码

部分前端存在 `TurnBasedGameData` 硬编码 fallback，会导致 Genshin 内容也显示 StarRail Source。

### 必须修复

所有来源字段必须来自：

```text
provenance
source
sourceSnapshot
upstreamSource
```

原则：

> **没有 Provenance 就显示“来源未解析”，不能猜。**

---

## P0-11 首页存在与当前游戏无关的硬编码剧情

当前 Archive Home 存在静态 Genshin 剧情示例。如果当前游戏是 StarRail，仍可能显示 Genshin 内容。

### 必须删除

首页只允许：

- 通用产品说明；
- 当前游戏真实统计；
- 当前 Revision 真实数据；
- 或没有数据时显示 Empty。

不允许静态伪真实剧情。

---

## P0-12 Game Terminology 判断方式错误

当前存在类似：

```ts
gameId.toLowerCase().includes("starrail")
```

但 `gameId` 是 UUID，因此 StarRail 页面可能继续显示“武器 / 圣遗物”，而不是“光锥 / 遗器”。

### 必须修复

Game Contract 增加正式 `slug / family / terminology`，或者由 Game Archive Adapter 提供术语。

禁止从 UUID 猜游戏类型。

---

## P0-13 Mock E2E 造成“假完成”

当前大量测试直接 Mock 理想 API 数据。测试通过只能说明：

```text
前端收到理想 API 数据时可以渲染
```

不能说明：

```text
Converter
Database
Adapter
API
真实 Revision
```

能生成这些数据。

### 必须新增

```text
Real Data Integration Gate
```

---

# 3. 本轮目标

本轮不追求所有游戏数据 100% 全覆盖，只追求四个 P0 结果。

## 目标 A：剧情真的能读

```text
选择主线
→ 有正确标题
→ 有正确地区 / 世界
→ 有真实正文
→ 没有正文时明确说明数据不完整原因
```

## 目标 B：材料真的可信

```text
材料是公开可用的真实材料
→ 分类正确
→ 描述正确
→ 来源不是假数据
→ 用途不是假数据
→ 无内部 / 测试垃圾内容
```

## 目标 C：Genshin / StarRail 真正隔离

```text
StarRail 不读取 Genshin Repository
Genshin 不显示 TurnBasedGameData
StarRail 不显示 Genshin 静态内容
Genshin 不出现光锥 / 遗器错误术语
StarRail 不出现武器 / 圣遗物错误术语
```

## 目标 D：CI 可以证明真实数据，而不是只证明 UI

```text
Mock UI E2E
+
Real Data Integration
+
Data Quality Gate
```

---

# 4. 推荐目标架构

```text
                    ┌──────────────────┐
                    │ Raw Game Sources │
                    └────────┬─────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        Genshin Adapter            StarRail Adapter
                │                         │
                └────────────┬────────────┘
                             │
                  Archive Domain Model
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
      Story Model       Material Model      Data Model
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    Database Read Model
                             │
                    Generic Archive API
                             │
                      Archive Frontend
```

## 原则

Frontend 不负责修正游戏数据，只负责正确展示 API 返回的数据。游戏差异必须在 Adapter / Domain / Read Model 解决。

---

# 5. Phase 0：冻结 UI + 建立真实数据基线

优先级：**P0**

## 任务 0.1 暂停 UI 美化

本阶段禁止：

- Bento 继续优化；
- 新动画；
- 卡片重构；
- Theme polish；
- 新图标；
- 页面装饰；
- Landing Page Demo。

除非 UI 修改是修复真实数据显示错误所必需。

## 任务 0.2 生成 Real Data Baseline Report

新增脚本建议：

```text
scripts/archive-data-audit.ts
```

输出：

```text
reports/archive-data-baseline.json
reports/archive-data-baseline.md
```

### Genshin 至少统计

```text
quests.total
quests.public
quests.withRegion
quests.withReadableTitle
quests.withDialogueNodes
quests.withDocumentBody
quests.withAnyReadableBody

materials.totalRaw
materials.public
materials.otherCategory
materials.withDescription
materials.withSources
materials.withUsedBy
materials.internalLike
```

### StarRail 至少统计

```text
missions.total
missions.withWorldId
missions.withChapterId
missions.withReadableWorld
missions.withReadableChapter
missions.withNarrativeText
missions.objectiveOnly

materials.total
materials.public
materials.withDescription
materials.withSources
materials.withUsedBy
```

## Phase 0 Gate

Agent 必须先输出“真实数据当前到底有多少”，再开始修。

禁止在没有 Baseline 的情况下直接重写 Converter。

---

# 6. Phase 1：删除假数据、错误 fallback、伪通用行为

优先级：**P0**

## 任务 1.1 删除 ArchiveHome 硬编码剧情

涉及：

```text
apps/web/src/archive/ArchiveHome.tsx
```

删除静态角色名、伪真机剧情文本、“真机原文比照”等与当前真实数据无关的展示。

如果需要 Preview，必须使用真实 API。

## 任务 1.2 删除前端 Source fallback

重点检查：

```text
MaterialBrowser.tsx
StoryInspector.tsx
DataBrowser.tsx
```

删除：

```text
?? "TurnBasedGameData"
```

替换为“来源未解析”，或者无来源时隐藏 Source Section。

## 任务 1.3 删除 Generic → Genshin 前端 fallback

类似：

```ts
try codex
catch → /genshin/*
```

全部移除。Generic API 不工作时应直接暴露错误，不能偷偷换 Genshin API。

## 任务 1.4 删除 gameId 字符串游戏判断

禁止：

```ts
gameId.includes("starrail")
```

改为正式 Game Metadata。

## Phase 1 Gate

```text
Hardcoded fake content = 0
Wrong provenance fallback = 0
UUID game detection = 0
Frontend genshin API fallback = 0
```

---

# 7. Phase 2：建立正式 Story Catalog Read Model

优先级：**P0**

这是本轮核心任务之一。

## 任务 2.1 新增 Story Catalog Contract

不要继续依赖 `/quests?limit=50` 构造左侧剧情树。

建议：

```http
GET /api/games/:gameId/story/catalog
```

返回：

```ts
type StoryCatalog = {
  gameId: string;
  revisionId: string;
  regions: StoryRegion[];
};

type StoryRegion = {
  id: string;
  name: string;
  order: number;
  chapters: StoryChapter[];
};

type StoryChapter = {
  id: string;
  name: string;
  order: number;
  series?: string;
  quests: StoryQuestEntry[];
};

type StoryQuestEntry = {
  questKey: string;
  title: string;
  order: number;
  completeness: "complete" | "partial" | "metadata_only";
  bodyAvailability:
    | "dialogue"
    | "document"
    | "objective_only"
    | "none";
};
```

StarRail：

```text
World
→ Chapter
→ MainMission
```

Genshin：

```text
Region
→ Chapter
→ MainQuest
```

## 任务 2.2 Genshin Region Adapter

利用至少：

```text
ChapterExcelConfigData.cityId
chapterTitleTextMapHash
beginQuestId
endQuestId
```

建立 `cityId → Region`。

必要 Mapping 必须集中在 Adapter / Mapping Module，不能散落在前端组件中。

## 任务 2.3 StarRail World Adapter

利用：

```text
WorldID
ChapterID
DisplayPriority
NextTrackMainMission
```

建立：

```text
World
→ Chapter
→ Mission
```

需要独立 StarRail World Mapping 或从真实 World Config 解析。

## Phase 2 Gate

### Genshin

```text
主线 Region resolve >= 99%
主线 Chapter title resolve >= 99%
主线 Quest title resolve >= 99%
```

### StarRail

```text
MainMission World resolve >= 99%
Chapter resolve >= 99%
Mission title resolve >= 99%
```

所有 unresolved 必须输出详细清单。

---

# 8. Phase 3：修复 Story 正文链路

优先级：**P0**

## 任务 3.1 Quest Detail 增加 Body Availability

建议 API 返回：

```ts
{
  ...,
  narrative: {
    mode:
      | "structured_dialogue"
      | "document"
      | "objective_only"
      | "unavailable",

    dialogueNodes: [],
    documentSegments: [],
    reason?: string
  }
}
```

## 任务 3.2 Genshin Story 正文

读取优先级：

```text
Quest Dialogue Nodes
→ Document Segments
→ Document Body
→ Objective / Description
→ unavailable
```

注意：Objective / Description 不能伪装成完整剧情。

UI 必须明确标记：

```text
当前数据仅包含任务目标 / 描述，暂无完整对白。
```

## 任务 3.3 StarRail Story Adapter

Agent 必须先回答：

```text
TurnBasedGameData 当前哪些文件包含真实剧情对白？
```

先做 Source Inventory，不允许直接猜。

建议检查：

- MainMission；
- SubMission；
- Talk / Dialogue；
- Story；
- Sequence；
- NPC Dialogue；
- TextMap references；
- Script / Trigger related config。

当前 `MainMission.Name / SubMission.TargetText / DescriptionText` 只能证明任务 Meta 存在，不能当作完整剧情正文。

## 任务 3.4 StoryBrowser 渲染模式

Frontend 根据 `narrative.mode` 渲染。

禁止继续使用：

```ts
dialogueNodes.length === 0
→ 暂无正文
```

作为唯一判断。

## Phase 3 Gate

至少抽样：

### Genshin

```text
Mondstadt 5
Liyue 5
Inazuma 5
Sumeru 5
Fontaine 5
Natlan 5
```

### StarRail

每个 World 至少 5 个 MainMission。

逐条检查：

```text
标题正确
地区正确
章节正确
正文非空
正文不是任务目标冒充
角色名称正确
正文顺序合理
无内部 ID
```

---

# 9. Phase 4：重建 Material Domain

优先级：**P0**

这是另一个核心任务。

## 任务 4.1 建立 Generic Material Contract

不要复用 `GenshinMaterial` 作为通用合同。

建议：

```ts
type ArchiveMaterial = {
  id: string;
  stableId: string;
  gameId: string;

  name: string;
  category: string;
  categoryLabel: string;

  rarity?: number | null;
  description?: string | null;

  sources: MaterialSource[];
  usages: MaterialUsage[];

  visibility: "public" | "hidden";

  provenance: ArchiveProvenance;
};
```

## 任务 4.2 Genshin Material Adapter

至少区分：

```text
character_ascension
talent
weapon_ascension
local_specialty
monster_drop
weekly_boss
currency
forging
cooking
consumable
quest_item
furnishing
event
other
```

分类必须来自真实字段 / 关系，而不是字符串模糊匹配。

## 任务 4.3 Material Public Filter

建立：

```ts
isPublicMaterial(record)
```

至少过滤：

```text
测试 ID
空名称
占位名称
内部系统对象
无法获取对象
不可公开对象
unreleased
明显 event temporary
```

如无法可靠判断，进入 review list，不能直接 Public。

## 任务 4.4 Material Sources

建议：

```ts
type MaterialSource = {
  type:
    | "enemy_drop"
    | "domain"
    | "collection"
    | "shop"
    | "quest"
    | "reward"
    | "craft"
    | "weekly_boss"
    | "event"
    | "other";
  name: string;
  relatedId?: string;
};
```

禁止直接拼一个不可信字符串。

## 任务 4.5 Material Usage

建议：

```ts
type MaterialUsage = {
  type:
    | "character_ascension"
    | "character_talent"
    | "weapon_ascension"
    | "craft"
    | "other";

  targetId?: string;
  targetName: string;
};
```

当前前端 `usedBy: string[]` 可暂时兼容，但 Domain 应改成结构化关系。

## 任务 4.6 StarRail Material Adapter

不要调用 `repository.genshin`。

需要查明 StarRail 数据源中的：

```text
Item
Material
Character Promotion
Trace
LightCone Promotion
Enemy Drop
Reward
Shop / Synthesis
```

建立 StarRail 自己的 Material Adapter。

## Phase 4 Gate

必须输出真实统计：

```text
Total public materials
Other category %
Description coverage %
Source coverage %
Usage coverage %
Hidden / filtered count
Unresolved count
```

并输出异常样本。

---

# 10. Phase 5：修复 Generic Codex 架构

优先级：**P0**

## 任务 5.1 Game Archive Adapter Interface

建议建立：

```ts
interface GameArchiveAdapter {
  getStoryCatalog(...)
  getQuest(...)
  listMaterials(...)
  getMaterial(...)
  listCharacters(...)
  getCharacter(...)
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

## 任务 5.2 API 只依赖 Adapter

目标：`codex-routes.ts` 中禁止直接依赖 `genshin*Schema`。

Generic API 返回 Generic Contract。

## 任务 5.3 Terminology

API / Game Metadata 返回：

```json
{
  "terminology": {
    "weapon": "光锥",
    "artifact": "遗器"
  }
}
```

或由正式 game slug metadata 映射。

禁止 `gameId contains ...`。

## Phase 5 Gate

代码级扫描 `apps/web/src/archive` 不应再出现：

```text
/genshin/
isStarRail = gameId.includes(...)
TurnBasedGameData fallback
```

Generic API 层不应直接 parse `genshinCharacterSchema / genshinWeaponSchema / ...`，除游戏 Adapter 内部外。

---

# 11. Phase 6：Backend 负责搜索、统计、分页

优先级：**P0**

## Material API

建议：

```http
GET /api/games/:gameId/archive/materials
```

支持：

```text
q
category
limit
offset
revisionId
```

返回：

```json
{
  "total": 1240,
  "categories": [
    {
      "key": "character_ascension",
      "label": "角色突破素材",
      "count": 143
    }
  ],
  "items": [],
  "limit": 100,
  "offset": 0,
  "nextOffset": 100
}
```

## 搜索字段

至少：

```text
name
aliases
description
source names
usage target names
```

Backend 明确返回 `matchField`，方便调试。

## Phase 6 Gate

以下搜索都必须从 Backend 返回正确结果：

```text
搜索来源名
搜索角色名
搜索材料描述关键词
搜索材料名称
```

---

# 12. Phase 7：建立真实数据测试体系

优先级：**P0**

## 保留现有 Mock Playwright

将其定义为：

```text
UI Contract Test
```

Mock E2E 只能证明 UI Contract，不允许作为 Data Correctness 完成证明。

## 新增 1：Archive Real Data Integration Test

要求启动：

```text
PostgreSQL
API
真实 Published Revision
```

直接调用真实 API。

## 新增 2：Story Data Quality Test

检查：

```text
主线标题可读率
Region / World Resolve Rate
Chapter Resolve Rate
Body Availability Rate
Objective-only Rate
Internal ID Leak
Wrong Game Data
```

## 新增 3：Material Data Quality Test

检查：

```text
Public total
Other category ratio
No-description ratio
Source coverage
Usage coverage
Internal-like item count
Duplicate normalized names
Wrong provenance
Cross-game pollution
```

## 新增 4：Cross-game Isolation Test

### Genshin 系统层面禁止出现

```text
星琼
光锥
遗器
TurnBasedGameData
StarRail-only source
```

除非正文真实提及，不可作为系统术语 / Provenance。

### StarRail 系统层面禁止出现

```text
原石
圣遗物
AnimeGameData
Genshin-only Repository
```

除非正文真实提及。

---

# 13. Phase 8：重新导入并生成新 Revision

优先级：**P0**

修复 Converter / Adapter 后，**不要继续修补旧 Revision。**

流程：

```text
Raw Source
→ Converter
→ Adapter
→ Candidate
→ Data Audit
→ Integration Test
→ Manual Sample Review
→ Publish New Revision
```

必须保存：

```text
upstreamSource
upstreamCommit
upstreamVersion
converterVersion
adapterVersion
inputHash
generatedAt
```

---

# 14. 最终 Data Quality Gate

以下条件全部满足后，Agent 才能宣布本轮完成。

## Story

| 指标 | 目标 |
|---|---:|
| Genshin 主线可读标题 | ≥ 99% |
| Genshin 主线 Region | ≥ 99% |
| Genshin 主线正文可读 | ≥ 95%，未达必须有原因 |
| StarRail MainMission 可读标题 | ≥ 99% |
| StarRail World resolve | ≥ 99% |
| StarRail Chapter resolve | ≥ 99% |
| StarRail 正文可用率 | 给出真实统计并达到约定阈值 |
| Numeric/Internal ID 直接暴露 | 0 |
| 错误 Source 标签 | 0 |

## Material

| 指标 | 目标 |
|---|---:|
| 错误游戏数据串入 | 0 |
| 内部 / 测试物品进入 Public | 0 |
| 明显错误分类 | 0 |
| `other` 占比 | 给出真实原因，禁止无解释过高 |
| 描述覆盖率 | 给出真实统计 |
| Source 覆盖率 | 给出真实统计 |
| Usage 覆盖率 | 给出真实统计 |
| 错误 Provenance | 0 |
| 当前页统计冒充全库统计 | 0 |

## Architecture

必须满足：

```text
Story Catalog 不再使用 Quest Search API 临时构造
Material Generic API 不再调用 repository.genshin
Archive Web 不再 fallback 到 /genshin/*
gameId 不再用于字符串判断游戏类型
Provenance 不再硬编码
```

---

# 15. Agent 禁止事项

## 禁止 1：用 Mock 数据证明完成

错误：

```text
Playwright 通过 50 个
→ 完成
```

正确：

```text
Mock UI Test
+
Real DB Test
+
Data Quality Report
```

## 禁止 2：继续增加前端 fallback

错误：

```ts
if (!region) return "未知地区";
if (!source) return "TurnBasedGameData";
if (codex fails) call /genshin/*
```

这些只会隐藏真正的问题。

## 禁止 3：为了通过测试硬编码数据

必要 Mapping 必须集中在独立 Adapter / Mapping Module，必须有出处和测试，不能散落在组件中。

## 禁止 4：把 Objective 当完整剧情

任务描述不是剧情正文。UI 必须区分：

```text
任务目标
任务说明
剧情对白
旁白
玩家选项
```

## 禁止 5：Generic Route 继续包 Genshin Schema

`/codex/*` 是通用 API。不要只改 URL 名字。

## 禁止 6：修改 UI 来掩盖后端缺陷

例如隐藏获取方式、隐藏地区、隐藏正文空白，都不是修复。

正确做法是数据层补齐，或明确展示“当前数据源未解析”。

---

# 16. Agent 每阶段提交要求

每个 Phase 完成后，提交一个报告：

```md
## Phase X Result

### Commit
<sha>

### Files Changed
...

### Data Pipeline Before
...

### Data Pipeline After
...

### Real Data Samples
...

### Metrics
...

### Tests
...

### Remaining Problems
...

### Gate
PASS / FAIL
```

如果 Gate 是 `FAIL`，禁止继续宣称整个计划完成。

---

# 17. 推荐 Commit 切分

```text
fix(archive): remove fake content and invalid frontend fallbacks

feat(story): add generic story catalog contracts and region hierarchy

feat(genshin): map chapter city regions into archive story model

feat(starrail): map world and chapter hierarchy into archive story model

feat(story): support document narrative fallback and body availability

feat(materials): introduce generic archive material domain model

feat(genshin): rebuild material category visibility source and usage mapping

feat(starrail): implement starrail material adapter

refactor(codex): route generic archive APIs through game adapters

feat(archive): move material search aggregation and counts to backend

test(archive): add real revision data quality and cross-game isolation gates

data(archive): publish rebuilt verified archive revision
```

---

# 18. 建议实际执行顺序

严格按下面顺序执行：

```text
Phase 0
真实数据 Baseline

↓
Phase 1
删除假内容 / fallback

↓
Phase 2
Story Catalog + Region / World

↓
Phase 3
Story 正文链路

↓
Phase 4
Material Domain

↓
Phase 5
Generic Codex Adapter

↓
Phase 6
Backend Search / Count

↓
Phase 7
Real Data Tests

↓
Phase 8
重新导入 / 发布 Revision
```

不要同时大规模改 Story、Material、UI。

---

# 19. 本轮明确不做

以下不是当前 P0：

- 继续提高 UI 质感；
- 图片资源系统；
- 完整人物头像 CDN；
- 动画；
- 可视化剧情图；
- Timeline；
- 编辑器；
- Admin UI 恢复；
- Revision Selector 恢复；
- 自动数据纠错 AI；
- 全游戏全版本历史浏览；
- 高级 Recommendation；
- SEO。

先把：

```text
数据正确
数据完整
数据隔离
正文可读
材料可信
```

做好。

---

# 20. 最终一句话验收标准

> **用户打开 Genshin 或 StarRail Archive 后，看到的剧情、地区、材料、来源和用途必须来自真实游戏数据链；不能靠 Mock、硬编码、Fallback 或 Genshin 专用 Repository 冒充“多游戏完成”。**

---

# 21. 给 Agent 的最终提醒

当前项目最大的风险是：

```text
页面越来越像完成品
但数据仍然是半成品
```

因此这一次不要再以：

```text
页面能打开
CI Green
E2E Mock Green
接口返回 200
```

作为完成依据。

真正的完成依据是：

```text
真实 Published Revision
+
真实 Genshin 数据
+
真实 StarRail 数据
+
正确 Story Read Model
+
正确 Material Read Model
+
Cross-game Isolation
+
Data Quality Metrics
```

如果最终报告没有给出真实数据指标，请直接视为本计划 **未完成**。
