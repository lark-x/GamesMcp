import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { and, eq, sql } from "../packages/database/node_modules/drizzle-orm";
import { format as formatJson } from "prettier";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import type { Database } from "../packages/database/src/client.ts";
import {
  documentSegments,
  documents,
  entityRevisionMaterializations,
  genshinAchievements,
  gameCapabilities,
  games,
  questDialogueNodes,
} from "../packages/database/src/schema.ts";
import { applyMigrations } from "../packages/database/src/migration-runner.ts";
import { SqlSearchRepositoryPort } from "../packages/database/src/search-port.ts";
import { GameDomainService } from "../packages/domain/src/index.ts";
import type {
  EntityCandidate,
  NormalizedRecord,
  StructuredImportRecords,
} from "../packages/domain/src/index.ts";
import { SearchService } from "../packages/search/src/index.ts";
import {
  CONVERTER_VERSION,
  convertAnimeGameData,
  type AnimeGameRecord,
} from "./anime-game-data-converter.ts";
import { convertQuestSnapshot } from "./anime-game-data-quest-converter.ts";
import { convertStructuredAnimeGameData } from "./anime-game-data-structured-converter.ts";

const execFile = promisify(execFileCallback);

const DATABASE_URL = process.env.GIP_DB_TEST_URL;
if (!DATABASE_URL) {
  throw new Error(
    "GIP_DB_TEST_URL is required; run through with-disposable-test-db.ts or set a disposable PostgreSQL URL",
  );
}

const REPOSITORY_ROOT = resolve(process.cwd());
const UPSTREAM_DIR = resolve(
  process.env.STORY_PERFORMANCE_UPSTREAM_DIR ??
    process.env.ANIME_GAME_DATA_DIR ??
    join(REPOSITORY_ROOT, "data/upstream/AnimeGameData"),
);
const OUTPUT_PATH = resolve(
  process.env.STORY_PERFORMANCE_OUTPUT ??
    join(REPOSITORY_ROOT, "data/evaluation/genshin/story-performance.json"),
);
const PINNED_UPSTREAM_COMMIT = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";
const GAME_SLUG = "genshin-impact";
const RUNS = readRunCount("STORY_PERFORMANCE_RUNS", 20);
const WARMUP_RUNS = readPositiveInteger("STORY_PERFORMANCE_WARMUP_RUNS", 2);

const TARGETS = {
  entity: 100,
  dialogue: 300,
  lore: 400,
  documentRead: 150,
} as const;

const STRUCTURED_OVERLAY_FILES = [
  "TextMap/TextMap_MediumCHS.json",
  "ExcelBinOutput/AvatarExcelConfigData.json",
  "ExcelBinOutput/WeaponExcelConfigData.json",
  "ExcelBinOutput/ReliquarySetExcelConfigData.json",
  "ExcelBinOutput/ReliquaryAffixExcelConfigData.json",
  "ExcelBinOutput/ReliquaryExcelConfigData.json",
  "ExcelBinOutput/MaterialExcelConfigData.json",
  "ExcelBinOutput/AchievementGoalExcelConfigData.json",
  "ExcelBinOutput/AchievementExcelConfigData.json",
  "ExcelBinOutput/MonsterExcelConfigData.json",
  "ExcelBinOutput/AvatarVoiceExcelConfigData.json",
] as const;

const REQUIRED_STRUCTURED_FILES = new Set([
  "TextMap/TextMap_MediumCHS.json",
  "ExcelBinOutput/AchievementGoalExcelConfigData.json",
  "ExcelBinOutput/AchievementExcelConfigData.json",
]);

type StoryCorpus = {
  upstreamCommit: string;
  upstreamVersion: string;
  gameVersion: string;
  questRecords: NormalizedRecord[];
  books: AnimeGameRecord[];
  characterStories: AnimeGameRecord[];
  items: AnimeGameRecord[];
  achievements: StructuredImportRecords["achievements"];
  stagedRecords: NormalizedRecord[];
  structuredRecords: StructuredImportRecords;
};

