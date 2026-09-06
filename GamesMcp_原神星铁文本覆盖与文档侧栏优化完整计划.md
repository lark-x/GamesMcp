# GamesMcp 原神 / 星铁文本覆盖与文档侧栏优化完整计划

> 项目：`lark-x/GamesMcp`  
> 审查基线：`df6f0db7729f9350f238cc9d7857ba3cc76a40ca`  
> 适用范围：原神（Genshin Impact）+ 崩坏：星穹铁道（Honkai: Star Rail）  
> 目标：补齐可读文本数据覆盖、修复“已存在但未解析/未展示”的链路问题、建立统一 Text Catalog，并在**不大改文档阅读页主体布局**的前提下优化侧边目录与列表交互。

---

# 1. 背景与本轮目标

当前 GamesMcp 的 Archive 前端已经完成较大规模重构，Story / Material / Data / Text 等浏览模块均已形成较稳定的页面骨架。

本轮不再进行整体 Archive UI 重构，而是集中解决两个问题：

1. **原神与星铁存在大量上游可读文本，但没有完整进入 Text Corpus。**
2. **Text Browser 的侧边目录在数据量扩大后可用性很差，尤其是角色语音、角色故事、短信、书籍等按组展开的场景。**

本轮核心原则：

> 文档阅读页主体不大改；数据层和目录层补完整。

具体表现为：

- 保留现有 `ArchiveLayout`
- 保留正文 Reader
- 保留 Inspector
- 保留当前 Text 深链路路由
- 保留上一篇 / 下一篇逻辑
- 增加更多 Text Kind
- 增加正式 Text Catalog API
- 修复分页与截断
- 去除前端基于标题字符串猜分组
- 去除“大量 Accordion 全展开”的目录形式
- 改为“分组选择器 + 当前组平面列表”
- 确保原神和星铁均能输出真实、完整、可验证的文本数据

---

# 2. 当前审查结论总览

## 2.1 原神当前文本覆盖不足

当前原神文本 Converter 的核心 Document 类型主要集中在：

- `book`
- `character_story`
- `item_description`
- `mechanism`

当前文本来源虽然已经读取不少数据，但仍主要被聚合在 `mechanism` 中。

也就是说：

```text
上游存在文本
→ 当前没有独立 Text Kind
→ 被归到 mechanism 或根本未进入 Converter
→ Text API 无独立浏览能力
→ Text Browser 看不到或只能搜索
```

当前原神最明显的问题不是数据库漏写，而是：

> **Text Domain 本身定义得太窄。**

---

## 2.2 原神已有数据其实足够先扩一轮分类

当前 mechanism 相关来源已经覆盖：

- Tutorial
- TutorialDetail
- TutorialCatalog
- GuideV2
- PushTips
- PushTipsCodex
- LoadingTips
- GCGTutorialText
- 活动教程
- UGC 教程
- HandbookQuestGuide

这些都属于玩家实际可见文本。

但现在 UI 只把它们粗略看作：

```text
机制 / 教程
```

本轮应拆分成正式可浏览类别。

---

## 2.3 原神存在“解析到了但前端看不全”的问题

目前部分 Text API / 前端调用存在较低 limit：

- 物品文本常见 `limit=50`
- 角色语音常见 `limit=100`

这会导致：

```text
数据库有 2000 条
API 只返回前 50 条
前端误以为只有 50 条
```

因此必须把“数据没解析到”和“数据被列表截断”区分开。

本轮需要建立：

```text
source count
↓
converted count
↓
db count
↓
api count
↓
ui visible count
```

五层审计。

---

## 2.4 星铁 Structured 数据已经明显加强

当前星铁 structured 已存在：

- Character
- LightCone
- Relic
- Material
- Enemy
- Achievement
- Dialogue
- Story Resolver
- World / Chapter

所以星铁已经不是“没有 structured data”的状态。

当前主要问题转为：

> Structured Archive 与 Text Corpus 覆盖范围不一致。

---

## 2.5 星铁 Text Corpus 仍然偏窄

当前星铁文本主要集中在：

- Book
- Character Story
- Item Lore
- Message
- Mission
- Story
- Train Visitor
- Voice Line

但上游仍存在大量可读文本类型，例如：

- StoryAtlas
- Story/Discussion
- Tutorial
- Guide
- NPC/Dialog
- Cutscene/Performance
- Activity
- Event
- Rogue / 模拟宇宙相关玩法文本
- Equipment / LightCone lore
- Relic lore

当前 source audit 对其中很多数据仍标记为：

```text
PLANNED
```

说明项目知道这些数据存在，但尚未完整进入 Text Corpus。

---

## 2.6 星铁存在 Production Baseline 假数据风险

当前多个 structured extractor 在真实数据文件不存在或为空时，会回退到 `getBaseline*()`。

涉及风险模块包括：

- Character
- LightCone
- Relic
- Material
- 以及其他采用同模式的 structured extractor

这会造成：

```text
真实源解析失败
↓
返回硬编码 baseline
↓
页面仍然“有数据”
↓
用户误以为解析成功
```

这是本轮 P0 必须修复的问题。

正式环境中必须做到：

```text
source = baseline
```

数量为 0。

---

## 2.7 星铁部分“来源 / 用途”目前仍是通用推导

例如材料分类后根据类别自动写：

```text
角色晋阶 → 凝滞虚影
行迹 → 拟造花萼（赤）
周本 → 历战余响
```

