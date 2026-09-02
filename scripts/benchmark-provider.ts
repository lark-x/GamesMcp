import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  GameProviderRegistry,
  GenshinIstarothProvider,
  IstarothMcpClient,
} from "../packages/providers/src/index.js";

const url = process.env.ISTAROTH_INTEGRATION_URL ?? process.env.GAMESMCP_ISTAROTH_URL;
const output = resolve(process.env.PROVIDER_BASELINE_OUTPUT ?? "artifacts/provider-baseline.json");
if (!url) {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: "ISTAROTH_INTEGRATION_URL or GAMESMCP_ISTAROTH_URL is not set",
      output,
    }),
  );
  process.exit(0);
}

const game = process.env.GAMESMCP_ISTAROTH_GAME_SLUG ?? "genshin";
const runs = Math.max(Number(process.env.PROVIDER_BENCHMARK_RUNS ?? 20), 5);
const concurrency = readConcurrency(process.env.PROVIDER_BENCHMARK_CONCURRENCY ?? "1,4,16");
const provider = new GenshinIstarothProvider({
  gameSlug: game,
  client: new IstarothMcpClient({
    url,
    connectTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS ?? 3_000),
    requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
  }),
  requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
});
const registry = new GameProviderRegistry();
registry.register(provider);

try {
  const search = await provider.search({
    game,
    query: "芙宁娜与枫丹预言",
    mode: "hybrid",
    limit: 5,
  });
  const documentId = search.hits.find((hit) => hit.documentId)?.documentId;
  if (!documentId) throw new Error("No document id returned from provider search");

  const operations = [
    {
      name: "search_hybrid",
      run: () => provider.search({ game, query: "芙宁娜与枫丹预言", mode: "hybrid", limit: 5 }),
    },
    {
      name: "search_keyword",
      run: () => provider.search({ game, query: "戴因斯雷布", mode: "keyword", limit: 5 }),
    },
    {
      name: "get_document",
      run: () => provider.getDocument({ game, documentId, cursor: 0, limit: 20 }),
    },
  ];

  const results = [];
  for (const operation of operations) {
    const cold = await measure(operation.run, 1);
    const warm = await measure(operation.run, runs);
    const concurrencyResults = [];
    for (const level of concurrency)
      concurrencyResults.push(await measureConcurrent(operation.run, level));
    results.push({ name: operation.name, cold, warm, concurrency: concurrencyResults });
  }

  const payload = {
    schemaVersion: 1,
    provider: "istaroth",
    game,
    generatedAt: new Date().toISOString(),
    documentId,
    results,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, output }));
} finally {
  await registry.close();
}

async function measure(operation: () => Promise<unknown>, count: number) {
  const samples: number[] = [];
  let errors = 0;
  let bytes = 0;
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    try {
      const result = await operation();
      samples.push(performance.now() - startedAt);
      bytes += Buffer.byteLength(JSON.stringify(result), "utf8");
    } catch {
      errors += 1;
    }
  }
  return summarize(samples, errors, bytes);
}

async function measureConcurrent(operation: () => Promise<unknown>, level: number) {
  const samples: number[] = [];
  let errors = 0;
  let bytes = 0;
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: level }, async () => {
      const requestStartedAt = performance.now();
      const result = await operation();
      return {
        elapsed: performance.now() - requestStartedAt,
        bytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
      };
    }),
  );
  for (const item of settled) {
    if (item.status === "fulfilled") {
      samples.push(item.value.elapsed);
      bytes += item.value.bytes;
    } else {
      errors += 1;
    }
  }
  return {
    level,
    ...summarize(samples, errors, bytes),
    throughputPerSecond: round(
      samples.length / Math.max((performance.now() - startedAt) / 1000, 0.001),
    ),
  };
}

function summarize(samples: number[], errors: number, bytes: number) {
  return {
    runs: samples.length + errors,
    p50Ms: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    p99Ms: round(percentile(samples, 0.99)),
    successRate: round(samples.length / Math.max(samples.length + errors, 1)),
    errorRate: round(errors / Math.max(samples.length + errors, 1)),
    responseBytesAvg: Math.round(bytes / Math.max(samples.length, 1)),
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function readConcurrency(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}
