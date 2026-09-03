import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  IstarothKnowledgeProvider,
  IstarothMcpClient,
  StarRailLocalProvider,
} from "../packages/providers/src/index.js";
import type { GameKnowledgeProvider } from "../packages/providers/src/index.js";

const localDataDir = process.env.GAMESMCP_STARRAIL_DATA_DIR;
const istarothUrl =
  process.env.STARRAIL_ISTAROTH_INTEGRATION_URL ?? process.env.GAMESMCP_STARRAIL_ISTAROTH_URL;
const output = resolve(
  process.env.STARRAIL_RETRIEVAL_EVAL_OUTPUT ?? "artifacts/evaluation/starrail-retrieval-eval.json",
);

if (!localDataDir || !istarothUrl) {
  await writeReport({
    skipped: true,
    reason: "GAMESMCP_STARRAIL_DATA_DIR and StarRail Istaroth URL are required",
    generatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ skipped: true, output }));
  process.exit(0);
}

const golden = JSON.parse(
  await readFile("data/evaluation/providers/starrail-istaroth-golden.json", "utf8"),
) as GoldenFile;
const providers: Array<{ name: string; provider: GameKnowledgeProvider }> = [
  {
    name: "starrail-local",
    provider: new StarRailLocalProvider({
      dataDir: localDataDir,
      inventoryOutput: resolve("artifacts/starrail-source-inventory.json"),
    }),
  },
  {
    name: "starrail-istaroth",
    provider: new IstarothKnowledgeProvider({
      gameSlug: "starrail",
      client: new IstarothMcpClient({
        url: istarothUrl,
        connectTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS ?? 3_000),
        requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
      }),
      requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
    }),
  },
];

try {
  const reports = [];
  for (const { name, provider } of providers) {
    const cases = [];
    for (const item of golden.cases) {
      const response = await provider.search({
        game: "starrail",
        query: item.query,
        mode: item.mode,
        limit: 10,
      });
      const joined = JSON.stringify(response.hits);
      const firstRelevantIndex = response.hits.findIndex((hit) =>
        item.mustContainAny.some((needle) => JSON.stringify(hit).includes(needle)),
      );
      cases.push({
        id: item.id,
        category: item.category,
        query: item.query,
        hitCount: response.hits.length,
        relevantRank: firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
        matched: item.mustContainAny.some((needle) => joined.includes(needle)),
      });
    }
    reports.push({
      provider: name,
      total: cases.length,
      recallAt5: ratio(
        cases.filter((item) => item.relevantRank !== null && item.relevantRank <= 5).length,
        cases.length,
      ),
      recallAt10: ratio(
        cases.filter((item) => item.relevantRank !== null && item.relevantRank <= 10).length,
        cases.length,
      ),
      mrr: ratio(
        cases.reduce((sum, item) => sum + (item.relevantRank ? 1 / item.relevantRank : 0), 0),
        cases.length,
      ),
      emptyResultRate: ratio(cases.filter((item) => item.hitCount === 0).length, cases.length),
      cases,
    });
  }
  await writeReport({ generatedAt: new Date().toISOString(), reports });
  console.log(
    JSON.stringify({
      ok: true,
      output,
      reports: reports.map(({ provider, recallAt10, mrr }) => ({ provider, recallAt10, mrr })),
    }),
  );
} finally {
  await Promise.all(providers.map(({ provider }) => provider.close?.()));
}

async function writeReport(payload: unknown) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
}

function ratio(value: number, total: number): number {
  return total ? Number((value / total).toFixed(4)) : 0;
}

interface GoldenFile {
  cases: Array<{
    id: string;
    category: string;
    mode: "hybrid" | "keyword";
    query: string;
    mustContainAny: string[];
  }>;
}