这些可以作为“类别说明”，但不能冒充：

- 具体副本
- 具体角色
- 具体光锥
- 真实 source relation

后续 Text / Material 页面都需要区分：

```text
derived generic metadata
```

与：

```text
verified source relationship
```

---

# 3. 本轮明确不做的大改

本轮禁止为了“看起来更现代”而重构整套文档页面。

以下内容原则上不动：

- Archive 全局布局结构
- Header
- Global Nav
- Reader 主体排版
- Inspector 基础结构
- 路由总体模式
- Story / Material / Data 页面布局
- Citation 体系
- 当前 Archive Design Language
- 文本正文加载方式
- Reader 上一篇 / 下一篇基础交互

允许修改：

- Text Browser 顶部分类入口
- Text Browser 左侧 Catalog
- Text Catalog API
- Text Kind Registry
- Text 分组
- Text 分页
- Text 列表项样式
- Inspector 文本元数据
- Text API contracts
- Text ingestion / projection

---

# 4. 最终目标架构

建议最终形成以下链路：

```text
Genshin AnimeGameData
        ↓
Genshin Text Extractors
        ↓
Canonical Text Document
        ↓
Text Catalog Projection
        ↓
Database
        ↓
/api/games/:gameId/text/catalog
        ↓
TextBrowser
```

```text
StarRail TurnBasedGameData
        ↓
StarRail Text Extractors
        ↓
Canonical Text Document
        ↓
Text Catalog Projection
        ↓
Database
        ↓
/api/games/:gameId/text/catalog
        ↓
TextBrowser
```

两游戏差异只存在于：

```text
Source Adapter / Extractor
```

进入 Canonical Text Document 后：

```text
DB
API
Frontend
Pagination
Grouping
Sorting
```

尽可能共用。

---

# 5. 第一阶段：建立完整 Text Coverage Audit

这是本轮第一优先级。

禁止直接先改前端。

必须先明确：

> 哪些数据是真的没有解析，哪些数据只是没有暴露到 API，哪些只是前端没显示完整。

---

## 5.1 新增统一审计维度

对每个 Text Kind 建立：

```ts
type TextCoverageAudit = {
  gameId: string;
  kind: string;

  sourceDatasetCount: number;
  discoveredCount: number;
  convertedCount: number;
  excludedCount: number;
  failedCount: number;

  databaseDocumentCount: number;
  databaseSegmentCount: number;

  apiTotalCount: number;
  apiReturnedCount: number;

  unresolvedTitleCount: number;
  unresolvedGroupCount: number;

  hiddenCount: number;
  duplicateCount: number;

  coverage: number;
};
```

---

## 5.2 审计必须覆盖完整链路

每个类别必须输出：

```text
上游文件
↓
上游记录数
↓
Extractor 发现记录数
↓
成功转 Document 数
↓
Excluded 数
↓
Failures 数
↓
DB Documents 数
↓
DB Segments 数
↓
API Total
↓
UI 可浏览数量
```

---

## 5.3 原神审计对象

至少包含：

### 已支持

- books
- character-stories
- voices
- item-texts
- mechanisms

### 新增候选

- tutorials
- guides
- exploration-tips
- system-tips
- loading-tips
- gcg
- activity-tutorials
- handbook-guides

### P1 候选

- weapon-lore
- artifact-lore
- character-profile
- achievement-lore
- other-lore

---

## 5.4 星铁审计对象

至少包含：

### 已支持

- books
- character-stories
- voices
- messages
- train-visitors
- item-lore
- mission
- story

### 新增候选

- story-atlas
- discussion
- lightcone-lore
- relic-lore

### P1 候选

- tutorials
- guides
- npc-dialogue
- cutscene-text
- activity-text
- event-text
- rogue-text
- special-mode-text

---

## 5.5 需要新增脚本

建议：

```text
scripts/audit-text-coverage.ts
```

输出：

```text
artifacts/text-coverage/genshin.json
artifacts/text-coverage/starrail.json
artifacts/text-coverage/summary.md
```

---

## 5.6 Coverage Gate

必须满足：

```text
discovered
=
converted
+ excluded
+ failed
```

即：

```text
unexplainedMissing = 0
```

如果不为 0，CI 直接失败。

---

# 6. 第二阶段：移除星铁 Production Baseline Fallback

这是 P0。

---

## 6.1 正式环境禁止 baseline

以下逻辑：

```ts
if (!sourceFile) {
  return getBaselineXXX();
}
```

应改为：

```ts
if (!sourceFile) {
  if (context.mode === "fixture") {
    return fixtureData();
  }

  throw new MissingSourceDatasetError(...);
}
```

或：

```ts
return {
  records: [],
  failures: [...]
}
```

具体采用 fail-fast 还是 failure manifest，按现有 pipeline 风格统一。

---

## 6.2 Baseline 仅允许 Fixture Test

允许：

```text
data/fixtures/starrail
```

使用 fixture。

不允许：

```text
production
release candidate
published revision
```

使用 baseline。

---

## 6.3 增加 provenance Gate

正式 Revision 中必须满足：

```sql
SELECT COUNT(*)
FROM ...
WHERE provenance->>'source' IN ('baseline', 'fixture');
```

结果：

```text
0
```

---

## 6.4 CI Gate

新增：

```text
P0_STARRAIL_BASELINE_RECORDS=0
```

否则：

```text
FAIL
```

---

