# StarRail Local Provider

StarRail uses a local dataset-backed provider instead of an external Istaroth clone. This validates that GamesMcp provider contracts are game-agnostic:

```text
game=genshin  -> istaroth external MCP
game=starrail -> starrail-local local dataset
```

Primary source:

```text
https://github.com/DimbreathBot/TurnBasedGameData
```

Keep that checkout outside the GamesMcp git repository and pin it by commit:

```bash
git clone https://github.com/DimbreathBot/TurnBasedGameData /data/games/starrail/turn-based-game-data/<commit>
git -C /data/games/starrail/turn-based-game-data/<commit> rev-parse HEAD
```

Configure:

```env
GAMESMCP_STARRAIL_ENABLED=true
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit>
```

Run gates:

```bash
pnpm data:starrail:inventory
pnpm test:starrail-provider
PROVIDER_BENCHMARK_GAME=starrail pnpm benchmark:provider
```

The provider scans `Config`, `ExcelOutput`, `Story`, and `TextMap`, writes `artifacts/starrail-source-inventory.json`, resolves CHS TextMap once per provider load, builds stable document ids such as `starrail/textmap/<hash>` and `starrail/story/<source-path>/<unit>`, and exposes:

- `knowledge_search`
- `keyword_search`
- `document_read`

It does not declare `document_hierarchy` until a reliable source hierarchy is available. In that state, `get_game_document_hierarchy(game=starrail)` correctly returns `provider_not_supported`.
