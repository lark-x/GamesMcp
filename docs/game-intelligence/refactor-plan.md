# Game Intelligence Platform 覆盖式重构实施计划

> 状态：本文件是从用户提供的 `GamesMcp original refactor plan attachment` 完整迁移而来，并按最新口径修订为覆盖式重构计划。
>
> 原始计划 SHA-256：`580f15b5b70da62590f9fd12ed59c9c738f5e8a740b02f6292c8a6c4b4f0c3b9`
>
> 覆盖式修订优先级：
>
> 1. 不保留当前代码兼容，不建设并行第二套版本轨道，不引入带版本号的 API、第二套 feature flag、双写、双读或新旧工具共存。
> 2. 允许直接覆盖当前实现，但不得删除 `.git`、上游原始数据、许可证/来源说明、`.env`/本地密钥配置参考，以及本计划登记文档。
> 3. 当前代码只能作为理解业务和测试预期的参考；最终实现以新的 Game Intelligence Platform、Game Data Core、Game Codex、Game MCP 分层为准。
> 4. 数据库按新 schema 从空库重建；旧迁移、旧派生数据、旧 revision/candidate/build/manifest/index 不作为兼容对象。
> 5. 每个阶段完成后必须更新 `docs/game-intelligence/progress.md`，记录完成证据、验证命令、遗留风险和下一阶段入口。
> 6. 如果本文件后续段落仍出现“保留现有能力”的表述，解释为“可复用技术栈或业务认知”，不是保留旧代码路径或旧外部契约。

> 项目：`lark-x/GamesMcp`  
> 目标：将当前“原神叙事知识平台”重构为 **共享 Game Data Core 的双产品架构**：
>
> 1. **Game Codex（游戏智库）**：面向用户浏览游戏内结构化数据与文本资料。
> 2. **Game MCP**：面向 LLM / Agent 提供低 Token、强类型、可检索、可引用的游戏知识服务。
>
> 核心原则：**一份底层数据、一套版本系统、一套索引体系、两个独立 Read Model。**

---

## 0. Agent 执行总要求

本计划用于直接交给编码 Agent 执行。执行过程中遵守以下约束：

1. **允许直接覆盖现有项目，不保留当前实现的兼容边界。**
   - 保留 pnpm Monorepo。
   - 保留 PostgreSQL、Drizzle、Fastify、React/Vite、MCP SDK。
   - 保留现有 Source Snapshot / Revision / Manifest / Current Revision / Backup 基础能力。
   - 保留现有 AnimeGameData Quest Converter 中已验证有效的任务结构化逻辑。

2. **停止继续扩大 Generic Knowledge Platform 的复杂度。**
   - 暂停新增复杂 Candidate 审核规则。
   - 暂停新增新的人工 Screenshot Gate。
   - 暂停继续扩展通用 `Entity / Document / Claim / Relationship` 以承载所有游戏数据。
   - 这些能力保留，但不再作为所有新业务数据的唯一建模方式。

3. **优先构建 Genshin-specific Domain Model。**
   - 角色、武器、圣遗物、材料、敌人、成就等必须有明确结构化表。
   - 文本型数据继续使用 Document/Segment 能力。
   - 两类数据通过稳定 ID / Binding 关联。

4. **Web 与 MCP 不直接读取 AnimeGameData 原始文件。**
   - AnimeGameData 只进入 ingestion / ETL。
   - Web 和 MCP 只读取 Canonical Database / Read Model。

5. **所有阶段必须可独立验收。**
   - 每个 Phase 完成后必须：
     - `pnpm format:check`
     - `pnpm lint`
     - `pnpm typecheck`
     - `pnpm test`
     - `pnpm build`
   - 涉及 Web 页面时增加：
     - `pnpm test:e2e`
   - 涉及数据库迁移时增加 disposable database 测试。
   - 涉及 MCP 时必须增加真实 MCP tool contract 测试。

6. **禁止继续制造超大文件。**
   - 当前 `repository.ts`、`App.tsx`、`styles.css` 等已经过大。
   - 新增或重构后：
     - 单个业务 service 建议 `< 600` 行。
     - 单个 React 页面建议 `< 400` 行。
     - 单个数据库 repository 建议 `< 500` 行。
   - 超过后必须拆分。

---

# 1. 产品重新定义

## 1.1 项目定位

将项目从：

> Evidence-first narrative knowledge platform for Genshin Impact

调整为：

> **Game Intelligence Platform — 游戏智库与 AI 游戏知识服务平台**

当前阶段仅完整支持：

```text
genshin-impact
```

未来允许扩展：

```text
star-rail
zzz
other games
```

但本次重构**不要为了未来游戏强行抽象掉原神领域模型**。

---

## 1.2 两个产品，一个 Data Core

```text
                        ┌────────────────────┐
                        │   AnimeGameData    │
                        │   Other Sources    │
                        └─────────┬──────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │      Game Data Core     │
                     │                         │
                     │ Snapshot / ETL / DB     │
                     │ Revision / Search       │
                     │ Provenance / Index      │
                     └────────────┬────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │    Game Codex    │        │     Game MCP     │
          │    Web / API     │        │ MCP Server / AI  │
          └──────────────────┘        └──────────────────┘
```

### Game Codex

面向人类用户：

- 浏览角色
- 浏览武器
- 浏览圣遗物
- 浏览材料
- 浏览敌人
- 浏览成就
- 浏览任务
- 阅读任务对话
- 阅读书籍
- 阅读角色故事
- 阅读物品描述
- 搜索游戏文本
- 查看来源和游戏版本

### Game MCP

面向模型：

- 角色结构化查询
- 武器结构化查询
- 材料用途反查
- 敌人掉落查询
- 成就查询
- 任务搜索
- 对话搜索
- Lore 搜索
- 证据型文本读取
- Entity Alias Resolve
- 低 Token 按 section 返回