# 7. 第三阶段：建立 Canonical Text Kind Registry

目前 Text Browser 不应该继续通过大量：

```ts
if (textKind === ...)
```

扩展。

建议新增：

```text
apps/web/src/archive/text/text-kind-registry.ts
```

以及共享 contract：

```text
packages/contracts/src/text.ts
```

---

## 7.1 Canonical Text Kind

建议定义：

```ts
export type TextKind =
  | "books"
  | "character-stories"
  | "voices"
  | "item-texts"
  | "tutorials"
  | "guides"
  | "exploration-tips"
  | "system-tips"
  | "loading-tips"
  | "mechanics"
  | "gcg"
  | "activity-tutorials"
  | "messages"
  | "train-visitors"
  | "story-atlas"
  | "discussion"
  | "lightcone-lore"
  | "relic-lore";
```

---

## 7.2 Registry 配置

示例：

```ts
export type TextKindConfig = {
  id: TextKind;

  games: Array<"genshin" | "starrail">;

  navLabel: string;
  itemNoun: string;

  groupMode:
    | "none"
    | "character"
    | "contact"
    | "book"
    | "series"
    | "category";

  sortMode:
    | "source_order"
    | "group_order"
    | "title"
    | "custom";

  supportsSearch: boolean;
  supportsPagination: boolean;

  route: string;
};
```

---

## 7.3 UI 禁止 game hardcode 扩散

不要在 TextBrowser 中继续写：

```ts
if (gameSlug === "genshin") ...
if (gameSlug === "starrail") ...
```

只在 registry / adapter 层保留必要差异。

---

# 8. 第四阶段：原神文本类别扩展

本轮优先利用**已经存在的真实来源**。

---

## 8.1 原神最终 P0 Text Kind

第一轮建议正式支持：

```text
书籍文献
角色故事
角色语音
物品文本
基础教程
探索与系统提示
加载提示
玩法机制
七圣召唤
活动教程
```

---

# 9. 原神基础教程

来源：

```text
TutorialExcelConfigData
TutorialDetailExcelConfigData
TutorialCatalogExcelConfigData
```

新增：

```text
TextKind: tutorials
DocumentType: tutorial
```

---

## 9.1 数据结构

建议 metadata：

```ts
{
  tutorialId,
  catalogId,
  category,
  titleResolution,
  sourcePath
}
```

---

## 9.2 UI

左侧：

```text
基础教程

[ 搜索教程... ]

类别
[ 全部 ▼ ]

元素反应
探索
战斗
角色培养
...
```

不使用 Accordion。

---

# 10. 原神探索与系统提示

来源候选：

```text
GuideV2
PushTips
PushTipsCodex
HandbookQuestGuide
```

建议拆为：

```text
guides
exploration-tips
system-tips
```

如果 Source Audit 发现区分价值不高，可以第一阶段合并成：

```text
探索与系统提示
```

但数据库 metadata 必须保留 source subtype。

---

# 11. 原神 Loading Tips

来源：

```text
LoadingTipsExcelConfigData
```

新增：

```text
TextKind: loading-tips
DocumentType: lore / tutorial
```

UI 分类：

```text
加载提示
```

这类内容是游戏内真实文本，适合完整收录。

---

# 12. 原神七圣召唤

来源：

```text
GCGTutorialTextExcelConfigData
```

新增：

```text
TextKind: gcg
```

可继续细分：

```text
基础规则
卡牌
战斗流程
元素反应
其他
```

第一阶段可只做平面列表。

---

# 13. 原神活动教程

来源：

```text
ActivitySnowRaceHideTutorial
AlchemySimPotionTutorial
UgcTutorial
...
```

不要为每个活动建立独立 DocumentType。

统一：

```text
TextKind: activity-tutorials
DocumentType: tutorial
metadata.activityType
metadata.sourceTable
```

---

# 14. 原神玩法机制

当前 mechanism extractor 已具备较多逻辑。

本轮需要：

1. 保留 `mechanism` DocumentType
2. 增加正式 catalog/list API
3. 不再要求输入 query 才能看到内容
4. 支持 category filter
5. 支持分页

---

# 15. 原神角色语音修复

当前角色语音存在两个问题：

1. 列表数量可能被 limit 截断
2. 前端分组依赖标题字符串

必须改成后端返回：

```ts
{
  documentId,
  characterStableId,
  characterName,
  voiceKey,
  title,
  order
}
```

禁止前端：

```ts
title.split("：")
```

推断 character。

---

# 16. 原神物品文本修复

取消：

```text
limit=50
```

假完整列表。

API 应返回：

```ts
{
  total,
  offset,
  limit,
  nextOffset,
  entries
}
```

前端滚动 / 下一页均可。

第一阶段建议简单：

```text
上一页
下一页
```

或者：

```text
Load More
```

不要一次拉 10000。

---

# 17. 原神 P1 文本类别

Source Audit 完成后再决定是否加入：

```text
武器故事
圣遗物故事
角色资料
成就文本
其他 Lore
```

准入条件：

> 必须存在真实、独立、人类可读正文。

禁止把：

```text
武器技能数值
圣遗物二件套效果
角色攻击倍率
```

包装为 Lore。

---

# 18. 第五阶段：星铁文本类别扩展

建议 P0 Text Kind：

```text
书籍文献
角色故事
角色语音
星轨短信
列车访客
物品文本
剧情回顾
场景 / 散篇对话
光锥文本
遗器文本
```

