# StarRail Provider Migration

StarRail is migrating from the current local dataset-backed provider to an Istaroth-compatible corpus/checkpoint flow. During migration, the local provider remains the baseline and rollback path:

```text
TurnBasedGameData pinned checkout
→ StarRail dataset-aware corpus
→ Istaroth-compatible manifest/text files
→ StarRail checkpoint
→ StarRail Istaroth MCP
→ GamesMcp provider gateway
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

Local baseline mode:

```env
GAMESMCP_STARRAIL_ENABLED=true
GAMESMCP_STARRAIL_PROVIDER=local
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit>
```

Istaroth target mode:

```env
GAMESMCP_STARRAIL_ENABLED=true
GAMESMCP_STARRAIL_PROVIDER=istaroth
GAMESMCP_STARRAIL_ISTAROTH_URL=http://istaroth-starrail:8000/mcp
```

Baseline gates:

```bash
pnpm data:starrail:inventory
pnpm test:starrail-provider
PROVIDER_BENCHMARK_GAME=starrail pnpm benchmark:provider
```

Corpus/checkpoint gates:

```bash
pnpm data:starrail:corpus --source /data/games/starrail/turn-based-game-data/<commit> --output /data/generated/starrail/istaroth/chs
pnpm data:starrail:validate --corpus /data/generated/starrail/istaroth/chs
ISTAROTH_DIR=/path/to/lark-x/istaroth STARRAIL_CORPUS_DIR=/data/generated/starrail/istaroth/chs STARRAIL_CHECKPOINT_DIR=/data/checkpoints/starrail/chs/<version> pnpm checkpoint:starrail:build
STARRAIL_ISTAROTH_INTEGRATION_URL=http://127.0.0.1:8001/mcp pnpm test:starrail-istaroth
```

The local provider scans `Config`, `ExcelOutput`, `Story`, and `TextMap`, writes `artifacts/starrail-source-inventory.json`, resolves CHS TextMap once per provider load, and exposes:

- `knowledge_search`
- `keyword_search`
- `document_read`

The target Istaroth provider must expose:

- `knowledge_search`
- `keyword_search`
- `document_read`
- `document_hierarchy`, or explicit degraded status until hierarchy metadata is supported.

Production-ready requires a real StarRail checkpoint loaded by Istaroth MCP and a successful GamesMcp gateway E2E. Fixture-only and mocked MCP tests are not sufficient.
