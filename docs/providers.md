# Game Provider Gateway

GamesMcp exposes one MCP server to AI clients and can route selected calls to game knowledge providers. The first two provider modes are Istaroth for Genshin Impact and a local TurnBasedGameData-backed provider for Honkai: Star Rail.

The gateway keeps the existing PostgreSQL/revision/evidence/search stack intact. Existing tools such as `search_lore`, `search_dialogue`, `get_character`, `get_weapon`, and `resolve_entity` continue to use the local GamesMcp implementation. New provider calls use separate tools:

- `search_game_knowledge`
- `get_game_document`
- `get_game_document_hierarchy`
- `get_game_provider_status`

Provider code lives in `packages/providers`. Core code only depends on `GameKnowledgeProvider`, `GameProviderRegistry`, and normalized GamesMcp response types. Istaroth-specific MCP output parsing is isolated under `packages/providers/src/istaroth`; Star Rail local dataset reading is isolated under `packages/providers/src/starrail`.

## Configuration

Provider registration is explicit; there is no dynamic plugin scan.

```env
GAMESMCP_ISTAROTH_ENABLED=true
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp
GAMESMCP_ISTAROTH_GAME_SLUG=genshin
GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS=3000
GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS=15000
GAMESMCP_PROVIDER_HEALTH_CACHE_MS=15000

GAMESMCP_STARRAIL_ENABLED=false
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit>
```

If a provider is disabled or unavailable, GamesMcp starts normally and the provider tools return a standard provider error. Existing local tools are unaffected.

Provider URLs are read only from configuration. MCP users cannot pass a provider URL.

## Error model

Provider failures are normalized before reaching MCP callers:

- `provider_disabled`
- `provider_unavailable`
- `provider_timeout`
- `provider_protocol_error`
- `provider_bad_response`
- `provider_not_supported`
- `provider_document_not_found`
- `game_provider_not_found`

Raw network errors, stack traces, credentials, and internal URLs are not returned to callers.

## Response budget

Provider search responses are normalized first, then passed through the existing `shapeForBudget` MCP shaper. Document reads are line-paginated and bounded.

## Tests

Local unit and MCP tests:

```bash
pnpm vitest run packages/providers/src/registry.test.ts packages/providers/src/istaroth/provider.test.ts apps/mcp-server/src/server.test.ts
```

Real provider E2E, skipped unless an Istaroth MCP URL is configured:

```bash
ISTAROTH_INTEGRATION_URL=http://127.0.0.1:8000/mcp pnpm test:istaroth-provider
```

Star Rail local dataset gate, skipped unless a TurnBasedGameData checkout is configured:

```bash
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm data:starrail:inventory
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm test:starrail-provider
```

Provider baseline benchmark:

```bash
ISTAROTH_INTEGRATION_URL=http://127.0.0.1:8000/mcp pnpm benchmark:provider
PROVIDER_BENCHMARK_GAME=starrail GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm benchmark:provider
```

The benchmark writes under `artifacts/provider-baseline/` and records cold/warm latency, P50/P95/P99, response bytes, success/error rate, throughput, RSS, CPU usage, and concurrency 1/4/16.