---

# 19. 星铁剧情回顾

来源：

```text
StoryAtlas
```

新增：

```text
TextKind: story-atlas
```

用途：

```text
章节回顾
剧情摘要
阶段节点
```

注意：

> StoryAtlas 不应替代 Story Browser。

它属于 Text Browser 的“剧情回顾”文献类别。

---

# 20. 星铁 Story / Discussion

来源：

```text
Story/Discussion/**
```

新增：

```text
TextKind: discussion
```

UI 名称：

```text
场景 / 散篇对话
```

---

## 20.1 去重要求

如果某 Discussion 已被明确归属：

```text
Mission / Story
```

并已经在 Story Browser 中呈现，不要重复生成独立 Text Document。

建议：

```ts
metadata.storyBinding = {
  questKey,
  subquestKey,
  dialogueNodeKey
}
```

如果 binding 存在：

```text
Story only
```

如果无法归属：

```text
Discussion Text Browser
```

---

# 21. 星铁光锥文本

当前 structured LightCone 更多是：

```text
名称
稀有度
命途
基础属性
技能名
技能说明
```

这些还不足以直接称为“光锥故事”。

必须先 Source Audit：

```text
EquipmentConfig
ItemConfigEquipment
TextMap
其他 lore / desc 字段
```

确认：

```text
背景描述
图鉴文本
故事文本
```

是否存在。

---

## 21.1 分类要求

如果只有：

```text
skillDesc
```

则继续留在 Data Browser。

如果存在真实背景文本：

```text
TextKind: lightcone-lore
```

---

# 22. 星铁遗器文本

当前 Relic extractor 主要是：

```text
SetName
2pc
4pc
```

并且部分 Piece 仍是按 Set 自动生成。

不能直接把它们当遗器 Lore。

必须进一步检查：

```text
RelicConfig
RelicSetConfig
ItemConfigRelic
TextMap
```

是否存在：

```text
部位名称
单件描述
背景故事
套装故事
```

确认后再加入：

```text
TextKind: relic-lore
```

---

# 23. 星铁教程 / 活动 / 模拟宇宙

这些属于 P1。

先做 Source Coverage Audit。

候选：

```text
Tutorial
Guide
NPC/Dialog
Performance
Cutscene
Activity
Event
Rogue
```

只有满足：

```text
真实文本字段
+
稳定 ID
+
可读标题
+
可解释分类
```

才进入 Text Browser。

---

# 24. 第六阶段：建立统一 Text Catalog Contract

本轮最重要的 API 改造之一。

---

## 24.1 当前问题

现在各 Text API 返回结构不同：

```text
books
characters
entries
voices
items
hits
```

导致 TextBrowser 不断写：

```text
if / map / convert / infer
```

应统一。

---

## 24.2 新 Contract

建议：

```ts
export type TextCatalogEntry = {
  documentId: string;
  stableId: string;

  kind: TextKind;

  title: string;
  subtitle?: string | null;
  preview?: string | null;

  groupId?: string | null;
  groupName?: string | null;

  order: number;

  segmentCount?: number | null;

  gameVersion?: string | null;
  locale: string;

  provenance?: {
    sourceKey?: string | null;
    sourceType?: string | null;
  };
};
```

---

## 24.3 Group

```ts
export type TextCatalogGroup = {
  id: string;
  name: string;

  count: number;

  subtitle?: string | null;

  order: number;
};
```

---

## 24.4 Response

```ts
export type TextCatalogResponse = {
  gameId: string;
  revisionId: string;
  locale: string;

  kind: TextKind;

  groups: TextCatalogGroup[];

  entries: TextCatalogEntry[];

  total: number;

  offset: number;
  limit: number;
  nextOffset: number | null;
};
```

---

# 25. 第七阶段：新增统一 Text Catalog API

推荐：

```http
GET /api/games/:gameId/text/catalog
```

Query：

```text
kind
locale
group
q
offset
limit
revisionId
```

---

## 25.1 示例

角色语音：

```http
GET /api/games/:gameId/text/catalog
  ?kind=voices
  &group=character/10000002
  &offset=0
  &limit=100
```

短信：

```http
GET /api/games/:gameId/text/catalog
  ?kind=messages
  &group=contact/1001
```

教程：

```http
GET /api/games/:gameId/text/catalog
  ?kind=tutorials
```

---

## 25.2 分页规范

禁止：

```text
limit=10000
```

作为正式方案。

建议：

```text
default = 100
max = 200
```

---

## 25.3 Group 请求策略

支持：

```text
group omitted
```

返回：

```text
groups
+
默认组 entries
```

或：

```text
groups only
```

两种都可以。

建议简化为：

```text
groups 始终返回
entries 根据 group 返回当前组
```

---

# 26. 第八阶段：重构 TextBrowser 数据层，但不重做 UI

目标：

```text
TextBrowser 不再理解每种后端 response
```

统一：

```ts
loadTextCatalog(kind, group, query, offset)
```

正文依旧：

```ts
loadDocument(documentId)
```

---

# 27. TextBrowser 最终状态结构

建议：

```ts
const [catalog, setCatalog] = useState<TextCatalogResponse>();
const [activeGroupId, setActiveGroupId] = useState<string | null>();
const [activeDocumentId, setActiveDocumentId] = useState<string | null>();
const [searchQuery, setSearchQuery] = useState("");
const [offset, setOffset] = useState(0);
```

---