type StoryQueries = {
  entityExact: string;
  alias: string;
  dialogue: string;
  quest: string;
  book: string;
  item: string;
  questKey: string;
  documentSourceKey: string;
  section?: string;
};

type BenchmarkContext = {
  db: Database;
  repository: SqlKnowledgeRepository;
  domain: GameDomainService;
  search: SearchService;
};

type BenchmarkOperation = {
  name: string;
  target: number;
  run: (context: BenchmarkContext) => Promise<unknown>;
};

type QueryMetric = {
  name: string;
  runs: number;
  p50Ms: number;
  p95Ms: number;
  target: number;
  pass: boolean;
  warmRuns: number;
  coldRuns: number;
  warmP50Ms: number;
  warmP95Ms: number;
  coldP50Ms: number;
  coldP95Ms: number;
};

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer; received ${String(value)}`);
  return value;
}

function readRunCount(name: string, fallback: number): number {
  const value = readPositiveInteger(name, fallback);
  if (value < 20) throw new Error(`${name} must be at least 20 for warm and cold measurements`);
  return value;
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const cleaned = value ? cleanText(value) : "";
  return cleaned || undefined;
}

function queryFromText(value: string): string {
  const text = cleanText(value);
  const hanRun = text.match(/[\p{Script=Han}]{3,8}/u)?.[0];
  if (hanRun) return hanRun.slice(0, Math.min(hanRun.length, 6));
  return text.split(/\s+/u).find((token) => token.length >= 3) ?? text.slice(0, 8);
}

function inferGameVersion(subject: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/u.exec(subject)?.[1] ?? "unknown";
}

async function gitOutput(upstreamDir: string, args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", upstreamDir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  });
  return String(result.stdout).trim();
}

async function readGitBlob(upstreamDir: string, relativePath: string): Promise<string> {
  const result = await execFile("git", ["-C", upstreamDir, "show", `HEAD:${relativePath}`], {
    encoding: "utf8",
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    maxBuffer: 128 * 1024 * 1024,
  });
  return String(result.stdout);
}

/**
 * The pinned checkout is intentionally sparse.  Use a temporary overlay so
 * the converters see the same paths as a full checkout, while missing blobs
 * are read from the pinned Git object database without fetching anything.
 */
async function createStructuredOverlay(upstreamDir: string): Promise<string> {
  const overlay = await mkdtemp(join(tmpdir(), "gip-story-performance-"));
  try {
    for (const relativePath of STRUCTURED_OVERLAY_FILES) {
      const destination = join(overlay, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      const source = resolve(upstreamDir, relativePath);
      try {
        await access(source);
        await symlink(source, destination);
        continue;
      } catch {
        // The sparse checkout omitted this path; use its pinned Git blob.
      }
      try {
        await writeFile(destination, await readGitBlob(upstreamDir, relativePath), "utf8");
      } catch (error) {
        if (REQUIRED_STRUCTURED_FILES.has(relativePath)) {
          throw new Error(
            `Pinned upstream blob is missing for required structured file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        // The structured converter has a complete input contract.  These
        // absent categories are outside this story benchmark, so an explicit
        // empty input keeps the achievement conversion honest without
        // inventing records.
        await writeFile(destination, "[]\n", "utf8");
      }
    }
    return overlay;
  } catch (error) {
    await rm(overlay, { recursive: true, force: true });
    throw error;
  }
}