---

# 2. 当前技术栈与覆盖式重构技术选型

## 2.1 保留技术栈

基于当前仓库继续使用：

### Runtime / Monorepo

- Node.js 22+
- TypeScript
- pnpm Workspace
- ESM
- `tsx` 用于开发脚本

### Web

- React 19
- Vite
- React Router
- TanStack Query

### API

- Fastify
- Zod

### Database

- PostgreSQL 16
- pgvector
- Drizzle ORM / Drizzle Kit
- `pg`

### MCP

- `@modelcontextprotocol/sdk`
- Zod

### Testing

- Vitest
- Playwright

### Deployment

- Docker Compose
- PostgreSQL 独立持久化
- API / Worker / Web 容器

---

## 2.2 建议新增前端依赖

不换 React，不换 Vite。

建议新增：

```text
Tailwind CSS
shadcn/ui
Radix UI primitives（通过 shadcn/ui）
Lucide React
@tanstack/react-virtual
cmdk
```

用途：

- `Tailwind CSS`：替代当前巨大 `styles.css` 的主要页面样式维护方式。
- `shadcn/ui`：Dialog、Dropdown、Tabs、Tooltip、Sheet、Command、Skeleton、Table 等基础组件。
- `Lucide React`：统一图标体系。
- `@tanstack/react-virtual`：长任务对话、成就、材料列表虚拟化。
- `cmdk`：全局 Command Palette / 快速搜索。

**不要引入重量级完整 UI Framework。**

---

## 2.3 搜索技术

### 结构化数据

只使用：

- Stable Entity Resolver
- SQL
- PostgreSQL indexes

**不使用向量搜索。**

### 文本数据

分层检索：

```text
Exact / Alias
      +
PostgreSQL FTS
      +
pg_trgm
      +
Optional pgvector
      ↓
Reciprocal Rank Fusion
      ↓
Optional Rerank
```

第一阶段可以先实现：

```text
Exact + FTS + pg_trgm
```

随后再接 pgvector。

---

# 3. 覆盖式重构总体架构

```text
GamesMcp
│
├── apps
│   ├── web                 # Game Codex
│   ├── api                 # Web REST API
│   ├── mcp-server          # Game MCP
│   └── worker              # import/index jobs
│
├── packages
│   ├── config
│   ├── contracts
│   │
│   ├── database
│   │   ├── core
│   │   ├── genshin
│   │   ├── knowledge
│   │   └── revision
│   │
│   ├── genshin-domain      # NEW
│   │   ├── character
│   │   ├── weapon
│   │   ├── artifact
│   │   ├── material
│   │   ├── enemy
│   │   ├── achievement
│   │   ├── quest
│   │   └── lore
│   │
│   ├── ingestion
│   │   └── anime-game-data
│   │
│   ├── search              # NEW / replace retrieval naming gradually
│   ├── knowledge
│   ├── qa
│   └── mcp-tools           # NEW
│
├── scripts
├── data
└── docs
```

---

# 4. 数据分层设计

必须明确区分四层。

## 4.1 Raw Source Layer

位置：

```text
DATA_DIR/upstream/
DATA_DIR/snapshots/
```

职责：

- 保存固定 AnimeGameData Commit。
- 保存 Git commit、commit date、game version。
- 保存输入文件 Hash。
- Web/MCP 不允许直接读取。

继续使用不可变 Source Snapshot。

---

## 4.2 Canonical Game Data Layer

这是 覆盖式重构 最重要的新层。

负责把 AnimeGameData 转换为“游戏领域数据”。

### 第一批必须支持

```text
characters
character_stats
character_skills
character_skill_levels
character_constellations
character_passives
character_ascensions
character_talent_costs

weapons
weapon_stats
weapon_affixes
weapon_ascensions

artifact_sets
artifact_set_effects

materials
material_sources
material_usages

enemies
enemy_drops

achievements
achievement_groups

quests
quest_subquests
quest_dialogue_nodes
quest_dialogue_edges

books
character_stories
voice_lines
item_descriptions
```

---

## 4.3 Knowledge/Text Layer

保留现有：

```text
documents
document_segments
entities
entity_aliases
entity_mentions
relationships
claims
evidence
```

但重新定义职责：

### 应该进入 Knowledge Layer

- 任务文本
- 对话
- 书籍
- 角色故事
- 语音
- 物品描述
- Lore
- 可引用文本证据

### 不应该只存在于 Knowledge Layer

- 角色基础属性
- 技能倍率
- 武器数值
- 圣遗物套装属性
- 突破材料
- 成就 ID / 奖励
- 怪物掉落

这些必须在 Canonical Game Data 中有结构化表示。

---

## 4.4 Read Model Layer

Web 和 MCP 使用不同 read model。

### Web Read Model

目标：

- 信息完整
- 分页友好
- 支持图形化展示
- 支持排序/过滤
- 支持相关数据链接

例如：

```ts
CharacterCodexView;
QuestReaderView;
AchievementListView;
MaterialDetailView;
```

### MCP Read Model

目标：

- 一次调用回答一个明确问题
- 小 Payload
- 强类型
- section 裁剪
- 适合 Token
- 附 provenance / revision

例如：

```ts
McpCharacterView;
McpWeaponView;
McpLoreEvidenceView;
```

---

# 5. 数据库覆盖式重建设计

## 5.1 Schema Namespace

建议继续 PostgreSQL schema 分区：

```text
platform.*
revision.*
genshin.*
knowledge.*
search.*
```

如果现有表位于 `knowledge`，不要求立即搬迁。

---

## 5.2 Character

### `genshin.characters`

建议字段：

```sql
id                    bigint / integer upstream id
game_id               uuid
source_key             text
name                   text
name_hash              text
rarity                 smallint
element                text
weapon_type            text
body_type              text
icon_key               text
release_version        text
revision_id            uuid
metadata               jsonb
```