# 28. 第九阶段：彻底去除 Accordion / 全展开目录

这是本轮前端主要 UX 调整。

---

## 28.1 当前问题

例如：

```text
角色 A
  条目1
  条目2
  条目3

角色 B
  条目1
  条目2

角色 C
  ...
```

在数百角色 / 数千语音情况下完全不可用。

---

## 28.2 最终模式

统一改成：

```text
[ 搜索... ]

分组
[ 三月七 ▼ ]

────────────────

初次见面
早上好
下午好
关于丹恒
关于姬子
...
```

---

# 29. Group Selector 规范

不同 Kind 使用不同 label：

```text
voices              → 角色
character-stories   → 角色
messages            → 联系人
books               → 书籍
activity-tutorials  → 活动
gcg                  → 分类
relic-lore           → 套装
```

---

## 29.1 Group Selector 不是 Accordion

允许使用：

```text
select
combobox
popover list
```

不建议：

```text
几十个 details/summary
```

---

## 29.2 搜索 Group

如果 group 数量超过：

```text
30
```

Selector 内建议支持搜索。

---

# 30. 第十阶段：优化左侧列表项

不进行 Card 重构。

只做轻量两行列表。

---

## 30.1 推荐结构

```text
标题
辅助信息
```

例如语音：

```text
关于丹恒
角色语音 · 三月七
```

短信：

```text
「今晚有空吗？」
卡芙卡 · 5 条消息
```

书籍：

```text
第三卷 · 梦境研究
12 个文本片段
```

教程：

```text
元素反应基础
基础教程 · 战斗
```

---

## 30.2 不要加入

侧边列表中不要堆：

```text
Revision
完整 sourceKey
长 description
Raw ID
完整正文 preview
```

避免信息过载。

---

# 31. 列表项样式建议

推荐：

```css
.text-catalog-entry {
  min-height: 48px;
  padding: 8px 10px;
}
```

内部：

```text
title: 14~15px
meta: 12px
```

选中状态：

```text
is-active
```

继续沿用当前 Archive 设计语言。

---

# 32. 第十一阶段：Inspector 小幅增强

正文页不大改。

右侧 Inspector 增加：

```text
标题
分类
所属分组
当前序号
片段数量
游戏版本
Revision
来源
```

---

## 32.1 技术字段

Raw ID：

```text
默认不显示
```

如果未来需要开发模式：

```text
Technical Details
```

单独折叠。

正式用户默认不看。

---

# 33. 第十二阶段：Text 文档元数据规范

Canonical Document metadata 最少应包含：

```ts
{
  textKind,
  groupId,
  groupName,
  sourceType,
  sourceKey,
  sourcePath,
  sourceOrder,
  displayOrder
}
```

---

# 34. 原神 metadata 建议

### 角色语音

```ts
{
  textKind: "voices",
  groupId: "character/<id>",
  groupName: "<角色名>",
  voiceKey,
  order
}
```

### 角色故事

```ts
{
  textKind: "character-stories",
  groupId: "character/<id>",
  groupName: "<角色名>",
  storyKey,
  order
}
```

### Book

```ts
{
  textKind: "books",
  groupId: "book/<seriesId>",
  groupName: "<书籍名>",
  volumeId,
  volumeOrder
}
```

---

# 35. 星铁 metadata 建议

### Message

```ts
{
  textKind: "messages",
  groupId: "contact/<id>",
  groupName: "<联系人>",
  messageGroupId,
  sectionOrder
}
```

### Train Visitor

```ts
{
  textKind: "train-visitors",
  groupId: "visitor/<id>",
  groupName: "<访客名>",
  order
}
```

### LightCone Lore

```ts
{
  textKind: "lightcone-lore",
  groupId: "lightcone/<id>",
  groupName: "<光锥名>",
  loreType,
  order
}
```

---

# 36. 第十三阶段：排序规范

前端不得再：

```text
title.localeCompare()
```

作为主要业务排序。

---

## 36.1 排序优先级

建议：

```text
group.order
→ entry.order
→ sourceOrder
→ stableId
```

---

## 36.2 ID 只允许做最后稳定 tie-breaker

不能：

```text
ID = 故事顺序
```

---

# 37. 第十四阶段：真实标题与 ID 隔离

统一原则：

```text
ID ≠ Title
```

禁止：

```text
groupName = String(groupId)
```

公开页面遇到解析失败时：

```text
未归类文本
未解析标题
```

也不能显示：

```text
1001001
202401
sr_message_1003
```

作为标题。

---

# 38. 第十五阶段：处理 unresolved 文本

所有 Extractor 都应输出质量字段。

例如：

```ts
titleQuality:
  | "exact"
  | "fallback"
  | "derived"
  | "unresolved"
```

Group 同样：

```ts
groupQuality:
  | "exact"
  | "derived"
  | "unresolved"
```

---

## 38.1 Public Gate

对于公开 Text Document：

```text
titleQuality = unresolved
```

必须为：

```text
0
```

---

## 38.2 Group unresolved

允许：

```text
未归类文本
```

但必须统计。

不能显示机器 ID。

---

# 39. 第十六阶段：正文内容语义规范

Text Browser 不应把任何字符串都当成“正文”。

需要区分：

```text
Narrative
Dialogue
Description
Objective
Tutorial
System Text
Lore
Message
Voice
```

---

# 40. 星铁特别要求

如果 Mission 当前只有：