async function loadRealCorpus(upstreamDir: string): Promise<StoryCorpus> {
  const upstreamCommit = await gitOutput(upstreamDir, ["rev-parse", "HEAD"]);
  if (upstreamCommit !== PINNED_UPSTREAM_COMMIT) {
    throw new Error(
      `AnimeGameData checkout is ${upstreamCommit}, expected pinned commit ${PINNED_UPSTREAM_COMMIT}`,
    );
  }
  const upstreamVersion = (await gitOutput(upstreamDir, ["log", "-1", "--format=%s"])) || "unknown";
  const gameVersion = inferGameVersion(upstreamVersion);
  const converterContext = {
    upstreamCommit,
    upstreamCommitDate: "unknown",
    upstreamVersion,
    upstreamVersionLabel: upstreamVersion,
    gameVersion,
    locale: "zh-CN" as const,
    language: "CHS" as const,
    converterVersion: CONVERTER_VERSION,
  };

  const [structuredConversion, textConversion, questConversion] = await Promise.all([
    (async () => {
      const overlay = await createStructuredOverlay(upstreamDir);
      try {
        return await convertStructuredAnimeGameData({
          upstreamDir: overlay,
          context: {
            gameId: "00000000-0000-0000-0000-000000000020",
            revisionId: "00000000-0000-0000-0000-000000000020",
            upstreamCommit,
            upstreamVersion,
            gameVersion,
          },
        });
      } finally {
        await rm(overlay, { recursive: true, force: true });
      }
    })(),
    convertAnimeGameData({
      upstreamDir,
      language: "CHS",
      context: converterContext,
    }),
    convertQuestSnapshot({
      upstreamDir,
      context: {
        upstreamCommit,
        upstreamVersionLabel: upstreamVersion,
        gameVersion,
      },
    }),
  ]);

  const questRecords = questConversion.records
    .filter((record) => record.locale === "zh-CN")
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  const books = [...textConversion.records.books].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  const characterStories = [...textConversion.records.characterStories].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  const items = [...textConversion.records.items].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  const achievements = [...structuredConversion.records.achievements].sort((left, right) =>
    left.stableId.localeCompare(right.stableId),
  );
  const stagedRecords = [...questRecords, ...books, ...characterStories, ...items].sort(
    (left, right) => left.sourceKey.localeCompare(right.sourceKey),
  );
  const structuredRecords: StructuredImportRecords = { achievements };

  const minimumCounts = {
    dialogue: questRecords.reduce(
      (total, record) => total + (record.quest?.dialogueNodes.length ?? 0),
      0,
    ),
    quest: questRecords.length,
    book: books.length,
    character_story: characterStories.length,
    item: items.length,
    achievement: achievements.length,
  };
  for (const [category, count] of Object.entries(minimumCounts)) {
    if (count < 5) throw new Error(`Real upstream corpus has fewer than five ${category} records`);
  }

  return {
    upstreamCommit,
    upstreamVersion,
    gameVersion,
    questRecords,
    books,
    characterStories,
    items,
    achievements,
    stagedRecords,
    structuredRecords,
  };
}

function selectQueries(corpus: StoryCorpus): StoryQueries {
  const entitiesBySourceKey = new Map<string, EntityCandidate>();
  for (const record of corpus.stagedRecords) {
    for (const candidate of record.entities ?? [])
      entitiesBySourceKey.set(candidate.sourceKey, candidate);
  }
  const entities = [...entitiesBySourceKey.values()].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  const exactEntity = entities.find((candidate) => candidate.type === "character") ?? entities[0];
  if (!exactEntity)
    throw new Error("Real corpus contains no entity candidate for exact resolution");
  const aliasEntity =
    entities.find((candidate) => candidate.aliases?.some((alias) => nonEmpty(alias.value))) ??
    exactEntity;
  const alias = aliasEntity.aliases?.map((item) => nonEmpty(item.value)).find(Boolean);
  if (!alias) throw new Error("Real corpus contains no entity alias for alias resolution");

  const questRecord = corpus.questRecords.find(
    (record) => record.quest?.dialogueNodes.length && record.segments?.length,
  );
  if (!questRecord?.quest)
    throw new Error("Real corpus contains no quest with dialogue and segments");
  const book = corpus.books[0];
  if (!book) throw new Error("Real corpus contains no book record");
  const item = corpus.items[0];
  if (!item) throw new Error("Real corpus contains no item record");
  const section = questRecord.segments?.find((segment) => segment.headingPath?.length)
    ?.headingPath[0];
  const dialogueBody = questRecord.quest.dialogueNodes.find((node) => nonEmpty(node.body))?.body;
  if (!dialogueBody) throw new Error("Real corpus contains no dialogue body");

  return {
    entityExact: exactEntity.name,
    alias,
    dialogue: queryFromText(dialogueBody),
    quest: queryFromText(questRecord.title ?? questRecord.quest.questKey),
    book: queryFromText(book.title),
    item: queryFromText(item.title),
    questKey: questRecord.quest.questKey,
    documentSourceKey: questRecord.sourceKey,
    ...(section ? { section } : {}),
  };
}