唯一约束：

```text
(game_id, upstream_id, revision_id)
(source_key, revision_id)
```

### `genshin.character_stats`

```text
character_id
level
ascension
hp
atk
def
special_stat_type
special_stat_value
revision_id
```

### `genshin.character_skills`

```text
id
character_id
skill_kind
name
description
icon_key
energy_cost
cooldown
revision_id
metadata
```

`skill_kind`：

```text
normal
elemental_skill
elemental_burst
alternate_sprint
passive
other
```

### `genshin.character_skill_levels`

```text
skill_id
level
parameter_key
parameter_label
value
raw_value
revision_id
```

不要只保存拼好的文本。

必须允许：

```text
角色 + 技能 + level = 10
```

直接查询倍率。

### `genshin.character_constellations`

```text
character_id
constellation_index
name
description
icon_key
revision_id
```

### `genshin.character_ascensions`

```text
character_id
ascension_stage
target_level
material_id
quantity
revision_id
```

### `genshin.character_talent_costs`

```text
character_id
talent_level_from
talent_level_to
material_id
quantity
mora
revision_id
```

---

# 6. Weapon

## `genshin.weapons`

```text
id
name
weapon_type
rarity
description
passive_name
release_version
revision_id
```

## `genshin.weapon_stats`

```text
weapon_id
level
ascension
base_atk
secondary_stat_type
secondary_stat_value
revision_id
```

## `genshin.weapon_affixes`

```text
weapon_id
refinement
name
description
revision_id
```

## `genshin.weapon_ascensions`

```text
weapon_id
ascension_stage
material_id
quantity
revision_id
```

---

# 7. Artifact

## `genshin.artifact_sets`

```text
id
name
max_rarity
domain_or_source
revision_id
```

## `genshin.artifact_set_effects`

```text
artifact_set_id
piece_count
description
revision_id
```

首版只要求：

```text
2-piece
4-piece
```

不要首阶段解析每件圣遗物的随机词条机制。

---

# 8. Material

## `genshin.materials`

```text
id
name
rarity
material_type
description
icon_key
revision_id
```

## `genshin.material_usages`

反向关系表。

```text
material_id
target_type
target_id
usage_type
quantity
revision_id
```

支持 MCP：

> 霓裳花有哪些角色需要？

无需文本搜索。

## `genshin.material_sources`

```text
material_id
source_type
source_id
description
revision_id
```

---

# 9. Enemy

## `genshin.enemies`

```text
id
name
enemy_type
category
description
revision_id
```

## `genshin.enemy_drops`

```text
enemy_id
material_id
min_world_level
revision_id
```

首版不要做复杂战斗模拟。

---

# 10. Achievement

## `genshin.achievement_groups`

```text
id
name
order_index
revision_id
```

## `genshin.achievements`

```text
id
group_id
name
description
reward_primogems
hidden
progress
revision_id
```

要求支持：

```text
按名称搜索
按描述搜索
hidden 筛选
group 筛选
reward 筛选
```

---

# 11. Quest / Dialogue

保留现有 Quest Converter 的有效实现。

当前结构可以继续使用：

```text
quest_subquests
quest_dialogue_nodes
quest_dialogue_edges
document_segments
```

覆盖式重构 重点是围绕新目标覆盖式重建，旧实现只作为参考：

1. Quest Title Resolution。
2. Speaker Entity Binding。
3. Dialogue Search。
4. Quest Type / Chapter / Series。
5. Locale。
6. Completeness。
7. Pagination。
8. 对话文本全文索引。

新增：

```text
search_dialogue_documents / materialized search representation
```

不要让 MCP 每次先 `get_quest` 后在几十 KB 文本中自行找。

---

# 12. Books / Character Story / Voice / Item Text

保留当前 AnimeGameData 文本转换能力，但拆分 Extractor。

建议：

```text
packages/ingestion/src/anime-game-data/
├── source.ts
├── text-map.ts
├── character-extractor.ts
├── weapon-extractor.ts
├── artifact-extractor.ts
├── material-extractor.ts
├── enemy-extractor.ts
├── achievement-extractor.ts
├── quest-extractor.ts
├── book-extractor.ts
├── character-story-extractor.ts
├── voice-extractor.ts
├── item-description-extractor.ts
└── manifest.ts
```

不要继续出现新的 30k~40k 行等价单文件 converter。

---

# 13. AnimeGameData ETL 原则

## 13.1 Extraction

每个 Extractor：

```ts
interface AnimeExtractor<T> {
  id: string;
  version: string;
  requiredInputs: string[];
  extract(context: AnimeContext): Promise<ExtractionResult<T>>;
}
```

输出：

```ts
type ExtractionResult<T> = {
  records: T[];
  warnings: ExtractionWarning[];
  failures: ExtractionFailure[];
  stats: ExtractionStats;
};
```

---

## 13.2 Stable Identity

优先使用 AnimeGameData 内部稳定数字 ID。

不要使用角色名称作为主键。

数据库：

```text
upstream_id
source_key
canonical_id
```

名称只是可变字段。

---

## 13.3 TextMap

建立统一：

```ts
TextResolver;
```

接口：

```ts
resolve(hash, locale);
tryResolve(hash, locale);
resolveWithFallback(hash, preferredLocales);
```

所有 Extractor 禁止各写一套 TextMap 解析。

---

## 13.4 Provenance

每条 Canonical Record 至少保留：

```text
upstream source
commit
game version
source file
upstream id
parser version
revision id
```

对于文本：

```text
TextMap hash
source file hash
```

已有 lineage 能力可复用。

---

# 14. Entity Binding

建立：

## `knowledge.entity_bindings`

```text
entity_id
target_type
target_id
revision_id
confidence
binding_source
```