```text
TargetText
DescriptionText
```

不能显示成：

```text
完整剧情正文
```

应标记：

```text
当前仅收录任务说明
```

---

# 41. 第十七阶段：分页与搜索

每个 Text Kind 都必须支持：

```text
q
group
offset
limit
```

---

## 41.1 前端搜索防抖

建议：

```text
250~300ms
```

---

## 41.2 切换 group

立即：

```text
offset = 0
activeDocument = first item
```

---

## 41.3 搜索时

建议：

```text
当前 group 内搜索
```

并提供：

```text
全部分组
```

后续 P1。

---

# 42. 第十八阶段：深链接

保留现有模式：

```text
#text/:kind/:bookId?/:chapterId?
```

但内部概念建议泛化：

```text
groupId
documentId
```

不强制路由立即重命名。

---

## 42.1 兼容方案

现有参数：

```text
bookId
chapterId
```

内部解释为：

```text
groupId
entryId
```

避免本轮大规模改 Router。

---

# 43. 第十九阶段：API 与旧接口兼容

现有：

```text
/text/books
/text/character-stories
/text/documents
/text/items
/text/voices
/text/mechanics
```

第一阶段可以保留。

新增统一：

```text
/text/catalog
```

TextBrowser 优先切新接口。

旧接口标记：

```text
legacy
```

后续再删除。

---

# 44. 第二十阶段：数据库是否需要新表

优先不新建文本主表。

继续复用：

```text
documents
segments
```

只增加 metadata。

---

## 44.1 如 Query 性能不足

可以新增：

```text
knowledge.text_catalog_entries
```

Projection 表。

字段：

```text
revision_id
game_id
document_id
text_kind
group_id
group_name
entry_order
group_order
locale
```

---

## 44.2 何时才建 Projection 表

如果出现：

```text
每次 catalog 查询都需要解析 JSON metadata
```

或者：

```text
group/filter/sort 性能明显差
```

再落表。

第一阶段可以先 repository query。

---

# 45. 第二十一阶段：原神 Import Pipeline 改造

需要检查：

```text
scripts/anime-game-data-converter.ts
packages/ingestion/src/anime-game-data/**
scripts/import-anime-game-data.ts
```

重点：

1. 新增 text kind
2. 保留 provenance
3. 建立 group metadata
4. 输出 coverage manifest
5. 不改变已有 stable ID

---

# 46. 第二十二阶段：星铁 Import Pipeline 改造

重点文件：

```text
packages/providers/src/starrail/extractors/**
packages/providers/src/starrail/corpus/**
packages/providers/src/starrail/structured/**
scripts/ingest-starrail-full.ts
```

任务：

1. 移除 production baseline
2. 新增 StoryAtlas extractor
3. 新增 Discussion projection
4. Audit LightCone Lore
5. Audit Relic Lore
6. 增加 Text Catalog metadata
7. 增加 coverage accounting

---

# 47. 第二十三阶段：避免星铁继续依赖 genshin_* 语义

短期可以继续共用存储。

但 Text Browser 不得读取：

```text
genshin_weapons.weaponType
```

去推断星铁 lore。

应从：

```text
StarRail Extractor
→ Canonical Document metadata
```

获取。

---

# 48. 第二十四阶段：测试策略

至少分五层：

```text
Extractor Unit
Converter Unit
Repository/API
Frontend Component
Real Data E2E
```

---

# 49. Extractor Unit Tests

每个新增类别：

```text
正常数据
缺 TextMap
缺 title
空正文
重复记录
机器 ID 标题
隐藏数据
排序
```

---

# 50. Baseline Tests

必须新增：

```text
production mode:
missing source
→ FAIL / empty + failure
→ NEVER baseline
```

fixture：

```text
explicit fixture mode
→ allowed
```

---

# 51. API Tests

覆盖：

```text
kind filter
group filter
q
offset
limit
locale
revision
nextOffset
total
```

---

# 52. Group Contract Tests

必须确保：

```text
character group 不通过 title parsing 生成
contact group 不通过 title parsing 生成
book group 不通过 heading parsing 猜测
```

全部由后端 metadata 返回。

---

# 53. Frontend Component Tests

测试：

```text
切换 kind
切换 group
搜索
分页
选中 entry
深链接
上一条 / 下一条
空组
加载失败
retry
```

---

# 54. Accordion Removal Test

必须加入断言：

```text
多个 group 不应同时渲染全部 entry
```

例如 100 个角色语音：

```text
DOM 不允许一次出现全部 5000 个 voice item
```

---

# 55. Real Data E2E

这是本轮必须新增的 Gate。

Mock E2E 不足。

需要：

```text
Full Genshin Source
+
Full StarRail Source
+
Candidate Revision
+
API
+
Web
```

完整运行。

---

# 56. Real Data E2E 样例

原神：

```text
书籍
角色语音
物品文本
Tutorial
Loading Tips
GCG
```

星铁：

```text
Book
Character Story
Voice
Message
Train Visitor
StoryAtlas
Discussion
```

---

# 57. 第二十五阶段：数据质量 Gate

## P0

```text
Production baseline records = 0
Public unresolved title = 0
Machine ID visible title = 0
Unexpected duplicate document = 0
Unexplained missing = 0
API total != DB count = 0
Text Browser hard truncation = 0
Frontend title-based grouping = 0
```

---

# 58. 原神 Gate

