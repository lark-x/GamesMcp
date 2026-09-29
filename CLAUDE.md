# GamesMcp — Knowledge Retrieval & MCP Tool Routing Guidelines

When querying game lore, characters, weapons, items, or quests via the GamesMcp MCP server, follow these performance and routing rules for optimal speed and minimal latency:

## 1. Tool Selection Priority (Rule of Thumb)

| User Intent | Recommended Tool | Latency | Why |
| :--- | :--- | :--- | :--- |
| **Character Info** (Talents, Stats, Constellations, Materials) | `get_character` | **~15ms** (cached: <1ms) | Direct B-Tree index lookup. 100x faster than `search`. |
| **Weapon / Light Cone** (Base stats, Lore, Ascension materials) | `get_equipment` | **~15ms** (cached: <1ms) | Direct index lookup on structured catalog. |
| **Material / Item Details** (Drop sources, Categories, Usages) | `get_material` | **~15ms** (cached: <1ms) | Direct index lookup. |
| **Monster / Boss** (Resistances, Drops, Category) | `get_enemy` | **~15ms** (cached: <1ms) | Direct index lookup. |
| **Quest Outline / Dialogue Flow** | `get_quest` | **~30ms** | Fetches tree structure, dialogue branches, and participants. |
| **Dialogue & Quote Matching** | `search` (`type: "dialogue"`) | **~150ms** | Uses GIN inverted vector index on 800k dialogue lines. |
| **Specific Text Search** | `search` (`type: "quest"` / `"item"`) | **~80ms** | Scoped single-surface inverted index scan. |
| **Open-ended / Exploratory Search** | `search` (`type: "all"`) | **~350ms** | Broad multi-corpus search across 6 surfaces. Use sparingly. |

## 2. Best Practices for MCP Callers

1. **NEVER use `search` for named entities**:
   - ❌ `search(query: "钟离突破材料")`
   - ✅ `get_character(name: "钟离")` (contains talents, ascension items, and voice lines)
   - ❌ `search(query: "护摩之杖属性")`
   - ✅ `get_equipment(name: "护摩之杖")`
   - ❌ `search(query: "霓裳花采集地点")`
   - ✅ `get_material(name: "霓裳花")`

2. **Always specify `type` when calling `search`**:
   - If searching for character spoken lines: `search(query: "欲买桂花同载酒", type: "dialogue", speaker: "钟离")`
   - If searching for quest titles: `search(query: "捕风的异乡人", type: "quest")`
   - If searching for item lore: `search(query: "神之眼", type: "item")`
   - Specifying `type` eliminates unneeded surface searches and returns in under 150ms.

3. **`game_id` is Optional**:
   - If the platform is registered with a single active game (or using default), omit `game_id` to let the platform resolve it automatically.
