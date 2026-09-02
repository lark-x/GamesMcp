import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { format as formatJson } from "prettier";
import type { DocumentType, GenshinAchievement } from "../packages/contracts/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import type { Database } from "../packages/database/src/client.ts";
import { SqlSearchRepositoryPort } from "../packages/database/src/search-port.ts";
import { loadConfig } from "../packages/config/src/index.ts";
import type { NormalizedRecord } from "../packages/domain/src/index.ts";
import {
  SearchService,
  type DialogueSearchFilters,
  type EntityCandidateSearchRequest,
  type ResolverCandidate,
  type SearchRepositoryPort,
  type StructuredSearchKind,
} from "../packages/search/src/index.ts";
import {
  CONVERTER_VERSION,
  convertAnimeGameData,
  type AnimeGameRecord,
} from "./anime-game-data-converter.ts";
import { convertQuestSnapshot } from "./anime-game-data-quest-converter.ts";
import { convertStructuredAnimeGameData } from "./anime-game-data-structured-converter.ts";

const execFile = promisify(execFileCallback);

const REPOSITORY_ROOT = resolve(process.cwd());
const DEFAULT_UPSTREAM_DIR = resolve(
  process.env.SEARCH_REGRESSION_UPSTREAM_DIR ??
    process.env.ANIME_GAME_DATA_DIR ??
    join(REPOSITORY_ROOT, "data/upstream/AnimeGameData"),
);
const OUTPUT_PATH = resolve(
  process.env.SEARCH_REGRESSION_OUTPUT ??
    join(REPOSITORY_ROOT, "data/evaluation/genshin/search-regression.json"),
);
const FIXTURE_PATH = resolve(
  process.env.SEARCH_REGRESSION_FIXTURE ??
    join(REPOSITORY_ROOT, "data/fixtures/search-golden.json"),
);
const PINNED_UPSTREAM_COMMIT = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";
const GAME_SLUG = process.env.GAME_SLUG ?? "genshin-impact";
const MEMORY_GAME_ID = "00000000-0000-0000-0000-000000000017";
const MEMORY_REVISION_ID = `published-memory:${PINNED_UPSTREAM_COMMIT}`;
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

const EVALUATED_CATEGORIES = [
  "dialogue",
  "quest",
  "book",
  "character_story",
  "item",
  "achievement",
] as const;
type EvaluatedCategory = (typeof EVALUATED_CATEGORIES)[number];
type ExcludedCategory = "voice" | "tutorial" | "mechanism";
type Category = EvaluatedCategory | ExcludedCategory;

const QUEST_TYPES = new Set<DocumentType>([
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
  "commission",
  "hangout",
  "other",
]);