```text
items 仅前 50 条 = 禁止
voices 仅前 100 条 = 禁止
mechanics 只能搜索不能浏览 = 禁止
```

---

# 59. 星铁 Gate

```text
source missing → baseline = 禁止
fixture data进入 public revision = 禁止
lightcone skillDesc 冒充 lore = 禁止
relic set effect 冒充 lore = 禁止
```

---

# 60. UI Gate

```text
Text Reader 主体不大改
Catalog 支持 group selector
不允许大量 accordion
列表支持 2 行信息
移动端可使用
Inspector 不溢出
```

---

# 61. 第二十六阶段：性能目标

Text Catalog：

```text
P95 < 300ms
```

Document Detail：

```text
P95 < 500ms
```

---

## 61.1 前端

首屏：

```text
只加载当前 kind
只加载 group list
只加载当前 group 第一页
```

禁止：

```text
启动时加载全部 kind
```

---

# 62. 第二十七阶段：移动端

现有 Archive 响应式策略继续使用。

Text Catalog 移动端建议：

```text
顶部 Kind
Group selector
List
Reader
```

Inspector：

```text
drawer
```

本轮不单独设计移动端新页面。

---

# 63. 第二十八阶段：可访问性

Group selector：

```text
label
keyboard
aria-expanded
aria-controls
```

Entry：

```text
button
aria-current
```

Catalog：

```text
nav / list semantics
```

---

# 64. 第二十九阶段：错误状态

明确区分：

```text
source_empty
not_supported
parse_failed
no_public_data
search_empty
group_empty
```

不要统一显示：

```text
暂无数据
```

---

# 65. 第三十阶段：Source Coverage Report

最终每次 release 输出：

```text
Genshin Text Coverage
StarRail Text Coverage
```

表格：

| Kind | Source | Converted | DB | API | Public | Unresolved |
|---|---:|---:|---:|---:|---:|---:|

---

# 66. 第三十一阶段：建议文件级修改范围

## Contracts

```text
packages/contracts/src/index.ts
```

建议拆出：

```text
packages/contracts/src/text.ts
```

新增：

```text
TextKind
TextCatalogEntry
TextCatalogGroup
TextCatalogResponse
```

---

## Domain

检查：

```text
packages/domain/src/index.ts
```

增加：

```text
listTextCatalog()
```

---

## Database

重点：

```text
packages/database/src/repository-read-models.ts
packages/database/src/schema.ts
```

必要时增加：

```text
text catalog projection
```

---

## API

重点：

```text
apps/api/src/text-routes.ts
```

新增：

```text
GET /api/games/:gameId/text/catalog
```

---

## Web

重点：

```text
apps/web/src/archive/text/TextBrowser.tsx
```

新增：

```text
apps/web/src/archive/text/text-kind-registry.ts
apps/web/src/archive/text/TextCatalog.tsx
apps/web/src/archive/text/TextGroupSelector.tsx
apps/web/src/archive/text/TextCatalogEntry.tsx
```

不要把所有逻辑继续堆进 TextBrowser。

---

## Genshin

重点：

```text
scripts/anime-game-data-converter.ts
packages/ingestion/src/anime-game-data/**
scripts/import-anime-game-data.ts
```

---

## StarRail

重点：

```text
packages/providers/src/starrail/extractors/**
packages/providers/src/starrail/corpus/**
packages/providers/src/starrail/structured/**
scripts/ingest-starrail-full.ts
```

---

# 67. 第三十二阶段：开发顺序

推荐严格按以下顺序：

### Phase A

```text
Coverage Audit
```

### Phase B

```text
移除 StarRail baseline
```

### Phase C

```text
Canonical Text Kind / Catalog Contract
```

### Phase D

```text
Genshin 已有文本分类拆分
```

### Phase E

```text
StarRail StoryAtlas / Discussion
```

### Phase F

```text
LightCone / Relic Lore Source Audit
```

### Phase G

```text
统一 Text Catalog API
```

### Phase H

```text
TextBrowser 数据层迁移
```

### Phase I

```text
Group Selector + 平面列表
```

### Phase J

```text
真实数据 E2E + Release Gate
```

---

# 68. 第三十三阶段：每阶段提交建议

## Commit 1

```text
test(text): add cross-game text coverage audit
```

## Commit 2

```text
fix(starrail): remove production baseline fallbacks
```

## Commit 3

```text
feat(text): add canonical text catalog contracts
```

## Commit 4

```text
feat(genshin): expand tutorial and system text corpus
```

## Commit 5

```text
feat(starrail): add story atlas and discussion text corpus
```

## Commit 6

```text
feat(api): add unified text catalog endpoint
```

## Commit 7

```text
refactor(web): migrate TextBrowser to text catalog
```

## Commit 8

```text
feat(web): replace expandable text groups with selector list
```

## Commit 9

```text
test(archive): add real data text browser gates
```

---

# 69. 第三十四阶段：验收场景

## 原神

### 场景 1

进入：

```text
文本 → 角色语音
```

应看到：

```text
角色 selector
当前角色语音列表
```

不是：

```text
所有角色全部展开
```

### 场景 2

选择一个拥有 100+ 语音的角色。

必须能够：

```text
完整分页浏览
```

### 场景 3

进入：

```text
文本 → 加载提示
```

必须展示真实 LoadingTips 数据。

### 场景 4

进入：

```text
文本 → 七圣召唤
```

必须展示 GCG Tutorial 数据。

### 场景 5

