# StarRail Local Provider Baseline

Run:

```bash
PROVIDER_BENCHMARK_GAME=starrail GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm benchmark:provider
```

Output:

```text
artifacts/provider-baseline/starrail-local.json
```

The baseline uses the same measurement format as the Istaroth provider. StarRail is local dataset-backed while Genshin/Istaroth is an external MCP service, so the numbers should be compared as service-model facts rather than a blanket architecture verdict.
