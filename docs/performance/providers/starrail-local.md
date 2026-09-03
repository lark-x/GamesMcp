# StarRail Local Provider Baseline

Run:

```bash
PROVIDER_BENCHMARK_GAME=starrail GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> pnpm benchmark:provider
```

Output:

```text
artifacts/provider-baseline/starrail-local.json
```

The baseline uses the same measurement format as the Istaroth provider. It is retained as a migration comparison point and rollback path, not as the long-term RAG implementation.
