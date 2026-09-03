import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertUniqueCorpusIds } from "./ids.js";
import { buildStarRailHierarchy } from "./hierarchy.js";
import { buildIstarothManifest } from "./manifest.js";
import type { StarRailCorpusBuildResult, StarRailCorpusDocument } from "./types.js";

export async function writeStarRailIstarothCorpus(input: {
  outputDir: string;
  locale: string;
  sourceCommit: string;
  generatedAt?: string;
  documents: StarRailCorpusDocument[];
  issues?: StarRailCorpusBuildResult["metadata"]["issues"];
  duplicateRejected?: number;
  unresolvedText?: number;
}): Promise<StarRailCorpusBuildResult> {
  assertUniqueCorpusIds(input.documents);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const documents = [...input.documents].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  for (const document of documents) {
    const path = resolve(input.outputDir, document.relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      document.content.endsWith("\n") ? document.content : `${document.content}\n`,
      "utf8",
    );
  }
  await mkdir(resolve(input.outputDir, "manifest"), { recursive: true });
  await mkdir(resolve(input.outputDir, "metadata", "starrail"), { recursive: true });
  const manifest = buildIstarothManifest(documents);
  const categories = countBy(documents.map((document) => document.category));
  const metadata: StarRailCorpusBuildResult["metadata"] = {
    source: {
      game: "starrail",
      source: "DimbreathBot/TurnBasedGameData",
      sourceCommit: input.sourceCommit,
      generatedAt,
      generator: "gamesmcp-starrail-corpus",
      generatorVersion: "1",
      locale: input.locale,
    },
    files: documents.map((document) => ({
      category: document.category,
      id: document.id,
      relativePath: document.relativePath,
      sourceFiles: document.sourceFiles,
      sourceIds: document.sourceIds,
    })),
    stats: {
      documents: documents.length,
      chars: documents.reduce((sum, document) => sum + document.content.length, 0),
      categories,
      unresolvedText: input.unresolvedText ?? 0,
      duplicateRejected: input.duplicateRejected ?? 0,
      sourceFiles: new Set(documents.flatMap((document) => document.sourceFiles)).size,
    },
    issues: input.issues ?? [],
    hierarchy: buildStarRailHierarchy(documents),
  };
  await writeJson(resolve(input.outputDir, "manifest", "starrail.json"), manifest);
  await writeJson(resolve(input.outputDir, "metadata", "starrail", "source.json"), metadata.source);
  await writeJson(resolve(input.outputDir, "metadata", "starrail", "files.json"), metadata.files);
  await writeJson(resolve(input.outputDir, "metadata", "starrail", "stats.json"), metadata.stats);
  await writeJson(resolve(input.outputDir, "metadata", "starrail", "issues.json"), metadata.issues);
  await writeJson(
    resolve(input.outputDir, "metadata", "starrail", "hierarchy.json"),
    metadata.hierarchy,
  );
  return {
    schemaVersion: 1,
    game: "starrail",
    locale: input.locale,
    sourceCommit: input.sourceCommit,
    generatedAt,
    documents,
    metadata,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
