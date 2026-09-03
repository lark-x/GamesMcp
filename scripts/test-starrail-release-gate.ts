import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  GameProviderError,
  IstarothKnowledgeProvider,
  IstarothMcpClient,
} from "../packages/providers/src/index.js";

interface GoldenCase {
  id: string;
  category: string;
  query: string;
  mode: "hybrid" | "keyword";
  minHits: number;
  mustContainAny: string[];
}

interface GoldenFile {
  game: string;
  provider: string;
  cases: GoldenCase[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.max(Math.ceil((p / 100) * sorted.length) - 1, 0), sorted.length - 1);
  return Number((sorted[index] ?? 0).toFixed(2));
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const istarothUrl =
  args.url ??
  process.env.STARRAIL_ISTAROTH_INTEGRATION_URL ??
  process.env.GAMESMCP_STARRAIL_ISTAROTH_URL ??
  "http://127.0.0.1:8001/mcp";

const outputPath = resolve(
  args.output ??
    process.env.STARRAIL_RELEASE_GATE_OUTPUT ??
    "artifacts/evaluation/starrail-istaroth-release-gate.json",
);

console.log(`=== StarRail Istaroth Release Gate Evaluation ===`);
console.log(`Provider URL: ${istarothUrl}`);
console.log(`Output: ${outputPath}`);

const golden = JSON.parse(
  await readFile("data/evaluation/providers/starrail-istaroth-golden.json", "utf8"),
) as GoldenFile;

const client = new IstarothMcpClient({
  url: istarothUrl,
  connectTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS ?? 5_000),
  requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
});

const provider = new IstarothKnowledgeProvider({
  gameSlug: "starrail",
  client,
  requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
});

// Latency trackers
const latencies: Record<string, number[]> = {
  hybrid: [],
  keyword: [],
  document: [],
  hierarchy: [],
  overall: [],
};

let healthPassed = false;
let hybridPassed = true;
let keywordPassed = true;
let documentReadPassed = false;
let hierarchyPassed = false;
let downIsolationPassed = false;
let reconnectPassed = false;

// 1. Health Gate
try {
  console.log("Testing Provider Health...");
  const health = await provider.health();
  if (health.id === "istaroth" && health.status === "available" && health.game === "starrail") {
    healthPassed = true;
    console.log("✓ Health Gate: PASS");
  } else {
    console.error(`✗ Health Gate: FAIL (${JSON.stringify(health)})`);
  }
} catch (error) {
  console.error("✗ Health Gate: FAIL with exception", error);
}

// 2. 50-Case Golden Evaluation
console.log(`Running 50-case Golden Evaluation...`);
const caseResults = [];
let passedCount = 0;
let emptyResultCount = 0;
let top5Hits = 0;
let top10Hits = 0;
let reciprocalRankSum = 0;
const firstRealDocumentIds: string[] = [];

for (const item of golden.cases) {
  const t0 = performance.now();
  let hits: Array<{ documentId?: string; excerpt?: string; title?: string }> = [];
  let isError = false;

  try {
    const res = await provider.search({
      game: "starrail",
      query: item.query,
      mode: item.mode,
      limit: 10,
    });
    hits = res.hits ?? [];
  } catch {
    isError = true;
  }

  const elapsed = performance.now() - t0;
  latencies[item.mode]?.push(elapsed);
  latencies.overall?.push(elapsed);

  if (hits.length === 0) {
    emptyResultCount++;
  }

  // Find relevant rank
  let relevantRank: number | null = null;
  const joinedAll = JSON.stringify(hits);
  const matched =
    !isError &&
    hits.length >= item.minHits &&
    item.mustContainAny.some((needle) => joinedAll.includes(needle));

  if (matched) {
    for (let i = 0; i < hits.length; i++) {
      const hitText = JSON.stringify(hits[i]);
      if (item.mustContainAny.some((needle) => hitText.includes(needle))) {
        relevantRank = i + 1;
        break;
      }
    }
  }

  if (relevantRank !== null) {
    reciprocalRankSum += 1 / relevantRank;
    if (relevantRank <= 5) top5Hits++;
    if (relevantRank <= 10) top10Hits++;
  }

  if (matched) {
    passedCount++;
  } else {
    if (item.mode === "hybrid") hybridPassed = false;
    if (item.mode === "keyword") keywordPassed = false;
  }

  // Collect first real document ID for document/hierarchy gate
  const validDoc = hits.find((h) => h.documentId && !h.documentId.startsWith("text-block"));
  if (validDoc?.documentId && !firstRealDocumentIds.includes(validDoc.documentId)) {
    firstRealDocumentIds.push(validDoc.documentId);
  }

  caseResults.push({
    id: item.id,
    category: item.category,
    query: item.query,
    mode: item.mode,
    passed: matched,
    hitCount: hits.length,
    relevantRank,
    latencyMs: Number(elapsed.toFixed(2)),
  });
}

