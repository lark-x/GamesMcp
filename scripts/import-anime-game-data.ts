import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import { manifestFailureIssues } from "./anime-game-data-import-helpers.js";
import {
  adapterFor,
  computeDiff,
  normalizeSnapshot,
  validateImport,
} from "../packages/ingestion/src/index.ts";
import type { StructuredImportRecords } from "../packages/domain/src/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.js";

const categoryFiles = {
  book: "books.json",
  character_story: "character-stories.json",
  item_description: "items.json",
  quest: "quests.json",
  structured: "manifest.json",
} as const;

type Category = keyof typeof categoryFiles;

const execFileAsync = promisify(execFile);

function parseCategory(value: string | undefined): Category {
  if (value && value in categoryFiles) return value as Category;
  throw new Error(`ANIME_GAME_CATEGORY must be one of: ${Object.keys(categoryFiles).join(", ")}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function checkoutCommit(upstreamDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: upstreamDir,
    });
    const commit = stdout.trim();
    return commit || undefined;
  } catch {
    return undefined;
  }
}

const config = loadConfig();
const category = parseCategory(process.env.ANIME_GAME_CATEGORY);
const configuredDataRoot =
  process.env.STORAGE_DATA_ROOT?.trim() ||
  process.env.DATA_ROOT?.trim() ||
  process.env.DATA_DIR?.trim() ||
  "data";
const upstreamDir = resolve(
  process.env.ANIME_GAME_DATA_DIR ?? join(configuredDataRoot, "upstream", "AnimeGameData"),
);
const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));
if (!isPathInside(upstreamDir, preflight.config.externalVolumePath))
  throw new Error(`AnimeGameData checkout must stay under the external volume: ${upstreamDir}`);
const configuredCommit = process.env.ANIME_GAME_COMMIT?.trim() || undefined;
const detectedCommit = configuredCommit ?? (await checkoutCommit(upstreamDir));
if (!process.env.ANIME_GAME_OUTPUT_DIR && !detectedCommit)
  throw new Error(
    `Could not determine AnimeGameData checkout Commit at ${upstreamDir}; set ANIME_GAME_COMMIT or ANIME_GAME_OUTPUT_DIR explicitly`,
  );
const outputRoot = resolve(
  process.env.ANIME_GAME_OUTPUT_DIR ??
    join(
      configuredDataRoot,
      "imports",
      "normalized",
      "anime-game-data",
      detectedCommit,
      category === "quest" ? "quests" : category === "structured" ? "structured" : "zh-CN",
    ),
);
const inputPath = resolve(outputRoot, "records", categoryFiles[category]);
if (!isPathInside(outputRoot, preflight.config.dataRoot))
  throw new Error(`AnimeGameData input must stay under the external data root: ${outputRoot}`);

const manifestPath = resolve(outputRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
const manifestUpstream = asRecord(manifest.upstream);
const manifestCommit =
  typeof manifestUpstream?.commit === "string"
    ? manifestUpstream.commit.trim()
    : typeof manifest.upstreamCommit === "string"
      ? manifest.upstreamCommit.trim()
      : undefined;
const manifestGameVersion =
  typeof manifest.gameVersion === "string" ? manifest.gameVersion.trim() : undefined;
const manifestLocale = typeof manifest.locale === "string" ? manifest.locale.trim() : undefined;
const manifestLocales = Array.isArray(manifest.locales)
  ? manifest.locales.filter((value): value is string => typeof value === "string")
  : [];
const manifestLanguage =
  typeof manifest.language === "string" ? manifest.language.trim() : undefined;
if (!manifestCommit || !manifestGameVersion || missingManifestLocale(category))
  throw new Error(
    "AnimeGameData Manifest is missing upstream Commit, game version, locale/language, or locales; regenerate the snapshot before importing",
  );
if (category === "quest") {
  const localeSet = new Set(manifestLocales);
  if (!localeSet.has("zh-CN") || !localeSet.has("en"))
    throw new Error(
      `AnimeGameData quest import requires bilingual zh-CN/en Manifest; received ${manifestLocales.join(", ")}`,
    );
} else if (
  category !== "structured" &&
  (manifestLocale !== "zh-CN" || manifestLanguage !== "CHS")
) {
  throw new Error(
    `AnimeGameData import only supports zh-CN/CHS in this phase; received ${manifestLocale}/${manifestLanguage}`,
  );
}
if (detectedCommit && manifestCommit !== detectedCommit)
  throw new Error(
    `AnimeGameData Manifest Commit ${manifestCommit} does not match checkout/configured Commit ${detectedCommit}`,
  );
const sourceLocaleLabel = category === "quest" ? manifestLocales.join("+") : manifestLocale;

function missingManifestLocale(targetCategory: Category): boolean {
  if (targetCategory === "quest") return !manifestLocales.length;
  if (targetCategory === "structured") return !manifestLocale;
  return !manifestLocale || !manifestLanguage;
}

async function readStructuredRecords(outputRootValue: string): Promise<StructuredImportRecords> {
  const recordsRoot = resolve(outputRootValue, "records");
  const readArray = async <T>(filename: string): Promise<T[]> => {
    const value = JSON.parse(await readFile(resolve(recordsRoot, filename), "utf8")) as unknown;
    if (!Array.isArray(value))
      throw new Error(`Structured records file is not an array: ${filename}`);
    return value as T[];
  };
  return {
    characters: await readArray("characters.json"),
    weapons: await readArray("weapons.json"),
    artifactSets: await readArray("artifact-sets.json"),
    artifacts: await readArray("artifacts.json"),
    materials: await readArray("materials.json"),
    achievements: await readArray("achievements.json"),
    enemies: await readArray("enemies.json"),
    voices: await readArray("voices.json"),
  };
}

const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
try {
  const game = (await repository.listGames()).find(
    (candidate) => candidate.slug === "genshin-impact",
  );
  if (!game) throw new Error("Seed the genshin-impact game before importing AnimeGameData");
  const sources = await repository.listSources(game.id);
  const parserType = `anime-game-data:${category}`;
  const source =
    sources.find((candidate) => candidate.parserType === parserType) ??
    (await repository.createSource({
      gameId: game.id,
      name: `AnimeGameData ${sourceLocaleLabel} ${manifestGameVersion} · ${category}`,
      type: "local_json",
      pathLabel: `records/${basename(inputPath)}`,
      licenseNote: "上游许可证未声明；仅限私有内部使用，待权利审查",
      enabled: true,
      parserType,
    }));
  const adapter = adapterFor("local_json");
  if (category === "structured") {
    const inspection = await adapter.inspect({
      sourceId: source.id,
      type: "local_json",
      path: manifestPath,
      storageDir: config.dataDir,
    });
    if (!inspection.supported) throw new Error(`Unsupported generated input: ${manifestPath}`);
    const snapshot = await adapter.snapshot({
      sourceId: source.id,
      type: "local_json",
      path: manifestPath,
      storageDir: config.dataDir,
    });
    const savedSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: snapshot.contentHash,
      storagePath: snapshot.storagePath,
      metadata: {
        ...snapshot.metadata,
        acquisition: "AnimeGameData",
        category,
        manifestPath: relative(process.cwd(), manifestPath) || ".",
        upstreamCommit: manifest.upstreamCommit,
        upstreamVersion: manifest.upstreamVersion,
        gameVersion: manifest.gameVersion,
        locale: manifest.locale,
        inputHashes: manifest.inputHashes,
        structuredContentHash: manifest.contentHash,
      },
    });
    const structuredRecords = await readStructuredRecords(outputRoot);
    const structuredKeys = Object.values(structuredRecords).flatMap((records) =>
      (records ?? []).map((record) => record.sourceKey),
    );
    const batch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: savedSnapshot.id,
      parserVersion: "anime-game-data-structured-import-1.0.0",
      stagedRecords: [],
      structuredRecords,
      errors: [],
      warnings: [
        ...inspection.warnings.map((message) => ({
          severity: "warning" as const,
          code: "inspection_warning",
          message,
        })),
      ],
      diff: {
        added: structuredKeys,
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    console.log(
      JSON.stringify(
        {
          batchId: batch.id,
          category,
          status: batch.status,
          records: batch.successCount,
          errors: batch.errors.length,
          warnings: batch.warnings.length,
          sourceSnapshotId: savedSnapshot.id,
          input: manifestPath,
        },
        null,
        2,
      ),
    );
  } else {
    const inspection = await adapter.inspect({
      sourceId: source.id,
      type: "local_json",
      path: inputPath,
      storageDir: config.dataDir,
    });
    if (!inspection.supported) throw new Error(`Unsupported generated input: ${inputPath}`);
    const snapshot = await adapter.snapshot({
      sourceId: source.id,
      type: "local_json",
      path: inputPath,
      storageDir: config.dataDir,
    });
    const savedSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: snapshot.contentHash,
      storagePath: snapshot.storagePath,
      metadata: {
        ...snapshot.metadata,
        acquisition: "AnimeGameData",
        category,
        manifestPath: relative(process.cwd(), manifestPath) || ".",
        upstream: manifest.upstream,
        gameVersion: manifest.gameVersion,
        locale: manifest.locale,
        locales: manifest.locales,
        language: manifest.language,
        inputHashes: manifest.inputHashes,
      },
    });
    const normalized = await normalizeSnapshot(snapshot, adapter);
    const previousKeys = await repository.getSourceRecordHashes(source.id);
    const knownEntityKeys = new Set((await repository.listEntitySourceKeys?.(game.id)) ?? []);
    const validation = validateImport(
      normalized.records,
      normalized.parseIssues,
      previousKeys,
      knownEntityKeys,
    );
    const conversionFailures = manifestFailureIssues(manifest, category);
    const errors = [...validation.errors, ...conversionFailures];
    const diff = computeDiff(normalized.records, previousKeys, [
      ...normalized.parseIssues,
      ...errors,
      ...validation.warnings,
    ]);
    const batch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: savedSnapshot.id,
      parserVersion: "anime-game-data-import-1.0.0",
      stagedRecords: normalized.records,
      errors,
      warnings: [
        ...validation.warnings,
        ...inspection.warnings.map((message) => ({
          severity: "warning" as const,
          code: "inspection_warning",
          message,
        })),
      ],
      diff,
    });
    console.log(
      JSON.stringify(
        {
          batchId: batch.id,
          category,
          status: batch.status,
          records: normalized.records.length,
          errors: errors.length,
          warnings: validation.warnings.length,
          sourceSnapshotId: savedSnapshot.id,
          input: inputPath,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await pool.end();
}