例如：

```text
entity = 摩拉克斯
target_type = character
target_id = 钟离 character id
```

Alias：

```text
钟离
摩拉克斯
岩王帝君
岩神
Rex Lapis
Zhongli
Morax
```

统一进入 Entity Resolver。

---

# 15. Entity Resolver

新增：

```text
packages/search/src/entity-resolver.ts
```

查询优先级：

```text
1. exact canonical name
2. exact alias
3. normalized name
4. prefix
5. pg_trgm
```

返回：

```json
{
  "entityType": "character",
  "id": 10000030,
  "canonicalName": "钟离",
  "matchedBy": "alias",
  "matchedText": "摩拉克斯",
  "confidence": 1
}
```

对于强歧义：

```text
旅行者
空
荧
```

允许返回候选，而不是随机选择。

---

# 16. Search Core

新增：

```text
packages/search
```

逐步替代现在过于笼统的 `retrieval`。

## 16.1 API

```ts
SearchService.searchText();
SearchService.searchDialogue();
SearchService.searchQuest();
SearchService.searchLore();
SearchService.resolveEntity();
```

---

## 16.2 文本索引

PostgreSQL：

```text
tsvector
GIN
pg_trgm
```

对以下字段建立全文索引：

```text
documents.title
documents.body
document_segments.body
quest dialogue body
speaker name
achievement name
achievement description
```

---

## 16.3 Ranking

不要使用“查询字符重合比例”作为主要评分。

第一版：

```text
exact title                  10
exact alias                   9
title prefix                  8
FTS rank                      6
trigram title                 5
body FTS                      4
body trigram                  2
```

剧情对话额外：

```text
speaker exact                 +3
quest title match             +2
important quest type          +1
```

---

## 16.4 Semantic Search

作为 Phase 2B，而不是结构化事实查询基础。

使用现有 pgvector。

流程：

```text
lexical top 30
semantic top 30
      ↓
RRF
      ↓
top 10
```

Embedding 不可用时必须可正常退化。

---

# 17. Game Codex 前端信息架构

## 17.1 Desktop 总布局

采用：

```text
┌─────────────────────────────────────────────────────────────────┐
│ Top Header                                                      │
│ Logo | Game | Global Search | Version | Theme | Settings       │
├───────────────┬─────────────────────────────────────────────────┤
│ Sidebar       │ Main Content                                    │
│               │                                                 │
│ 首页          │                                                 │
│ 角色          │                                                 │
│ 武器          │                                                 │
│ 圣遗物        │                                                 │
│ 材料          │                                                 │
│ 敌人          │                                                 │
│ 成就          │                                                 │
│ 任务          │                                                 │
│ 文本资料      │                                                 │
│ 搜索          │                                                 │
│               │                                                 │
│ ─────────     │                                                 │
│ 数据版本      │                                                 │
│ 数据来源      │                                                 │
│ 管理          │                                                 │
└───────────────┴─────────────────────────────────────────────────┘
```

### Header

高度约：

```text
56px
```

包含：

- Product Logo / GamesMcp
- 当前游戏：原神
- 全局搜索
- 数据版本
- Dark/Light
- 设置

### Sidebar

桌面：

```text
240px
```

允许折叠到：

```text
64px
```

不要把管理功能和用户浏览功能混成同一一级菜单。

---

# 18. 首页布局

首页不是管理 Dashboard。

面向普通用户：

```text
┌────────────────────────────────────────────┐
│ 原神游戏智库                               │
│ 搜索游戏内角色、剧情、书籍、成就……        │
│ [                 Search                 ] │
├────────────────────────────────────────────┤
│ 快速入口                                   │
│ 角色 | 武器 | 圣遗物 | 材料 | 成就 | 任务 │
├────────────────────────────────────────────┤
│ 数据概览                                   │
│ 角色 xxx  武器 xxx  成就 xxx  任务 xxx    │
├────────────────────────────────────────────┤
│ 最近版本内容 / 数据版本                     │
├────────────────────────────────────────────┤
│ 热门文本入口                               │
│ 魔神任务 | 书籍 | 角色故事 | 世界观       │
└────────────────────────────────────────────┘
```

---

# 19. 角色列表页

Route：

```text
/characters
```

布局：

```text
标题：角色

[搜索] [元素] [武器类型] [星级] [版本] [排序]

角色 Card Grid

┌─────┐ ┌─────┐ ┌─────┐
│头像 │ │头像 │ │头像 │
│胡桃 │ │夜兰 │ │钟离 │
│火 5★│ │水 5★│ │岩 5★│
└─────┘ └─────┘ └─────┘
```

Desktop：

```text
5~6 columns
```

Tablet：

```text
3~4
```

Mobile：

```text
2
```

---

# 20. 角色详情页

Route：

```text
/characters/:idOrSlug
```

顶部：

```text
┌───────────────────────────────────────────┐
│ Portrait │ 胡桃                           │
│          │ ★★★★★ 火 / 长柄武器           │
│          │ ID / 版本 / Source             │
└───────────────────────────────────────────┘
```

Tabs：

```text
概览
属性
技能
命座
突破
培养
故事
语音
相关任务
来源
```

### 概览

展示：

- 基础信息
- Lv.90 基础属性
- 简介
- 所需突破核心材料摘要

### 属性

表格：

```text
Lv | Ascension | HP | ATK | DEF | Bonus
```

### 技能

每个技能：

```text
技能名称
技能描述
CD / Energy
Lv.1 ~ Lv.15 参数表
```

倍率表默认折叠，避免页面过长。

### 突破

Timeline：

```text
20 → 40 → 50 → 60 → 70 → 80 → 90
```

材料可点击进入 Material 页面。

### 故事 / 语音

使用文档阅读器组件，不和结构化信息混在一个超长页面。

---

# 21. 武器详情页

