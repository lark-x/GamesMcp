import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  adapterFor,
  normalizeSnapshot,
  validateImport,
  type SourceInput,
} from "../packages/ingestion/src/index.js";
import { LOCKED_COMMIT } from "../packages/ingestion/src/genshin-db-adapter.js";

const outputRoot = resolve(
  process.env.GENSHIN_DB_OUTPUT_DIR ?? "data/imports/normalized/genshin-db",
);
const recordsPath = resolve(outputRoot, "records.json");
const manifestPath = resolve(outputRoot, "manifest.json");
const expected = { characters: 122, weapons: 249, artifacts: 63, materials: 919, enemies: 346 };

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
const records = JSON.parse(await readFile(recordsPath, "utf8")) as unknown;
if (!Array.isArray(records)) throw new Error("records.json must contain an array");
if (records.length !== 1699) throw new Error(`expected 1699 records, got ${records.length}`);
if (manifest.converted !== 1699)
  throw new Error(`manifest converted must be 1699, got ${String(manifest.converted)}`);
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0)
  throw new Error("manifest failures must be an empty array");
const upstream = manifest.upstream as Record<string, unknown> | undefined;
if (upstream?.commit !== LOCKED_COMMIT) throw new Error("manifest upstream commit is not locked");
if (
  manifest.sourceKind !== "community_derived" ||
  manifest.contentRights !== "HoYoverse/third-party"
)
  throw new Error("manifest rights/source metadata is incomplete");

const counts = Object.fromEntries(
  Object.keys(expected).map((category) => [
    category,
    records.filter(
      (record) =>
        typeof record === "object" &&
        record !== null &&
        String((record as Record<string, unknown>).sourceKey ?? "").startsWith(
          `genshin-db/${category}/`,
        ),
    ).length,
  ]),
);
for (const [category, count] of Object.entries(expected))
  if (counts[category] !== count)
    throw new Error(`${category}: expected ${count}, got ${counts[category]}`);
if (/\.(png|jpe?g|webp|gif|mp3|wav|ogg)\b/i.test(JSON.stringify(records)))
  throw new Error("records contain media references");
if (records.some((record) => typeof record === "object" && record !== null && "body" in record))
  throw new Error("records must contain short facts, not document bodies");

const storageDir = await mkdtemp(join(tmpdir(), "gip-genshin-db-"));
try {
  const input: SourceInput = {
    sourceId: "genshin-db-validation",
    type: "local_json",
    path: recordsPath,
    storageDir,
  };
  const adapter = adapterFor(input.type);
  const snapshot = await adapter.snapshot(input);
  const normalized = await normalizeSnapshot(snapshot, adapter);
  const result = validateImport(normalized.records, normalized.parseIssues);
  const errors = result.errors.filter((issue) => issue.severity === "error");
  if (errors.length)
    throw new Error(`ingestion validation failed: ${errors.map((e) => e.code).join(", ")}`);
  console.log(
    JSON.stringify(
      {
        records: records.length,
        counts,
        normalized: normalized.records.length,
        warnings: result.warnings.length,
        recordsPath,
        manifestPath,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(storageDir, { recursive: true, force: true });
}
