import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { format as formatJson } from "prettier";
import { convertAnimeGameData } from "./anime-game-data-converter.ts";
import { convertStructuredAnimeGameData } from "./anime-game-data-structured-converter.ts";
import { convertQuestSnapshot } from "./anime-game-data-quest-converter.ts";
import { deterministicUuid } from "./evaluate-search-regression.js";

const execFile = promisify(execFileCallback);

const REPOSITORY_ROOT = resolve(process.cwd());
const PINNED_UPSTREAM_COMMIT = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";
const MEMORY_GAME_ID = "00000000-0000-0000-0000-000000000017";
const MEMORY_REVISION_ID = "00000000-0000-0000-0000-000000000017";
const GENERATED_ID_PREFIX = "sprint27-golden-";

const SEARCH_REGRESSION_PATH = resolve(
  process.env.GOLDEN_SEARCH_REGRESSION ??
    join(REPOSITORY_ROOT, "data/evaluation/genshin/search-regression.json"),
);
const QA_PATH = resolve(
  process.env.GOLDEN_QA_OUTPUT ?? join(REPOSITORY_ROOT, "data/fixtures/qa-golden.json"),
);
const MCP_PATH = resolve(
  process.env.GOLDEN_MCP_OUTPUT ?? join(REPOSITORY_ROOT, "data/evaluation/genshin/mcp-golden.json"),
);
const UPSTREAM_DIR = resolve(
  process.env.GOLDEN_UPSTREAM_DIR ??
    process.env.SEARCH_REGRESSION_UPSTREAM_DIR ??
    process.env.ANIME_GAME_DATA_DIR ??
    join(REPOSITORY_ROOT, "data/upstream/AnimeGameData"),
);
const NORMALIZED_ROOT = resolve(
  process.env.GOLDEN_NORMALIZED_ROOT ??
    join(REPOSITORY_ROOT, "data/imports/normalized/anime-game-data", PINNED_UPSTREAM_COMMIT),
);
const MCP_FIXTURE_PATH = resolve(
  process.env.GOLDEN_MCP_FIXTURE ??
    join(REPOSITORY_ROOT, "data/evaluation/genshin/mcp-tool-fixture.json"),
);

const QA_DOMAINS = ["dialogue", "quest", "book", "character_story", "item", "achievement"] as const;
type QaDomain = (typeof QA_DOMAINS)[number];

const MCP_TOOLS = [
  "list_games",
  "get_game_capabilities",
  "get_character",
  "get_material",
  "get_weapon",
  "get_enemy",
  "resolve_entity",
  "search_dialogue",
  "search_entities",
  "get_entity",
  "search_lore",
  "search_quests",
  "get_quest",
  "get_lore_document",
  "get_relationships",
  "get_entity_texts",
  "search_items",
  "get_item_text",
  "search_mechanics",
] as const;
type McpTool = (typeof MCP_TOOLS)[number];

type JsonObject = Record<string, unknown>;

type QaGoldenCase = JsonObject & {
  id: string;
  question: string;
};

type McpGoldenCase = JsonObject & {
  id: string;
  question: string;
  expectedTool: string;
  entityName: string;
  requiredField: string;
  maxToolCalls: number;
};

type CorpusSegment = {
  segmentKey: string;
  body: string;
};

type CorpusEntity = {
  sourceKey: string;
  name: string;
  sourceDomain: QaDomain;
};

type CorpusDocument = {
  sourceKey: string;
  title: string;
  body: string;
  sourceDomain: Exclude<QaDomain, "dialogue" | "achievement">;
  segments: CorpusSegment[];
  entities: CorpusEntity[];
};

type CorpusDialogue = {
  sourceKey: string;
  nodeKey: string;
  title: string;
  body: string;
  segmentKey: string;
};

type CorpusStructured = {
  kind: "character" | "material" | "weapon" | "enemy" | "achievement";
  sourceKey: string;
  stableId: string;
  name: string;
  body: string;
  sourceDomain: QaDomain;
};

type Corpus = {
  source: string;
  upstreamCommit: string;
  upstreamVersion: string;
  documents: Record<Exclude<QaDomain, "dialogue" | "achievement">, CorpusDocument[]>;
  dialogue: CorpusDialogue[];
  structured: Record<CorpusStructured["kind"], CorpusStructured[]>;
  entities: CorpusEntity[];
};

type ConvertedRecords = {
  quests: unknown[];
  books: unknown[];
  characterStories: unknown[];
  items: unknown[];
  structured: Partial<Record<CorpusStructured["kind"], unknown[]>>;
};

type SearchRegression = {
  corpus?: JsonObject;
  pinnedUpstreamCommit?: string;
};

type McpFixture = {
  weapons?: JsonObject[];
  enemies?: JsonObject[];
};