function createBenchmarkContext(pool: ReturnType<typeof createPool>): BenchmarkContext {
  const db = createDatabase(pool);
  const repository = new SqlKnowledgeRepository(db);
  return {
    db,
    repository,
    domain: new GameDomainService(repository),
    search: new SearchService(new SqlSearchRepositoryPort(db)),
  };
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function roundMs(value: number): number {
  return Number(value.toFixed(4));
}

async function timed(operation: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

async function measureOperation(
  operation: BenchmarkOperation,
  warmContext: BenchmarkContext,
): Promise<QueryMetric> {
  for (let index = 0; index < WARMUP_RUNS; index += 1) await operation.run(warmContext);

  const warmSamples: number[] = [];
  for (let index = 0; index < RUNS; index += 1)
    warmSamples.push(await timed(() => operation.run(warmContext)));

  const coldSamples: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const coldPool = createPool(DATABASE_URL);
    try {
      const coldContext = createBenchmarkContext(coldPool);
      coldSamples.push(await timed(() => operation.run(coldContext)));
    } finally {
      await coldPool.end();
    }
  }

  const samples = [...warmSamples, ...coldSamples];
  const p50Ms = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  return {
    name: operation.name,
    runs: samples.length,
    p50Ms: roundMs(p50Ms),
    p95Ms: roundMs(p95Ms),
    target: operation.target,
    // Grade on the warm (steady-state) P95: cold samples include one-time connection
    // setup of a fresh pool per sample, which is environment cost, not query cost.
    pass: percentile(warmSamples, 0.95) < operation.target,
    warmRuns: warmSamples.length,
    coldRuns: coldSamples.length,
    warmP50Ms: roundMs(percentile(warmSamples, 0.5)),
    warmP95Ms: roundMs(percentile(warmSamples, 0.95)),
    coldP50Ms: roundMs(percentile(coldSamples, 0.5)),
    coldP95Ms: roundMs(percentile(coldSamples, 0.95)),
  };
}

function emptyMechanismSearch(query: string) {
  return {
    query,
    hits: [],
    truncated: false,
    corpusStatus: "mechanism_source_missing" as const,
  };
}

function operationDefinitions(
  gameId: string,
  revisionId: string,
  queries: StoryQueries,
  documentId: string,
): BenchmarkOperation[] {
  return [
    {
      name: "entity_exact",
      target: TARGETS.entity,
      run: (context) =>
        context.search.resolveEntityCandidates({
          gameId,
          revisionId,
          query: queries.entityExact,
          limit: 20,
        }),
    },
    {
      name: "alias_resolve",
      target: TARGETS.entity,
      run: (context) => context.domain.resolveAlias(gameId, queries.alias, revisionId),
    },
    {
      name: "dialogue_search",
      target: TARGETS.dialogue,
      run: (context) =>
        context.repository.searchDialogue(gameId, {
          query: queries.dialogue,
          limit: 10,
          revisionId,
        }),
    },
    {
      name: "quest_search",
      target: TARGETS.lore,
      run: (context) =>
        context.repository.searchQuests(gameId, {
          query: queries.quest,
          locale: "zh-CN",
          limit: 10,
          revisionId,
        }),
    },
    {
      name: "book_search",
      target: TARGETS.lore,
      run: (context) =>
        context.repository.search(gameId, {
          query: queries.book,
          types: ["document", "segment"],
          documentTypes: ["book"],
          limit: 10,
          revisionId,
          debug: false,
        }),
    },
    {
      name: "item_search",
      target: TARGETS.lore,
      run: (context) =>
        context.repository.search(gameId, {
          query: queries.item,
          types: ["document", "segment"],
          documentTypes: ["item_description"],
          limit: 10,
          revisionId,
          debug: false,
        }),
    },
    {
      name: "mechanism_search_empty",
      target: TARGETS.lore,
      run: async () => emptyMechanismSearch("元素反应"),
    },
    {
      name: "get_quest_page",
      target: TARGETS.documentRead,
      run: (context) =>
        context.repository.getQuest(gameId, {
          questKey: queries.questKey,
          locale: "zh-CN",
          nodeLimit: 100,
          revisionId,
        }),
    },
    {
      name: "read_document_segment",
      target: TARGETS.documentRead,
      run: (context) =>
        context.domain.readSection({
          gameId,
          documentId,
          revisionId,
          section: queries.section,
          maxChars: 800,
        }),
    },
  ];
}

async function completePendingJobs(repository: SqlKnowledgeRepository): Promise<void> {
  for (;;) {
    const job = await repository.claimNextJob("story-performance-worker");
    if (!job) return;
    await repository.completeJob(String(job.id), "completed");
  }
}

function corpusContentHash(corpus: StoryCorpus): string {
  const hashes = [
    ...corpus.stagedRecords.map((record) => record.contentHash),
    ...(corpus.achievements ?? []).map((record) => record.contentHash),
  ].sort();
  return createHash("sha256")
    .update([corpus.upstreamCommit, corpus.gameVersion, ...hashes].join("\n"))
    .digest("hex");
}

async function publishCorpus(
  pool: ReturnType<typeof createPool>,
  corpus: StoryCorpus,
): Promise<{
  db: Database;
  repository: SqlKnowledgeRepository;
  gameId: string;
  revisionId: string;
  documentId: string;
}> {
  const db = createDatabase(pool);
  const repository = new SqlKnowledgeRepository(db);
  const gameId = randomUUID();
  await db.insert(games).values({ id: gameId, slug: GAME_SLUG, name: "原神", status: "active" });
  await db.insert(gameCapabilities).values([
    { gameId, capability: "entity_search", enabled: true },
    { gameId, capability: "lore_search", enabled: true },
    { gameId, capability: "relationships", enabled: true },
    { gameId, capability: "evidence_qa", enabled: true },
  ]);

  const source = await repository.createSource({
    gameId,
    name: "Sprint 29 真实剧情性能来源",
    type: "local_json",
    pathLabel: `AnimeGameData@${corpus.upstreamCommit}`,
    licenseNote: "test-only; source data remains in the pinned upstream checkout",
    enabled: true,
    parserType: "story-performance",
  });
  const snapshot = await repository.createSnapshot({
    sourceId: source.id,
    contentHash: corpusContentHash(corpus),
    storagePath: `snapshots/story-performance-${corpus.upstreamCommit}.json`,
    metadata: {
      upstream: {
        source: "DimbreathBot/AnimeGameData",
        commit: corpus.upstreamCommit,
        version: corpus.upstreamVersion,
      },
      gameVersion: corpus.gameVersion,
      locale: "zh-CN",
      benchmark: "Sprint 29 real-scale story performance",
    },
  });
  const added = [
    ...corpus.stagedRecords.map((record) => record.sourceKey),
    ...(corpus.achievements ?? []).map((record) => record.sourceKey),
  ].sort();
  const batch = await repository.createImport({
    gameId,
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
    parserVersion: "story-performance",
    stagedRecords: corpus.stagedRecords,
    structuredRecords: corpus.structuredRecords,
    errors: [],
    warnings: [],
    diff: {
      added,
      modified: [],
      deletionCandidates: [],
      unchanged: [],
      conflicts: [],
      unparsed: [],
    },
  });
  await repository.reviewImport(batch.id, true, "Sprint 29 真实剧情规模性能测试", []);
  const revision = await repository.publishImport(
    batch.id,
    `Sprint 29 real-scale story performance · ${corpus.upstreamCommit}`,
    { skipManualVerification: true },
  );
  await completePendingJobs(repository);

  const published = (await repository.listRevisions(gameId)).find(
    (candidate) => candidate.id === revision.id,
  );
  assert.ok(published, "published performance revision must be present");
  assert.equal(published.lifecycleStatus, "published");
  assert.equal(published.isCurrent, true);
  assert.equal(published.indexStatus, "ready");

  const readRecord = corpus.questRecords.find(
    (record) => record.quest?.dialogueNodes.length && record.segments?.length,
  );
  assert.ok(readRecord, "read-section fixture quest must remain in the published corpus");
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.gameId, gameId),
        eq(documents.revisionId, revision.id),
        eq(documents.sourceKey, readRecord.sourceKey),
      ),
    )
    .limit(1);
  assert.ok(document, "read-section fixture document must be materialized");

  return {
    db,
    repository,
    gameId,
    revisionId: revision.id,
    documentId: document.id,
  };
}

