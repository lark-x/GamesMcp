import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { NormalizedRecord, QuestRecordPayload } from "../packages/domain/src/index.ts";
import { validateNormalizedRecords } from "../packages/domain/src/index.ts";
import {
  buildTalkSourceRegistry,
  resolveQuestTalks,
  type ResolvedQuestTalks,
  type TalkSourceRegistry,
} from "../packages/ingestion/src/anime-game-data/talk/index.ts";
import {
  parseBinQuestFile,
  classifyDialogueResolution,
  classifyQuestContentRole,
  type QuestBinRecord,
  type QuestContentRole,
  type DialogueResolutionStatus,
  type QuestRelationEdge,
} from "../packages/ingestion/src/anime-game-data/quest/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.ts";
import { loadConfig } from "../packages/config/src/index.ts";

export const QUEST_CONVERTER_VERSION = "anime-game-data-quests-v2";
export const DEFAULT_QUEST_UPSTREAM_DIR =
  process.env.ANIME_GAME_DATA_DIR ??
  (existsSync("data/upstream/AnimeGameData-current")
    ? "data/upstream/AnimeGameData-current"
    : "data/upstream/AnimeGameData");
export const QUEST_UPSTREAM_SOURCE = "DimbreathBot/AnimeGameData";
const execFileAsync = promisify(execFile);

const inputPaths = {
  mainQuest: "ExcelBinOutput/MainQuestExcelConfigData.json",
  quest: "ExcelBinOutput/QuestExcelConfigData.json",
  chapter: "ExcelBinOutput/ChapterExcelConfigData.json",
  questCodex: "ExcelBinOutput/QuestCodexExcelConfigData.json",
  talk0: "ExcelBinOutput/TalkExcelConfigData_0.json",
  talk1: "ExcelBinOutput/TalkExcelConfigData_1.json",
  dialog: "ExcelBinOutput/DialogExcelConfigData.json",
  npc: "ExcelBinOutput/NpcExcelConfigData.json",
  avatar: "ExcelBinOutput/AvatarExcelConfigData.json",
  textMapChs: "TextMap/TextMapCHS.json",
  textMapMediumChs: "TextMap/TextMap_MediumCHS.json",
  textMapEn: "TextMap/TextMapEN.json",
  textMapMediumEn: "TextMap/TextMap_MediumEN.json",
} as const;
const codexQuestDir = "BinOutput/CodexQuest";
const binQuestDir = "BinOutput/Quest";
const mainQuestRelationsPath = "ExcelBinOutput/MainQuestFmtQuestRelateExcelConfigData.json";
const questTalkDir = "BinOutput/Talk/Quest";

const locales = ["zh-CN", "en"] as const;
type Locale = (typeof locales)[number];
type Json = Record<string, unknown>;
type StoryFamilyOverride = {
  id: string;
  title?: Partial<Record<Locale, string>>;
  questIds: string[];
  order?: number;
  chapterOrders?: Record<string, number>;
};

export type QuestConversionOptions = {
  upstreamDir?: string;
  limit?: number;
  profile?: boolean;
  context?: {
    upstreamCommit?: string;
    upstreamCommitDate?: string;
    gameVersion?: string;
    upstreamVersionLabel?: string;
  };
};

export type QuestConversionManifest = {
  schemaVersion: 2;
  generatedAt?: string;
  upstream: {
    source: string;
    commit: string;
    commitDate: string;
    versionLabel: string;
  };
  gameVersion: string;
  locales: Locale[];
  converterVersion: string;
  inputHashes: Record<string, string>;
  counts: {
    mainQuests: number;
    discoveredByType: Record<string, number>;
    documents: Record<Locale, number>;
    eligibleDocuments: Record<Locale, number>;
    publicDocuments: Record<Locale, number>;
    completeness: Record<Locale, Record<"complete" | "partial" | "metadata_only", number>>;
    subquests: number;
    dialogueNodes: number;
    dialogueEdges: number;
  };
  accounting: {
    discoveredMainQuests: number;
    discoveredDocuments: number;
    convertedDocuments: number;
    excludedDocuments: number;
    failedDocuments: number;
    accountedCoverage: number;
    unexplainedMissing: number;
  };
  sourceCoverage: {
    codexQuestFiles: number;
    codexQuestMatchedMainQuests: number;
    questTalkFiles: number;
    questTalkDialogRows: number;
    questTalkMatchedMainQuests: number;
    talkFallbackMainQuests: number;
    binQuestFiles: number;
    binQuestParsedMainQuests: number;
    binQuestRelationEdges: number;
    binQuestFailures: number;
    talkRegistryFiles: number;
    talkRegistryParsedFiles: number;
    talkRegistryDuplicateTalkIds: number;
    npcGroupRelationEdges: number;
  };
  quality: {
    metadataOnlyDocuments: Record<Locale, number>;
    titleUnresolvedDocuments: number;
    speakerUnresolvedNodes: Record<Locale, number>;
    speakerNpcFallbackNodes: Record<Locale, number>;
  };
  excluded: Array<{ sourceKey: string; reason: string }>;
  failures: Array<{ sourceKey: string; reason: string }>;
  warnings: Array<{ sourceKey: string; warning: string }>;
  completenessReasons: Array<{ sourceKey: string; reasons: string[] }>;
  unexplainedMissing: Array<{ scope: string; count: number }>;
};

export type QuestConversionResult = {
  records: NormalizedRecord[];
  /**
   * All successfully normalized locale records, including rows that are later
   * excluded from the public bilingual projection.  The audit phase uses this
   * view to explain metadata-only, hidden, and asymmetric rows without having
   * to run a second parser pass.
   */
  auditRecords: NormalizedRecord[];
  /** Reuse the converter's source indexes during the read-only audit pass. */
  auditInputs: Inputs;
  manifest: QuestConversionManifest;
};

type QuestType = QuestRecordPayload["questType"];
type TitleResolutionMethod = "textmap_direct" | "codex_fallback" | "chapter_derived" | "unresolved";
type TitleResolution = {
  title: string;
  method: TitleResolutionMethod;
  locale: Locale;
  hash?: string;
  source: string;
};
type CodexQuestFile = Inputs["codexQuest"][number];

const dialogueRegionAliases: Record<string, string> = {
  mengde: "mondstadt",
  mondstadt: "mondstadt",
  liyue: "liyue",
  inazuma: "inazuma",
  daoqi: "inazuma",
  sumeru: "sumeru",
  xumi: "sumeru",
  fontaine: "fontaine",
  water: "fontaine",
  natlan: "natlan",
  nodkrai: "nod_krai",
  "nod-krai": "nod_krai",
  snezhnaya: "snezhnaya",
};

/**
 * QuestDialogue paths carry the game's own region partition, including for
 * world quests that have no ChapterExcelConfigData row.  Keep this mapping
 * deliberately small: only tokens that are unambiguous region names are
 * accepted, while event/temporary scene names remain unclassified.
 */
function regionIdFromPerformCfg(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const match = raw.match(/QuestDialogue[\\/]([^\\/]+)[\\/]([^\\/_]+)(?:_|[\\/])/i);
  const token = match?.[2]?.toLocaleLowerCase("en");
  return token ? dialogueRegionAliases[token] : undefined;
}

function indexQuestRegions(talk: Json[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const row of talk) {
    const mainId = idText(row.questId ?? row.mainQuestId ?? row.mainId);
    const regionId = regionIdFromPerformCfg(row.performCfg ?? row.performConfig);
    if (!mainId || !regionId) continue;
    const values = candidates.get(mainId) ?? new Set<string>();
    values.add(regionId);
    candidates.set(mainId, values);
  }
  return new Map(
    [...candidates.entries()]
      .filter(([, regionIds]) => regionIds.size === 1)
      .map(([mainId, regionIds]) => [mainId, [...regionIds][0]!]),
  );
}

type Inputs = {
  root: string;
  mainQuest: Json[];
  mainQuestById: Map<string, Json>;
  mainQuestRelations: Map<string, string[]>;
  quest: Json[];
  questByMainId: Map<string, Json[]>;
  chapter: Json[];
  chapterByMainId: Map<string, Json>;
  questRegionByMainId: Map<string, string>;
  questCodex: Json[];
  talk: Json[];
  dialog: Json[];
  dialogById: Map<string, Json>;
  questTalkDialogById: Map<string, Json>;
  npcById: Map<string, Json>;
  codexQuest: Array<{ relativePath: string; hash: string; value: Json }>;
  codexQuestByMainId: Map<string, { relativePath: string; hash: string; value: Json }>;
  codexQuestFailures: Array<{ relativePath: string; reason: string }>;
  questTalkDialogRows: Json[];
  questTalkFiles: number;
  questTalkInputHashes: Record<string, string>;
  questTalkAggregateHash?: string;
  questTalkFailures: Array<{ relativePath: string; reason: string }>;
  binQuest: QuestBinRecord[];
  binQuestByMainId: Map<string, QuestBinRecord>;
  binQuestFailures: Array<{ relativePath: string; reason: string }>;
  talkRegistry: TalkSourceRegistry;
  resolvedTalksByMainId: Map<string, ResolvedQuestTalks>;
  resolvedTalkRowsByMainId: Map<string, Json[]>;
  resolvedTalkDialogRowsByMainId: Map<string, Json[]>;
  questRelationEdges: QuestRelationEdge[];
  npc: Json[];
  avatar: Json[];
  textMaps: Record<Locale, Record<string, unknown>>;
  inputHashes: Record<string, string>;
  storyFamilyOverrides: StoryFamilyOverride[];
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return text(value);
}