Tabs：

```text
概览
属性曲线
被动
精炼
突破
使用材料
来源
```

支持：

```text
90级基础攻击
副属性
R1~R5 文本对比
```

---

# 22. 圣遗物页面

列表：

```text
套装名
最高星级
2件套
4件套
来源
```

详情：

```text
套装概览
2件效果
4件效果
获取来源
相关文本
```

首阶段不要加入复杂的“最佳角色推荐”，因为那是攻略层而不是游戏事实层。

---

# 23. 材料页面

这是智库中非常重要的一页。

详情：

```text
材料名称
类型
稀有度
描述

获取来源

用于：
  角色突破
  武器突破
  天赋升级
```

形成双向导航：

```text
角色 → 材料
材料 → 角色
```

---

# 24. 成就页面

Route：

```text
/achievements
```

推荐布局：

```text
左侧 Achievement Group
右侧 Achievement List
```

顶部 Filter：

```text
搜索
隐藏成就
原石奖励
完成次数
```

列表行：

```text
名称
描述
奖励
隐藏状态
所属分类
```

大量数据使用 virtualization。

---

# 25. Quest Browser

Route：

```text
/quests
```

左侧：

```text
任务分类
├─ 魔神任务
├─ 传说任务
├─ 世界任务
└─ 活动任务
```

主区：

```text
任务系列
章节
任务标题
完整度
版本
```

---

# 26. Quest Reader

Route：

```text
/quests/:questKey
```

采用“三栏/双栏自适应”。

Desktop：

```text
┌─────────────┬────────────────────────────┬────────────┐
│ 子任务目录   │ Dialogue Reader            │ Metadata   │
│             │                            │            │
│ 第一阶段     │ 派蒙                      │ 参与角色   │
│ 第二阶段     │ “……”                      │ 版本       │
│ ...         │                            │ 来源       │
│             │ 旅行者                     │ 完整度     │
│             │ > 选项 A                   │            │
│             │ > 选项 B                   │            │
└─────────────┴────────────────────────────┴────────────┘
```

中间对话：

- NPC 名字突出
- 玩家选项单独 Card
- 支持复制单句
- 支持生成 Deep Link 到具体 Dialogue Node
- 支持“仅显示某角色”
- 支持当前任务内搜索

右侧 metadata 可折叠。

---

# 27. Book / Lore Reader

统一 Reader Shell：

```text
/archives/books
/archives/character-stories
/archives/item-descriptions
/archives/voices
```

布局：

```text
左：目录/对象列表
中：正文
右：来源 / 关联实体 / 游戏版本
```

正文宽度：

```text
680~820px
```

不要让阅读正文占满 1440px 屏幕。

---

# 28. 全局搜索页

Route：

```text
/search?q=
```

搜索结果分类：

```text
全部
角色
武器
圣遗物
材料
成就
任务
对话
书籍
角色故事
物品文本
```

每条结果显示：

```text
type icon
title
breadcrumb
snippet
source
version
```

搜索页与 MCP Search Core 共用 backend search service。

---

# 29. Mobile Layout

移动端：

- Sidebar → Bottom / Drawer Navigation。
- Header 保留 Search 按钮。
- Detail Page Tabs 支持横向滚动。
- Quest Reader：
  - 子任务目录变 Sheet。
  - metadata 变 Bottom Sheet。
- 不保留三栏布局。
- Card Grid 2 列。
- 长文本正文 padding 16px。

---

# 30. 管理功能重新收口

管理功能 Route：

```text
/admin/*
```

侧边栏普通用户区域只保留一个：

```text
管理
```

进入后才显示：

```text
数据导入
预发布
版本
问题
来源
系统状态
```

不要把管理工作流占据普通“游戏智库”的信息架构。

---

# 31. API

建议增加：

```text
/api/games/genshin-impact/...
```

内部仍可使用 UUID，但外部 API 不要求用户传 UUID。

---

## 31.1 Character

```http
GET /api/genshin/characters
GET /api/genshin/characters/:id
GET /api/genshin/characters/:id/stats
GET /api/genshin/characters/:id/skills
GET /api/genshin/characters/:id/ascension
GET /api/genshin/characters/:id/stories
```

---

## 31.2 Weapon

```text
GET /weapons
GET /weapons/:id
GET /weapons/:id/stats
GET /weapons/:id/refinements
GET /weapons/:id/ascension
```

---

## 31.3 Other

```text
GET /artifacts
GET /artifacts/:id

GET /materials
GET /materials/:id

GET /enemies
GET /enemies/:id

GET /achievements
GET /achievements/:id

GET /quests
GET /quests/:questKey
GET /quests/:questKey/dialogues

GET /search
```

---

# 32. MCP Tool 设计

## 32.1 原则

1. 不要求 LLM 传内部 UUID。
2. 工具名面向游戏语义。
3. 一次调用尽量能回答一个问题。
4. 默认小 Payload。
5. 支持 `sections`。
6. 返回 `revision` 与 `source`。
7. 不返回无用后台状态字段。

---

## 32.2 核心工具

第一阶段：

```text
get_character
get_weapon
get_artifact
get_material
get_enemy
get_achievement

search_quests
get_quest

search_dialogue
search_lore

resolve_entity
```

MCP Server 可以保留：

```text
get_game_capabilities
```

但不要强迫每次调用先 `list_games`。

---

# 33. MCP `get_character`

Input：

```json
{
  "name": "胡桃",
  "sections": ["summary", "ascension"]
}
```

Sections：

```text
summary
stats
skills
constellations
ascension
talent_costs
stories
voice
related_quests
```

Output：

```json
{
  "character": {
    "id": 10000046,
    "name": "胡桃",
    "rarity": 5,
    "element": "Pyro",
    "weaponType": "Polearm",
    "ascension": []
  },
  "revision": "r12"
}
```

