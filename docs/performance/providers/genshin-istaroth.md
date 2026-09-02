# Genshin Istaroth Provider Baseline

Run:

```bash
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm benchmark:provider
```

Output:

```text
artifacts/provider-baseline/genshin-istaroth.json
```

The baseline records:

- cold and warm request latency
- P50 / P95 / P99
- success and error rates
- average response bytes
- throughput for concurrency 1 / 4 / 16
- process RSS and CPU samples
- GamesMcp commit, Node version, Docker version, OS, CPU, RAM
- configured Istaroth image and checkpoint identity when provided

This benchmark is a reproducible measurement record, not an SLO gate. Do not add Redis, OpenSearch, or caching layers only because the first baseline is aesthetically unpleasant—tempting little gremlin though that may be.
