import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
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
import type { NormalizedRecord, StructuredImportRecords } from "../packages/domain/src/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.js";

const categoryFiles = {
  book: "books.json",
  character_story: "character-stories.json",
  item_description: "items.json",
  mechanism: "mechanisms.json",
  quest: "quests.json",
  structured: "manifest.json",
} as const;

// PostgreSQL limits the total size of one JSONB array element payload.  Quest
// records can legitimately exceed that limit after dialogue recovery, so keep
// each staged import payload comfortably below it and let the release
// candidate merge the chunks back together.
// Keep the in-memory and PostgreSQL JSONB copies bounded.  The importer keeps
// one chunk while the database client serializes it and acquisition-preview
// hooks inspect it, so a nominally 160 MB chunk can briefly occupy several
// times that amount on the V8 heap.
const MAX_STAGED_RECORD_BYTES = 32_000_000;

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

function chunkRecordsByBytes<T>(records: T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record));
    if (current.length && currentBytes + recordBytes + 1 > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(record);
    currentBytes += recordBytes + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Stream the generated pre-normalized quest array without materializing the
 * 500MB+ JSON file as one V8 string. */
async function* streamNormalizedQuestRecords(path: string): AsyncGenerator<NormalizedRecord> {
  let arrayStarted = false;
  let arrayFinished = false;
  let recordActive = false;
  let recordDepth = 0;
  let inString = false;
  let escaped = false;
  let recordParts: string[] = [];

  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    let segmentStart = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index]!;
      if (!arrayStarted) {
        if (/\s/u.test(char)) continue;
        if (char !== "[") throw new Error(`Quest records must be a JSON array: ${path}`);
        arrayStarted = true;
        segmentStart = index + 1;
        continue;
      }
      if (arrayFinished) {
        if (!/\s/u.test(char)) throw new Error(`Unexpected content after quest records: ${path}`);
        continue;
      }
      if (!recordActive) {
        if (/\s|,/u.test(char)) {
          segmentStart = index + 1;
          continue;
        }
        if (char === "]") {
          arrayFinished = true;
          segmentStart = index + 1;
          continue;
        }
        if (char !== "{") throw new Error(`Quest record is not an object: ${path}`);
        recordActive = true;
        recordDepth = 1;
        inString = false;
        escaped = false;
        recordParts = [];
        segmentStart = index;
        continue;
      }

      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        recordDepth += 1;
      } else if (char === "}") {
        recordDepth -= 1;
        if (recordDepth === 0) {
          recordParts.push(chunk.slice(segmentStart, index + 1));
          const parsed = JSON.parse(recordParts.join("")) as NormalizedRecord;
          yield parsed;
          recordParts = [];
          recordActive = false;
          segmentStart = index + 1;
        }
      }
    }
    if (recordActive) recordParts.push(chunk.slice(segmentStart));
  }

  if (!arrayStarted || recordActive || !arrayFinished)
    throw new Error(`Truncated quest records JSON: ${path}`);
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
    const previousKeys = await repository.getSourceRecordHashes(source.id);
    const knownEntityKeys = new Set((await repository.listEntitySourceKeys?.(game.id)) ?? []);
    const conversionFailures = manifestFailureIssues(manifest, category);
    // Do not retain the ImportBatch objects here: each one contains the full
    // staged JSONB payload.  Retaining them made a multi-chunk quest import
    // grow until the Node heap was exhausted even though each DB write had
    // already completed.
    const batchIds: string[] = [];
    let hasFailedBatch = false;
    let batchCount = 0;
    let recordCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    const createBatch = async (
      records: NormalizedRecord[],
      lastChunk: boolean,
      deletionCandidates: string[],
    ) => {
      const validation = validateImport(records, [], previousKeys, knownEntityKeys);
      const errors = [...validation.errors, ...(lastChunk ? conversionFailures : [])];
      const warnings = [
        ...validation.warnings,
        ...inspection.warnings.map((message) => ({
          severity: "warning" as const,
          code: "inspection_warning",
          message,
        })),
      ];
      const diff = computeDiff(records, previousKeys, [...errors, ...warnings]);
      diff.deletionCandidates = lastChunk ? deletionCandidates : [];
      const batch = await repository.createImport({
        gameId: game.id,
        sourceId: source.id,
        sourceSnapshotId: savedSnapshot.id,
        parserVersion: "anime-game-data-import-1.0.0",
        stagedRecords: records,
        skipPreview: category === "quest",
        errors,
        warnings,
        diff,
      });
      batchIds.push(batch.id);
      hasFailedBatch ||= batch.status === "failed";
      batchCount += 1;
      errorCount += errors.length;
      warningCount += warnings.length;
    };

    if (category === "quest") {
      const currentKeys = new Set<string>();
      let currentChunk: NormalizedRecord[] = [];
      let currentBytes = 2;
      let pendingChunk: NormalizedRecord[] | undefined;
      for await (const record of streamNormalizedQuestRecords(inputPath)) {
        currentKeys.add(record.sourceKey);
        recordCount += 1;
        const recordBytes = Buffer.byteLength(JSON.stringify(record));
        if (currentChunk.length && currentBytes + recordBytes + 1 > MAX_STAGED_RECORD_BYTES) {
          if (pendingChunk) await createBatch(pendingChunk, false, []);
          pendingChunk = currentChunk;
          currentChunk = [];
          currentBytes = 2;
        }
        currentChunk.push(record);
        currentBytes += recordBytes + 1;
      }
      if (currentChunk.length > 0) {
        if (pendingChunk) await createBatch(pendingChunk, false, []);
        pendingChunk = currentChunk;
      }
      if (!pendingChunk) pendingChunk = [];
      const deletionCandidates = [...previousKeys.keys()].filter((key) => !currentKeys.has(key));
      await createBatch(pendingChunk, true, deletionCandidates);
    } else {
      const normalized = await normalizeSnapshot(snapshot, adapter);
      const validation = validateImport(
        normalized.records,
        normalized.parseIssues,
        previousKeys,
        knownEntityKeys,
      );
      const chunks = chunkRecordsByBytes(normalized.records, MAX_STAGED_RECORD_BYTES);
      if (!chunks.length) chunks.push([]);
      const currentKeys = new Set(normalized.records.map((record) => record.sourceKey));
      const deletionCandidates = [...previousKeys.keys()].filter((key) => !currentKeys.has(key));
      for (let index = 0; index < chunks.length; index += 1) {
        const records = chunks[index]!;
        const lastChunk = index === chunks.length - 1;
        const errors = lastChunk ? [...validation.errors, ...conversionFailures] : [];
        const warnings = [
          ...(lastChunk ? validation.warnings : []),
          ...inspection.warnings.map((message) => ({
            severity: "warning" as const,
            code: "inspection_warning",
            message,
          })),
        ];
        const diff = computeDiff(records, previousKeys, [
          ...normalized.parseIssues,
          ...errors,
          ...warnings,
        ]);
        diff.deletionCandidates = lastChunk ? deletionCandidates : [];
        const batch = await repository.createImport({
          gameId: game.id,
          sourceId: source.id,
          sourceSnapshotId: savedSnapshot.id,
          parserVersion: "anime-game-data-import-1.0.0",
          stagedRecords: records,
          errors,
          warnings,
          diff,
        });
        batchIds.push(batch.id);
        hasFailedBatch ||= batch.status === "failed";
        batchCount += 1;
      }
      recordCount = normalized.records.length;
      errorCount = validation.errors.length + conversionFailures.length;
      warningCount = validation.warnings.length + inspection.warnings.length;
    }
    console.log(
      JSON.stringify(
        {
          batchIds,
          category,
          status: hasFailedBatch ? "failed" : "review_required",
          records: recordCount,
          chunks: batchCount,
          errors: errorCount,
          warnings: warningCount,
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