/** Deterministic RFC-4122 v5-style UUID from a stable key (sha1, version 5, RFC variant). */
export function deterministicUuid(key: string): string {
  const hash = createHash("sha1").update(key).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export type CorpusDocument = {
  key: string;
  category: Exclude<EvaluatedCategory, "dialogue" | "achievement">;
  id: string;
  sourceKey: string;
  title: string;
  body: string;
  type: DocumentType;
  locale: string;
};

export type CorpusDialogue = {
  key: string;
  documentId: string;
  nodeKey: string;
  questKey: string;
  subquestKey: string | null;
  title: string;
  body: string;
  speaker: string | null;
  questType: string;
  locale: string;
};

type CorpusStructured = {
  key: string;
  kind: StructuredSearchKind;
  stableId: string;
  name: string;
  body: string;
};

export type Corpus = {
  source: "real-upstream" | "fixture";
  upstreamCommit: string;
  upstreamVersion: string;
  locale: string;
  documents: CorpusDocument[];
  dialogue: CorpusDialogue[];
  structured: CorpusStructured[];
  counts: Record<EvaluatedCategory, number>;
  conversion: Record<string, number>;
  sourceDescription: string;
};

type QueryCase = {
  id: string;
  query: string;
  relevantKey: string;
  evidence: {
    title: string;
    text: string;
  };
};

type QueryResult = QueryCase & {
  rank: number | null;
  hitAt5: boolean;
  hitAt10: boolean;
  reciprocalRankAt10: number;
  returned: string[];
};

type EvaluatedCategoryResult = {
  status: "evaluated";
  queryCount: number;
  metrics: {
    "hit@5": number;
    "hit@10": number;
    "MRR@10": number;
    hitAt5: number;
    hitAt10: number;
    mrrAt10: number;
  };
  queries: QueryResult[];
};

type ExcludedCategoryResult = {
  status: "excluded";
  queryCount: 0;
  reason: string;
};

type CategoryResult = EvaluatedCategoryResult | ExcludedCategoryResult;

type SearchRunner = {
  db: boolean;
  adapter: "postgresql" | "memory";
  revision: {
    id: string;
    lifecycleStatus: "published";
    indexStatus: "ready";
    isCurrent: boolean;
  };
  search(category: EvaluatedCategory, query: string): Promise<string[]>;
};

type DatabaseAttempt = {
  runner: SearchRunner | null;
  reason?: string;
  close: () => Promise<void>;
};

class MemorySearchRepository implements SearchRepositoryPort {
  constructor(
    private readonly documents: CorpusDocument[],
    private readonly dialogue: CorpusDialogue[],
    private readonly structured: CorpusStructured[],
  ) {}

  async listStructuredAtRevision(gameId: string, revisionId: string, query: string) {
    void gameId;
    void revisionId;
    void query;
    return this.structured.map((item) => ({
      kind: item.kind,
      stableId: item.stableId,
      name: item.name,
      aliases: [],
      body: item.body,
    }));
  }

  async resolveEntityCandidates(
    request: EntityCandidateSearchRequest,
  ): Promise<ResolverCandidate[]> {
    void request;
    return [];
  }

  async listDialogueHits(
    _gameId: string,
    revisionId: string,
    query: string,
    filters?: DialogueSearchFilters,
  ) {
    void query;
    void filters;
    return this.dialogue.map((item) => ({
      key: item.key,
      title: item.title,
      body: item.body,
      speaker: item.speaker,
      questTitle: item.title,
      questType: item.questType,
      documentId: item.documentId,
      nodeKey: item.nodeKey,
      subquestKey: item.subquestKey,
      citation: {
        documentId: item.documentId,
        locale: item.locale,
        questKey: item.questKey,
        ...(item.subquestKey ? { subquestKey: item.subquestKey } : {}),
        dialogueNodeKey: item.nodeKey,
        revision: revisionId,
      },
    }));
  }

  async listDocumentHits(gameId: string, revisionId: string, query: string) {
    void gameId;
    void revisionId;
    void query;
    return this.documents.map((item) => ({
      key: item.key,
      document: {
        id: item.id,
        sourceKey: item.sourceKey,
        title: item.title,
        type: item.type,
        locale: item.locale,
      },
      body: item.body,
      title: item.title,
    }));
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const cleaned = value ? cleanText(value) : "";
  return cleaned || undefined;
}

function recordBody(record: AnimeGameRecord | NormalizedRecord): string {
  return nonEmpty(record.body) ?? "";
}

function documentFromRecord(
  category: CorpusDocument["category"],
  record: AnimeGameRecord | NormalizedRecord,
  index: number,
): CorpusDocument | undefined {
  const title = nonEmpty(record.title);
  const body = recordBody(record);
  if (!title || !body) return undefined;
  const sourceKey = record.sourceKey || `${category}/${index + 1}`;
  return {
    key: sourceKey,
    category,
    id: deterministicUuid(`document:${sourceKey}`),
    sourceKey,
    title,
    body,
    type: (record.documentType ?? "other") as DocumentType,
    locale: record.locale ?? "zh-CN",
  };
}

function questDocumentsAndDialogue(records: NormalizedRecord[]): {
  documents: CorpusDocument[];
  dialogue: CorpusDialogue[];
} {
  const documents: CorpusDocument[] = [];
  const dialogue: CorpusDialogue[] = [];
  for (const [index, record] of records.entries()) {
    if (record.locale !== "zh-CN" || !record.quest) continue;
    const document = documentFromRecord("quest", record, index);
    if (document) documents.push(document);
    for (const node of record.quest.dialogueNodes) {
      const body = nonEmpty(node.body);
      if (!body) continue;
      const questKey = record.quest.questKey;
      const key = `${questKey}/${node.nodeKey}`;
      dialogue.push({
        key,
        documentId: document?.id ?? deterministicUuid(`document:${record.sourceKey}`),
        nodeKey: node.nodeKey,
        questKey,
        subquestKey: node.subquestKey ?? null,
        title: record.title ?? questKey,
        body,
        speaker: node.speakerName ?? null,
        questType: record.quest.questType,
        locale: record.locale,
      });
    }
  }
  return { documents, dialogue };
}

function structuredAchievementRecords(records: GenshinAchievement[]): CorpusStructured[] {
  return records
    .flatMap((record) => {
      const name = nonEmpty(record.name);
      if (!name) return [];
      const body = nonEmpty(record.requirement) ?? "";
      return [
        {
          key: record.stableId,
          kind: "achievement" as const,
          stableId: record.stableId,
          name,
          body,
        },
      ];
    })
    .sort((left, right) => left.stableId.localeCompare(right.stableId));
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

async function createStructuredOverlay(upstreamDir: string): Promise<string> {
  const overlay = await mkdtemp(join(tmpdir(), "gip-search-regression-"));
  try {
    for (const relativePath of STRUCTURED_OVERLAY_FILES) {
      const destination = join(overlay, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      const source = resolve(upstreamDir, relativePath);
      try {
        await access(source);
        await symlink(source, destination);
      } catch {
        try {
          await writeFile(destination, await readGitBlob(upstreamDir, relativePath), "utf8");
        } catch (error) {
          // The structured converter loads its complete input contract even
          // when this regression only consumes achievements. A sparse
          // checkout may omit unrelated tables and their Git blobs; treating
          // those unused tables as empty keeps the achievement conversion
          // honest while the category is explicitly excluded below.
          void error;
          await writeFile(destination, "[]\n", "utf8");
        }
      }
    }
    return overlay;
  } catch (error) {
    await rm(overlay, { recursive: true, force: true });
    throw error;
  }
}

function inferGameVersion(subject: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/u.exec(subject)?.[1] ?? "unknown";
}

export async function loadRealCorpus(upstreamDir: string): Promise<Corpus> {
  const upstreamCommit = await gitOutput(upstreamDir, ["rev-parse", "HEAD"]);
  if (upstreamCommit !== PINNED_UPSTREAM_COMMIT) {
    throw new Error(
      `AnimeGameData checkout is ${upstreamCommit}, expected pinned commit ${PINNED_UPSTREAM_COMMIT}`,
    );
  }
  const subject = await gitOutput(upstreamDir, ["log", "-1", "--format=%s"]);
  const upstreamVersion = subject || "unknown";
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
            gameId: MEMORY_GAME_ID,
            revisionId: "00000000-0000-0000-0000-000000000017",
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

  const quests = questDocumentsAndDialogue(questConversion.records);
  const documents = [
    ...quests.documents,
    ...textConversion.records.books.flatMap((record, index) =>
      documentFromRecord("book", record, index) ? [documentFromRecord("book", record, index)!] : [],
    ),
    ...textConversion.records.characterStories.flatMap((record, index) =>
      documentFromRecord("character_story", record, index)
        ? [documentFromRecord("character_story", record, index)!]
        : [],
    ),
    ...textConversion.records.items.flatMap((record, index) =>
      documentFromRecord("item", record, index) ? [documentFromRecord("item", record, index)!] : [],
    ),
  ].sort((left, right) => left.key.localeCompare(right.key));
  const dialogue = quests.dialogue.sort((left, right) => left.key.localeCompare(right.key));
  const structured = structuredAchievementRecords(structuredConversion.records.achievements);
  const counts: Record<EvaluatedCategory, number> = {
    dialogue: dialogue.length,
    quest: documents.filter((record) => record.category === "quest").length,
    book: documents.filter((record) => record.category === "book").length,
    character_story: documents.filter((record) => record.category === "character_story").length,
    item: documents.filter((record) => record.category === "item").length,
    achievement: structured.length,
  };
  for (const category of EVALUATED_CATEGORIES) {
    if (counts[category] < 5)
      throw new Error(`Real upstream corpus has fewer than five ${category} records`);
  }
  return {
    source: "real-upstream",
    upstreamCommit,
    upstreamVersion,
    locale: "zh-CN",
    documents,
    dialogue,
    structured,
    counts,
    conversion: {
      dialogueNodes: dialogue.length,
      questDocuments: counts.quest,
      bookDocuments: counts.book,
      characterStoryDocuments: counts.character_story,
      itemDocuments: counts.item,
      achievementRecords: counts.achievement,
      publicQuestRecords: questConversion.records.filter((record) => record.locale === "zh-CN")
        .length,
      convertedBookRecords: textConversion.records.books.length,
      convertedCharacterStoryRecords: textConversion.records.characterStories.length,
      convertedItemRecords: textConversion.records.items.length,
      convertedAchievementRecords: structuredConversion.records.achievements.length,
    },
    sourceDescription:
      "Published-shaped zh-CN records converted offline from the pinned AnimeGameData checkout; sparse achievement files are read from the pinned Git blob without network fetch.",
  };
}

type FixtureGoldenCase = {
  query?: unknown;
  expected_document_ids?: unknown;
};

async function loadFixtureCorpus(): Promise<Corpus> {
  const raw = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as unknown;
  const cases = Array.isArray(raw) ? raw : [];
  const queries = cases.flatMap((value): string[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as FixtureGoldenCase;
    return typeof item.query === "string" && item.query.trim() ? [item.query.trim()] : [];
  });
  const uniqueQueries = [...new Set(queries)];
  const documents: CorpusDocument[] = [];
  const categories: Array<CorpusDocument["category"]> = [
    "quest",
    "book",
    "character_story",
    "item",
  ];
  for (const [index, query] of uniqueQueries.entries()) {
    const category = categories[index % categories.length]!;
    const key = `fixture/${category}/${index + 1}`;
    documents.push({
      key,
      category,
      id: `fixture-document:${index + 1}`,
      sourceKey: key,
      title: query,
      body: query,
      type:
        category === "quest"
          ? "other"
          : category === "book"
            ? "book"
            : category === "character_story"
              ? "character_story"
              : "item_description",
      locale: "zh-CN",
    });
  }
  const dialogue: CorpusDialogue[] = uniqueQueries.slice(0, 20).map((query, index) => ({
    key: `fixture/quest/${index + 1}/fixture/dialogue/${index + 1}`,
    documentId: `fixture-document:dialogue-${index + 1}`,
    nodeKey: `fixture/dialogue/${index + 1}`,
    questKey: `fixture/quest/${index + 1}`,
    subquestKey: null,
    title: query,
    body: query,
    speaker: null,
    questType: "world_quest",
    locale: "zh-CN",
  }));
  const structured: CorpusStructured[] = uniqueQueries.slice(0, 20).map((query, index) => ({
    key: `genshin:achievement:fixture-${index + 1}`,
    kind: "achievement",
    stableId: `genshin:achievement:fixture-${index + 1}`,
    name: query,
    body: query,
  }));
  const counts: Record<EvaluatedCategory, number> = {
    dialogue: dialogue.length,
    quest: documents.filter((record) => record.category === "quest").length,
    book: documents.filter((record) => record.category === "book").length,
    character_story: documents.filter((record) => record.category === "character_story").length,
    item: documents.filter((record) => record.category === "item").length,
    achievement: structured.length,
  };
  for (const category of EVALUATED_CATEGORIES) {
    if (counts[category] < 5)
      throw new Error(`Fixture corpus has fewer than five ${category} records`);
  }
  return {
    source: "fixture",
    upstreamCommit: PINNED_UPSTREAM_COMMIT,
    upstreamVersion: "fixture",
    locale: "zh-CN",
    documents,
    dialogue,
    structured,
    counts,
    conversion: { fixtureQueries: uniqueQueries.length },
    sourceDescription: `Fixture fallback built from ${relative(REPOSITORY_ROOT, FIXTURE_PATH)}; it is only used when the pinned upstream corpus cannot be converted.`,
  };
}

function queryFromDialogue(body: string): string {
  const hanRun = body.match(/[\p{Script=Han}]{3,8}/u)?.[0];
  if (hanRun) return hanRun.slice(0, Math.min(hanRun.length, 6));
  const token = body.split(/\s+/u).find((item) => item.length >= 3);
  return token ?? body.slice(0, 8);
}

function queryCasesFor(corpus: Corpus, category: EvaluatedCategory): QueryCase[] {
  const entries =
    category === "dialogue"
      ? corpus.dialogue.map((item) => ({
          key: item.key,
          title: item.title,
          text: item.body,
          query: queryFromDialogue(item.body),
        }))
      : category === "achievement"
        ? corpus.structured.map((item) => ({
            key: item.key,
            title: item.name,
            text: item.body || item.name,
            query: item.name,
          }))
        : corpus.documents
            .filter((item) => item.category === category)
            .map((item) => ({
              key: item.key,
              title: item.title,
              text: item.body,
              query: item.title,
            }));
  const selected: QueryCase[] = [];
  const seenQueries = new Set<string>();
  const orderedEntries = entries.sort((left, right) => left.key.localeCompare(right.key));
  const spreadEntries =
    orderedEntries.length > 5
      ? [0, 1, 2, 3, 4].map(
          (index) => orderedEntries[Math.floor((index * orderedEntries.length) / 5)]!,
        )
      : orderedEntries;
  for (const entry of [...spreadEntries, ...orderedEntries]) {
    if (selected.length === 5) break;
    const query = cleanText(entry.query);
    if (!query || seenQueries.has(query)) continue;
    seenQueries.add(query);
    selected.push({
      id: `${category}-${String(selected.length + 1).padStart(3, "0")}`,
      query,
      relevantKey: entry.key,
      evidence: { title: entry.title, text: cleanText(entry.text).slice(0, 180) },
    });
    if (selected.length === 5) break;
  }
  if (selected.length < 5)
    throw new Error(`Could not select five deterministic ${category} queries from the corpus`);
  return selected;
}

function documentHitMatches(category: EvaluatedCategory, type: string, sourceKey?: string | null) {
  if (category === "quest")
    return (
      Boolean(sourceKey?.startsWith("quest/") || sourceKey?.startsWith("fixture/quest/")) &&
      QUEST_TYPES.has(type as DocumentType)
    );
  if (category === "book") return type === "book";
  if (category === "character_story") return type === "character_story";
  if (category === "item") return type === "item_description";
  return false;
}

function memoryRunner(corpus: Corpus): SearchRunner {
  const service = new SearchService(
    new MemorySearchRepository(corpus.documents, corpus.dialogue, corpus.structured),
  );
  return {
    db: false,
    adapter: "memory",
    revision: {
      id: MEMORY_REVISION_ID,
      lifecycleStatus: "published",
      indexStatus: "ready",
      isCurrent: true,
    },
    async search(category, query) {
      if (category === "dialogue") {
        const hits = await service.searchDialogue(MEMORY_GAME_ID, MEMORY_REVISION_ID, query);
        return hits.map((hit) => `${hit.citation.questKey}/${hit.dialogueNodeKey}`);
      }
      if (category === "achievement") {
        const hits = await service.searchText(MEMORY_GAME_ID, MEMORY_REVISION_ID, query);
        return hits.structured
          .filter((hit) => hit.kind === "achievement")
          .map((hit) => hit.stableId);
      }
      const hits = await service.searchLore(MEMORY_GAME_ID, MEMORY_REVISION_ID, query);
      return hits
        .filter((hit) => documentHitMatches(category, hit.document.type, hit.document.sourceKey))
        .map((hit) => hit.document.sourceKey ?? hit.document.id);
    },
  };
}

function databaseRunner(
  db: Database,
  gameId: string,
  revisionId: string,
  isCurrent: boolean,
): SearchRunner {
  const service = new SearchService(new SqlSearchRepositoryPort(db));
  return {
    db: true,
    adapter: "postgresql",
    revision: {
      id: revisionId,
      lifecycleStatus: "published",
      indexStatus: "ready",
      isCurrent,
    },
    async search(category, query) {
      if (category === "dialogue") {
        const hits = await service.searchDialogue(gameId, revisionId, query);
        return hits.map((hit) => `${hit.citation.questKey}/${hit.dialogueNodeKey}`);
      }
      if (category === "achievement") {
        const hits = await service.searchText(gameId, revisionId, query);
        return hits.structured
          .filter((hit) => hit.kind === "achievement")
          .map((hit) => hit.stableId);
      }
      const hits = await service.searchLore(gameId, revisionId, query);
      return hits
        .filter((hit) => documentHitMatches(category, hit.document.type, hit.document.sourceKey))
        .map((hit) => hit.document.sourceKey ?? hit.document.id);
    },
  };
}

async function tryDatabaseRunner(): Promise<DatabaseAttempt> {
  if (process.env.SEARCH_REGRESSION_NO_DB === "1")
    return {
      runner: null,
      reason: "database disabled by SEARCH_REGRESSION_NO_DB=1",
      close: async () => undefined,
    };
  const databaseUrl =
    process.env.SEARCH_REGRESSION_DATABASE_URL ??
    process.env.DATABASE_URL ??
    loadConfig().databaseUrl;
  const pool = createPool(databaseUrl);
  try {
    await pool.query("select 1");
    const db = createDatabase(pool);
    const repository = new SqlKnowledgeRepository(db);
    const game = await repository.getGameBySlug(GAME_SLUG);
    if (!game) {
      await pool.end();
      return {
        runner: null,
        reason: `database is reachable but game ${GAME_SLUG} is not seeded`,
        close: async () => undefined,
      };
    }
    const revisions = await repository.listRevisions(game.id);
    const revision = revisions
      .filter(
        (candidate) =>
          candidate.lifecycleStatus === "published" && candidate.indexStatus === "ready",
      )
      .sort(
        (left, right) =>
          Number(right.isCurrent) - Number(left.isCurrent) ||
          right.revisionNumber - left.revisionNumber,
      )[0];
    if (!revision) {
      await pool.end();
      return {
        runner: null,
        reason: "database is reachable but has no published, ready revision",
        close: async () => undefined,
      };
    }
    return {
      runner: databaseRunner(db, game.id, revision.id, revision.isCurrent),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    return {
      runner: null,
      reason: `database unavailable: ${error instanceof Error ? error.message : String(error)}`,
      close: async () => undefined,
    };
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

async function evaluateCategory(
  category: EvaluatedCategory,
  cases: QueryCase[],
  runner: SearchRunner,
): Promise<EvaluatedCategoryResult> {
  const queries: QueryResult[] = [];
  for (const item of cases) {
    const returned = await runner.search(category, item.query);
    const rankIndex = returned.indexOf(item.relevantKey);
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;
    queries.push({
      ...item,
      rank,
      hitAt5: rank !== null && rank <= 5,
      hitAt10: rank !== null && rank <= 10,
      reciprocalRankAt10: rank !== null && rank <= 10 ? 1 / rank : 0,
      returned: returned.slice(0, 10),
    });
  }
  const hitAt5 = queries.filter((item) => item.hitAt5).length / queries.length;
  const hitAt10 = queries.filter((item) => item.hitAt10).length / queries.length;
  const mrrAt10 = queries.reduce((sum, item) => sum + item.reciprocalRankAt10, 0) / queries.length;
  return {
    status: "evaluated",
    queryCount: queries.length,
    metrics: {
      "hit@5": round(hitAt5),
      "hit@10": round(hitAt10),
      "MRR@10": round(mrrAt10),
      hitAt5: round(hitAt5),
      hitAt10: round(hitAt10),
      mrrAt10: round(mrrAt10),
    },
    queries,
  };
}

function excludedCategoryResult(category: ExcludedCategory): ExcludedCategoryResult {
  const reasons: Record<ExcludedCategory, string> = {
    voice: "excluded: pinned AnimeGameData has no AvatarVoiceExcelConfigData source file",
    tutorial: "excluded: pinned snapshot has no readable canonical tutorial/help source",
    mechanism: "excluded: pinned snapshot has no readable canonical mechanism/help source",
  };
  return { status: "excluded", queryCount: 0, reason: reasons[category] };
}

async function main(): Promise<void> {
  let corpus: Corpus;
  let corpusFallbackReason: string | undefined;
  if (process.env.SEARCH_REGRESSION_FORCE_FIXTURE === "1") {
    corpus = await loadFixtureCorpus();
    corpusFallbackReason = "fixture forced by SEARCH_REGRESSION_FORCE_FIXTURE=1";
  } else {
    try {
      corpus = await loadRealCorpus(DEFAULT_UPSTREAM_DIR);
    } catch (error) {
      corpusFallbackReason = error instanceof Error ? error.message : String(error);
      corpus = await loadFixtureCorpus();
    }
  }

  const databaseAttempt = await tryDatabaseRunner();
  const runner = databaseAttempt.runner ?? memoryRunner(corpus);
  const categories = {} as Record<Category, CategoryResult>;
  for (const category of EVALUATED_CATEGORIES) {
    categories[category] = await evaluateCategory(
      category,
      queryCasesFor(corpus, category),
      runner,
    );
  }
  for (const category of ["voice", "tutorial", "mechanism"] as const)
    categories[category] = excludedCategoryResult(category);

  await databaseAttempt.close();
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const output = {
    schemaVersion: 1,
    corpusSource: corpus.source,
    corpus: {
      sourceDescription: corpus.sourceDescription,
      upstreamCommit: corpus.upstreamCommit,
      upstreamVersion: corpus.upstreamVersion,
      locale: corpus.locale,
      records: corpus.counts,
      totalRecords: Object.values(corpus.counts).reduce((sum, count) => sum + count, 0),
      conversion: corpus.conversion,
    },
    db: runner.db,
    database: {
      adapter: runner.adapter,
      revision: runner.revision,
      fallbackReason: databaseAttempt.reason ?? null,
    },
    categories,
    excluded: {
      voice: categories.voice,
      tutorial: categories.tutorial,
      mechanism: categories.mechanism,
    },
    generatedAt: new Date().toISOString(),
    pinnedUpstreamCommit: PINNED_UPSTREAM_COMMIT,
    ...(corpusFallbackReason ? { corpusFallbackReason } : {}),
  };
  await writeFile(
    OUTPUT_PATH,
    await formatJson(JSON.stringify(output), {
      parser: "json",
      printWidth: 100,
      trailingComma: "all",
    }),
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        output: relative(REPOSITORY_ROOT, OUTPUT_PATH),
        corpusSource: corpus.source,
        records: corpus.counts,
        db: runner.db,
        revision: runner.revision,
        metrics: Object.fromEntries(
          EVALUATED_CATEGORIES.map((category) => [category, categories[category].metrics]),
        ),
        excluded: Object.fromEntries(
          (["voice", "tutorial", "mechanism"] as const).map((category) => [
            category,
            categories[category].reason,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

await main();
