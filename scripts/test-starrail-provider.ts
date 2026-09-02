import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { StarRailLocalProvider } from "../packages/providers/src/index.js";

const dataDir = process.env.GAMESMCP_STARRAIL_DATA_DIR;
const output = resolve(
  process.env.STARRAIL_E2E_OUTPUT ?? "artifacts/evaluation/starrail-local-e2e.json",
);

if (!dataDir) {
  await writeReport({
    provider: "starrail-local",
    game: "starrail",
    skipped: true,
    reason: "GAMESMCP_STARRAIL_DATA_DIR is not set",
    generatedAt: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({ skipped: true, reason: "GAMESMCP_STARRAIL_DATA_DIR is not set", output }),
  );
  process.exit(0);
}

const provider = new StarRailLocalProvider({
  dataDir,
  inventoryOutput: resolve("artifacts/starrail-source-inventory.json"),
});
const golden = JSON.parse(
  await readFile("data/evaluation/providers/starrail-local-golden.json", "utf8"),
) as GoldenFile;
const cases: CaseReport[] = [];
const documentReads: DocumentReadReport[] = [];
for (const item of golden.cases) {
  const search = await provider.search({
    game: golden.game,
    query: item.query,
    mode: item.mode,
    limit: 5,
  });
  const joined = JSON.stringify(search.hits);
  cases.push({
    id: item.id,
    query: item.query,
    mode: item.mode,
    passed:
      search.hits.length >= item.minHits &&
      search.hits.every((hit) => hit.game === "starrail") &&
      item.mustContainAny.some((needle) => joined.includes(needle)),
    hitCount: search.hits.length,
    documentId: search.hits[0]?.documentId,
  });
}
for (const item of cases.filter((caseResult) => caseResult.documentId).slice(0, 10)) {
  try {
    const document = await provider.getDocument({
      game: "starrail",
      documentId: item.documentId ?? "",
      cursor: 0,
      limit: 10,
    });
    documentReads.push({
      caseId: item.id,
      documentId: item.documentId ?? "",
      passed: Boolean(document.content && document.documentId === item.documentId),
    });
  } catch (error) {
    documentReads.push({
      caseId: item.id,
      documentId: item.documentId ?? "",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
const passed = cases.filter((item) => item.passed).length;
const documentReadPassed = documentReads.length >= 10 && documentReads.every((item) => item.passed);
const summary = await provider.getSourceSummary();
const payload = {
  provider: "starrail-local",
  game: golden.game,
  total: cases.length,
  passed,
  failed: cases.length - passed,
  documentReadPassed,
  documentReads,
  hierarchySupported: provider.capabilities.includes("document_hierarchy"),
  source: summary.snapshot,
  documents: summary.documents,
  categories: summary.categories,
  generatedAt: new Date().toISOString(),
  cases,
};
await writeReport(payload);
if (payload.failed || !documentReadPassed)
  throw new Error(`StarRail provider E2E failed; see ${output}`);
console.log(JSON.stringify({ ok: true, output, passed, failed: payload.failed }));

async function writeReport(payload: unknown) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
}

interface GoldenFile {
  game: string;
  cases: Array<{
    id: string;
    mode: "hybrid" | "keyword";
    query: string;
    mustContainAny: string[];
    minHits: number;
  }>;
}

interface CaseReport {
  id: string;
  query: string;
  mode: "hybrid" | "keyword";
  passed: boolean;
  hitCount: number;
  documentId?: string;
}

interface DocumentReadReport {
  caseId: string;
  documentId: string;
  passed: boolean;
  error?: string;
}