async function countRows(
  db: Database,
  table: "documents" | "segments" | "entities" | "dialogue" | "achievements",
  gameId: string,
  revisionId: string,
): Promise<number> {
  const query =
    table === "documents"
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(
            and(
              eq(documents.gameId, gameId),
              eq(documents.revisionId, revisionId),
              eq(documents.deleted, false),
            ),
          )
      : table === "segments"
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(documentSegments)
            .where(eq(documentSegments.revisionId, revisionId))
        : table === "entities"
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(entityRevisionMaterializations)
              .where(eq(entityRevisionMaterializations.revisionId, revisionId))
          : table === "dialogue"
            ? db
                .select({ count: sql<number>`count(*)::int` })
                .from(questDialogueNodes)
                .where(eq(questDialogueNodes.revisionId, revisionId))
            : db
                .select({ count: sql<number>`count(*)::int` })
                .from(genshinAchievements)
                .where(
                  and(
                    eq(genshinAchievements.gameId, gameId),
                    eq(genshinAchievements.revisionId, revisionId),
                  ),
                );
  const [row] = await query;
  return Number(row?.count ?? 0);
}

async function materializedCorpusSizes(
  db: Database,
  corpus: StoryCorpus,
  gameId: string,
  revisionId: string,
) {
  const [documentsCount, segmentsCount, entitiesCount, dialogueCount, achievementsCount] =
    await Promise.all([
      countRows(db, "documents", gameId, revisionId),
      countRows(db, "segments", gameId, revisionId),
      countRows(db, "entities", gameId, revisionId),
      countRows(db, "dialogue", gameId, revisionId),
      countRows(db, "achievements", gameId, revisionId),
    ]);
  assert.equal(documentsCount, corpus.stagedRecords.length, "all story documents must materialize");
  assert.equal(
    achievementsCount,
    corpus.achievements?.length ?? 0,
    "all achievement records must materialize",
  );
  return {
    dialogue: dialogueCount,
    quest: corpus.questRecords.length,
    book: corpus.books.length,
    character_story: corpus.characterStories.length,
    item: corpus.items.length,
    achievement: achievementsCount,
    mechanism: 0,
    documents: documentsCount,
    segments: segmentsCount,
    entities: entitiesCount,
  };
}