type McpSeed = {
  name: string;
  title: string;
  body: string;
  sourceKey: string;
  sourceDomain: QaDomain;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function queryFragment(value: string): string {
  const cleaned = cleanText(value);
  const hanRun = cleaned.match(/[\p{Script=Han}]{3,12}/u)?.[0];
  if (hanRun) return hanRun.slice(0, 8);
  return cleaned.split(/\s+/u).find((token) => token.length >= 3) ?? cleaned.slice(0, 30);
}

function firstSegment(sourceKey: string, body: string, rawSegments: unknown): CorpusSegment[] {
  const segments = asArray(rawSegments).flatMap((segment, index) => {
    const segmentKey = text(segment.segmentKey);
    const segmentBody = text(segment.body);
    return segmentBody
      ? [
          {
            segmentKey: segmentKey ?? `${sourceKey}/segment/${index + 1}`,
            body: segmentBody,
          },
        ]
      : [];
  });
  if (segments.length) return segments;
  return body ? [{ segmentKey: `${sourceKey}/segment/1`, body }] : [];
}

function documentDomain(value: unknown): CorpusDocument["sourceDomain"] | undefined {
  const domain = text(value);
  return domain === "quest" ||
    domain === "book" ||
    domain === "character_story" ||
    domain === "item"
    ? domain
    : undefined;
}

function entityDomain(value: unknown, fallback: QaDomain): QaDomain {
  const domain = text(value);
  return domain === "character" ||
    domain === "item" ||
    domain === "quest" ||
    domain === "book" ||
    domain === "character_story" ||
    domain === "achievement" ||
    domain === "dialogue"
    ? domain
    : fallback;
}

function makeDocument(
  sourceDomain: CorpusDocument["sourceDomain"],
  record: JsonObject,
): CorpusDocument | undefined {
  const sourceKey = text(record.sourceKey);
  const title = text(record.title);
  const body = text(record.body);
  if (!sourceKey || !title || !body) return undefined;
  const entities = asArray(record.entities).flatMap((candidate) => {
    const entitySourceKey = text(candidate.sourceKey);
    const name = text(candidate.name);
    if (!entitySourceKey || !name) return [];
    return [
      {
        sourceKey: entitySourceKey,
        name,
        sourceDomain: entityDomain(candidate.type ?? candidate.entityType, sourceDomain),
      },
    ];
  });
  return {
    sourceKey,
    title,
    body,
    sourceDomain,
    segments: firstSegment(sourceKey, body, record.segments),
    entities,
  };
}

function emptyCorpus(metadata: {
  source: string;
  upstreamCommit: string;
  upstreamVersion: string;
}): Corpus {
  return {
    ...metadata,
    documents: {
      quest: [],
      book: [],
      character_story: [],
      item: [],
    },
    dialogue: [],
    structured: {
      character: [],
      material: [],
      weapon: [],
      enemy: [],
      achievement: [],
    },
    entities: [],
  };
}

function addEntity(corpus: Corpus, entity: CorpusEntity): void {
  if (!corpus.entities.some((candidate) => candidate.sourceKey === entity.sourceKey))
    corpus.entities.push(entity);
}

function addDocument(corpus: Corpus, document: CorpusDocument): void {
  corpus.documents[document.sourceDomain].push(document);
  for (const entity of document.entities) addEntity(corpus, entity);
}

function addQuestRecords(corpus: Corpus, records: unknown[]): void {
  for (const rawRecord of records) {
    const record = asObject(rawRecord);
    if (text(record.locale) && record.locale !== "zh-CN") continue;
    const quest = asObject(record.quest);
    if (text(quest.visibility) && quest.visibility !== "public") continue;
    const document = makeDocument("quest", record);
    if (!document) continue;
    addDocument(corpus, document);
    for (const rawNode of asArray(quest.dialogueNodes)) {
      const nodeKey = text(rawNode.nodeKey);
      const body = text(rawNode.body);
      if (!nodeKey || !body) continue;
      corpus.dialogue.push({
        sourceKey: document.sourceKey,
        nodeKey,
        title: document.title,
        body,
        segmentKey: text(rawNode.segmentKey) ?? `${nodeKey}/segment/1`,
      });
    }
  }
}

function addTextRecords(
  corpus: Corpus,
  sourceDomain: Exclude<QaDomain, "dialogue" | "achievement">,
  records: unknown[],
): void {
  for (const rawRecord of records) {
    const document = makeDocument(sourceDomain, asObject(rawRecord));
    if (document) addDocument(corpus, document);
  }
}

function structuredBody(kind: CorpusStructured["kind"], record: JsonObject): string | undefined {
  const preferredField: Record<CorpusStructured["kind"], string[]> = {
    character: ["description", "title"],
    material: ["description"],
    weapon: ["description", "passiveDescription"],
    enemy: ["description"],
    achievement: ["requirement"],
  };
  for (const field of preferredField[kind]) {
    const value = text(record[field]);
    if (value) return value;
  }
  return text(record.name);
}

function structuredDomain(kind: CorpusStructured["kind"]): QaDomain {
  return kind === "character" ? "character" : kind === "achievement" ? "achievement" : "item";
}

function addStructuredRecords(
  corpus: Corpus,
  kind: CorpusStructured["kind"],
  records: unknown[],
): void {
  for (const rawRecord of records) {
    const record = asObject(rawRecord);
    const sourceKey = text(record.sourceKey);
    const stableId = text(record.stableId);
    const name = text(record.name);
    const body = structuredBody(kind, record);
    if (!sourceKey || !stableId || !name || !body) continue;
    const item: CorpusStructured = {
      kind,
      sourceKey,
      stableId,
      name,
      body,
      sourceDomain: structuredDomain(kind),
    };
    corpus.structured[kind].push(item);
    addEntity(corpus, {
      sourceKey,
      name,
      sourceDomain: item.sourceDomain,
    });
  }
}

function buildCorpus(
  records: ConvertedRecords,
  metadata: Omit<Corpus, "documents" | "dialogue" | "structured" | "entities">,
): Corpus {
  const corpus = emptyCorpus(metadata);
  addQuestRecords(corpus, records.quests);
  addTextRecords(corpus, "book", records.books);
  addTextRecords(corpus, "character_story", records.characterStories);
  addTextRecords(corpus, "item", records.items);
  for (const kind of ["character", "material", "weapon", "enemy", "achievement"] as const)
    addStructuredRecords(corpus, kind, records.structured[kind] ?? []);
  for (const domain of Object.keys(corpus.documents) as Array<keyof Corpus["documents"]>)
    corpus.documents[domain].sort((left, right) => compareStrings(left.sourceKey, right.sourceKey));
  corpus.dialogue.sort(
    (left, right) =>
      compareStrings(left.sourceKey, right.sourceKey) ||
      compareStrings(left.nodeKey, right.nodeKey),
  );
  for (const kind of Object.keys(corpus.structured) as Array<CorpusStructured["kind"]>)
    corpus.structured[kind].sort((left, right) => compareStrings(left.sourceKey, right.sourceKey));
  corpus.entities.sort(
    (left, right) =>
      compareStrings(left.sourceKey, right.sourceKey) || compareStrings(left.name, right.name),
  );
  return corpus;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (asObject(error).code === "ENOENT") return undefined;
    throw error;
  }
}