如果没有传 `sections`：

默认：

```text
summary
```

禁止默认返回完整角色所有数据。

---

# 34. MCP `get_material`

必须支持反查：

```json
{
  "name": "霓裳花",
  "sections": ["usage", "sources"]
}
```

让模型一次得到：

```text
谁需要
需要多少
哪里获取
```

---

# 35. MCP Search Tools

## `search_dialogue`

Input：

```text
query
speaker?
quest_type?
quest?
locale?
limit?
```

Output 每项：

```text
quest
subquest
speaker
text
dialogueNodeKey
citation
score
```

---

## `search_lore`

只针对：

```text
book
character_story
voice
item_description
lore
```

不要混入角色属性数据。

---

# 36. MCP Token 控制

建立统一：

```ts
McpResponseBudget;
```

默认限制：

```text
Structured result: 8~20 KB
Search result: 5~10 items
Text excerpt: 300~800 chars/item
```

允许：

```text
limit
sections
cursor
max_chars
```

禁止返回：

```text
整个角色全部技能等级表
整个任务全部 5 万节点
整个书库原文
```

---

# 37. MCP Tool Call KPI

覆盖式重构 必须测试以下指标：

| 问题                 | 目标 Tool Calls |
| -------------------- | --------------: |
| 胡桃是什么元素       |               1 |
| 胡桃突破需要什么     |               1 |
| 胡桃天赋 9→10 材料   |               1 |
| 护摩 90 级基础攻击   |               1 |
| 绝缘四件效果         |               1 |
| 霓裳花谁需要         |               1 |
| 某成就是什么         |               1 |
| 某一句是谁说的       |             1~2 |
| 某剧情观点有哪些证据 |              ≤2 |

平均结构化问题：

```text
≤ 1.2 MCP calls
```

---

# 38. Golden Question Dataset

新增：

```text
data/evaluation/genshin/
```

至少：

```text
100 structured questions
100 textual/lore questions
50 dialogue questions
30 ambiguous entity questions
```

字段：

```json
{
  "id": "...",
  "question": "...",
  "category": "character_fact",
  "expectedTool": "get_character",
  "expectedEntity": "胡桃",
  "expectedSections": ["ascension"],
  "requiredFacts": [],
  "maxToolCalls": 1
}
```

---

# 39. 评测指标

## Structured

```text
Entity Resolution Accuracy >= 99%
Fact Accuracy >= 99%
Required Field Coverage >= 98%
```

## Search

```text
MRR@10
Recall@10
NDCG@10
```

## Dialogue

```text
Correct Quest Recall
Correct Speaker Recall
Correct Node Recall
```

## MCP

```text
Average Tool Calls
P95 Tool Calls
Average JSON bytes
P95 latency
```

---

# 40. Repository 拆分

当前大型 Database Repository 必须拆。

建议：

```text
packages/database/src/repositories/

platform/
  game.repository.ts
  source.repository.ts
  revision.repository.ts

genshin/
  character.repository.ts
  weapon.repository.ts
  artifact.repository.ts
  material.repository.ts
  enemy.repository.ts
  achievement.repository.ts
  quest.repository.ts

knowledge/
  document.repository.ts
  entity.repository.ts
  claim.repository.ts

search/
  search.repository.ts
```

外层：

```text
KnowledgeRepository
GenshinRepository
RevisionRepository
SearchRepository
```

不要继续让一个 class 包含导入、冲突、搜索、quest、entity、版本、backup 等所有职责。

---

# 41. Web 代码拆分

当前 `App.tsx` 不再继续增加功能。

建议：

```text
apps/web/src/

app/
  router.tsx
  query-client.ts
  layout/

features/
  home/
  characters/
  weapons/
  artifacts/
  materials/
  enemies/
  achievements/
  quests/
  archives/
  search/
  admin/

components/
  entity/
  reader/
  filters/
  data-table/
  source/
```

---

# 42. API 代码拆分

```text
apps/api/src/

routes/
  health.ts
  games.ts
  characters.ts
  weapons.ts
  artifacts.ts
  materials.ts
  enemies.ts
  achievements.ts
  quests.ts
  search.ts
  admin/

services/
middleware/
schemas/
```

Fastify Route 仅负责：

```text
validate
call service
serialize
```

不要写大型业务 SQL。

---

# 43. MCP 代码拆分

```text
apps/mcp-server/src/

server.ts
tools/
  character.ts
  weapon.ts
  artifact.ts
  material.ts
  enemy.ts
  achievement.ts
  quest.ts
  dialogue.ts
  lore.ts
  entity.ts

serializers/
response-budget.ts
errors.ts
```

Tool Handler 不直接写 SQL。

---

# 44. Phase 0 — 建立 覆盖式重构 基线

目标：

不改行为，先为重构创造安全边界。

任务：

- 新建 `docs/game-intelligence/`。
- 将本文加入仓库。
- 记录当前 migration。
- 导出现有 current revision。
- 保存当前 Quest 数据量。
- 执行完整 test/build。
- 建立 覆盖式重构 feature flag：

```text
GIP_OVERWRITE_REBUILD_ENABLED_IS_NOT_USED
```

验收：

```text
existing app behavior unchanged
all tests green
```

---

# 45. Phase 1 — 目录与 Repository 解耦

目标：

先解决代码结构问题。

任务：

- 拆 `repository.ts`。
- 拆 API routes。
- 拆 Web App.tsx。
- 不改变数据库 Schema。
- 不改变外部 API。

验收：

```text
same API contracts
same MCP contracts
same E2E behavior
```

---

# 46. Phase 2 — Genshin Domain Schema

按顺序实现：

```text
Character
Weapon
Artifact
Material
Achievement
Enemy
```

本阶段只完成 migration + repository + contracts。

不要做 Web。

验收：