console.log(
  `Golden Results: ${passedCount}/${golden.cases.length} passed, empty results: ${emptyResultCount}`,
);

// 3. Document Read Gate
console.log("Testing Document Read Gate...");
const testDocId = firstRealDocumentIds[0] ?? "text-block-1";
try {
  const t0 = performance.now();
  const page1 = await provider.getDocument({
    game: "starrail",
    documentId: testDocId,
    limit: 10,
  });
  const tElapsed = performance.now() - t0;
  latencies.document?.push(tElapsed);
  latencies.overall?.push(tElapsed);

  if (page1.content && page1.content.trim().length > 0) {
    if (page1.nextCursor) {
      const page2 = await provider.getDocument({
        game: "starrail",
        documentId: testDocId,
        cursor: page1.nextCursor,
        limit: 10,
      });
      // Page 2 should not be duplicate of page 1
      if (page2.content && page2.content !== page1.content) {
        documentReadPassed = true;
      } else if (!page2.nextCursor) {
        documentReadPassed = true;
      }
    } else {
      documentReadPassed = true;
    }
  }
  console.log(`✓ Document Read Gate: ${documentReadPassed ? "PASS" : "FAIL"}`);
} catch (error) {
  console.error("✗ Document Read Gate: FAIL with exception", error);
}

// 4. Hierarchy Gate
console.log("Testing Hierarchy Gate...");
try {
  const t0 = performance.now();
  const hierarchy = await provider.getHierarchy({
    game: "starrail",
    documentId: testDocId,
  });
  const tElapsed = performance.now() - t0;
  latencies.hierarchy?.push(tElapsed);
  latencies.overall?.push(tElapsed);

  if (
    hierarchy.game === "starrail" &&
    hierarchy.documentId === testDocId &&
    hierarchy.hierarchy &&
    Object.keys(hierarchy.hierarchy).length > 0
  ) {
    hierarchyPassed = true;
  }
  console.log(`✓ Hierarchy Gate: ${hierarchyPassed ? "PASS" : "FAIL"}`);
} catch (error) {
  console.error("✗ Hierarchy Gate: FAIL with exception", error);
}

// 5. Failure Isolation Gate
console.log("Testing Failure Isolation Gate...");
try {
  // Point client to a non-existent port to simulate provider down
  const downClient = new IstarothMcpClient({
    url: "http://127.0.0.1:19999/mcp",
    connectTimeoutMs: 500,
    requestTimeoutMs: 1000,
    retryCount: 0,
  });
  const downProvider = new IstarothKnowledgeProvider({
    gameSlug: "starrail",
    client: downClient,
    requestTimeoutMs: 1000,
  });

  try {
    await downProvider.search({ game: "starrail", query: "卡芙卡", mode: "hybrid" });
    downIsolationPassed = false;
  } catch (err) {
    if (err instanceof GameProviderError && err.code === "provider_unavailable") {
      downIsolationPassed = true;
      console.log("✓ Failure Isolation Gate: PASS (caught provider_unavailable cleanly)");
    } else {
      console.error("✗ Failure Isolation Gate: Unexpected error type", err);
    }
  } finally {
    await downProvider.close().catch(() => {});
  }
} catch (error) {
  console.error("✗ Failure Isolation Gate: FAIL", error);
}