物品文本超过 50 条时：

```text
仍可继续浏览
```

---

# 70. 星铁验收场景

### 场景 1

角色语音：

```text
Group Selector
→ 角色
→ 语音
```

### 场景 2

短信：

```text
联系人
→ 会话
```

禁止所有联系人同时展开。

### 场景 3

剧情回顾：

```text
StoryAtlas
```

能作为独立 Text Kind 打开。

### 场景 4

Discussion：

无法绑定到任务的独立对话可以浏览。

### 场景 5

删除真实 AvatarConfig：

production ingestion 必须失败或报告 missing。

不能出现：

```text
三月七 baseline
```

---

# 71. 第三十五阶段：回归范围

本轮必须回归：

```text
Story Browser
Material Browser
Data Browser
Search
QA
Text Browser
Archive Routing
Mobile Layout
```

原因：

Text Document / DocumentType / API 改动可能影响全局 Search 与 QA。

---

# 72. 第三十六阶段：Search 兼容

新增 Text Kind 后：

```text
Search
```

应默认能搜到这些 Document。

但 Search 分类显示不要一次增加几十个 UI filter。

第一阶段统一：

```text
Text / 文献
```

详情再显示：

```text
Text Kind
```

---

# 73. 第三十七阶段：QA / MCP 兼容

新增文本可以进入检索。

但 MCP response 不应暴露：

```text
大量 catalog metadata
```

只保留：

```text
title
type
source
segment
citation
```

避免 token 膨胀。

---

# 74. 第三十八阶段：数据库迁移策略

若只是 Document metadata 扩展：

```text
不需要 schema migration
```

若新增：

```text
text_catalog_entries
```

则：

```text
新 migration
```

并：

```text
不修改旧 Revision
```

---

# 75. 第三十九阶段：Revision 策略

建议：

```text
新 Revision 导入
```

而不是直接修改已发布 Revision。

## 75.1 流程

```text
Current Public Revision
        ↓
New Candidate Revision
        ↓
Genshin import
        ↓
StarRail import
        ↓
Text Coverage Audit
        ↓
Real Data E2E
        ↓
Publish
```

---

# 76. 第四十阶段：回滚

如果发布后发现文本分类异常：

```text
切回旧 Public Revision
```

无需 rollback 数据库 schema。

UI API 应保持兼容：

```text
旧 Revision 缺某 kind
→ source_empty
```

不能 crash。

---

# 77. 第四十一阶段：必须禁止的实现方式

Agent 不得采用以下方案：

### 禁止 1

```text
直接把 API limit 改 10000
```

### 禁止 2

```text
前端 title.split("：") 猜角色
```

### 禁止 3

```text
多层 Accordion 展开
```

### 禁止 4

```text
真实数据缺失 → baseline
```

### 禁止 5

```text
技能说明 → Lore
```

### 禁止 6

```text
ID → 标题 fallback
```

### 禁止 7

```text
mock E2E 绿 = 数据完整
```

### 禁止 8

```text
为了增加分类重写 Reader 页面
```

---

# 78. 第四十二阶段：最终 Release Gate

发布前必须全部满足：

```text
TEXT_COVERAGE_GENSHIN_UNEXPLAINED_MISSING=0
TEXT_COVERAGE_STARRAIL_UNEXPLAINED_MISSING=0

STARRAIL_PRODUCTION_BASELINE=0

PUBLIC_TEXT_UNRESOLVED_TITLE=0
PUBLIC_MACHINE_ID_TITLE=0

TEXT_GROUP_TITLE_INFERENCE=0

TEXT_CATALOG_HARD_TRUNCATION=0

TEXT_CATALOG_REAL_DATA_E2E=PASS

TEXT_BROWSER_EXPAND_ALL_GROUPS=0
```

---

# 79. 最终预期页面

整体仍然是现有 Archive Reader。

示意：

```text
┌───────────────┬──────────────────────────────┬───────────────┐
│ 文本目录      │ 正文                         │ 文献信息      │
│               │                              │               │
│ [搜索……]      │ 标题                         │ 分类          │
│               │                              │ 所属角色      │
│ 角色          │ 正文                         │ 来源          │
│ [三月七 ▼]   │                              │ Revision      │
│               │                              │               │
│ 初次见面      │                              │               │
│ 早上好        │                              │               │
│ 下午好        │                              │               │
│ 关于丹恒      │                              │               │
│ 关于姬子      │                              │               │
│ ...           │                              │               │
└───────────────┴──────────────────────────────┴───────────────┘
```

而不是：

```text
▼ 三月七
  50 条

▼ 丹恒
  60 条

▼ 姬子
  45 条

▼ 卡芙卡
  55 条
...
```

---

# 80. 最终定义

本轮完成后，GamesMcp 的 Text Browser 应从：

```text
少量文献类别
+
部分列表
+
前端猜分组
+
大量展开
```

升级为：

```text
跨原神 / 星铁统一 Text Corpus
+
真实 Source Coverage
+
正式 Text Catalog API
+
服务器分组
+
完整分页
+
Group Selector
+
平面列表
+
Reader 保持原样
```

最终验收标准不是：

```text
页面增加了几个按钮
```

而是：

> **任何一个公开文本类别，都能够从真实上游数据一路追踪到 Extractor、Document、Database、API 和 Text Browser，并且不存在无解释缺失、假数据 fallback、机器 ID 标题、前端字符串猜分组或大规模展开目录。**