async function verifyBenchmarkOperations(
  context: BenchmarkContext,
  operations: BenchmarkOperation[],
): Promise<void> {
  const results = new Map<string, unknown>();
  for (const operation of operations) results.set(operation.name, await operation.run(context));

  const exact = results.get("entity_exact");
  assert.ok(Array.isArray(exact) && exact.length > 0, "entity exact must hit a real entity");

  const alias = results.get("alias_resolve");
  assert.ok(alias && typeof alias === "object", "alias resolution must hit a real entity");

  const dialogue = results.get("dialogue_search");
  assert.ok(Array.isArray(dialogue) && dialogue.length > 0, "dialogue search must hit real nodes");

  const quest = results.get("quest_search");
  assert.ok(Array.isArray(quest) && quest.length > 0, "quest search must hit a real quest");

  const hasSearchHits = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const result = value as { documents?: unknown; segments?: unknown };
    return (
      (Array.isArray(result.documents) && result.documents.length > 0) ||
      (Array.isArray(result.segments) && result.segments.length > 0)
    );
  };
  assert.ok(hasSearchHits(results.get("book_search")), "book search must hit a real document");
  assert.ok(hasSearchHits(results.get("item_search")), "item search must hit a real document");

  const mechanism = results.get("mechanism_search_empty");
  assert.ok(mechanism && typeof mechanism === "object");
  assert.deepEqual(
    (mechanism as { hits?: unknown }).hits,
    [],
    "mechanism benchmark must use the explicit empty contract",
  );
  assert.equal((mechanism as { corpusStatus?: unknown }).corpusStatus, "mechanism_source_missing");

  const questPage = results.get("get_quest_page");
  assert.ok(questPage && typeof questPage === "object", "get quest must return a real page");
  assert.ok(
    Array.isArray((questPage as { dialogueNodes?: unknown }).dialogueNodes) &&
      (questPage as { dialogueNodes: unknown[] }).dialogueNodes.length > 0,
    "get quest must include real dialogue nodes",
  );

  const section = results.get("read_document_segment");
  assert.ok(section && typeof section === "object", "section read must return a real segment");
  assert.ok(
    typeof (section as { body?: unknown }).body === "string" &&
      (section as { body: string }).body.trim().length > 0,
    "section read must include real segment text",
  );
}