- migration up/down disposable DB。
- CRUD/read tests。
- revision scoped read tests。

---

# 47. Phase 3 — AnimeGameData Structured ETL

优先级：

## P0

```text
Character
Weapon
Artifact
Material
Achievement
```

## P1

```text
Enemy
Voice
```

## P2

其他内容。

每个 extractor：

- Fixture。
- Real snapshot dry-run。
- Stats report。
- Field coverage report。
- Stable ID test。
- Deterministic output test。

输出：

```text
data/imports/normalized/anime-game-data/<commit>/
```

---

# 48. Phase 4 — Import / Revision Integration

将 Structured Records 接入现有 Snapshot / Revision。

要求：

```text
Source Snapshot
→ Import
→ Candidate/Build
→ Revision
```

可以继续使用现有 revision lifecycle。

但是 Canonical 数据 Materialization 必须和 Revision 原子绑定。

发布失败：

```text
current revision unchanged
```

---

# 49. Phase 5 — Game Codex API

实现 `/api/genshin/*`。

先支持：

```text
characters
weapons
artifacts
materials
achievements
quests
search
```

建立 OpenAPI-like contract tests，即使不生成 OpenAPI 文件也必须有 Zod response schema。

---

# 50. Phase 6 — Game Codex Web Shell

先完成 Layout，不填完整内容。

交付：

- Header
- Sidebar
- Mobile drawer
- Search
- Version Switch
- Theme
- Skeleton
- Error Boundary
- Empty State

然后替换当前页面。

---

# 51. Phase 7 — Web Data Pages

执行顺序：

```text
Characters
Materials
Weapons
Artifacts
Achievements
Quests
Archives
Global Search
```

原因：

Character/Material 可以最早验证“结构化关系”。

---

# 52. Phase 8 — Quest Reader

复用当前 Quest 数据。

重点：

- 对话分页
- Virtualization
- speaker filter
- node deep link
- citation copy
- mobile sheet
- current quest search

---

# 53. Phase 9 — Search

步骤：

1. Entity Resolver。
2. PostgreSQL FTS。
3. pg_trgm。
4. ranking。
5. evaluation。
6. 需要时才启用 pgvector。
7. RRF。

此阶段完成后废弃旧 `lexicalScore()` 主导逻辑。

---

# 54. Phase 10 — MCP

先并存：

```text
old tools
new game-intelligence tools
```

新工具稳定后：

- old tools 标记 deprecated。
- 保留一个版本周期。
- 再删除。

MCP 不依赖 Web API HTTP round-trip。

推荐：

```text
MCP → Domain Service → Repository
```

与 API 共用 Service。

不要：

```text
MCP → HTTP API → Database
```

本地部署没有必要多一跳。

---

# 55. Phase 11 — QA / Evidence Integration

现有 Evidence QA 继续服务 Lore。

新增：

```text
FactAnswerService
```

规则：

```text
结构化问题 → structured fact
Lore 问题 → evidence retrieval
混合问题 → structured + evidence
```

不要让角色基础事实经过 LLM RAG 才得到。

---

# 56. Phase 12 — 管理后台收尾

待核心产品可用后再整理：

```text
Import
Pre-release
Revision
Issue
Source
System
```

删除重复页面与重复说明。

把复杂流程文档从普通用户界面移出。

---

# 57. Phase 13 — 性能

目标：

## API

```text
Structured single entity P95 < 100ms
List P95 < 200ms
Lexical search P95 < 300ms
```

本地机器环境允许适度放宽，但必须建立 benchmark。

## MCP

```text
Structured Tool P95 < 200ms
Search Tool P95 < 500ms excluding embedding provider
```

---

# 58. Index 设计

重点：

```sql
characters(normalized_name)
weapons(normalized_name)
materials(normalized_name)
achievements(normalized_name)

GIN tsvector documents
GIN tsvector dialogue
GIN trigram title/name
```

必须使用 `EXPLAIN ANALYZE` 检查主要查询。

---

# 59. Cache

第一版：

**不要引入 Redis。**

使用：

- DB index
- process-local LRU
- HTTP cache headers
- TanStack Query cache

只有未来：

```text
multiple API replicas
dynamic external APIs
Enka
HoYoLAB
```

才考虑 Redis。

---

# 60. 图片资源策略

AnimeGameData 的文本/数据和图片分开处理。

Database 只保存：

```text
asset_key
source
hash
relative path
```

图片文件：

```text
DATA_DIR/assets/
```

Web 通过：

```text
/api/assets/*
```

或者静态资源服务读取。

**不要把图片 bytea 塞 PostgreSQL。**

---

# 61. 未来数据源接口

本次只重点实现 AnimeGameData。

预留：

```ts
interface GameDataSourceAdapter {
  sourceId: string;
  acquire(): Promise<SourceSnapshot>;
  extract(): Promise<NormalizedDataset>;
}
```

未来：

```text
AnimeGameData → Fact
KQM → Guide
Enka → Player
Official News → Event
Map Source → POI
```

但本次禁止提前实现这些以免扩大范围。

---

# 62. 数据源优先级

当前：

```text
AnimeGameData
= Primary Fact Source

genshin-db
= Secondary / Cross-check / temporary gap filler
```

当 AnimeGameData Structured Extractor 对某领域达到可接受 coverage 后：

```text
该领域 genshin-db 不再作为 primary published data
```

不要一次删除 genshin-db。

采用逐领域迁移：

```text
characters → anime
weapons → anime
artifacts → anime
materials → anime
...
```

---

# 63. Migration 策略

本次允许覆盖式重建，但必须先登记边界、保留上游原始数据，并按阶段验收。

步骤：

```text
Old DB + New Tables
         ↓
Dual Read Validation
         ↓
覆盖式重构 API
         ↓
覆盖式重构 Web/MCP
         ↓
Metrics
         ↓
Retire old path
```

