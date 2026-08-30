import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CONVERTER_VERSION,
  DEFAULT_LOCALE,
  convertAnimeGameData,
  type AnimeGameRecord,
  type ConversionManifest,
} from "./anime-game-data-converter.js";
import { isPathInside, runStoragePreflight } from "./check-data-storage.js";
import { loadConfig } from "../packages/config/src/index.ts";

const execFileAsync = promisify(execFile);
const expectedCommit = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";
const configuredDataRoot = loadConfig().dataDir;
const upstreamDir = resolve(
  process.env.ANIME_GAME_DATA_DIR ?? join(configuredDataRoot, "upstream", "AnimeGameData"),
);

const categoryFiles = {
  books: "books.json",
  characterStories: "character-stories.json",
  items: "items.json",
} as const;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

async function gitMetadata(): Promise<{
  commit: string;
  commitDate: string;
  subject: string;
}> {
  const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H%n%aI%n%s"], {
    cwd: upstreamDir,
  });
  const [commit = "", commitDate = "", subject = ""] = stdout.trim().split("\n");
  return { commit, commitDate, subject };
}

function inferGameVersion(subject: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/.exec(subject)?.[1] ?? "unknown";
}

function recordProvenance(record: AnimeGameRecord): Record<string, unknown> {
  const nested = record.metadata.provenance;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : record.metadata;
}

function recordCanonicalKey(record: AnimeGameRecord): string {
  const provenance = recordProvenance(record);
  return typeof provenance.canonicalKey === "string" && provenance.canonicalKey.trim()
    ? provenance.canonicalKey.trim()
    : record.sourceKey;
}

function assertRecord(
  record: AnimeGameRecord,
  sourceKeys: Set<string>,
  canonicalKeys: Set<string>,
): void {
  if (sourceKeys.has(record.sourceKey))
    throw new Error(`duplicate source key: ${record.sourceKey}`);
  sourceKeys.add(record.sourceKey);
  const canonicalKey = recordCanonicalKey(record);
  if (!canonicalKey) throw new Error(`empty canonical key: ${record.sourceKey}`);
  if (canonicalKeys.has(canonicalKey)) throw new Error(`duplicate canonical key: ${canonicalKey}`);
  const expectedPattern =
    record.documentType === "book"
      ? /^book\/[^/]+$/
      : record.documentType === "character_story"
        ? /^character\/[^/]+\/story\/[^/]+$/
        : /^item-codex\/[^/]+$/;
  if (!expectedPattern.test(canonicalKey))
    throw new Error(`canonical key/category mismatch: ${canonicalKey}`);
  canonicalKeys.add(canonicalKey);
  if (!record.title.trim() || !record.body.trim())
    throw new Error(`empty title/body: ${record.sourceKey}`);
  if (record.title.includes("\uFFFD") || record.body.includes("\uFFFD"))
    throw new Error(`replacement character: ${record.sourceKey}`);
  if (!isSha256(record.contentHash))
    throw new Error(`invalid record content hash: ${record.sourceKey}`);
  if (!isSha256(record.metadata.rawContentHash) || !isSha256(record.metadata.normalizedContentHash))
    throw new Error(`content hashes missing: ${record.sourceKey}`);
  const lineage = record.metadata.lineage;
  if (
    !lineage ||
    typeof lineage !== "object" ||
    Array.isArray(lineage) ||
    !lineage.title ||
    !lineage.body
  )
    throw new Error(`title/body lineage missing: ${record.sourceKey}`);
  const textMapHashes = record.metadata.textMapHashes;
  if (
    !textMapHashes ||
    typeof textMapHashes !== "object" ||
    Array.isArray(textMapHashes) ||
    !Object.values(textMapHashes).some(
      (value) =>
        (typeof value === "number" && Number.isInteger(value) && value >= 0) ||
        (Array.isArray(value) &&
          value.length > 0 &&
          value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0)),
    )
  )
    throw new Error(`TextMap hashes missing: ${record.sourceKey}`);
  const sourceFiles = record.metadata.sourceFiles ?? [];
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0)
    throw new Error(`source files missing: ${record.sourceKey}`);
  for (const file of sourceFiles) {
    if (typeof file !== "string" || file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file))
      throw new Error(`absolute provenance path: ${record.sourceKey}`);
  }
  for (const [field, lineage] of Object.entries(record.metadata.lineage ?? {})) {
    if (!lineage || typeof lineage.relativeFile !== "string" || !lineage.hash || !lineage.valueHash)
      throw new Error(`incomplete lineage ${field}: ${record.sourceKey}`);
  }
}