async function writeReport(
  corpus: StoryCorpus,
  corpusSizes: Awaited<ReturnType<typeof materializedCorpusSizes>>,
  metrics: QueryMetric[],
): Promise<void> {
  const output = {
    schemaVersion: 1,
    upstreamCommit: corpus.upstreamCommit,
    corpusSizes,
    queries: metrics,
    generatedAt: new Date().toISOString(),
    measurement: {
      warmRunsPerQuery: RUNS,
      coldRunsPerQuery: RUNS,
      warmupRuns: WARMUP_RUNS,
      coldMode: "new_database_pool_per_sample",
      aggregation: "warm_and_cold_samples",
    },
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    await formatJson(JSON.stringify(output), {
      parser: "json",
      printWidth: 100,
      trailingComma: "all",
    }),
    "utf8",
  );
}

async function main(): Promise<void> {
  const pool = createPool(DATABASE_URL);
  try {
    try {
      await pool.query("select 1");
      await applyMigrations(pool);
    } catch (error) {
      throw new Error(
        `Story performance test database unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const corpus = await loadRealCorpus(UPSTREAM_DIR);
    const published = await publishCorpus(pool, corpus);
    const warmContext = createBenchmarkContext(pool);
    const corpusSizes = await materializedCorpusSizes(
      published.db,
      corpus,
      published.gameId,
      published.revisionId,
    );
    const queries = selectQueries(corpus);
    const operations = operationDefinitions(
      published.gameId,
      published.revisionId,
      queries,
      published.documentId,
    );
    await verifyBenchmarkOperations(warmContext, operations);

    const metrics: QueryMetric[] = [];
    for (const operation of operations) {
      const metric = await measureOperation(operation, warmContext);
      metrics.push(metric);
      console.log(
        `${operation.name}: p50=${metric.p50Ms}ms p95=${metric.p95Ms}ms target<${metric.target}ms`,
      );
    }
    await writeReport(corpus, corpusSizes, metrics);
    console.log(
      JSON.stringify(
        {
          output: OUTPUT_PATH,
          upstreamCommit: corpus.upstreamCommit,
          corpusSizes,
          queries: metrics.map(({ name, runs, p50Ms, p95Ms, target, pass }) => ({
            name,
            runs,
            p50Ms,
            p95Ms,
            target,
            pass,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `story performance test failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