不建议 Dual Write 长期存在。

AnimeGameData 可以重新 ETL，因此新 Canonical Tables 可以由 source snapshot 重建。

---

# 64. 回滚

每一阶段都必须保证：

```text
Revision N
Revision N+1
```

可切回 N。

Canonical table records 必须带：

```text
revision_id
```

禁止“更新当前行覆盖历史”。

---

# 65. 安全边界

- 不保存 HoYoLAB Cookie。
- 不读取用户游戏安装目录作为必要条件。
- 不依赖游戏协议抓包。
- 不自动写入 AnimeGameData upstream checkout。
- Import Path 必须防 path traversal。
- API admin route 保持本地/认证边界。
- MCP 默认 read-only。

---

# 66. 文档要求

最终应新增：

```text
docs/game-intelligence/architecture.md
docs/game-intelligence/data-model.md
docs/game-intelligence/anime-game-data.md
docs/game-intelligence/search.md
docs/game-intelligence/mcp.md
docs/game-intelligence/codex-ui.md
docs/game-intelligence/migration.md
docs/game-intelligence/evaluation.md
```

---

# 67. Agent 每 Phase 提交格式

每阶段完成后输出：

```md
## Phase X Result

### Implemented

- ...

### Changed Files

- ...

### Database

- migration ...

### Tests

- command
- result

### Metrics

- ...

### Known Limitations

- ...

### Next Phase

- ...
```

不要只回复“已完成”。

---

# 68. Definition of Done — 第一里程碑

只有以下全部完成，才算 覆盖式重构 第一里程碑：

## Data

- AnimeGameData 正式成为 Character / Weapon / Artifact / Material / Achievement 主数据。
- Quest 保持可用。
- 文本资料保持可用。
- 所有数据有 revision/provenance。

## Codex

至少可稳定浏览：

```text
角色
武器
圣遗物
材料
成就
任务
任务对话
书籍
角色故事
物品描述
```

## Search

- 全局搜索可跨实体与文本。
- Dialogue Search 可定位到具体 node。
- Alias Resolver 可处理主要角色别名。

## MCP

至少：

```text
get_character
get_weapon
get_artifact
get_material
get_achievement
search_quests
get_quest
search_dialogue
search_lore
resolve_entity
```

## Quality

- 结构化 Golden Questions ≥ 100。
- Lore/Dialogue Questions ≥ 150。
- Structured fact accuracy ≥ 99%。
- 实体解析 ≥ 99%。
- MCP 结构化问题平均调用次数 ≤ 1.2。

## Engineering

- 无新的巨型单文件。
- 所有 CI 通过。
- Docker Compose 可部署。
- DB Backup/Restore 可用。
- 旧 Current Revision 可回滚。

---

# 69. 明确不在第一里程碑范围内

以下内容推迟：

```text
角色配队推荐
武器强度排名
圣遗物最佳搭配
深渊 Meta
KQM 攻略
Enka 玩家展示
HoYoLAB 登录
祈愿历史
地图 POI
实时活动
实时卡池
多人账号系统
复杂权限系统
AI 自动修改正式数据
```

这些不是 Game Data Core 第一阶段的必要条件。

---

# 70. 最终目标架构

```text
                          ┌──────────────────────┐
                          │   AnimeGameData      │
                          └──────────┬───────────┘
                                     │
                         Acquire / Snapshot
                                     │
                                     ▼
                         ┌──────────────────────┐
                         │ AnimeGameData ETL    │
                         │ Extractors           │
                         └──────────┬───────────┘
                                    │
                         Canonicalize / Bind
                                    │
                  ┌─────────────────┴─────────────────┐
                  │                                   │
                  ▼                                   ▼
        ┌──────────────────────┐           ┌─────────────────────┐
        │ Genshin Domain DB    │           │ Knowledge/Text DB   │
        │                      │           │                     │
        │ Character            │           │ Quest               │
        │ Weapon               │           │ Dialogue            │
        │ Artifact             │           │ Books               │
        │ Material             │           │ Character Story     │
        │ Enemy                │           │ Voice               │
        │ Achievement          │           │ Item Text           │
        └──────────┬───────────┘           └──────────┬──────────┘
                   │                                  │
                   └────────────────┬─────────────────┘
                                    │
                           Revision / Index
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
          ┌────────────────────┐           ┌────────────────────┐
          │ Game Codex Read    │           │ MCP Read Model     │
          │ Model              │           │                    │
          └──────────┬─────────┘           └──────────┬─────────┘
                     │                                │
                     ▼                                ▼
               React Web                         MCP Server
                     │                                │
                 Humans                             LLMs
```

---

# 71. 最关键的执行顺序

Agent 必须避免“哪里看起来旧就先改哪里”。

严格优先：

```text
1. 建立基线与拆巨型模块
2. Genshin Domain Schema
3. AnimeGameData Structured ETL
4. Revision Integration
5. API
6. Game Codex UI
7. Search
8. MCP
9. Evaluation
10. 管理后台收尾
```

其中真正决定项目成败的是：

```text
Genshin Domain Model
AnimeGameData ETL
Search Core
MCP Read Model
```

不是 Admin UI。

---

# 72. 给 Agent 的最后约束

在任何阶段，如果发现现有 Generic Entity/Document 模型无法自然表达一个结构化游戏事实：

**不要继续往 `properties JSONB` 里塞数据。**

优先判断它是否应该成为：

```text
genshin.* domain table
```

如果一个用户问题理论上可以通过确定性 SQL 得到答案：

**不要让它进入 RAG 才回答。**

如果 Web 与 MCP 需要相同事实：

**不要复制数据。**

正确模式必须始终是：

```text
One Data Core
Multiple Read Models
```

这是 GamesMcp 覆盖式重构 重构的最高优先级架构原则。
