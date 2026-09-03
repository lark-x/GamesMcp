# StarRail Istaroth Provider Evaluation

Run after a real StarRail checkpoint is built and served by Istaroth MCP:

```bash
STARRAIL_ISTAROTH_INTEGRATION_URL=http://127.0.0.1:8001/mcp pnpm test:starrail-istaroth
GAMESMCP_STARRAIL_DATA_DIR=/data/games/starrail/turn-based-game-data/<commit> STARRAIL_ISTAROTH_INTEGRATION_URL=http://127.0.0.1:8001/mcp pnpm eval:starrail-retrieval
```

Outputs:

```text
artifacts/evaluation/starrail-istaroth-e2e.json
artifacts/evaluation/starrail-retrieval-eval.json
```

The report must include corpus revision, checkpoint revision, golden query count, Recall@5, Recall@10, MRR, latency distribution, failures, and known gaps before StarRail Istaroth can become the default provider.
