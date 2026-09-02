# Story / Text / Mechanism Scope

> Milestone: **Story / Text / Mechanism Intelligence**
> Repo: `lark-x/GamesMcp`
> Baseline: `ce5d2a3` (Fix story text structured data mechanisms)
> Scope source: _GamesMcp Story Text Mechanism Completion Plan_ (user-provided)

## Current Milestone

Story / Text / Mechanism Intelligence: 人类剧情检索、LLM / Agent 剧情检索、游戏内文本证据查询。

## In Scope

### Quest / Dialogue

- Archon Quest, Story Quest, World Quest, Event Quest, Commission, Hangout, Sub Quest, Objective
- Dialogue, Narration, Player Choice, System Dialogue Text, Dialogue Edge
- Every dialogue node carries `questKey`, `subquestKey`, `dialogueNodeKey`, `speakerKey`, `speakerName`, `speakerEntityId`, `nodeType`, `body`, `order`, `locale`, `gameVersion`, `revision`, `source`, `provenance`

### Book / Document / Readable

- Book, Volume, Chapter, Readable, Note, Letter, Research Record, Tablet, Quest Document, World Lore, Long Item Text
- Volume / chapter / paragraph-group segmentation
- Segment citations: `documentId`, `segmentId`, `headingPath`, `revision`, `locale`

### Character Text

- Profile Description, Character Story, More About, Voice Line, About XXX, Birthday, Hobby, Thoughts
- Quest Appearance, Dialogue Appearance, Mentioned By

### Item / Material Text

- Material, Quest Item, Weapon, Artifact, Food, Gadget, Furnishing, Currency, Special Item, Collectible, Book Item
- Name, description, special description, story text, provenance

### Tutorial / Mechanism / Help

- In-game tutorials, newbie help, official mechanism explanations, elemental reaction help, gadget/gear explanations, exploration mechanics, enemy mechanics, boss tutorials, domain mechanics, system play rules
- Cooking / forging / fishing / reputation / housing system help, UI Help, Activity Rule Text
- These are _Official / In-game Game Knowledge_, **not** community guides

### Entity / Alias / Binding

- Canonical entities, aliases, entity-to-text and text-to-entity bindings
- Bindings are revision-scoped; mentions start as canonical-exact / alias-exact only

### Search / MCP / Evidence

- Exact, alias, prefix, PostgreSQL FTS, pg_trgm ranking
- Dialogue search, lore search, item search, mechanism search
- Low-token MCP tools with citations (revision, locale, source)
- Evidence QA built on the shared search core

## Out of Scope

- Community-authored content: KQM/TCL guides, tier lists, meta takes
- Any player-account data: Player UID, wish history, realtime banner, Enka-style panels

## Deferred

- Character Stat Growth, Skill Multipliers, Weapon Growth, Talent Cost Calculator, Artifact Random Stat
- Best Build, Best Team, DPS Simulator, Abyss Meta, Theater Meta
- Cross-version replay, multi-locale beyond zh-CN/en-US baseline, semantic/embedding search

## Definition of Done (milestone)

1. Main CI green with story gates included.
2. Quest / Dialogue / Book / Character Story / Voice / Item / Achievement / Tutorial / Mechanism have unified ingestion.
3. All text preserves Source / Locale / Game Version / AnimeGameData Commit / Published Revision.
4. Dialogue revision citation = 100%.
5. Entity resolver is truly revision-scoped.
6. Search never uses `includes()` as fake FTS.
7. Segment-only hits are never dropped.
8. Entity/text bidirectional bindings are queryable.
9. MCP requires no internal game UUID for normal use.
10. MCP has a unified response budget.
11. `search_dialogue` supports real dialogue filters.
12. `get_entity_texts`, `search_items`, `get_item_text`, `search_mechanics` are usable.
13. Evidence QA uses the new search core.
14. Golden >= 490 cases, run through real MCP client + server + PostgreSQL.
15. Average tool calls come from real runs.
16. Search evaluation uses a real corpus; performance tests use real story-scale data.
17. Web can read Quest / Dialogue / Book / Story / Voice / Item / Tutorial / Mechanism.
18. Candidate -> Build -> Revision -> Materialization is complete for structured and text records.
19. FIX-001 ~ FIX-025 closed or formally deferred.
20. No known incorrect data can pass tests into API/MCP.
21. Guide-capability gaps do not affect this milestone.
22. The progress ledger matches reality.