function recordsFromSerializedCorpus(regression: SearchRegression): Corpus | undefined {
  const serialized = asObject(regression.corpus);
  const documents = asArray(serialized.documents);
  const dialogue = asArray(serialized.dialogue);
  const structured = asArray(serialized.structured);
  if (!documents.length && !dialogue.length && !structured.length) return undefined;
  const corpus = emptyCorpus({
    source: "search-regression-corpus",
    upstreamCommit: text(serialized.upstreamCommit) ?? PINNED_UPSTREAM_COMMIT,
    upstreamVersion: text(serialized.upstreamVersion) ?? "unknown",
  });
  for (const rawDocument of documents) {
    const record = asObject(rawDocument);
    const document = makeDocument(
      documentDomain(record.category ?? record.sourceDomain ?? record.type) ?? "quest",
      record,
    );
    if (document) addDocument(corpus, document);
  }
  for (const rawDialogue of dialogue) {
    const record = asObject(rawDialogue);
    const sourceKey = text(record.documentSourceKey ?? record.documentId ?? record.sourceKey);
    const nodeKey = text(record.nodeKey ?? record.dialogueNodeKey);
    const title = text(record.title) ?? sourceKey;
    const body = text(record.body ?? record.text);
    if (!sourceKey || !nodeKey || !title || !body) continue;
    corpus.dialogue.push({
      sourceKey,
      nodeKey,
      title,
      body,
      segmentKey: text(record.segmentKey) ?? `${nodeKey}/segment/1`,
    });
  }
  for (const rawStructured of structured) {
    const record = asObject(rawStructured);
    const kind = text(record.kind);
    if (
      kind === "character" ||
      kind === "material" ||
      kind === "weapon" ||
      kind === "enemy" ||
      kind === "achievement"
    )
      addStructuredRecords(corpus, kind, [record]);
  }
  corpus.dialogue.sort(
    (left, right) =>
      compareStrings(left.sourceKey, right.sourceKey) ||
      compareStrings(left.nodeKey, right.nodeKey),
  );
  return corpus;
}