// 6. Reconnect Gate
console.log("Testing Reconnect Gate...");
try {
  // Close active connection and verify subsequent search re-establishes connection
  await client.close();
  const reconnectRes = await provider.search({
    game: "starrail",
    query: "卡芙卡",
    mode: "hybrid",
    limit: 3,
  });
  if (reconnectRes.hits && reconnectRes.hits.length > 0) {
    reconnectPassed = true;
    console.log("✓ Reconnect Gate: PASS (auto-reconnected and retrieved hits)");
  } else {
    console.error("✗ Reconnect Gate: FAIL (no hits returned)");
  }
} catch (error) {
  console.error("✗ Reconnect Gate: FAIL with exception", error);
} finally {
  await provider.close().catch(() => {});
}

// Compute metrics
const totalCases = golden.cases.length;
const recallAt5 = Number((top5Hits / totalCases).toFixed(4));
const recallAt10 = Number((top10Hits / totalCases).toFixed(4));
const mrr = Number((reciprocalRankSum / totalCases).toFixed(4));
const emptyResultRate = Number((emptyResultCount / totalCases).toFixed(4));

// Read checkpoint metadata for provenance
let checkpointProvenance = {
  corpusHash: "unknown",
  documentCount: 0,
  embeddingModel: "BAAI/bge-small-zh-v1.5",
};
try {
  const meta = JSON.parse(
    await readFile(
      resolve(
        process.env.STARRAIL_CHECKPOINT_DIR ?? "data/istaroth-starrail/checkpoint/chs",
        "checkpoint-metadata.json",
      ),
      "utf8",
    ),
  );
  checkpointProvenance = {
    corpusHash: meta.corpus?.corpusHash ?? "unknown",
    documentCount: meta.corpus?.documentCount ?? 0,
    embeddingModel: meta.embedding?.model ?? "BAAI/bge-small-zh-v1.5",
  };
} catch {
  // Ignored: fallback to defaults if checkpoint metadata cannot be loaded
}

const report = {
  schemaVersion: 1,
  testedRevision: {
    gamesMcp: process.env.GITHUB_SHA ?? "38f3603c4b7626c5c139f36d493dd731441db27c",
    istaroth: process.env.ISTAROTH_REF ?? "f22ea938704f414cfa6bfe03bc65b71142c781b7",
    turnBasedGameData:
      process.env.TURN_BASED_GAME_DATA_REF ?? "8cdb905dc2f8e6fffa9be4eb07af3e34435d6091",
  },
  checkpoint: checkpointProvenance,
  e2e: {
    total: totalCases,
    passed: passedCount,
    failed: totalCases - passedCount,
    healthPassed,
    hybridPassed,
    keywordPassed,
    documentReadPassed,
    hierarchyPassed,
    downIsolationPassed,
    reconnectPassed,
  },
  retrieval: {
    recallAt5,
    recallAt10,
    mrr,
    emptyResultRate,
  },
  latencyMs: {
    hybrid: {
      p50: percentile(latencies.hybrid ?? [], 50),
      p95: percentile(latencies.hybrid ?? [], 95),
      p99: percentile(latencies.hybrid ?? [], 99),
    },
    keyword: {
      p50: percentile(latencies.keyword ?? [], 50),
      p95: percentile(latencies.keyword ?? [], 95),
      p99: percentile(latencies.keyword ?? [], 99),
    },
    document: {
      p50: percentile(latencies.document ?? [], 50),
      p95: percentile(latencies.document ?? [], 95),
      p99: percentile(latencies.document ?? [], 99),
    },
    hierarchy: {
      p50: percentile(latencies.hierarchy ?? [], 50),
      p95: percentile(latencies.hierarchy ?? [], 95),
      p99: percentile(latencies.hierarchy ?? [], 99),
    },
    overall: {
      p50: percentile(latencies.overall ?? [], 50),
      p95: percentile(latencies.overall ?? [], 95),
      p99: percentile(latencies.overall ?? [], 99),
      sampleCount: latencies.overall?.length ?? 0,
    },
  },
  cases: caseResults,
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Saved release gate report to: ${outputPath}`);

const allPassed =
  healthPassed &&
  hybridPassed &&
  keywordPassed &&
  documentReadPassed &&
  hierarchyPassed &&
  downIsolationPassed &&
  reconnectPassed &&
  passedCount === totalCases;

if (!allPassed) {
  console.error("Release Gate validation FAILED!");
  process.exit(1);
}

console.log("=== ALL RELEASE GATES PASSED SUCCESSFULLY ===");
process.exit(0);
