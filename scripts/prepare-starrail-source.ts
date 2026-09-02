import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { StarRailLocalProvider } from "../packages/providers/src/index.js";

const dataDir = process.env.GAMESMCP_STARRAIL_DATA_DIR;
const output = resolve(
  process.env.STARRAIL_SOURCE_REPORT_OUTPUT ?? "artifacts/evaluation/starrail-source.json",
);

if (!dataDir) {
  await writeReport({
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
const summary = await provider.getSourceSummary();
const payload = {
  schemaVersion: 1,
  provider: "starrail-local",
  game: "starrail",
  generatedAt: new Date().toISOString(),
  releaseGate: {
    sourceAvailable: true,
    commitRecorded: summary.snapshot.ref !== "unknown",
    inventoryGenerated: summary.inventory.files > 0,
    textMapReadable: summary.textMap.totalKeys > 0,
    storySourceFound: (summary.categories.Story ?? 0) > 0,
    minimumDocumentsReached: summary.documents >= 5_000,
  },
  summary,
};
await writeReport(payload);
if (!payload.releaseGate.sourceAvailable || !payload.releaseGate.inventoryGenerated)
  throw new Error(`StarRail source gate failed; see ${output}`);
console.log(JSON.stringify({ ok: true, output, documents: summary.documents }));

async function writeReport(payload: unknown) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
}