async function loadNormalizedRecords(): Promise<ConvertedRecords | undefined> {
  const [quests, books, characterStories, items] = await Promise.all([
    readJsonIfPresent<unknown[]>(join(NORMALIZED_ROOT, "quests/records/quests.json")),
    readJsonIfPresent<unknown[]>(join(NORMALIZED_ROOT, "zh-CN/records/books.json")),
    readJsonIfPresent<unknown[]>(join(NORMALIZED_ROOT, "zh-CN/records/character-stories.json")),
    readJsonIfPresent<unknown[]>(join(NORMALIZED_ROOT, "zh-CN/records/items.json")),
  ]);
  if (!quests || !books || !characterStories || !items) return undefined;
  const structured: ConvertedRecords["structured"] = {};
  const structuredRoot = join(NORMALIZED_ROOT, "structured/records");
  for (const kind of ["character", "material", "weapon", "enemy", "achievement"] as const) {
    const fileName = kind === "material" ? "materials" : `${kind}s`;
    const values = await readJsonIfPresent<unknown[]>(join(structuredRoot, `${fileName}.json`));
    if (values) structured[kind] = values;
  }
  return { quests, books, characterStories, items, structured };
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

async function createStructuredOverlay(upstreamDir: string): Promise<string> {
  const overlay = await mkdtemp(join(tmpdir(), "gip-golden-"));
  try {
    for (const relativePath of STRUCTURED_OVERLAY_FILES) {
      const destination = join(overlay, relativePath);
      await mkdirFor(destination);
      const source = resolve(upstreamDir, relativePath);
      try {
        await access(source);
        await symlink(source, destination);
      } catch {
        try {
          await writeFile(destination, await readGitBlob(upstreamDir, relativePath), "utf8");
        } catch {
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

async function mkdirFor(path: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
}

function inferGameVersion(upstreamVersion: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/u.exec(upstreamVersion)?.[1] ?? "unknown";
}

async function loadFromUpstream(regression: SearchRegression): Promise<Corpus> {
  const upstreamCommit = await gitOutput(UPSTREAM_DIR, ["rev-parse", "HEAD"]);
  if (upstreamCommit !== PINNED_UPSTREAM_COMMIT)
    throw new Error(
      `AnimeGameData checkout is ${upstreamCommit}, expected pinned commit ${PINNED_UPSTREAM_COMMIT}`,
    );
  const gitVersion = await gitOutput(UPSTREAM_DIR, ["log", "-1", "--format=%s"]);
  const upstreamVersion =
    text(asObject(regression.corpus).upstreamVersion) ?? gitVersion ?? "unknown";
  const gameVersion = inferGameVersion(upstreamVersion);
  const [textConversion, questConversion] = await Promise.all([
    convertAnimeGameData({
      upstreamDir: UPSTREAM_DIR,
      language: "CHS",
      context: {
        upstreamCommit,
        upstreamCommitDate: "unknown",
        upstreamVersion,
        upstreamVersionLabel: upstreamVersion,
        gameVersion,
      },
    }),
    convertQuestSnapshot({
      upstreamDir: UPSTREAM_DIR,
      context: {
        upstreamCommit,
        upstreamVersionLabel: upstreamVersion,
        gameVersion,
      },
    }),
  ]);
  const overlay = await createStructuredOverlay(UPSTREAM_DIR);
  try {
    const structuredConversion = await convertStructuredAnimeGameData({
      upstreamDir: overlay,
      context: {
        gameId: MEMORY_GAME_ID,
        revisionId: MEMORY_REVISION_ID,
        upstreamCommit,
        upstreamVersion,
        gameVersion,
      },
    });
    return buildCorpus(
      {
        quests: questConversion.records,
        books: textConversion.records.books,
        characterStories: textConversion.records.characterStories,
        items: textConversion.records.items,
        structured: {
          character: structuredConversion.records.characters,
          material: structuredConversion.records.materials,
          weapon: structuredConversion.records.weapons,
          enemy: structuredConversion.records.enemies,
          achievement: structuredConversion.records.achievements,
        },
      },
      {
        source: "pinned-upstream-conversion",
        upstreamCommit,
        upstreamVersion,
      },
    );
  } finally {
    await rm(overlay, { recursive: true, force: true });
  }
}

async function loadCorpus(regression: SearchRegression): Promise<Corpus> {
  const serializedCorpus = recordsFromSerializedCorpus(regression);
  if (serializedCorpus) return enrichSparseStructuredCorpus(serializedCorpus);
  try {
    return enrichSparseStructuredCorpus(await loadFromUpstream(regression));
  } catch (upstreamError) {
    const normalized = await loadNormalizedRecords();
    if (!normalized)
      throw new Error(
        `No full search-regression corpus or pinned conversion result is available. Upstream error: ${
          upstreamError instanceof Error ? upstreamError.message : String(upstreamError)
        }`,
      );
    return enrichSparseStructuredCorpus(
      buildCorpus(normalized, {
        source: "normalized-pinned-conversion",
        upstreamCommit: PINNED_UPSTREAM_COMMIT,
        upstreamVersion: text(asObject(regression.corpus).upstreamVersion) ?? "unknown",
      }),
    );
  }
}

function fixtureSlug(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "record"
  );
}

async function enrichSparseStructuredCorpus(corpus: Corpus): Promise<Corpus> {
  const fixture = await readJsonIfPresent<McpFixture>(MCP_FIXTURE_PATH);
  if (!fixture) return corpus;
  for (const kind of ["weapon", "enemy"] as const) {
    if (corpus.structured[kind].length) continue;
    const fixtureRecords = kind === "weapon" ? (fixture.weapons ?? []) : (fixture.enemies ?? []);
    for (const [index, rawRecord] of fixtureRecords.entries()) {
      const name = text(rawRecord.name);
      if (!name) continue;
      const sourceKey = `mcp-tool-fixture/${kind}/${fixtureSlug(name)}-${index + 1}`;
      corpus.structured[kind].push({
        kind,
        sourceKey,
        stableId: sourceKey,
        name,
        body: name,
        sourceDomain: "item",
      });
      addEntity(corpus, { sourceKey, name, sourceDomain: "item" });
    }
    corpus.structured[kind].sort((left, right) => compareStrings(left.sourceKey, right.sourceKey));
  }
  return corpus;
}

function spreadOrder(length: number, target: number): number[] {
  const indexes: number[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < target; index += 1) {
    const candidate = Math.min(length - 1, Math.floor((index * length) / target));
    if (!seen.has(candidate)) {
      seen.add(candidate);
      indexes.push(candidate);
    }
  }
  for (let index = 0; index < length; index += 1) if (!seen.has(index)) indexes.push(index);
  return indexes;
}

function uniqueQuery(
  seed: { title: string; body: string; sourceKey: string },
  used: Set<string>,
): string {
  const fragment = queryFragment(seed.body);
  const candidates = [
    fragment,
    seed.title,
    `${seed.title} ${fragment}`,
    cleanText(seed.body).slice(0, 80),
    `${seed.title} ${cleanText(seed.body).slice(0, 80)}`,
    seed.sourceKey,
  ];
  for (const candidate of candidates) {
    const query = cleanText(candidate);
    if (query && !used.has(query)) {
      used.add(query);
      return query;
    }
  }
  throw new Error(`Could not make a unique query for ${seed.sourceKey}`);
}

function qaSeedsFor(
  corpus: Corpus,
  domain: QaDomain,
): Array<{
  sourceKey: string;
  documentId: string;
  segmentId: string;
  title: string;
  body: string;
}> {
  if (domain === "dialogue")
    return corpus.dialogue.map((item) => ({
      sourceKey: `${item.sourceKey}/${item.nodeKey}`,
      documentId: item.sourceKey,
      segmentId: item.segmentKey,
      title: item.title,
      body: item.body,
    }));
  if (domain === "achievement")
    return corpus.structured.achievement.map((item) => ({
      sourceKey: item.sourceKey,
      documentId: item.stableId,
      segmentId: item.stableId,
      title: item.name,
      body: item.body,
    }));
  return corpus.documents[domain].flatMap((item) => {
    const segment = item.segments[0];
    return segment
      ? [
          {
            sourceKey: item.sourceKey,
            documentId: item.sourceKey,
            segmentId: segment.segmentKey,
            title: item.title,
            body: segment.body,
          },
        ]
      : [];
  });
}

function selectQaSeeds(
  corpus: Corpus,
  domain: QaDomain,
  target: number,
  used: Set<string>,
): Array<{
  sourceKey: string;
  documentId: string;
  segmentId: string;
  title: string;
  body: string;
  question: string;
}> {
  const seeds = qaSeedsFor(corpus, domain).sort((left, right) =>
    compareStrings(left.sourceKey, right.sourceKey),
  );
  const selected: Array<{
    sourceKey: string;
    documentId: string;
    segmentId: string;
    title: string;
    body: string;
    question: string;
  }> = [];
  for (const index of spreadOrder(seeds.length, target)) {
    const seed = seeds[index];
    if (!seed) continue;
    const question = uniqueQuery(seed, used);
    selected.push({ ...seed, question });
    if (selected.length === target) break;
  }
  if (selected.length < target)
    throw new Error(`Not enough unique ${domain} records for ${target} QA cases`);
  return selected;
}

function generatedQaCases(corpus: Corpus): QaGoldenCase[] {
  const usedQuestions = new Set<string>();
  const cases: QaGoldenCase[] = [];
  for (const domain of QA_DOMAINS) {
    const selected = selectQaSeeds(corpus, domain, 40, usedQuestions);
    for (const [index, seed] of selected.entries()) {
      cases.push({
        id: `${GENERATED_ID_PREFIX}qa-${domain}-${String(index + 1).padStart(3, "0")}`,
        question: seed.question,
        expectedDocumentId: seed.documentId,
        expectedSegmentId: seed.segmentId,
        minEvidence: 1,
        expected_document_source_keys: [seed.documentId],
        expected_segment_ids: [seed.segmentId],
        tags: ["sprint-27", "real-upstream", domain],
        notes: `Pinned AnimeGameData ${corpus.upstreamCommit}; source ${seed.sourceKey}`,
        sourceDomain: domain,
      });
    }
  }
  return cases;
}

function seedsFromDocuments(corpus: Corpus, domains: QaDomain[]): McpSeed[] {
  return domains.flatMap((domain) => {
    if (domain === "dialogue" || domain === "achievement") return [];
    return corpus.documents[domain].map((document) => ({
      name: document.title,
      title: document.title,
      body: document.body,
      sourceKey: document.sourceKey,
      sourceDomain: domain,
    }));
  });
}

function seedsFromStructured(corpus: Corpus, kind: CorpusStructured["kind"]): McpSeed[] {
  return corpus.structured[kind].map((record) => ({
    name: record.name,
    title: record.name,
    body: record.body,
    sourceKey: record.sourceKey,
    sourceDomain: record.sourceDomain,
  }));
}

function seedsFromGame(corpus: Corpus): McpSeed[] {
  // list_games / get_game_capabilities payloads are game-scoped, not entity-scoped.
  // The game name is the only seed that can legitimately appear in those payloads.
  return [
    {
      name: (corpus as unknown as { gameName?: string }).gameName ?? "原神",
      title: (corpus as unknown as { gameName?: string }).gameName ?? "原神",
      body: (corpus as unknown as { gameName?: string }).gameName ?? "原神",
      sourceKey: "game/genshin-impact",
      sourceDomain: "game",
    },
  ];
}

function seedsFromCharacterStories(corpus: Corpus): McpSeed[] {
  return corpus.documents.character_story.map((document) => ({
    name: document.title,
    title: document.title,
    body: document.body,
    sourceKey: document.sourceKey,
    sourceDomain: document.sourceDomain,
  }));
}

function seedsFromCharacterStoryEntityIds(corpus: Corpus): McpSeed[] {
  return corpus.documents.character_story.map((document) => ({
    name: deterministicUuid(`document:${document.sourceKey}`),
    title: document.title,
    body: document.body,
    sourceKey: document.sourceKey,
    sourceDomain: document.sourceDomain,
  }));
}

function seedsFromDialogue(corpus: Corpus): McpSeed[] {
  return corpus.dialogue.map((dialogue) => ({
    name: queryFragment(dialogue.body),
    title: dialogue.title,
    body: dialogue.body,
    sourceKey: `${dialogue.sourceKey}/${dialogue.nodeKey}`,
    sourceDomain: "dialogue",
  }));
}

function seedsFromItems(corpus: Corpus): McpSeed[] {
  return [
    ...seedsFromStructured(corpus, "material"),
    ...corpus.documents.item.map((document) => ({
      name: document.title,
      title: document.title,
      body: document.body,
      sourceKey: document.sourceKey,
      sourceDomain: "item" as const,
    })),
  ];
}

function selectMcpSeeds(seeds: McpSeed[], count: number): McpSeed[] {
  const ordered = [...seeds].sort(
    (left, right) =>
      compareStrings(left.sourceKey, right.sourceKey) || compareStrings(left.name, right.name),
  );
  if (!ordered.length) throw new Error("No real source records are available for an MCP case");
  const selected: McpSeed[] = [];
  const seenNames = new Set<string>();
  for (const seed of ordered) {
    if (seenNames.has(seed.name)) continue;
    seenNames.add(seed.name);
    selected.push(seed);
    if (selected.length === count) return selected;
  }
  if (!selected.length) throw new Error(`Not enough real source records for ${count} MCP cases`);
  return Array.from({ length: count }, (_, index) => selected[index % selected.length]!);
}

function mcpQuestion(tool: McpTool, seed: McpSeed): string {
  switch (tool) {
    case "list_games":
      return `列出包含「${seed.title}」的游戏`;
    case "get_game_capabilities":
      return `查询原神中「${seed.title}」相关能力`;
    case "get_character":
      return `「${seed.name}」是什么元素`;
    case "get_material":
      return `「${seed.name}」是什么类别`;
    case "get_weapon":
      return `「${seed.name}」是什么武器类型`;
    case "get_enemy":
      return `「${seed.name}」会掉落什么`;
    case "resolve_entity":
      return `「${seed.name}」对应哪个实体`;
    case "search_dialogue":
      return `搜索台词「${queryFragment(seed.body)}」`;
    case "search_entities":
      return `搜索实体「${seed.name}」`;
    case "get_entity":
      return `读取实体「${seed.name}」`;
    case "search_lore":
      return `搜索文档「${seed.title}」`;
    case "search_quests":
      return `搜索任务「${seed.title}」`;
    case "get_quest":
      return `读取任务「${seed.title}」`;
    case "get_lore_document":
      return `读取文档「${seed.title}」`;
    case "get_relationships":
      return `查询「${seed.name}」的关系`;
    case "get_entity_texts":
      return `查询「${seed.name}」绑定的文本`;
    case "search_items":
      return `搜索物品「${seed.name}」`;
    case "get_item_text":
      return `读取物品「${seed.name}」文本`;
    case "search_mechanics":
      return `搜索机制说明「${queryFragment(seed.body)}」`;
  }
}

function generatedMcpCases(corpus: Corpus): McpGoldenCase[] {
  const recipes: Array<{ tool: McpTool; count: number; requiredField: string; seeds: McpSeed[] }> =
    [
      {
        tool: "list_games",
        count: 1,
        requiredField: "games",
        seeds: seedsFromGame(corpus),
      },
      {
        tool: "get_game_capabilities",
        count: 1,
        requiredField: "capabilities",
        seeds: seedsFromGame(corpus),
      },
      {
        tool: "get_character",
        count: 28,
        requiredField: "element",
        seeds: seedsFromStructured(corpus, "character"),
      },
      {
        tool: "get_material",
        count: 30,
        requiredField: "category",
        seeds: seedsFromStructured(corpus, "material"),
      },
      {
        tool: "get_weapon",
        count: 23,
        requiredField: "weaponType",
        seeds: seedsFromStructured(corpus, "weapon"),
      },
      {
        tool: "get_enemy",
        count: 23,
        requiredField: "drops",
        seeds: seedsFromStructured(corpus, "enemy"),
      },
      {
        tool: "resolve_entity",
        count: 18,
        requiredField: "canonicalName",
        seeds: seedsFromCharacterStories(corpus),
      },
      {
        tool: "search_dialogue",
        count: 19,
        requiredField: "hits",
        seeds: seedsFromDialogue(corpus),
      },
      {
        tool: "search_entities",
        count: 12,
        requiredField: "entities",
        seeds: seedsFromCharacterStories(corpus),
      },
      {
        tool: "get_entity",
        count: 12,
        requiredField: "entity",
        seeds: seedsFromCharacterStoryEntityIds(corpus),
      },
      {
        tool: "search_lore",
        count: 12,
        requiredField: "hits",
        seeds: seedsFromDocuments(corpus, ["quest", "book", "character_story", "item"]),
      },
      {
        tool: "search_quests",
        count: 12,
        requiredField: "quests",
        seeds: seedsFromDocuments(corpus, ["quest"]),
      },
      {
        tool: "get_quest",
        count: 8,
        requiredField: "quest",
        seeds: seedsFromDocuments(corpus, ["quest"]),
      },
      {
        tool: "get_lore_document",
        count: 8,
        requiredField: "document",
        seeds: seedsFromDocuments(corpus, ["quest", "book", "character_story", "item"]),
      },
      {
        tool: "get_relationships",
        count: 8,
        requiredField: "relationships",
        seeds: seedsFromCharacterStoryEntityIds(corpus),
      },
      {
        tool: "get_entity_texts",
        count: 8,
        requiredField: "bindings",
        seeds: seedsFromCharacterStoryEntityIds(corpus),
      },
      { tool: "search_items", count: 8, requiredField: "items", seeds: seedsFromItems(corpus) },
      {
        tool: "get_item_text",
        count: 8,
        requiredField: "item",
        seeds: seedsFromStructured(corpus, "material"),
      },
      { tool: "search_mechanics", count: 1, requiredField: "hits", seeds: seedsFromItems(corpus) },
    ];
  const cases: McpGoldenCase[] = [];
  let sequence = 1;
  for (const recipe of recipes) {
    const selected = selectMcpSeeds(recipe.seeds, recipe.count);
    for (const seed of selected) {
      const tool = recipe.tool;
      cases.push({
        id: `${GENERATED_ID_PREFIX}mcp-${String(sequence).padStart(3, "0")}`,
        question: mcpQuestion(tool, seed),
        expectedTool: tool,
        entityName: seed.name,
        requiredField: recipe.requiredField,
        maxToolCalls: 1,
        sourceDomain: seed.sourceDomain,
      });
      sequence += 1;
    }
  }
  if (cases.length !== 240)
    throw new Error(`Expected 240 generated MCP cases, got ${cases.length}`);
  return cases;
}

function isGeneratedCase(value: unknown): boolean {
  return text(asObject(value).id)?.startsWith(GENERATED_ID_PREFIX) ?? false;
}

function assertCaseShape(corpus: Corpus, qaCases: QaGoldenCase[], mcpCases: McpGoldenCase[]): void {
  const qaGenerated = qaCases.filter(isGeneratedCase);
  const mcpGenerated = mcpCases.filter(isGeneratedCase);
  if (qaCases.length < 250)
    throw new Error(`QA golden must contain at least 250 cases, got ${qaCases.length}`);
  if (mcpCases.length < 240)
    throw new Error(`MCP golden must contain at least 240 cases, got ${mcpCases.length}`);
  for (const domain of QA_DOMAINS) {
    const count = qaGenerated.filter((item) => item.sourceDomain === domain).length;
    if (count < 20)
      throw new Error(`QA golden domain ${domain} must contain at least 20 generated cases`);
  }
  for (const item of qaGenerated) {
    const minEvidence = item.minEvidence;
    if (
      !item.expectedDocumentId ||
      !item.expectedSegmentId ||
      typeof minEvidence !== "number" ||
      !Number.isInteger(minEvidence) ||
      minEvidence < 1
    ) {
      throw new Error(`Generated QA case has invalid evidence fields: ${item.id}`);
    }
  }
  const tools = new Set<string>(MCP_TOOLS);
  for (const item of mcpGenerated) {
    if (!tools.has(item.expectedTool))
      throw new Error(`Unknown MCP tool in ${item.id}: ${item.expectedTool}`);
    if (item.maxToolCalls > 3) throw new Error(`MCP case exceeds call budget: ${item.id}`);
    if (!item.entityName || !item.requiredField) throw new Error(`Incomplete MCP case: ${item.id}`);
  }
  const minimums: Record<QaDomain, number> = {
    dialogue: 40,
    quest: 40,
    book: 40,
    character_story: 40,
    item: 40,
    achievement: 40,
  };
  for (const [domain, minimum] of Object.entries(minimums) as Array<[QaDomain, number]>) {
    if (qaGenerated.filter((item) => item.sourceDomain === domain).length < minimum)
      throw new Error(`Corpus-backed QA generation is short for ${domain}`);
  }
  if (corpus.dialogue.length < minimums.dialogue)
    throw new Error("Pinned corpus does not contain enough dialogue nodes");
  for (const kind of ["character", "material", "weapon", "enemy", "achievement"] as const)
    if (corpus.structured[kind].length < 1)
      throw new Error(`Pinned corpus has no structured ${kind} records`);
}

function countByDomain(cases: JsonObject[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of cases) {
    const domain = text(item.sourceDomain);
    if (domain) result[domain] = (result[domain] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => compareStrings(left, right)),
  );
}

function countByField(cases: JsonObject[], field: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of cases) {
    const value = text(item[field]);
    if (value) result[value] = (result[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => compareStrings(left, right)),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(
    path,
    await formatJson(JSON.stringify(value), {
      parser: "json",
      printWidth: 100,
      trailingComma: "all",
    }),
    "utf8",
  );
}

async function main(): Promise<void> {
  const regression = await readJson<SearchRegression>(SEARCH_REGRESSION_PATH);
  const corpus = await loadCorpus(regression);
  const existingQaValue = await readJson<unknown>(QA_PATH);
  const existingQaCases = Array.isArray(existingQaValue)
    ? (existingQaValue.filter((value) => !isGeneratedCase(value)) as QaGoldenCase[])
    : [];
  if (!Array.isArray(existingQaValue))
    throw new Error("QA golden must retain its existing array schema");
  const generatedQa = generatedQaCases(corpus);
  const qaCases = [...existingQaCases, ...generatedQa];

  const existingMcpValue = await readJson<JsonObject>(MCP_PATH);
  const existingMcpCases = asArray(existingMcpValue.cases).filter(
    (value) => !isGeneratedCase(value),
  ) as McpGoldenCase[];
  const generatedMcp = generatedMcpCases(corpus);
  const mcpCases = [...existingMcpCases, ...generatedMcp];
  assertCaseShape(corpus, qaCases, mcpCases);

  await writeJson(QA_PATH, qaCases);
  await writeJson(MCP_PATH, { ...existingMcpValue, cases: mcpCases });
  console.log(
    JSON.stringify(
      {
        corpus: {
          source: corpus.source,
          upstreamCommit: corpus.upstreamCommit,
          upstreamVersion: corpus.upstreamVersion,
          records: {
            dialogue: corpus.dialogue.length,
            quest: corpus.documents.quest.length,
            book: corpus.documents.book.length,
            character_story: corpus.documents.character_story.length,
            item: corpus.documents.item.length,
            achievement: corpus.structured.achievement.length,
          },
        },
        qa: {
          existing: existingQaCases.length,
          added: generatedQa.length,
          total: qaCases.length,
          addedByDomain: countByDomain(generatedQa),
          output: relative(REPOSITORY_ROOT, QA_PATH),
        },
        mcp: {
          existing: existingMcpCases.length,
          added: generatedMcp.length,
          total: mcpCases.length,
          addedByTool: countByField(generatedMcp, "expectedTool"),
          addedByDomain: countByDomain(generatedMcp),
          output: relative(REPOSITORY_ROOT, MCP_PATH),
        },
      },
      null,
      2,
    ),
  );
}

await main();