async function main(): Promise<void> {
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));
  if (!isPathInside(upstreamDir, preflight.config.externalVolumePath))
    throw new Error(
      `AnimeGameData upstream checkout must stay on the external volume: ${upstreamDir}`,
    );
  const git = await gitMetadata();
  if (git.commit !== expectedCommit)
    throw new Error(`Unexpected upstream commit ${git.commit}; expected ${expectedCommit}`);
  const gameVersion = process.env.ANIME_GAME_VERSION ?? inferGameVersion(git.subject);
  const outputRoot = resolve(
    process.env.ANIME_GAME_OUTPUT_DIR ??
      join(configuredDataRoot, "imports", "normalized", "anime-game-data", git.commit, "zh-CN"),
  );
  if (!isPathInside(outputRoot, preflight.config.dataRoot))
    throw new Error(`AnimeGameData output must stay under the external data root: ${outputRoot}`);
  const manifest = JSON.parse(
    await readFile(resolve(outputRoot, "manifest.json"), "utf8"),
  ) as ConversionManifest;
  const actual = await convertAnimeGameData({
    upstreamDir,
    context: {
      upstreamCommit: git.commit,
      upstreamCommitDate: git.commitDate,
      upstreamVersion: git.subject,
      upstreamVersionLabel: git.subject,
      gameVersion,
      locale: DEFAULT_LOCALE,
      language: "CHS",
      converterVersion: CONVERTER_VERSION,
    },
  });
  const comparableManifest = {
    ...actual.manifest,
    generatedAt: undefined,
    outputRecordsPath: undefined,
  };
  const storedComparableManifest = {
    ...manifest,
    generatedAt: undefined,
    outputRecordsPath: undefined,
  };
  if (stableJson(comparableManifest) !== stableJson(storedComparableManifest))
    throw new Error("Manifest does not match a fresh deterministic conversion");
  const sourceKeys = new Set<string>();
  const canonicalKeys = new Set<string>();
  let recordCount = 0;
  for (const [category, filename] of Object.entries(categoryFiles)) {
    const stored = JSON.parse(
      await readFile(resolve(outputRoot, "records", filename), "utf8"),
    ) as AnimeGameRecord[];
    const generated =
      actual.records[
        category === "books"
          ? "books"
          : category === "characterStories"
            ? "characterStories"
            : "items"
      ];
    if (stableJson(stored) !== stableJson(generated))
      throw new Error(`Records differ from a fresh conversion: ${filename}`);
    for (const record of stored) {
      assertRecord(record, sourceKeys, canonicalKeys);
      recordCount += 1;
    }
  }
  for (const [relativePath, expectedHash] of Object.entries(manifest.inputHashes)) {
    const safePath = resolve(upstreamDir, relativePath);
    if (relative(upstreamDir, safePath).startsWith(".."))
      throw new Error(`Manifest input path escapes upstream checkout: ${relativePath}`);
    const actualHash = sha256(await readFile(safePath));
    if (actualHash !== expectedHash) throw new Error(`Input hash mismatch: ${relativePath}`);
  }
  const coverage = Object.values(manifest.accountedCoverage);
  if (manifest.unexplainedMissing.length || coverage.some((value) => value !== 1))
    throw new Error("Manifest has unexplained missing records or incomplete coverage");
  console.log(
    JSON.stringify(
      {
        ok: true,
        upstreamCommit: git.commit,
        gameVersion,
        locale: manifest.locale,
        converterVersion: manifest.converterVersion,
        records: recordCount,
        inputFiles: Object.keys(manifest.inputHashes).length,
        accountedCoverage: manifest.accountedCoverage,
        unexplainedMissing: manifest.unexplainedMissing,
      },
      null,
      2,
    ),
  );
}

await main();
