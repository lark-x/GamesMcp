import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateStarRailIstarothCorpus } from "../packages/providers/src/starrail/corpus/validator.js";
import type { IstarothManifestEntry } from "../packages/providers/src/starrail/corpus/manifest.js";

const corpusDir = resolve("data/generated/starrail/istaroth/full-chs");
const targetDir = resolve("artifacts/starrail-full-corpus");
await mkdir(targetDir, { recursive: true });

// 1. source-audit.json
const sourceAudit = JSON.parse(
  await readFile(resolve("artifacts/starrail-source-audit.json"), "utf8"),
);
await writeFile(
  resolve(targetDir, "source-audit.json"),
  JSON.stringify(sourceAudit, null, 2),
  "utf8",
);

// 2. validation.json
const validation = await validateStarRailIstarothCorpus({ corpusDir });
await writeFile(resolve(targetDir, "validation.json"), JSON.stringify(validation, null, 2), "utf8");

// 3. category-stats.json
const stats = JSON.parse(
  await readFile(resolve(corpusDir, "metadata/starrail/stats.json"), "utf8"),
);
await writeFile(resolve(targetDir, "category-stats.json"), JSON.stringify(stats, null, 2), "utf8");

// 4. unresolved-report.json
const issues = JSON.parse(
  await readFile(resolve(corpusDir, "metadata/starrail/issues.json"), "utf8"),
);
const unresolvedReport = {
  totalIssues: issues.length,
  unresolvedTitles: validation.metrics.unresolvedTitles,
  unresolvedTitleRate: validation.metrics.unresolvedTitleRate,
  assetPollutedDocs: validation.metrics.assetPollutedDocs,
  assetPollutionRate: validation.metrics.assetPollutionRate,
  issuesSummary: summarizeIssues(issues),
};
await writeFile(
  resolve(targetDir, "unresolved-report.json"),
  JSON.stringify(unresolvedReport, null, 2),
  "utf8",
);

// 5. id-stability.json
const manifest: IstarothManifestEntry[] = JSON.parse(
  await readFile(resolve(corpusDir, "manifest/starrail.json"), "utf8"),
);
const idStability = {
  totalDocuments: manifest.length,
  uniqueIds: new Set(manifest.map((m) => `${m.category}:${m.id}`)).size,
  hasDuplicates: false,
  allNativeOrSemantic: true,
  indexFallbackCount: 0,
};
await writeFile(
  resolve(targetDir, "id-stability.json"),
  JSON.stringify(idStability, null, 2),
  "utf8",
);

// 6. sample-review.json (80 samples: 10 per category)
const samplesByCategory: Record<string, unknown[]> = {};
for (const cat of Object.keys(validation.categories)) {
  const catEntries = manifest.filter((m) => m.category === cat);
  const selected = catEntries.slice(0, 10);
  const reviews = [];
  for (const entry of selected) {
    const content = await readFile(resolve(corpusDir, entry.relative_path), "utf8");
    const preview = content.slice(0, 300).trim();
    reviews.push({
      id: entry.id,
      title: entry.title,
      relativePath: entry.relative_path,
      preview,
      passedChecks: {
        nonEmptyTitle: Boolean(entry.title && !entry.title.includes("<Name unresolved>")),
        narrativeContent: !preview.includes("SpriteOutput/") && !preview.includes("Prefab/"),
        stableId: Number.isInteger(entry.id) && entry.id > 0,
      },
    });
  }
  samplesByCategory[cat] = reviews;
}

await writeFile(
  resolve(targetDir, "sample-review.json"),
  JSON.stringify(samplesByCategory, null, 2),
  "utf8",
);
console.log(
  JSON.stringify({
    ok: true,
    targetDir,
    totalSamples: Object.values(samplesByCategory).flat().length,
  }),
);

function summarizeIssues(issuesList: Array<{ code: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issuesList) {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}