async function loadStoryFamilyOverrides(): Promise<StoryFamilyOverride[]> {
  const relativePath = "data/curated/genshin-story-family-overrides.json";
  try {
    const raw = await readFile(resolve(process.cwd(), relativePath), "utf8");
    const parsed = asObject(JSON.parse(raw));
    return asArray(parsed.families).flatMap((value) => {
      const id = text(value.id);
      const questIds = Array.isArray(value.questIds)
        ? value.questIds.map(idText).filter((item): item is string => Boolean(item))
        : [];
      if (!id || questIds.length === 0) return [];
      const titleValue = asObject(value.title);
      const title: Partial<Record<Locale, string>> = {};
      const zh = text(titleValue["zh-CN"]);
      const en = text(titleValue.en);
      if (zh) title["zh-CN"] = zh;
      if (en) title.en = en;
      const chapterOrders = asObject(value.chapterOrders);
      return [
        {
          id,
          title,
          questIds,
          order: typeof value.order === "number" ? value.order : undefined,
          chapterOrders: Object.fromEntries(
            Object.entries(chapterOrders).flatMap(([key, order]) =>
              typeof order === "number" ? [[key, order]] : [],
            ),
          ),
        },
      ];
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function textHash(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return text(value);
}

function textRefHash(value: unknown): string | undefined {
  const object = asObject(value);
  return textHash(
    object.BNJEGIAOKGM ??
      object.textMapHash ??
      object.hash ??
      object.value ??
      (Object.keys(object).length ? undefined : value),
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanDialogue(value: string): string {
  return value
    .replace(/<color=[^>]+>/gi, "")
    .replace(/<\/color>/gi, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

const questMarkerPattern = /\$(?:HIDDEN|UNRELEASED)\$?/i;
const questTestPattern =
  /(?:^|[\s._()（）【】[\]{}*·-])(?:test|debug|tutorial|mirror|placeholder|dummy|hidden|internal)(?:$|[\s._()（）【】[\]{}*·-])/i;

export type QuestVisibilityReason =
  | "public"
  | "hidden_show_type"
  | "unresolved_show_type"
  | "unreleased_marker"
  | "test_or_placeholder"
  | "unresolved_title"
  | "incomplete_content";

/**
 * Classify a main quest without guessing from its numeric id.  The client-facing
 * catalogue only exposes `public` records; all other rows remain accounted for
 * in the conversion manifest as explicit exclusions.
 */
export function classifyQuestVisibility(
  main: Json,
  title: string | undefined,
): QuestVisibilityReason {
  const showType = text(main.showType ?? main.questShowType ?? main.visibility);
  if (showType) {
    if (/UNRELEASED/i.test(showType)) return "unreleased_marker";
    if (/HIDDEN/i.test(showType)) return "hidden_show_type";
    if (/TEST|DEBUG/i.test(showType)) return "test_or_placeholder";
    if (!/^(?:PUBLIC|SHOW|VISIBLE|NORMAL|QUEST_PUBLIC|QUEST_SHOW)$/i.test(showType)) {
      return "unresolved_show_type";
    }
  }
  if (!title) return "unresolved_title";
  if (questMarkerPattern.test(title))
    return /UNRELEASED/i.test(title) ? "unreleased_marker" : "hidden_show_type";
  if (questTestPattern.test(title) || /\$(?:TEST|DEBUG|HIDDEN)\$/i.test(title))
    return "test_or_placeholder";
  if (/^Quest\s+\d+$/i.test(title)) return "unresolved_title";
  return "public";
}

function resolveText(
  textMap: Record<string, unknown>,
  hash: unknown,
  sourceKey: string,
  field: string,
): string {
  const key = textHash(hash);
  if (!key) throw new Error(`text_hash_missing:${sourceKey}:${field}`);
  const value = textMap[key];
  if (typeof value !== "string")
    throw new Error(`text_hash_unresolved:${sourceKey}:${field}:${key}`);
  return cleanDialogue(value);
}

function tryResolveText(textMap: Record<string, unknown>, hash: unknown): string | undefined {
  const key = textRefHash(hash);
  if (!key) return undefined;
  const value = textMap[key];
  return typeof value === "string" && value.trim() ? cleanDialogue(value) : undefined;
}

function resolveLocalizedText(
  textMaps: Record<Locale, Record<string, unknown>>,
  requestedLocale: Locale,
  hash: unknown,
): { value: string; locale: Locale; hash: string } | undefined {
  const key = textRefHash(hash);
  if (!key) return undefined;
  const localesToTry: Locale[] = [requestedLocale, requestedLocale === "zh-CN" ? "en" : "zh-CN"];
  for (const locale of localesToTry) {
    const value = tryResolveText(textMaps[locale], key);
    if (value) return { value, locale, hash: key };
  }
  return undefined;
}

function hashValue(value: unknown): string | undefined {
  return textRefHash(value);
}

async function readJson(
  root: string,
  relativePath: string,
): Promise<{ value: unknown; hash: string }> {
  const raw = await readFile(join(root, relativePath), "utf8");
  return { value: JSON.parse(raw), hash: sha256(raw) };
}

type QuestTalkLoadResult = {
  rows: Json[];
  files: number;
  inputHashes: Record<string, string>;
  aggregateHash?: string;
  failures: Array<{ relativePath: string; reason: string }>;
};

/**
 * Newer quest dialogue is emitted as opaque BinOutput/Talk/Quest records rather
 * than rows in DialogExcelConfigData.  The public TalkExcel rows still point at
 * the same numeric dialogue ids, so normalize this source into the legacy
 * dialogue shape and let the existing graph traversal consume both formats.
 */
async function loadQuestTalkDialogs(root: string): Promise<QuestTalkLoadResult> {
  const directory = join(root, questTalkDir);
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    return {
      rows: [],
      files: 0,
      inputHashes: {},
      failures:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? []
          : [
              {
                relativePath: questTalkDir,
                reason: error instanceof Error ? error.message : String(error),
              },
            ],
    };
  }

  const rows: Json[] = [];
  const inputHashes: Record<string, string> = {};
  const failures: Array<{ relativePath: string; reason: string }> = [];
  for (const file of files) {
    const relativePath = `${questTalkDir}/${file}`;
    try {
      const raw = await readFile(join(directory, file), "utf8");
      inputHashes[relativePath] = sha256(raw);
      const value = asObject(JSON.parse(raw));
      for (const sourceRow of asArray(value.PFALHAKIILD)) {
        const nodeId = idText(sourceRow.OIFGMOHKPOI);
        if (!nodeId) continue;
        const role = asObject(sourceRow.LFGCLNLPAPB);
        rows.push({
          GFLDJMJKIKE: sourceRow.OIFGMOHKPOI,
          nextDialogs: Array.isArray(sourceRow.KMLAFCBMFEI) ? sourceRow.KMLAFCBMFEI : [],
          talkRole: role ? { type: role._type, id: role._id } : undefined,
          // In this binary table OACNIBLFFDI is the dialogue body hash and
          // BKABCBAFIKD is the optional explicit speaker-name hash.
          talkContentTextMapHash: sourceRow.OACNIBLFFDI,
          talkRoleNameTextMapHash: sourceRow.BKABCBAFIKD,
          __sourceFile: relativePath,
        });
      }
    } catch (error) {
      failures.push({
        relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const aggregateHash = sha256(
    Object.entries(inputHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, hash]) => `${relativePath}:${hash}`)
      .join("\n"),
  );
  return { rows, files: files.length, inputHashes, aggregateHash, failures };
}

type BinQuestLoadResult = {
  records: QuestBinRecord[];
  byMainId: Map<string, QuestBinRecord>;
  inputHashes: Record<string, string>;
  failures: Array<{ relativePath: string; reason: string }>;
};

async function loadBinQuestRecords(root: string): Promise<BinQuestLoadResult> {
  const directory = join(root, binQuestDir);
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { records: [], byMainId: new Map(), inputHashes: {}, failures: [] };
    return {
      records: [],
      byMainId: new Map(),
      inputHashes: {},
      failures: [{ relativePath: binQuestDir, reason: error instanceof Error ? error.message : String(error) }],
    };
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const relativePath = `${binQuestDir}/${file}`;
      try {
        const raw = await readFile(join(root, relativePath), "utf8");
        const value = asObject(JSON.parse(raw));
        const parsed = parseBinQuestFile(value, relativePath, sha256(raw));
        return { relativePath, hash: sha256(raw), parsed };
      } catch (error) {
        return {
          relativePath,
          hash: undefined,
          parsed: undefined,
          failure: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const inputHashes: Record<string, string> = {};
  const failures: Array<{ relativePath: string; reason: string }> = [];
  const records: QuestBinRecord[] = [];
  for (const item of loaded) {
    if (item.hash) inputHashes[item.relativePath] = item.hash;
    if (item.failure) failures.push({ relativePath: item.relativePath, reason: item.failure });
    if (item.parsed) records.push(item.parsed);
  }
  const byMainId = new Map<string, QuestBinRecord>();
  for (const record of records) byMainId.set(record.mainQuestId, record);
  return { records, byMainId, inputHashes, failures };
}

export async function loadInputs(root: string): Promise<Inputs> {
  const loaded = await Promise.all(
    Object.entries(inputPaths).map(async ([key, relativePath]) => {
      const file = await readJson(root, relativePath);
      return [key, file] as const;
    }),
  );
  const byKey = Object.fromEntries(loaded);
  const codexQuest: Inputs["codexQuest"] = [];
  const codexQuestFailures: Inputs["codexQuestFailures"] = [];
  try {
    const files = (await readdir(join(root, codexQuestDir)))
      .filter((file) => file.endsWith(".json"))
      .sort();
    for (const file of files) {
      const relativePath = `${codexQuestDir}/${file}`;
      try {
        const raw = await readFile(join(root, relativePath), "utf8");
        if (!raw.trim()) throw new Error("empty_json");
        codexQuest.push({
          relativePath,
          hash: sha256(raw),
          value: asObject(JSON.parse(raw)),
        });
      } catch (error) {
        codexQuestFailures.push({
          relativePath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    codexQuestFailures.push({
      relativePath: codexQuestDir,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  let mainQuestRelationsValue: unknown = [];
  let mainQuestRelationsHash: string | undefined;
  try {
    const relationFile = await readJson(root, mainQuestRelationsPath);
    mainQuestRelationsValue = relationFile.value;
    mainQuestRelationsHash = relationFile.hash;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const mainQuest = asArray(byKey.mainQuest.value);
  const mainQuestById = new Map(
    mainQuest.flatMap((row) => {
      const id = idText(row.id ?? row.mainQuestId);
      return id ? [[id, row] as const] : [];
    }),
  );
  const mainQuestRelations = new Map<string, string[]>();
  for (const row of asArray(mainQuestRelationsValue)) {
    const mainId = idText(row.mainQuestID ?? row.mainQuestId ?? row.id);
    if (!mainId) continue;
    const relatedIds = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map((item) => idText(item)).filter((item): item is string => Boolean(item))
        : [];
    const related = [...relatedIds(row.JPHNIKNHFBL), ...relatedIds(row.GCOCPOOBMEE)];
    if (related.length) mainQuestRelations.set(mainId, [...new Set(related)]);
  }
  const quest = asArray(byKey.quest.value);
  const chapter = asArray(byKey.chapter.value);
  const questCodex = asArray(byKey.questCodex.value);
  const talk = [...asArray(byKey.talk0.value), ...asArray(byKey.talk1.value)];
  const dialog = asArray(byKey.dialog.value);
  const npc = asArray(byKey.npc.value);
  const avatar = asArray(byKey.avatar.value);
  const questTalk = await loadQuestTalkDialogs(root);
  const binQuest = await loadBinQuestRecords(root);
  // Parse the relation-bearing Talk families up front.  Npc assets are kept
  // in the registry and loaded by exact talk id on demand, which keeps the
  // full conversion deterministic without retaining every idle NPC file.
  const talkRegistry = await buildTalkSourceRegistry(root, {
    parseKinds: ["quest", "npc_group"],
    concurrency: 32,
  });
  const textMaps: Inputs["textMaps"] = {
    "zh-CN": {
      ...asObject(byKey.textMapChs.value),
      ...asObject(byKey.textMapMediumChs.value),
    },
    en: {
      ...asObject(byKey.textMapEn.value),
      ...asObject(byKey.textMapMediumEn.value),
    },
  };
  const chapterByMainId = new Map<string, Json>();
  for (const row of chapter) {
    const chapterQuestIds = Array.isArray(row.PACJEJCGPLN) ? row.PACJEJCGPLN : [];
    for (const value of chapterQuestIds) {
      const mainId = idText(value);
      if (mainId) chapterByMainId.set(mainId, row);
    }
  }
  const questByMainId = new Map<string, Json[]>();
  for (const row of quest) {
    const mainId = idText(row.mainQuestId ?? row.mainId);
    if (!mainId) continue;
    const rows = questByMainId.get(mainId) ?? [];
    rows.push(row);
    questByMainId.set(mainId, rows);
  }
  for (const rows of questByMainId.values()) {
    rows.sort(
      (left, right) =>
        Number(left.order ?? left.subId ?? left.id ?? 0) -
        Number(right.order ?? right.subId ?? right.id ?? 0),
    );
  }
  const dialogById = new Map(
    dialog.flatMap((row) => {
      const id = dialogueId(row);
      return id ? [[id, row] as const] : [];
    }),
  );
  const questTalkDialogById = new Map(
    questTalk.rows.flatMap((row) => {
      const id = dialogueId(row);
      return id ? [[id, row] as const] : [];
    }),
  );
  const npcById = new Map(
    npc.flatMap((row) => {
      const id = idText(row.id ?? row.npcId);
      return id ? [[id, row] as const] : [];
    }),
  );
  const codexQuestByMainId = new Map(
    codexQuest.flatMap((item) => {
      const id = codexMainId(item.value);
      return id ? [[id, item] as const] : [];
    }),
  );
  const inputHashes = Object.fromEntries(
    Object.entries(inputPaths).map(([key, relativePath]) => [
      relativePath,
      byKey[key as keyof typeof inputPaths].hash,
    ]),
  );
  for (const item of codexQuest) inputHashes[item.relativePath] = item.hash;
  if (mainQuestRelationsHash) inputHashes[mainQuestRelationsPath] = mainQuestRelationsHash;
  Object.assign(inputHashes, questTalk.inputHashes);
  Object.assign(inputHashes, binQuest.inputHashes);
  const storyFamilyOverrides = await loadStoryFamilyOverrides();

  const resolvedTalksByMainId = new Map<string, ResolvedQuestTalks>();
  const resolvedTalkRowsByMainId = new Map<string, Json[]>();
  const resolvedTalkDialogRowsByMainId = new Map<string, Json[]>();
  for (const main of mainQuest) {
    const mainId = idText(main.id ?? main.mainQuestId);
    if (!mainId) continue;
    const bin = binQuest.byMainId.get(mainId);
    const resolved = await resolveQuestTalks({
      mainQuestId: mainId,
      relatedQuestIds: bin?.subQuestIds,
      completeTalkIds: bin?.completeTalkIds,
      talkRows: talk,
      registry: talkRegistry,
    });
    resolvedTalksByMainId.set(mainId, resolved);
    const rows: Json[] = [];
    const dialogueRows: Json[] = [];
    for (const candidate of resolved.candidates) {
      const asset = candidate.asset;
      if (!asset) continue;
      for (const dialogueRow of asset.dialogueRows) {
        const normalizedRow: Json = {
          GFLDJMJKIKE: dialogueRow.dialogId,
          nextDialogs: dialogueRow.nextDialogIds,
          talkRole: { type: dialogueRow.roleType, id: dialogueRow.roleId },
          talkContentTextMapHash: dialogueRow.bodyHash,
          talkRoleNameTextMapHash: dialogueRow.speakerNameHash,
          __sourceFile: dialogueRow.sourceFile,
          __talkId: candidate.talkId,
          __sourceKind: candidate.sourceKind,
          __relationEvidence: candidate.evidence,
          __relationEdgeId: candidate.relationEdgeId,
        };
        dialogueRows.push(normalizedRow);
        const existing = questTalkDialogById.get(dialogueRow.dialogId);
        if (!existing || !tryResolveText(textMaps["zh-CN"], existing.talkContentTextMapHash))
          questTalkDialogById.set(dialogueRow.dialogId, normalizedRow);
      }
      const roots = asset.rootDialogueIds.length ? asset.rootDialogueIds : [];
      for (const [index, rootDialog] of roots.entries()) {
        rows.push({
          id: `${candidate.talkId}:${rootDialog}:${index}`,
          initDialog: rootDialog,
          questId: mainId,
          __sourceFile: candidate.sourceFile,
          __talkId: candidate.talkId,
          __sourceKind: candidate.sourceKind,
          __relationEvidence: candidate.evidence,
          __relationEdgeId: candidate.relationEdgeId,
        });
      }
    }
    resolvedTalkRowsByMainId.set(mainId, rows);
    resolvedTalkDialogRowsByMainId.set(mainId, dialogueRows);
  }

  return {
    root,
    mainQuest,
    mainQuestById,
    mainQuestRelations,
    quest,
    questByMainId,
    chapter,
    chapterByMainId,
    questRegionByMainId: indexQuestRegions(talk),
    questCodex,
    talk,
    dialog,
    dialogById,
    questTalkDialogById,
    npcById,
    codexQuest,
    codexQuestByMainId,
    codexQuestFailures,
    npc,
    avatar,
    textMaps,
    inputHashes,
    questTalkDialogRows: questTalk.rows,
    questTalkFiles: questTalk.files,
    questTalkInputHashes: questTalk.inputHashes,
    questTalkAggregateHash: questTalk.aggregateHash,
    questTalkFailures: questTalk.failures,
    binQuest: binQuest.records,
    binQuestByMainId: binQuest.byMainId,
    binQuestFailures: binQuest.failures,
    talkRegistry,
    resolvedTalksByMainId,
    resolvedTalkRowsByMainId,
    resolvedTalkDialogRowsByMainId,
    questRelationEdges: [
      ...binQuest.records.flatMap((record) => record.relationEdges),
      ...talkRegistry.npcGroupRelations,
      ...[...mainQuestRelations.entries()].flatMap(([fromQuestId, relatedIds]) =>
        relatedIds.map((toQuestId) => ({
          fromQuestId,
          toQuestId,
          relationType: "main_quest_relation" as const,
          sourceFile: mainQuestRelationsPath,
          sourcePath: `mainQuestRelations[${fromQuestId}]`,
          sourceHash: mainQuestRelationsHash ?? "",
          derived: false,
          confidence: 1,
          metadata: { direction: "source_related_ids" },
        })),
      ),
    ],
    storyFamilyOverrides,
  };
}

export function questType(value: unknown): QuestType {
  const raw = text(value)?.toLocaleLowerCase("en");
  if (raw === "aq" || raw === "archon" || raw === "archon_quest") return "archon_quest";
  if (raw === "lq" || raw === "story" || raw === "story_quest") return "story_quest";
  if (raw === "eq" || raw === "event" || raw === "event_quest") return "event_quest";
  if (raw === "wq" || raw === "world" || raw === "world_quest") return "world_quest";
  if (
    raw === "iq" ||
    raw === "commission" ||
    raw === "commissions" ||
    raw === "cq" ||
    raw === "daily" ||
    raw === "daily_quest" ||
    raw === "daily_commission" ||
    raw === "commission_quest"
  )
    return "commission";
  if (raw === "hangout" || raw === "hangout_quest" || raw === "hq") return "hangout";
  return "other";
}

function questTypeWarning(value: unknown): string | undefined {
  const raw = text(value);
  return questType(value) === "other" ? `unknown_quest_type:${raw ?? "missing"}` : undefined;
}

function numericId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return undefined;
}

function directSeriesId(main: Json): string | undefined {
  const series = asObject(main.series);
  return idText(main.seriesId ?? series.id ?? (numericId(main.series) ? main.series : undefined));
}

/**
 * MainQuestExcelConfigData does not consistently carry a series id on every
 * member.  The relation table does, however, link follow-up quests to the
 * root quest.  Resolve that link transitively instead of turning a numeric
 * series value into a fake chapter id.
 */
function resolveSeriesId(inputs: Inputs, mainId: string, main: Json): string | undefined {
  const direct = directSeriesId(main);
  if (direct) return direct;

  const queue = [mainId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const related of inputs.mainQuestRelations.get(current) ?? []) {
      // The relation table also contains legacy test roots (for example 309
      // and 396). They are valid rows but are not story-family parents.
      if (related === "309" || related === "396") continue;
      const relatedMain = inputs.mainQuestById.get(related);
      if (!relatedMain) continue;
      const relatedTitle = questTitleForSeries(inputs, relatedMain, "zh-CN") ?? "";
      if (/\(test\)|测试|\$HIDDEN/iu.test(relatedTitle)) continue;
      const relatedSeries = relatedMain ? directSeriesId(relatedMain) : undefined;
      if (relatedSeries) return relatedSeries;
      if (!visited.has(related)) queue.push(related);
    }
  }
  return undefined;
}

function questTitleForSeries(inputs: Inputs, row: Json, locale: Locale): string | undefined {
  const direct = text(row.title);
  if (direct) return cleanDialogue(direct);
  const resolved = resolveLocalizedText(
    inputs.textMaps,
    locale,
    row.titleTextMapHash ?? row.titleHash,
  );
  return resolved?.value;
}

function deriveSeriesTitle(
  inputs: Inputs,
  seriesId: string | undefined,
  locale: Locale,
  preferredTitle?: string,
): string | undefined {
  if (!seriesId) return undefined;
  const members = inputs.mainQuest.filter(
    // Use the source's direct series membership when deriving the display name.
    // Relation inheritance is useful for assigning a quest to a series, but
    // following it here can pull an adjacent quest chain into an unrelated
    // series title (for example, The Exile vs. A Gifted Rose).
    (row) => directSeriesId(row) === seriesId,
  );
  const titles = members
    .map((row) => questTitleForSeries(inputs, row, locale))
    .filter((value): value is string => Boolean(value));
  const prefixes = new Map<string, number>();
  for (const title of titles) {
    const match = title.match(/^(.+?)[·・:：]\s*.+$/u);
    if (!match?.[1]) continue;
    const prefix = match[1].trim();
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  const preferredPrefix = preferredTitle?.match(/^(.+?)[·・:：]\s*.+$/u)?.[1]?.trim();
  if (preferredPrefix && prefixes.size > 1 && prefixes.has(preferredPrefix)) {
    return preferredPrefix;
  }
  const repeatedPrefix = [...prefixes.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0];
  if (repeatedPrefix) return repeatedPrefix;
  if (members.length > 1) return locale === "en" ? "Quest Series" : "连续任务";
  return undefined;
}

const genericStoryFamilyTitles = new Set([
  "连续任务",
  "Quest Series",
  "开拓任务",
  "同行任务",
  "开拓续闻",
  "冒险任务",
  "日常任务",
  "活动任务",
  "散篇剧情",
  "散篇任务",
]);

function chapterStoryOrder(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (value.includes("序曲") || value.includes("序章") || /\bprologue\b/iu.test(value)) return 10;
  const match = value.match(/第([一二三四五六七八九十百]+)章/u);
  if (!match?.[1]) return undefined;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    百: 100,
  };
  const valueText = match[1];
  if (valueText.length === 1) return (digits[valueText] ?? 0) * 10;
  if (valueText === "十一") return 110;
  if (valueText.startsWith("十")) return (10 + (digits[valueText.slice(1)] ?? 0)) * 10;
  if (valueText.endsWith("十")) return (digits[valueText[0] ?? ""] ?? 0) * 100;
  return undefined;
}

function storyFamilyOverrideFor(
  inputs: Inputs,
  mainId: string,
): StoryFamilyOverride | undefined {
  return inputs.storyFamilyOverrides.find((override) => override.questIds.includes(mainId));
}

function resolveStoryFamily(
  inputs: Inputs,
  mainId: string,
  main: Json,
  locale: Locale,
  chapterId: string | undefined,
  chapterTitle: string | undefined,
  resolvedSeriesTitle: string | undefined,
  seriesId: string | undefined,
): {
  id: string;
  title: string;
  provenance: "upstream" | "derived" | "curated" | "fallback";
  familyOrder?: number;
  chapterOrder?: number;
} {
  const override = storyFamilyOverrideFor(inputs, mainId);
  if (override) {
    return {
      id: override.id,
      title: override.title?.[locale] ?? override.title?.["zh-CN"] ?? override.id,
      provenance: "curated",
      familyOrder: override.order,
      chapterOrder: override.chapterOrders?.[chapterId ?? ""] ?? chapterStoryOrder(chapterTitle),
    };
  }

  const meaningfulSeries =
    resolvedSeriesTitle && !genericStoryFamilyTitles.has(resolvedSeriesTitle.trim())
      ? resolvedSeriesTitle.trim()
      : undefined;
  if (meaningfulSeries) {
    return {
      id: `genshin:series:${seriesId ?? meaningfulSeries}`,
      title: meaningfulSeries,
      provenance: seriesId ? "upstream" : "derived",
      chapterOrder: chapterStoryOrder(chapterTitle),
    };
  }

  const chapterGroup = inputs.chapterByMainId.get(mainId)?.groupId;
  if (chapterGroup !== undefined && chapterGroup !== null) {
    const groupId = idText(chapterGroup) ?? String(chapterGroup);
    return {
      id: `genshin:chapter-group:${groupId}`,
      title:
        chapterTitle?.split(/[·:：]/u, 1)[0]?.trim() ||
        (locale === "en" ? "Story Group" : "任务系列"),
      provenance: "derived",
      chapterOrder: chapterStoryOrder(chapterTitle),
    };
  }

  const direct = directSeriesId(main);
  if (direct) {
    return {
      id: `genshin:series:${direct}`,
      title: locale === "en" ? "Quest Series" : "任务系列",
      provenance: "derived",
      chapterOrder: chapterStoryOrder(chapterTitle),
    };
  }

  return {
    id: `genshin:standalone:${mainId}`,
    title: locale === "en" ? "Standalone Quests" : "散篇任务",
    provenance: "fallback",
    chapterOrder: chapterStoryOrder(chapterTitle),
  };
}

function resolveTitle(
  inputs: Inputs,
  main: Json,
  codexFile: CodexQuestFile | undefined,
  locale: Locale,
  chapterTitle: { value: string; locale: Locale; hash?: string } | undefined,
  mainId: string,
): TitleResolution {
  const mainTitle = main.titleTextMapHash ?? main.titleHash;
  const codexTitle = codexFile?.value.HEDPNHPBMJH;
  const directTitle = text(main.title);
  if (directTitle) {
    return {
      title: cleanDialogue(directTitle),
      method: "textmap_direct",
      locale,
      source: inputPaths.mainQuest,
    };
  }
  const candidates: Array<{
    hash: unknown;
    method: Exclude<TitleResolutionMethod, "chapter_derived" | "unresolved">;
    source: string;
  }> = [
    { hash: mainTitle, method: "textmap_direct", source: inputPaths.mainQuest },
    ...(codexTitle !== undefined
      ? [{ hash: codexTitle, method: "codex_fallback" as const, source: codexFile!.relativePath }]
      : []),
  ];
  for (const candidate of candidates) {
    const resolved = resolveLocalizedText(inputs.textMaps, locale, candidate.hash);
    if (resolved) {
      return {
        title: resolved.value,
        method: candidate.method,
        locale: resolved.locale,
        hash: resolved.hash,
        source: candidate.source,
      };
    }
  }
  if (chapterTitle) {
    return {
      title: chapterTitle.value,
      method: "chapter_derived",
      locale: chapterTitle.locale,
      hash: chapterTitle.hash,
      source: inputPaths.chapter,
    };
  }
  return {
    title: `Quest ${mainId}`,
    method: "unresolved",
    locale,
    source: inputPaths.mainQuest,
  };
}

function participantEntity(row: Json, locale: Locale, textMap: Record<string, unknown>) {
  const npcId = idText(row.id ?? row.npcId);
  if (!npcId) return undefined;
  const nameHash = row.nameTextMapHash ?? row.nameHash;
  const name =
    nameHash === undefined
      ? text(row.name)
      : (tryResolveText(textMap, nameHash) ?? text(row.jsonName) ?? `NPC ${npcId}`);
  if (!name) return undefined;
  return {
    sourceKey: `npc/${npcId}`,
    name,
    type: "npc" as const,
    aliases: [{ value: name, language: locale, primary: true }],
    properties: { upstreamId: npcId },
  };
}

function codexMainId(value: Json): string | undefined {
  return idText(value.IMJHJGBNMMD ?? value.mainQuestId ?? value.mainId ?? value.id);
}

function codexText(value: Json, key: string): unknown {
  return value[key];
}

function dialogueId(row: Json): string | undefined {
  return idText(row.GFLDJMJKIKE ?? row.id ?? row.dialogId);
}

function talkRoleNpcId(row: Json): string | undefined {
  const role = asObject(row.talkRole);
  const type = text(role.type);
  const id = idText(role.id);
  return type === "TALK_ROLE_NPC" && id ? id : undefined;
}

function npcDisplayName(
  inputs: Inputs,
  npcId: string | undefined,
  textMap: Record<string, unknown>,
): string | undefined {
  const npc = npcId ? inputs.npcById.get(npcId) : undefined;
  if (!npc) return undefined;
  const nameHash = npc.nameTextMapHash ?? npc.nameHash;
  return (
    (nameHash === undefined ? undefined : tryResolveText(textMap, nameHash)) ??
    text(npc.name) ??
    text(npc.jsonName)
  );
}

function resolveDialogSpeakerName(
  inputs: Inputs,
  dialogRow: Json,
  textMap: Record<string, unknown>,
): { value?: string; method: "dialog_textmap" | "npc_fallback" | "unresolved" } {
  const direct = tryResolveText(textMap, dialogRow.talkRoleNameTextMapHash);
  if (direct) return { value: direct, method: "dialog_textmap" };
  const fallback = npcDisplayName(inputs, talkRoleNpcId(dialogRow), textMap);
  return fallback ? { value: fallback, method: "npc_fallback" } : { method: "unresolved" };
}

function buildDialogueGraph(
  inputs: Inputs,
  mainId: string,
  locale: Locale,
  textMap: Record<string, unknown>,
  subquestKeyByTitleHash: Map<string, string>,
): {
  nodes: QuestRecordPayload["dialogueNodes"];
  edges: QuestRecordPayload["dialogueEdges"];
  participantIds: Set<string>;
  sourceFiles: string[];
} {
  const codexFile = inputs.codexQuestByMainId.get(mainId);
  const dialogById = inputs.dialogById;
  const participantIds = new Set<string>();
  const sourceFiles = new Set<string>();
  const nodes: QuestRecordPayload["dialogueNodes"] = [];
  const edges: QuestRecordPayload["dialogueEdges"] = [];
  const nodeKeyByLine = new Map<string, string[]>();
  const nodeKeyByIdentity = new Map<string, string>();
  const pendingEdges: Array<{
    fromNodeKeys: string[];
    targetLineKey: string;
    type: QuestRecordPayload["dialogueEdges"][number]["type"];
    optionText?: string;
    sourceFile: string;
  }> = [];
  const usedNodeKeys = new Set<string>();

  function uniqueNodeKey(base: string): string {
    if (!usedNodeKeys.has(base)) {
      usedNodeKeys.add(base);
      return base;
    }
    let suffix = 2;
    while (usedNodeKeys.has(`${base}-${suffix}`)) suffix += 1;
    const key = `${base}-${suffix}`;
    usedNodeKeys.add(key);
    return key;
  }

  function appendNode(input: {
    nodeId: string;
    type: QuestRecordPayload["dialogueNodes"][number]["type"];
    subquestKey?: string;
    speakerKey?: string;
    speakerName?: string;
    body: string;
    lineKey: string;
    sourceFile: string;
    identityScope?: string;
    nodeKeyBase?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const identity = `${input.identityScope ?? ""}\u0000${input.nodeId}\u0000${input.speakerKey ?? ""}\u0000${input.body}`;
    const existingNodeKey = nodeKeyByIdentity.get(identity);
    if (existingNodeKey) {
      const existing = nodeKeyByLine.get(input.lineKey) ?? [];
      if (!existing.includes(existingNodeKey)) existing.push(existingNodeKey);
      nodeKeyByLine.set(input.lineKey, existing);
      sourceFiles.add(input.sourceFile);
      return existingNodeKey;
    }
    const nodeKey = uniqueNodeKey(
      input.nodeKeyBase ?? `quest/${mainId}/dialog/${input.nodeId}`,
    );
    nodes.push({
      nodeKey,
      nodeId: input.nodeId,
      type: input.type,
      subquestKey: input.subquestKey,
      speakerKey: input.speakerKey,
      speakerName: input.speakerName,
      body: input.body,
      segmentKey: nodeKey,
      order: nodes.length,
      metadata: { sourceFile: input.sourceFile, ...input.metadata },
    });
    const existing = nodeKeyByLine.get(input.lineKey) ?? [];
    existing.push(nodeKey);
    nodeKeyByLine.set(input.lineKey, existing);
    nodeKeyByIdentity.set(identity, nodeKey);
    sourceFiles.add(input.sourceFile);
    return nodeKey;
  }

  if (codexFile) {
    const groups = asArray(codexText(codexFile.value, "EBNBLBEIFFJ"));
    groups.forEach((group, groupIndex) => {
      const groupTitleHash = hashValue(codexText(group, "OGEGCCLHIHP"));
      const subquestKey =
        (groupTitleHash ? subquestKeyByTitleHash.get(groupTitleHash) : undefined) ??
        `quest/${mainId}/subquest/${groupIndex + 1}`;
      const lines = asArray(codexText(group, "PEAKPGNONFA"));
      lines.forEach((line, lineIndex) => {
        const lineId = idText(line.EICGDLLPINH ?? lineIndex) ?? String(lineIndex);
        const lineKey = `${groupIndex}:${lineId}`;
        const lineKind = text(line.NDANANGPLHB);
        const speakerName = tryResolveText(textMap, line.IILBCFJNPGA);
        const narrationRefs = asArray(line.JOLOODLBEGO);
        narrationRefs.forEach((ref, refIndex) => {
          const body = tryResolveText(textMap, ref);
          if (!body) return;
          appendNode({
            nodeId: `codex-${groupIndex}-${lineIndex}-narration-${refIndex}`,
            type: "narration",
            subquestKey,
            body,
            lineKey,
            sourceFile: codexFile.relativePath,
            metadata: {
              textMapHash: hashValue(ref),
              codexLineKind: lineKind,
            },
          });
        });
        const dialogueRefs = asArray(line.OFKGPGLHIDJ);
        dialogueRefs.forEach((ref, refIndex) => {
          const dialogId = idText(ref.AAICCGABILO);
          const dialogRow = dialogId
            ? (dialogById.get(dialogId) ?? inputs.questTalkDialogById.get(dialogId))
            : undefined;
          const body =
            tryResolveText(textMap, ref.JGPDCLOJKLC) ??
            (dialogRow ? tryResolveText(textMap, dialogRow.talkContentTextMapHash) : undefined);
          if (!body) return;
          const npcId = dialogRow ? talkRoleNpcId(dialogRow) : undefined;
          const dialogSpeaker = dialogRow
            ? resolveDialogSpeakerName(inputs, dialogRow, textMap)
            : { method: "unresolved" as const };
          if (npcId) participantIds.add(npcId);
          appendNode({
            nodeId: dialogId ?? `codex-${groupIndex}-${lineIndex}-dialog-${refIndex}`,
            type: lineKind === "MultiDialog" ? "player_choice" : "dialogue",
            subquestKey,
            speakerKey: npcId ? `npc/${npcId}` : undefined,
            speakerName: speakerName ?? dialogSpeaker.value,
            body,
            lineKey,
            sourceFile: codexFile.relativePath,
            metadata: {
              textMapHash: hashValue(ref.JGPDCLOJKLC ?? dialogRow?.talkContentTextMapHash),
              dialogId,
              codexLineKind: lineKind,
              speakerNameResolution: speakerName ? "codex_line_textmap" : dialogSpeaker.method,
            },
          });
        });
        const fromNodeKeys = nodeKeyByLine.get(lineKey) ?? [];
        for (const target of Array.isArray(line.MOMDAPFBMBM) ? line.MOMDAPFBMBM : []) {
          const targetId = idText(target);
          if (!targetId || !fromNodeKeys.length) continue;
          pendingEdges.push({
            fromNodeKeys,
            targetLineKey: `${groupIndex}:${targetId}`,
            type: lineKind === "MultiDialog" ? "choice" : "next",
            optionText:
              fromNodeKeys.length === 1
                ? nodes.find((node) => node.nodeKey === fromNodeKeys[0])?.body
                : undefined,
            sourceFile: codexFile.relativePath,
          });
        }
      });
    });
  }

  {
    const resolvedTalkRows = inputs.resolvedTalkRowsByMainId.get(mainId) ?? [];
    const resolvedTalkDialogRows = inputs.resolvedTalkDialogRowsByMainId.get(mainId) ?? [];
    const resolvedTalkDialogByKey = new Map(
      resolvedTalkDialogRows.flatMap((row) => {
        const talkId = idText(row.__talkId);
        const dialogId = dialogueId(row);
        return talkId && dialogId ? [[`${talkId}:${dialogId}`, row] as const] : [];
      }),
    );
    const directTalkRows = inputs.talk.filter((row) => {
      // TalkExcelConfigData carries an explicit questId.  Prefix matching on
      // the talk id is unsafe (e.g. quest 11 also matches 11124), so rows
      // without the relation are deliberately not assigned to a quest.
      if (idText(row.questId ?? row.mainQuestId ?? row.mainId) === mainId) return true;
      // A few old rows omit questId but retain a path with an explicit quest
      // token (MQ/WQ/LQ/EQ/Q + exact id).  This is still an exact source
      // relation; bare numeric prefix matching is not used here.
      const performCfg = text(row.performCfg ?? row.performConfig);
      if (!performCfg) return false;
      const escaped = mainId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return new RegExp(`(?:^|[/_])(?:MQ|WQ|LQ|EQ|Q)${escaped}(?:[/_]|$)`, "iu").test(
        performCfg,
      );
    });
    const explicitTalkRows = [
      ...directTalkRows,
      ...resolvedTalkRows,
    ];
    const talkRowsById = new Map(
      explicitTalkRows.flatMap((row) => {
        const id = idText(row.id ?? row.__talkId);
        return id ? [[id, row] as const] : [];
      }),
    );
    const talkRows = [...talkRowsById.values()].sort(
      (left, right) => Number(left.id ?? 0) - Number(right.id ?? 0),
    );
    const traverseTalkRows = (useQuestTalkFallback: boolean, followEmptyNodes: boolean) => {
      for (const talk of talkRows) {
        const talkId = idText(talk.__talkId ?? talk.id);
        const initDialog = idText(talk.initDialog);
        if (!talkId || !initDialog) continue;
        const visited = new Set<string>();
        const queue = [initDialog];
        while (queue.length) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);
          const scopedResolvedDialogRow = resolvedTalkDialogByKey.get(`${talkId}:${current}`);
          const legacyDialogRow = dialogById.get(current);
          const legacyBody = legacyDialogRow
            ? tryResolveText(textMap, legacyDialogRow.talkContentTextMapHash)
            : undefined;
          const dialogRow =
            scopedResolvedDialogRow ??
            (useQuestTalkFallback && !legacyBody
              ? (inputs.questTalkDialogById.get(current) ?? legacyDialogRow)
              : legacyDialogRow);
          if (!dialogRow) continue;
          const body = tryResolveText(textMap, dialogRow.talkContentTextMapHash);
          const sourceFile = text(dialogRow.__sourceFile) ?? inputPaths.dialog;
          if (body) {
            const npcId = talkRoleNpcId(dialogRow);
            const speaker = resolveDialogSpeakerName(inputs, dialogRow, textMap);
            if (npcId) participantIds.add(npcId);
            appendNode({
              nodeId: current,
              type: "dialogue",
              subquestKey: `quest/${mainId}/subquest/${talkId}`,
              speakerKey: npcId ? `npc/${npcId}` : undefined,
              speakerName: speaker.value,
              body,
              lineKey: `talk:${talkId}:${current}`,
              sourceFile,
              identityScope: talkId,
              nodeKeyBase: `quest/${mainId}/talk/${talkId}/dialog/${current}`,
              metadata: {
                textMapHash: hashValue(dialogRow.talkContentTextMapHash),
                talkId,
                sourceKind: dialogRow.__sourceKind ?? talk.__sourceKind,
                relationEvidence: dialogRow.__relationEvidence ?? talk.__relationEvidence,
                relationEdgeId: dialogRow.__relationEdgeId ?? talk.__relationEdgeId,
                speakerNameResolution: speaker.method,
              },
            });
          }
          if (!body && !followEmptyNodes) continue;
          for (const next of Array.isArray(dialogRow.nextDialogs) ? dialogRow.nextDialogs : []) {
            const nextId = idText(next);
            if (!nextId) continue;
            if (body) {
              edges.push({
                fromNodeKey: `quest/${mainId}/talk/${talkId}/dialog/${current}`,
                toNodeKey: `quest/${mainId}/talk/${talkId}/dialog/${nextId}`,
                type: "next",
                metadata: {
                  sourceFile,
                  talkId,
                  sourceKind: dialogRow.__sourceKind ?? talk.__sourceKind,
                  relationEvidence: dialogRow.__relationEvidence ?? talk.__relationEvidence,
                  relationEdgeId: dialogRow.__relationEdgeId ?? talk.__relationEdgeId,
                },
              });
            }
            queue.push(nextId);
          }
        }
      }
    };

    // A single traversal prefers the legacy row when its localized body is
    // present and falls back to the exact QuestTalk node otherwise.  This
    // merges both generations without traversing every graph twice.
    traverseTalkRows(true, true);
  }

  for (const edge of pendingEdges) {
    const toNodeKeys = nodeKeyByLine.get(edge.targetLineKey) ?? [];
    for (const fromNodeKey of edge.fromNodeKeys) {
      for (const toNodeKey of toNodeKeys) {
        if (fromNodeKey === toNodeKey) continue;
        edges.push({
          fromNodeKey,
          toNodeKey,
          type: edge.type,
          optionText: edge.type === "choice" ? edge.optionText : undefined,
          metadata: { sourceFile: edge.sourceFile },
        });
      }
    }
  }

  const nodeKeys = new Set(nodes.map((node) => node.nodeKey));
  const uniqueEdges = new Map<string, QuestRecordPayload["dialogueEdges"][number]>();
  for (const edge of edges) {
    if (!nodeKeys.has(edge.fromNodeKey) || !nodeKeys.has(edge.toNodeKey)) continue;
    uniqueEdges.set(
      [edge.fromNodeKey, edge.toNodeKey, edge.type, edge.optionText ?? ""].join("\u0000"),
      edge,
    );
  }
  return {
    nodes,
    edges: [...uniqueEdges.values()],
    participantIds,
    sourceFiles: [...sourceFiles].sort(),
  };
}

function questBody(payload: QuestRecordPayload): string {
  const lines = [payload.chapter, payload.series].filter(Boolean) as string[];
  const rendered = new Set<string>();
  for (const subquest of payload.subquests) {
    lines.push(`## ${subquest.title}`);
    if (subquest.objective) lines.push(subquest.objective);
    for (const node of payload.dialogueNodes.filter(
      (item) => item.subquestKey === subquest.subquestKey,
    )) {
      const speaker = node.speakerName ? `${node.speakerName}: ` : "";
      lines.push(`${speaker}${node.body}`);
      rendered.add(node.nodeKey);
    }
  }
  // A quest may have dialogue assets but no public stage rows.  The text is
  // still part of the quest body; never manufacture “剧情对白 N” headings.
  for (const node of payload.dialogueNodes) {
    if (rendered.has(node.nodeKey)) continue;
    const speaker = node.speakerName ? `${node.speakerName}: ` : "";
    lines.push(`${speaker}${node.body}`);
  }
  if (lines.length === 0) return payload.questKey;
  return lines.join("\n");
}

export function buildRecord(
  inputs: Inputs,
  main: Json,
  locale: Locale,
  context: Required<NonNullable<QuestConversionOptions["context"]>>,
): NormalizedRecord {
  const mainId = idText(main.id ?? main.mainQuestId);
  if (!mainId) throw new Error("main_quest_id_missing");
  const sourceKey = `quest/${mainId}/locale/${locale}`;
  const requestedTextMap = inputs.textMaps[locale];
  const fallbackLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const fallbackTextMap = inputs.textMaps[fallbackLocale];
  const textMap = new Proxy(requestedTextMap, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return value;
      return Reflect.get(fallbackTextMap, property);
    },
  }) as Record<string, unknown>;
  const codexFile = inputs.codexQuestByMainId.get(mainId);
  const originalQuestType = text(main.type ?? codexFile?.value.DCNPPIOLEOK ?? main.questType);
  const questRows = inputs.questByMainId.get(mainId) ?? [];
  const codexIndexRows = inputs.questCodex.filter(
    (row) => idText(row.parentQuestId ?? row.mainQuestId ?? row.mainId) === mainId,
  );
  const chapterId = idText(
    main.chapterId ??
      main.resId ??
      codexIndexRows[0]?.chapterId ??
      codexFile?.value.PBIOMJGIMAK ??
      inputs.chapterByMainId.get(mainId)?.id,
  );
  const chapterRow = inputs.chapter.find((row) => idText(row.id ?? row.chapterId) === chapterId);
  const chapterStyle = text(chapterRow?.LINLPCFFGFC);
  const codexType = text(codexFile?.value.DCNPPIOLEOK);

  const explicitType = text(main.type ?? main.questType);
  let resolvedQuestType = questType(originalQuestType);
  // Hangout events are stored as LQ in the current AnimeGameData snapshot,
  // but their ChapterExcelConfigData style is the authoritative distinction
  // used by the game UI.  Resolve this before the generic type fallback so
  // the public "邀约事件" catalogue is not folded into story quests.
  if (chapterStyle === "CHAPTER_STYLE_TYPE_COOP_QUEST" || codexType === "HQ") {
    resolvedQuestType = "hangout";
  } else if (!explicitType && resolvedQuestType === "other") {
    if (chapterStyle === "CHAPTER_STYLE_TYPE_AQ" || codexType === "AQ") {
      resolvedQuestType = "archon_quest";
    } else if (
      chapterStyle === "CHAPTER_STYLE_TYPE_PERSONALLINE" ||
      chapterStyle === "CHAPTER_STYLE_TYPE_LEGEND" ||
      codexType === "LQ"
    ) {
      resolvedQuestType = "story_quest";
    } else if (chapterStyle === "CHAPTER_STYLE_TYPE_ACTIVITY_QUEST" || codexType === "EQ") {
      resolvedQuestType = "event_quest";
    } else if (chapterStyle === "CHAPTER_STYLE_TYPE_WORLD_QUEST_RANK_ZERO" || codexType === "WQ") {
      resolvedQuestType = "world_quest";
    } else if (chapterStyle === "CHAPTER_STYLE_TYPE_COOP_QUEST") {
      resolvedQuestType = "hangout";
    }
  }

  const chapterTitleHash =
    chapterRow?.chapterTitleTextMapHash ??
    chapterRow?.titleTextMapHash ??
    chapterRow?.titleHash ??
    codexFile?.value.ALOHJMPDFKI;
  const chapterTitleResolution =
    resolveLocalizedText(inputs.textMaps, locale, chapterTitleHash) ??
    (text(chapterRow?.title)
      ? { value: text(chapterRow.title)!, locale, hash: undefined }
      : undefined);

  const chapterNumHash =
    chapterRow?.chapterNumTextMapHash ?? chapterRow?.numTextMapHash ?? codexFile?.value.NNPJABOAJPL;
  const chapterNumResolution = resolveLocalizedText(inputs.textMaps, locale, chapterNumHash);

  const chapterNum = chapterNumResolution?.value;
  const rawChapterTitle = chapterTitleResolution?.value;
  const fullChapterTitle =
    chapterNum && rawChapterTitle
      ? locale === "zh-CN"
        ? `${chapterNum} ${rawChapterTitle}`
        : `${chapterNum}: ${rawChapterTitle}`
      : (rawChapterTitle ?? chapterNum);

  const cityRegions: Record<number, { id: string; zh: string; en: string }> = {
    1: { id: "mondstadt", zh: "蒙德", en: "Mondstadt" },
    2: { id: "liyue", zh: "璃月", en: "Liyue" },
    3: { id: "inazuma", zh: "稻妻", en: "Inazuma" },
    4: { id: "sumeru", zh: "须弥", en: "Sumeru" },
    5: { id: "fontaine", zh: "枫丹", en: "Fontaine" },
    6: { id: "natlan", zh: "纳塔", en: "Natlan" },
    7: { id: "nod_krai", zh: "诺德卡莱", en: "Nod-Krai" },
    8: { id: "snezhnaya", zh: "至冬", en: "Snezhnaya" },
    100: { id: "golden_apple", zh: "金苹果群岛", en: "Golden Apple Archipelago" },
    101: { id: "three_realms", zh: "三界路飨祭", en: "Three Realms Gateway Offering" },
    102: { id: "golden_apple", zh: "金苹果群岛", en: "Golden Apple Archipelago" },
    103: { id: "veluriyam_mirage", zh: "琉形蜃境", en: "Veluriyam Mirage" },
    104: { id: "simulanka", zh: "希穆兰卡", en: "Simulanka" },
    105: { id: "temple_of_space", zh: "空之神殿", en: "Temple of Space" },
  };

  const rawCityId = typeof chapterRow?.cityId === "number" ? chapterRow.cityId : undefined;
  let regionInfo = rawCityId ? cityRegions[rawCityId] : undefined;
  if (!regionInfo) {
    const inferredRegionId = inputs.questRegionByMainId.get(mainId);
    regionInfo = inferredRegionId
      ? Object.values(cityRegions).find((candidate) => candidate.id === inferredRegionId)
      : undefined;
  }
  if (!regionInfo && resolvedQuestType === "archon_quest") {
    const chapterName = fullChapterTitle ?? "";
    if (chapterName.includes("序章") || chapterName.includes("Prologue")) {
      regionInfo = cityRegions[1];
    } else if (chapterName.includes("第一章") || chapterName.includes("Chapter I")) {
      regionInfo = cityRegions[2];
    } else if (chapterName.includes("第二章") || chapterName.includes("Chapter II")) {
      regionInfo = cityRegions[3];
    } else if (chapterName.includes("第三章") || chapterName.includes("Chapter III")) {
      regionInfo = cityRegions[4];
    } else if (chapterName.includes("第四章") || chapterName.includes("Chapter IV")) {
      regionInfo = cityRegions[5];
    } else if (chapterName.includes("第五章") || chapterName.includes("Chapter V")) {
      regionInfo = cityRegions[6];
    } else if (
      chapterName.includes("空月之歌") ||
      chapterName.includes("第六章") ||
      chapterName.includes("Chapter VI") ||
      chapterName.includes("Song of the Moon")
    ) {
      regionInfo = cityRegions[7];
    } else if (chapterName.includes("第七章") || chapterName.includes("Chapter VII")) {
      regionInfo = cityRegions[8];
    }
  }

  const resolvedRegionId = regionInfo?.id;
  const resolvedRegionName = regionInfo
    ? locale === "en"
      ? regionInfo.en
      : regionInfo.zh
    : undefined;
  const seriesValue = asObject(main.series);
  const seriesId =
    resolveSeriesId(inputs, mainId, main) ?? idText(codexIndexRows[0]?.seriesId ?? seriesValue.id);
  const seriesTitleHash =
    main.seriesTitleTextMapHash ??
    main.seriesTitleHash ??
    main.seriesNameTextMapHash ??
    main.seriesNameHash ??
    seriesValue.titleTextMapHash ??
    seriesValue.titleHash ??
    codexIndexRows[0]?.seriesTitleTextMapHash ??
    codexIndexRows[0]?.seriesTitleHash;
  const chapterSeriesTitle = chapterNum?.match(/[·:]/)
    ? chapterNum.split(/[·:]/, 1)[0]?.trim()
    : undefined;
  const directSeriesTitle = text(main.seriesTitle ?? main.seriesName);
  const preferredSeriesTitle = questTitleForSeries(inputs, main, locale);
  const derivedSeriesTitle = deriveSeriesTitle(inputs, seriesId, locale, preferredSeriesTitle);
  const rawSeriesText =
    !seriesId && text(main.series) && !seriesValue.id ? text(main.series) : undefined;
  const seriesTitleResolution =
    resolveLocalizedText(inputs.textMaps, locale, seriesTitleHash) ??
    (directSeriesTitle
      ? { value: directSeriesTitle, locale, hash: undefined }
      : derivedSeriesTitle
        ? { value: derivedSeriesTitle, locale, hash: undefined }
        : rawSeriesText
          ? { value: rawSeriesText, locale, hash: undefined }
          : chapterSeriesTitle
            ? { value: chapterSeriesTitle, locale, hash: undefined }
            : undefined);

  const resolvedSeriesTitle =
    seriesTitleResolution?.value && !/^\d+$/.test(seriesTitleResolution.value.trim())
      ? seriesTitleResolution.value
      : resolvedQuestType === "archon_quest"
        ? locale === "en"
          ? "Archon Quests"
          : "魔神任务"
        : undefined;

  const storyFamily = resolveStoryFamily(
    inputs,
    mainId,
    main,
    locale,
    chapterId,
    fullChapterTitle,
    resolvedSeriesTitle,
    seriesId,
  );

  const titleResolution = resolveTitle(
    inputs,
    main,
    codexFile,
    locale,
    chapterTitleResolution,
    mainId,
  );
  const title = titleResolution.title;
  const titleHash = titleResolution.hash ?? main.titleTextMapHash ?? main.titleHash;
  const titleFallbackUsed =
    titleResolution.method !== "textmap_direct" || titleResolution.locale !== locale;
  const speakerRows = inputs.npcById;
  const subquestKeyByTitleHash = new Map<string, string>();
  let subquests: Array<{
    subquestKey: string;
    subquestId: string;
    title: string;
    objective?: string;
    order: number;
    completeness: "complete";
    metadata: Record<string, unknown>;
  }> = [];

  if (questRows.length > 0) {
    subquests = questRows.map((row, index) => {
      const subquestId = idText(row.subId ?? row.id ?? row.subQuestId);
      if (!subquestId) throw new Error(`subquest_id_missing:${sourceKey}`);
      const titleHash = hashValue(
        row.titleTextMapHash ?? row.titleHash ?? row.failParent ?? row.stepDescTextMapHash,
      );
      const subquestKey = `quest/${mainId}/subquest/${subquestId}`;
      if (titleHash) subquestKeyByTitleHash.set(titleHash, subquestKey);
      return {
        subquestKey,
        subquestId,
        title:
          tryResolveText(textMap, row.titleTextMapHash ?? row.titleHash ?? row.failParent) ??
          tryResolveText(textMap, row.stepDescTextMapHash) ??
          `Subquest ${subquestId}`,
        objective:
          (row.objectiveTextMapHash ?? row.objectiveHash) === undefined
            ? tryResolveText(textMap, row.stepDescTextMapHash ?? row.guideTipsTextMapHash)
            : resolveText(
                textMap,
                row.objectiveTextMapHash ?? row.objectiveHash,
                sourceKey,
                `subquest:${subquestId}:objective`,
              ),
        order: Number(row.order ?? index),
        completeness: "complete" as const,
        metadata: {
          sourceFile: inputPaths.quest,
          titleTextMapHash: titleHash,
          stepDescTextMapHash: hashValue(row.stepDescTextMapHash),
          guideTipsTextMapHash: hashValue(row.guideTipsTextMapHash),
        },
      };
    });
  } else if (codexFile) {
    const groups = asArray(codexText(codexFile.value, "EBNBLBEIFFJ"));
    subquests = groups.map((group, groupIndex) => {
      const subquestId = String(groupIndex + 1);
      const titleHash = hashValue(codexText(group, "OGEGCCLHIHP"));
      const subquestKey = `quest/${mainId}/subquest/${subquestId}`;
      if (titleHash) subquestKeyByTitleHash.set(titleHash, subquestKey);
      return {
        subquestKey,
        subquestId,
        title:
          (titleHash ? tryResolveText(textMap, titleHash) : undefined) ?? `Subquest ${subquestId}`,
        objective: undefined,
        order: groupIndex,
        completeness: "complete" as const,
        metadata: {
          sourceFile: codexFile.relativePath,
          titleTextMapHash: titleHash,
        },
      };
    });
  }

  const codexSortOrder =
    typeof codexIndexRows[0]?.sortOrder === "number" ? codexIndexRows[0].sortOrder : undefined;
  const questOrder = codexSortOrder ?? Number(main.order ?? mainId);

  const graph = buildDialogueGraph(inputs, mainId, locale, textMap, subquestKeyByTitleHash);
  const subquestKeys = new Set(subquests.map((subquest) => subquest.subquestKey));
  const dialogueNodes = graph.nodes.map((node) => ({
    ...node,
    subquestKey:
      node.subquestKey && subquestKeys.has(node.subquestKey)
        ? node.subquestKey
      : undefined,
  }));
  const dialogueEdges = graph.edges;
  const usesQuestTalkSource = graph.sourceFiles.some((sourceFile) =>
    sourceFile.startsWith(`${questTalkDir}/`),
  );
  const dialogueLineageFile =
    codexFile?.relativePath ??
    (usesQuestTalkSource ? questTalkDir : (graph.sourceFiles[0] ?? inputPaths.dialog));
  const dialogueLineageHash =
    codexFile?.hash ??
    (usesQuestTalkSource
      ? inputs.questTalkAggregateHash
      : (inputs.inputHashes[dialogueLineageFile] ?? inputs.inputHashes[inputPaths.dialog]));
  const visibilityReason = classifyQuestVisibility(
    main,
    titleResolution.method === "unresolved" ? undefined : title,
  );
  const visibility =
    visibilityReason === "public"
      ? "public"
      : visibilityReason === "unreleased_marker"
        ? "unreleased"
        : visibilityReason === "hidden_show_type"
          ? "hidden"
          : visibilityReason === "test_or_placeholder"
            ? "test"
        : "unresolved";
  const binQuestRecord = inputs.binQuestByMainId.get(mainId);
  const resolvedTalks = inputs.resolvedTalksByMainId.get(mainId);
  const relationEdges = [
    ...(binQuestRecord?.relationEdges ?? []),
    ...inputs.questRelationEdges.filter(
      (edge) =>
        (edge.sourceFile.startsWith("BinOutput/Talk/NpcGroup/") ||
          edge.sourceFile === mainQuestRelationsPath) &&
        (edge.fromQuestId === mainId ||
          edge.toQuestId === mainId ||
          binQuestRecord?.subQuestIds.includes(edge.fromQuestId)),
    ),
  ];
  const talkIds = resolvedTalks?.talkIds ?? [];
  const resolvedTalkIds = resolvedTalks?.resolvedTalkIds ?? [];
  const unresolvedTalkIds = resolvedTalks?.unresolvedTalkIds ?? [];
  const talkSourceKinds = [
    ...new Set((resolvedTalks?.candidates ?? []).map((candidate) => candidate.sourceKind)),
  ];
  const contentRole: QuestContentRole = classifyQuestContentRole({
    bin: binQuestRecord,
    hasExplicitStoryTalk: Boolean(binQuestRecord?.hasCompleteTalk),
    resolvedTalkCount: resolvedTalkIds.length,
    dialogueNodeCount: dialogueNodes.length,
    hasSiblingQuestRelations: relationEdges.some(
      (edge) => edge.relationType === "quest_state_equal" || edge.relationType === "add_quest_progress",
    ),
    hasProgressOrReward: Boolean(
      binQuestRecord?.contentCounts.QUEST_CONTENT_ADD_QUEST_PROGRESS ||
        main.rewardIdList ||
        main.rewardId,
    ),
  });
  const dialogueResolutionStatus: DialogueResolutionStatus = classifyDialogueResolution({
    contentRole,
    talkReferenceCount: talkIds.length || (codexFile ? 1 : 0),
    talkAssetCount:
      (resolvedTalks?.ambiguousTalkIds.length ?? 0) > 0
        ? 2
        : (resolvedTalks?.candidates.length ?? 0) > 0 || codexFile
          ? 1
          : 0,
    dialogueNodeCount: dialogueNodes.length,
  });
  const completenessReasons = [
    ...(dialogueNodes.length || dialogueResolutionStatus === "not_applicable"
      ? []
      : ["missingDialogue"]),
    ...(subquests.length || dialogueResolutionStatus === "not_applicable" ? [] : ["missingSubquests"]),
  ];
  const warnings = [
    questTypeWarning(originalQuestType),
    visibilityReason === "unresolved_show_type"
      ? `unknown_show_type:${text(main.showType ?? main.questShowType ?? main.visibility)}`
      : undefined,
    titleResolution.method === "unresolved" ? "title_unresolved" : undefined,
  ].filter((warning): warning is string => Boolean(warning));
  const unresolvedSpeakerCount = dialogueNodes.filter(
    (node) => Boolean(node.speakerKey) && !node.speakerName,
  ).length;
  const qualityCode: NonNullable<QuestRecordPayload["qualityCode"]> =
    contentRole === "control" || contentRole === "trigger" || contentRole === "reward"
      ? "control"
      : contentRole === "aggregate"
        ? "aggregate"
    : dialogueNodes.length
      ? unresolvedSpeakerCount > 0
        ? "speaker_unresolved"
        : "complete"
      : dialogueNodes.length
        ? "partial_dialogue"
        : "metadata_only";
  const isNonNarrative = ["control", "trigger", "reward", "aggregate"].includes(contentRole);
  const prerequisites = [
    ...asArray(main.prerequisites),
    ...asArray(main.BJOCFAJIGLH),
  ].flatMap((row) => {
    const id = idText(row.id ?? row.mainQuestId ?? row.questId);
    return id ? [`quest/${id}`] : [];
  });
  const payload: QuestRecordPayload = {
    questKey: `quest/${mainId}`,
    mainQuestId: mainId,
    questType: resolvedQuestType,
    locale,
    regionId: resolvedRegionId,
    region: resolvedRegionName,
    regionName: resolvedRegionName,
    chapterId,
    chapterTitle: fullChapterTitle,
    chapterNum,
    storyFamilyId: storyFamily.id,
    storyFamilyTitle: storyFamily.title,
    storyFamilyProvenance: storyFamily.provenance,
    storyFamilyOrder: storyFamily.familyOrder,
    seriesId,
    seriesTitle: storyFamily.title,
    chapter: fullChapterTitle,
    series: storyFamily.title,
    order: questOrder,
    chapterOrder: storyFamily.chapterOrder,
    storyPosition: questOrder,
    qualityCode,
    contentRole,
    dialogueResolutionStatus,
    talkIds,
    resolvedTalkIds,
    unresolvedTalkIds,
    talkSourceKinds,
    questRelationEdges: relationEdges,
    topology: {
      prerequisiteQuestIds: [
        ...new Set([
          ...prerequisites.map((key) => key.replace(/^quest\//u, "")),
          ...relationEdges
            .filter((edge) => edge.toQuestId === mainId)
            .map((edge) => edge.fromQuestId),
        ]),
      ],
      childQuestIds: relationEdges
        .filter((edge) => edge.fromQuestId === mainId && edge.toQuestId)
        .map((edge) => edge.toQuestId!),
      parentQuestIds: relationEdges
        .filter((edge) => edge.toQuestId === mainId)
        .map((edge) => edge.fromQuestId),
      storyOrder: questOrder,
    },
    completeness:
      isNonNarrative || dialogueNodes.length
        ? "complete"
        : subquests.length
          ? "partial"
          : "metadata_only",
    completenessReasons: isNonNarrative ? [] : completenessReasons,
    visibility,
    visibilityReason,
    warnings,
    prerequisites,
    subquests,
    dialogueNodes,
    dialogueEdges,
    metadata: {
      sourceFile: inputPaths.mainQuest,
      codexSourceFile: codexFile?.relativePath,
      originalQuestType,
      upstreamSeriesTitle: resolvedSeriesTitle,
      storyFamilyId: storyFamily.id,
      storyFamilyTitle: storyFamily.title,
      storyFamilyProvenance: storyFamily.provenance,
      storyFamilyOrder: storyFamily.familyOrder,
      chapterOrder: storyFamily.chapterOrder,
      storyPosition: questOrder,
      qualityCode,
      titleTextMapHash: hashValue(titleHash),
      titleFallbackUsed,
      titleResolutionMethod: titleResolution.method,
      titleResolutionLocale: titleResolution.locale,
      titleResolutionSource: titleResolution.source,
      titleUnresolved: titleResolution.method === "unresolved",
      region: {
        id: resolvedRegionId,
        name: resolvedRegionName,
        cityId: rawCityId,
      },
      chapter: {
        id: chapterId,
        num: chapterNum,
        title: fullChapterTitle,
        sourceFile: chapterRow
          ? inputPaths.chapter
          : (codexFile?.relativePath ?? inputPaths.mainQuest),
        idField: chapterId
          ? chapterRow
            ? "ChapterExcelConfigData.id"
            : "MainQuestExcelConfigData.chapterId"
          : undefined,
        titleField: chapterTitleHash ? "chapterTitleTextMapHash" : undefined,
      },
      series: {
        id: seriesId,
        title: resolvedSeriesTitle,
        sourceFile: inputPaths.mainQuest,
        idField: seriesId ? "MainQuestExcelConfigData.series" : undefined,
        titleField: seriesTitleHash ? "seriesTitleTextMapHash" : undefined,
      },
      completenessReasons,
      warnings,
    },
  };
  const body = questBody(payload);
  const segments = dialogueNodes.map((node, index) => ({
    segmentKey: node.segmentKey!,
    ordinal: index,
    headingPath: [title],
    body: node.speakerName ? `${node.speakerName}: ${node.body}` : node.body,
    startOffset: index,
    endOffset: index + node.body.length,
  }));
  const entities = [
    {
      sourceKey: payload.questKey,
      name: title,
      type: "quest" as const,
      aliases: [{ value: title, language: locale, primary: true }],
      properties: { mainQuestId: mainId, questType: payload.questType },
    },
    ...[...graph.participantIds]
      .map((id) => speakerRows.get(id))
      .filter((row): row is Json => Boolean(row))
      .map((row) => participantEntity(row, locale, textMap))
      .filter((row): row is NonNullable<ReturnType<typeof participantEntity>> => Boolean(row)),
    ...payload.prerequisites
      .filter((key) => key !== payload.questKey)
      .map((key) => ({
        sourceKey: key,
        name: key,
        type: "quest" as const,
        aliases: [{ value: key, language: locale, primary: true }],
        properties: { inferredFromPrerequisite: true },
      })),
  ];
  const relationships = payload.prerequisites.map((key) => ({
    subjectSourceKey: key,
    predicate: "prerequisite_for" as const,
    objectSourceKey: payload.questKey,
    confidence: 1,
  }));
  const contentBasis = { sourceKey, title, body, locale, payload, segments };
  return {
    sourceKey,
    recordType: "document",
    title,
    body,
    documentType: payload.questType,
    gameVersion: context.gameVersion,
    locale,
    segments,
    quest: payload,
    entities,
    relationships,
    metadata: {
      provenance: {
        upstreamSource: QUEST_UPSTREAM_SOURCE,
        upstreamCommit: context.upstreamCommit,
        upstreamCommitDate: context.upstreamCommitDate,
        upstreamVersionLabel: context.upstreamVersionLabel,
        locale,
        canonicalKey: sourceKey,
        sourceFiles: [
          ...new Set([
            ...Object.values(inputPaths),
            ...(binQuestRecord ? [binQuestRecord.sourceFile] : []),
            ...(resolvedTalks?.candidates.map((candidate) => candidate.sourceFile) ?? []),
            ...graph.sourceFiles,
          ]),
        ].sort(),
      relationEdges,
      contentRole,
      dialogueResolutionStatus,
      talkIds,
      resolvedTalkIds,
      unresolvedTalkIds,
      talkSourceKinds,
      sourceCoverage: {
        talkRegistry: inputs.talkRegistry.coverage,
        binQuestFiles: inputs.binQuest.length,
        binQuestFailures: inputs.binQuestFailures,
      },
      lineage: {
          mainQuest: {
            relativeFile: inputPaths.mainQuest,
            upstreamId: mainId,
            hash: inputs.inputHashes[inputPaths.mainQuest],
            valueHash: sha256(stableStringify(main)),
          },
          subquests: {
            relativeFile: inputPaths.quest,
            upstreamId: questRows.map((row) => idText(row.subId ?? row.id ?? row.subQuestId) ?? ""),
            hash: inputs.inputHashes[inputPaths.quest],
            valueHash: sha256(stableStringify(questRows)),
          },
          title: {
            relativeFile: locale === "zh-CN" ? inputPaths.textMapChs : inputPaths.textMapEn,
            upstreamId: hashValue(titleHash),
            hash: inputs.inputHashes[
              locale === "zh-CN" ? inputPaths.textMapChs : inputPaths.textMapEn
            ],
            valueHash: title ? sha256(title) : undefined,
          },
          dialogue: {
            relativeFile: dialogueLineageFile,
            hash: dialogueLineageHash,
            valueHash: sha256(stableStringify(payload.dialogueNodes)),
          },
        },
        upstreamIds: {
          mainQuestId: mainId,
          subquestIds: questRows.map((row) => idText(row.subId ?? row.id ?? row.subQuestId) ?? ""),
        },
        textMapHashes: {
          ...(hashValue(titleHash) && Number.isSafeInteger(Number(hashValue(titleHash)))
            ? { title: Number(hashValue(titleHash)) }
            : {}),
        },
        rawContentHash: sha256(stableStringify({ main, questRows, codexFile: codexFile?.value })),
        normalizedContentHash: sha256(stableStringify(contentBasis)),
        transforms: ["textmap_resolution", "dialogue_graph_materialization"],
        converterVersion: QUEST_CONVERTER_VERSION,
        rightsStatus: "upstream-license-not-declared",
      },
      quest: {
        questKey: payload.questKey,
        completeness: payload.completeness,
        completenessReasons: payload.completenessReasons,
        visibility: payload.visibility,
        visibilityReason: payload.visibilityReason,
      },
      questPayload: {
        questKey: payload.questKey,
        mainQuestId: payload.mainQuestId,
        questType: payload.questType,
        regionId: payload.regionId,
        regionName: payload.regionName,
        chapterId: payload.chapterId,
        chapterTitle: payload.chapterTitle,
        chapterOrder: payload.chapterOrder,
        storyFamilyId: payload.storyFamilyId,
        storyFamilyTitle: payload.storyFamilyTitle,
        storyFamilyProvenance: payload.storyFamilyProvenance,
        storyFamilyOrder: payload.storyFamilyOrder,
        chapterNum: payload.chapterNum,
        seriesTitle: payload.seriesTitle,
        seriesId: payload.seriesId,
        order: payload.order,
        storyPosition: payload.storyPosition,
        qualityCode: payload.qualityCode,
        contentRole: payload.contentRole,
        dialogueResolutionStatus: payload.dialogueResolutionStatus,
        talkIds: payload.talkIds,
        resolvedTalkIds: payload.resolvedTalkIds,
        unresolvedTalkIds: payload.unresolvedTalkIds,
        displayTitle: payload.displayTitle,
        completeness: payload.completeness,
        visibility: payload.visibility,
        dialogueNodes: payload.dialogueNodes.length > 0 ? [{ nodeId: "has_dialogue" }] : [],
        subquests: payload.subquests.length > 0 ? [{ subquestId: "has_subquests" }] : [],
      },
      titleResolutionMethod: titleResolution.method,
      titleResolutionLocale: titleResolution.locale,
      completenessReasons,
      contentRole,
      dialogueResolutionStatus,
      warnings,
    },
    contentHash: sha256(stableStringify(contentBasis)),
    parserVersion: QUEST_CONVERTER_VERSION,
  };
}

export async function convertQuestSnapshot(
  options: QuestConversionOptions = {},
): Promise<QuestConversionResult> {
  const startedAt = Date.now();
  const root = resolve(options.upstreamDir ?? DEFAULT_QUEST_UPSTREAM_DIR);
  const context = {
    upstreamCommit: options.context?.upstreamCommit ?? "unknown",
    upstreamCommitDate: options.context?.upstreamCommitDate ?? "unknown",
    gameVersion: options.context?.gameVersion ?? "unknown",
    upstreamVersionLabel: options.context?.upstreamVersionLabel ?? "unknown",
  };
  const inputs = await loadInputs(root);
  if (options.profile) console.error(`loaded inputs in ${Date.now() - startedAt}ms`);
  const records: NormalizedRecord[] = [];
  const builtRecords: NormalizedRecord[] = [];
  const excluded: Array<{ sourceKey: string; reason: string }> = [];
  const failures: Array<{ sourceKey: string; reason: string }> = [];
  const warnings: Array<{ sourceKey: string; warning: string }> = [];
  let excludedDocumentCount = 0;
  const discoveredByType: Record<string, number> = {};
  const mainQuestRows =
    options.limit && options.limit > 0
      ? inputs.mainQuest.slice(0, options.limit)
      : inputs.mainQuest;
  for (const main of mainQuestRows) {
    const mainId = idText(main.id ?? main.mainQuestId) ?? "unknown";
    const codexFile = inputs.codexQuestByMainId.get(mainId);
    const rawType = text(main.type ?? codexFile?.value.DCNPPIOLEOK ?? main.questType);
    const resolvedType = questType(rawType);
    const typeWarning = questTypeWarning(rawType);
    if (typeWarning) warnings.push({ sourceKey: `quest/${mainId}`, warning: typeWarning });
    const mainRecords: NormalizedRecord[] = [];
    for (const locale of locales) {
      try {
        const record = buildRecord(inputs, main, locale, context);
        builtRecords.push(record);
        mainRecords.push(record);
        for (const warning of (record.metadata.warnings as string[] | undefined) ?? []) {
          warnings.push({ sourceKey: record.sourceKey, warning });
        }
      } catch (error) {
        failures.push({
          sourceKey: `quest/${mainId}/locale/${locale}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const effectiveType = mainRecords[0]?.quest?.questType ?? resolvedType;
    discoveredByType[effectiveType] = (discoveredByType[effectiveType] ?? 0) + 1;
    const hasBilingualPublicPair =
      mainRecords.length === locales.length &&
      mainRecords.every((record) => record.quest?.visibility === "public");
    if (hasBilingualPublicPair) {
      records.push(...mainRecords);
    } else {
      // A public revision is bilingual and atomic: if one locale is hidden,
      // partial, or failed, the matching document in the other locale is also
      // excluded rather than publishing an asymmetric task set.  Completeness
      // is intentionally not an eligibility gate: AnimeGameData contains many
      // public quest titles/chapters whose dialogue is stored in runtime assets
      // rather than CodexQuest, and dropping those rows makes the catalogue
      // silently incomplete.
      for (const record of mainRecords) {
        const payload = record.quest;
        const reason = !payload
          ? "quest_payload_missing"
          : payload.visibility !== "public"
            ? (payload.visibilityReason ?? `visibility:${payload.visibility ?? "unknown"}`)
            : "bilingual_pair_incomplete";
        excluded.push({ sourceKey: record.sourceKey, reason });
        excludedDocumentCount += 1;
        const reasons = (record.quest?.completenessReasons ?? []).join(",");
        if (reasons && record.quest?.completeness !== "complete") {
          excluded[excluded.length - 1]!.reason += `:${reasons}`;
        }
      }
    }
  }
  if (options.profile) console.error(`built records in ${Date.now() - startedAt}ms`);
  failures.push(
    ...inputs.codexQuestFailures.map((failure) => ({
      sourceKey: failure.relativePath,
      reason: `codex_quest_file_unreadable:${failure.reason}`,
    })),
  );
  failures.push(
    ...inputs.questTalkFailures.map((failure) => ({
      sourceKey: failure.relativePath,
      reason: `quest_talk_file_unreadable:${failure.reason}`,
    })),
  );
  failures.push(
    ...validateNormalizedRecords(records)
      .filter((issue) => issue.severity === "error")
      .map((issue) => ({
        sourceKey: issue.sourceKey ?? "unknown",
        reason: `${issue.code}: ${issue.message}`,
      })),
  );
  if (options.profile) console.error(`validated records in ${Date.now() - startedAt}ms`);
  const documents = Object.fromEntries(
    locales.map((locale) => [locale, records.filter((record) => record.locale === locale).length]),
  ) as Record<Locale, number>;
  const eligibleDocuments = Object.fromEntries(
    locales.map((locale) => [
      locale,
      builtRecords.filter((record) => record.locale === locale).length,
    ]),
  ) as Record<Locale, number>;
  const completeness = Object.fromEntries(
    locales.map((locale) => [
      locale,
      {
        complete: builtRecords.filter(
          (record) => record.locale === locale && record.quest?.completeness === "complete",
        ).length,
        partial: builtRecords.filter(
          (record) => record.locale === locale && record.quest?.completeness === "partial",
        ).length,
        metadata_only: builtRecords.filter(
          (record) => record.locale === locale && record.quest?.completeness === "metadata_only",
        ).length,
      },
    ]),
  ) as Record<Locale, Record<"complete" | "partial" | "metadata_only", number>>;
  const speakerUnresolvedNodes = Object.fromEntries(
    locales.map((locale) => [
      locale,
      builtRecords.reduce(
        (sum, record) =>
          sum +
          (record.locale === locale
            ? (record.quest?.dialogueNodes ?? []).filter(
                (node) => node.speakerKey && !node.speakerName,
              ).length
            : 0),
        0,
      ),
    ]),
  ) as Record<Locale, number>;
  const speakerNpcFallbackNodes = Object.fromEntries(
    locales.map((locale) => [
      locale,
      builtRecords.reduce(
        (sum, record) =>
          sum +
          (record.locale === locale
            ? (record.quest?.dialogueNodes ?? []).filter(
                (node) => node.metadata?.speakerNameResolution === "npc_fallback",
              ).length
            : 0),
        0,
      ),
    ]),
  ) as Record<Locale, number>;
  const discoveredDocuments = mainQuestRows.length * locales.length;
  const convertedDocuments = records.length;
  const excludedDocuments = excludedDocumentCount;
  const failedDocuments = failures.length;
  const accountedDocuments = convertedDocuments + excludedDocuments + failedDocuments;
  const uniqueWarnings = [
    ...new Map(
      warnings.map((warning) => [`${warning.sourceKey}\u0000${warning.warning}`, warning]),
    ).values(),
  ];
  const completenessReasonEntries = builtRecords.map((record) => ({
    sourceKey: record.sourceKey,
    reasons: record.quest?.completenessReasons ?? [],
  }));
  return {
    records,
    auditRecords: builtRecords,
    auditInputs: inputs,
    manifest: {
      schemaVersion: 2,
      upstream: {
        source: QUEST_UPSTREAM_SOURCE,
        commit: context.upstreamCommit,
        commitDate: context.upstreamCommitDate,
        versionLabel: context.upstreamVersionLabel,
      },
      gameVersion: context.gameVersion,
      locales: [...locales],
      converterVersion: QUEST_CONVERTER_VERSION,
      inputHashes: inputs.inputHashes,
      counts: {
        mainQuests: inputs.mainQuest.length,
        discoveredByType,
        documents,
        eligibleDocuments,
        publicDocuments: documents,
        completeness,
        subquests: records.reduce((sum, record) => sum + (record.quest?.subquests.length ?? 0), 0),
        dialogueNodes: records.reduce(
          (sum, record) => sum + (record.quest?.dialogueNodes.length ?? 0),
          0,
        ),
        dialogueEdges: records.reduce(
          (sum, record) => sum + (record.quest?.dialogueEdges.length ?? 0),
          0,
        ),
      },
      accounting: {
        discoveredMainQuests: mainQuestRows.length,
        discoveredDocuments,
        convertedDocuments,
        excludedDocuments,
        failedDocuments,
        accountedCoverage: discoveredDocuments ? accountedDocuments / discoveredDocuments : 1,
        unexplainedMissing: Math.max(0, discoveredDocuments - accountedDocuments),
      },
      sourceCoverage: {
        codexQuestFiles: inputs.codexQuest.length,
        codexQuestMatchedMainQuests: new Set(
          [...inputs.codexQuestByMainId.keys()].filter((id) =>
            mainQuestRows.some((row) => idText(row.id ?? row.mainQuestId) === id),
          ),
        ).size,
        questTalkFiles: inputs.questTalkFiles,
        questTalkDialogRows: inputs.questTalkDialogRows.length,
        questTalkMatchedMainQuests: new Set(
          builtRecords
            .filter((record) =>
              (
                record.metadata.provenance as { sourceFiles?: string[] } | undefined
              )?.sourceFiles?.some((sourceFile) => sourceFile.startsWith(`${questTalkDir}/`)),
            )
            .map((record) => record.quest?.mainQuestId),
        ).size,
        talkFallbackMainQuests: new Set(
          builtRecords
            .filter((record) =>
              record.quest?.dialogueNodes.some((node) => Boolean(node.metadata?.talkId)),
            )
            .map((record) => record.quest?.mainQuestId),
        ).size,
        binQuestFiles: inputs.binQuest.length,
        binQuestParsedMainQuests: inputs.binQuestByMainId.size,
        binQuestRelationEdges: inputs.binQuest.reduce(
          (sum, record) => sum + record.relationEdges.length,
          0,
        ),
        binQuestFailures: inputs.binQuestFailures.length,
        talkRegistryFiles: inputs.talkRegistry.coverage.totalFiles,
        talkRegistryParsedFiles: inputs.talkRegistry.coverage.parsedFiles,
        talkRegistryDuplicateTalkIds: inputs.talkRegistry.duplicateTalkIds.length,
        npcGroupRelationEdges: inputs.talkRegistry.npcGroupRelations.length,
      },
      quality: {
        metadataOnlyDocuments: Object.fromEntries(
          locales.map((locale) => [locale, completeness[locale].metadata_only]),
        ) as Record<Locale, number>,
        titleUnresolvedDocuments: builtRecords.filter(
          (record) => record.metadata.titleResolutionMethod === "unresolved",
        ).length,
        speakerUnresolvedNodes,
        speakerNpcFallbackNodes,
      },
      excluded,
      failures,
      warnings: uniqueWarnings,
      completenessReasons: completenessReasonEntries,
      unexplainedMissing: [
        ...(failures.length ? [{ scope: "validation", count: failures.length }] : []),
        ...(discoveredDocuments > accountedDocuments
          ? [{ scope: "documents", count: discoveredDocuments - accountedDocuments }]
          : []),
      ],
    },
  };
}

export async function writeQuestSnapshot(result: QuestConversionResult, outputDir: string) {
  const recordsDir = resolve(outputDir, "records");
  await mkdir(recordsDir, { recursive: true });
  const manifest = { ...result.manifest, generatedAt: new Date().toISOString() };
  const recordsPath = join(recordsDir, "quests.json");
  const recordsFile = await open(recordsPath, "w");
  try {
    // The complete quest export is larger than V8's maximum single-string
    // size.  Keep each record independent while writing the JSON array so a
    // successful conversion cannot fail only at the final serialization step.
    await recordsFile.write("[\n");
    for (let index = 0; index < result.records.length; index += 1) {
      if (index > 0) await recordsFile.write(",\n");
      await recordsFile.write(JSON.stringify(result.records[index]));
    }
    await recordsFile.write("\n]\n");
  } finally {
    await recordsFile.close();
  }
  await writeFile(
    join(resolve(outputDir), "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function readUpstreamGitMetadata(upstreamDir: string): Promise<{
  commit: string;
  commitDate: string;
  subject: string;
}> {
  try {
    const result = await execFileAsync("git", ["log", "-1", "--format=%H%n%cI%n%s"], {
      cwd: upstreamDir,
    });
    const [commit = "unknown", commitDate = "unknown", subject = "unknown"] = String(result.stdout)
      .trim()
      .split("\n");
    return { commit, commitDate, subject };
  } catch {
    return { commit: "unknown", commitDate: "unknown", subject: "unknown" };
  }
}

function inferGameVersion(subject: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/.exec(subject)?.[1] ?? "unknown";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const upstreamDir = argValue("upstream") ?? DEFAULT_QUEST_UPSTREAM_DIR;
  const limit = Number(argValue("limit") ?? 0);
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));
  const resolvedUpstream = resolve(upstreamDir);
  if (!isPathInside(resolvedUpstream, preflight.config.externalVolumePath))
    throw new Error(
      `AnimeGameData upstream checkout must stay on the external volume: ${resolvedUpstream}`,
    );
  await access(resolvedUpstream);
  const git = await readUpstreamGitMetadata(resolvedUpstream);
  const requestedCommit = argValue("commit");
  if (requestedCommit && requestedCommit !== git.commit)
    throw new Error(`Upstream commit mismatch: requested ${requestedCommit}, found ${git.commit}`);
  if (git.commit === "unknown") throw new Error("Unable to determine the upstream Git commit");
  const commit = requestedCommit ?? git.commit;
  const gameVersion = argValue("game-version") ?? inferGameVersion(git.subject);
  const versionLabel = argValue("version-label") ?? git.subject;
  const config = loadConfig();
  const output = resolve(
    argValue("output") ??
      join(config.dataDir, "imports", "normalized", "anime-game-data", commit, "quests"),
  );
  if (!isPathInside(output, preflight.config.dataRoot))
    throw new Error(`Quest output must stay under the external data root: ${output}`);
  const result = await convertQuestSnapshot({
    upstreamDir: resolvedUpstream,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    profile: process.argv.includes("--profile"),
    context: {
      upstreamCommit: commit,
      upstreamCommitDate: argValue("commit-date") ?? git.commitDate,
      gameVersion,
      upstreamVersionLabel: versionLabel,
    },
  });
  await writeQuestSnapshot(result, output);
  if (result.manifest.failures.length || result.manifest.unexplainedMissing.length) {
    console.error(
      `Quest conversion completed with ${result.manifest.failures.length} failures and ${result.manifest.unexplainedMissing.length} unexplained gaps`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Quest conversion wrote ${result.records.length} public records to ${resolve(output)}`,
    );
  }
}
