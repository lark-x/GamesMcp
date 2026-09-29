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
  analyzeDialogueComponents,
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
  buildQuestTopologies,
  connectedQuestComponents,
  projectStoryCatalog,
  type QuestTopology,
  type StoryProjectionRegion,
} from "../packages/ingestion/src/anime-game-data/quest/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.ts";
import { loadConfig } from "../packages/config/src/index.ts";

export const QUEST_CONVERTER_VERSION = "anime-game-data-quests-v3";
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

const locales = ["zh-CN", "en"] as const;
type Locale = (typeof locales)[number];
type Json = Record<string, unknown>;
type StoryFamilyOverride = {
  id: string;
  title?: Partial<Record<Locale, string>>;
  catalogRegionId?: string;
  questIds: string[];
  order?: number;
  chapterOrders?: Record<string, number>;
  subseries?: Array<{
    id: string;
    title?: Partial<Record<Locale, string>>;
    questIds: string[];
    order?: number;
  }>;
  reason?: string;
  evidence?: string[];
  reviewedAt?: string;
  temporary?: boolean;
  obsolete?: boolean;
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
  schemaVersion: 3;
  storyProjectionSchemaVersion: 3;
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
  storyProjection: StoryProjectionRegion[];
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
  storyProjection: StoryProjectionRegion[];
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
type QuestRegionEvidence = {
  regionId?: string;
  candidateRegionIds: string[];
  talkIds: string[];
  talkPathEvidence: string[];
  performCfgValues: string[];
};

const dialogueRegionAliases: Record<string, string> = {
  mengde: "mondstadt",
  mondstadt: "mondstadt",
  liyue: "liyue",
  inazuma: "inazuma",
  daoqi: "inazuma",
  dq: "inazuma",
  sumeru: "sumeru",
  xumi: "sumeru",
  fontaine: "fontaine",
  water: "fontaine",
  natlan: "natlan",
  natian: "natlan",
  nt: "natlan",
  nodkrai: "nod_krai",
  "nod-krai": "nod_krai",
  snezhnaya: "snezhnaya",
  zhidong: "snezhnaya",
  enkanomiya: "enkanomiya",
  thechasm: "the_chasm_underground",
  thechasmchallenge: "the_chasm_underground",
  seaofbygoneeras: "sea_of_bygone_eras",
  homeworld: "homeworld",
  furniture: "homeworld",
  island: "golden_apple",
  dreamisland: "golden_apple",
  michiae: "three_realms",
  michiaematsuri: "three_realms",
  penumbra: "veluriyam_mirage",
  fairybook: "simulanka",
  templeofspace: "temple_of_space",
  sealamp: "liyue",
  sealampv3: "liyue",
  hdj: "liyue",
  fenghua: "mondstadt",
  vintage: "mondstadt",
  mdzjc: "mondstadt",
  mdzjcmbtalk: "mondstadt",
  v45catcafe: "mondstadt",
  filmfest: "fontaine",
  sumerubirth: "sumeru",
  sumeruadventuretraining: "sumeru",
  dog1: "inazuma",
  mimitomo: "mondstadt",
  akafes: "sumeru",
  v45alchemysim: "mondstadt",
  v54dqdhd: "inazuma",
  rongcaiji: "inazuma",
  ylyz: "natlan",
  v48fairy: "simulanka",
  fairy: "simulanka",
  ndklzx: "nod_krai",
  nodkraitour: "nod_krai",
  autochess: "natlan",
  catcafe: "mondstadt",
  alchemysim: "mondstadt",
  dqdhd: "inazuma",
  fishblaster: "mondstadt",
  fishingjoy: "fontaine",
  bubbledramadrink: "fontaine",
  bubble: "fontaine",
  hexenzirkel: "mondstadt",
  tradeshow: "nod_krai",
  sdn: "nod_krai",
  fungusfighter: "sumeru",
  slimecannon: "fontaine",
  birdball: "liyue",
  bullethell: "inazuma",
  goalchallenge: "natlan",
  effigychallenge: "mondstadt",
  brickbreaker: "inazuma",
  saurus: "natlan",
  humandragonpuzzle: "natlan",
  towerdefense: "liyue",
  oneshot: "fontaine",
  tpsdefense: "natlan",
  resort: "simulanka",
  fleurflower: "mondstadt",
  kapaixunyou: "inazuma",
  rainbowprince: "fontaine",
  greatfestival: "inazuma",
  ceremony: "natlan",
  nteqmatch: "natlan",
  themeparksim: "fontaine",
  lolifriend: "nod_krai",
  origamiwq: "simulanka",
  sandsworm: "sumeru",
  wolf: "mondstadt",
  musicgame: "mondstadt",
  dpeq: "mondstadt",
};

const cityRegions: Record<number, { id: string; zh: string; en: string }> = {
  1: { id: "mondstadt", zh: "蒙德", en: "Mondstadt" },
  2: { id: "liyue", zh: "璃月", en: "Liyue" },
  3: { id: "inazuma", zh: "稻妻", en: "Inazuma" },
  4: { id: "sumeru", zh: "须弥", en: "Sumeru" },
  5: { id: "fontaine", zh: "枫丹", en: "Fontaine" },
  6: { id: "natlan", zh: "纳塔", en: "Natlan" },
  7: { id: "nod_krai", zh: "诺德卡莱", en: "Nod-Krai" },
  8: { id: "snezhnaya", zh: "至冬", en: "Snezhnaya" },
};

const allRegions: Array<{ id: string; zh: string; en: string; order: number }> = [
  { id: "mondstadt", zh: "蒙德", en: "Mondstadt", order: 1 },
  { id: "liyue", zh: "璃月", en: "Liyue", order: 2 },
  { id: "inazuma", zh: "稻妻", en: "Inazuma", order: 3 },
  { id: "sumeru", zh: "须弥", en: "Sumeru", order: 4 },
  { id: "fontaine", zh: "枫丹", en: "Fontaine", order: 5 },
  { id: "natlan", zh: "纳塔", en: "Natlan", order: 6 },
  { id: "nod_krai", zh: "诺德卡莱", en: "Nod-Krai", order: 7 },
  { id: "snezhnaya", zh: "至冬", en: "Snezhnaya", order: 8 },
  { id: "enkanomiya", zh: "渊下宫", en: "Enkanomiya", order: 20 },
  {
    id: "the_chasm_underground",
    zh: "层岩巨渊·地下矿区",
    en: "The Chasm: Underground Mines",
    order: 21,
  },
  { id: "sea_of_bygone_eras", zh: "旧日之海", en: "Sea of Bygone Eras", order: 22 },
  { id: "homeworld", zh: "尘歌壶", en: "Serenitea Pot", order: 23 },
  { id: "golden_apple", zh: "金苹果群岛", en: "Golden Apple Archipelago", order: 30 },
  { id: "three_realms", zh: "三界路飨祭", en: "Three Realms Gateway Offering", order: 31 },
  { id: "veluriyam_mirage", zh: "琉形蜃境", en: "Veluriyam Mirage", order: 32 },
  { id: "simulanka", zh: "希穆兰卡", en: "Simulanka", order: 33 },
  { id: "temple_of_space", zh: "空之神殿", en: "Temple of Space", order: 34 },
  { id: "system_guidance", zh: "全局系统引导", en: "System Guidance", order: 40 },
  { id: "other", zh: "其他地区", en: "Other Region", order: 99 },
];

const regionById = new Map(allRegions.map((region) => [region.id, region]));

/**
 * QuestDialogue paths carry the game's own region partition, including for
 * world quests that have no ChapterExcelConfigData row.
 */
export function regionIdFromPerformCfg(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const match = raw.match(/QuestDialogue[\\/]([^\\/]+)[\\/]([^\\/_]+)(?:_|[\\/])/i);
  const token = match?.[2]?.toLocaleLowerCase("en");
  if (token) {
    const normalized = token
      .replace(/^(?:v?\d+\.\d+_*|v\d+_*|ver\d+\.\d+_*|activity_*)/i, "")
      .replace(/^activity/i, "");
    for (const cand of [token, normalized]) {
      if (dialogueRegionAliases[cand]) return dialogueRegionAliases[cand];
      const strippedV = cand.replace(/v\d+$/i, "");
      if (dialogueRegionAliases[strippedV]) return dialogueRegionAliases[strippedV];
      const stripped = cand.replace(/\d+$/u, "");
      if (dialogueRegionAliases[stripped]) return dialogueRegionAliases[stripped];
      const strippedBareV = stripped.replace(/v$/i, "");
      if (dialogueRegionAliases[strippedBareV]) return dialogueRegionAliases[strippedBareV];
    }
  }
  const categoryToken = match?.[1]?.toLocaleLowerCase("en");
  if (categoryToken && dialogueRegionAliases[categoryToken]) {
    return dialogueRegionAliases[categoryToken];
  }
  return undefined;
}

function indexQuestRegions(talk: Json[]): Map<string, QuestRegionEvidence> {
  const candidates = new Map<
    string,
    {
      regionIds: Set<string>;
      talkIds: Set<string>;
      talkPathEvidence: Set<string>;
      performCfgValues: Set<string>;
    }
  >();
  for (const row of talk) {
    const mainId = idText(row.questId ?? row.mainQuestId ?? row.mainId);
    if (!mainId) continue;
    const performCfg = text(row.performCfg ?? row.performConfig);
    const regionId = regionIdFromPerformCfg(performCfg);
    const value = candidates.get(mainId) ?? {
      regionIds: new Set<string>(),
      talkIds: new Set<string>(),
      talkPathEvidence: new Set<string>(),
      performCfgValues: new Set<string>(),
    };
    const talkId = idText(row.id ?? row.talkId);
    if (talkId) value.talkIds.add(talkId);
    if (performCfg) {
      value.performCfgValues.add(performCfg);
      const sourcePath = text(row.__sourceFile) ?? "ExcelBinOutput/TalkExcelConfigData_*.json";
      value.talkPathEvidence.add(`${sourcePath}:questId=${mainId}.performCfg=${performCfg}`);
    }
    if (regionId) value.regionIds.add(regionId);
    candidates.set(mainId, value);
  }
  return new Map(
    [...candidates.entries()].map(([mainId, value]) => {
      const regionIds = [...value.regionIds].sort();
      return [
        mainId,
        {
          regionId: regionIds.length === 1 ? regionIds[0] : undefined,
          candidateRegionIds: regionIds,
          talkIds: [...value.talkIds].sort(),
          talkPathEvidence: [...value.talkPathEvidence].sort(),
          performCfgValues: [...value.performCfgValues].sort(),
        },
      ];
    }),
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
  chapterById: Map<string, Json>;
  chapterByMainId: Map<string, Json>;
  usableChapterGroups: Set<string>;
  chapterGroupTitleByLocale: Record<Locale, Map<string, string>>;
  questRegionByMainId: Map<string, QuestRegionEvidence>;
  reputationRegionByMainId: Map<string, { regionId: string; evidence: string }>;
  questRegionOverrides: Map<string, QuestRegionOverride>;
  questCodex: Json[];
  talk: Json[];
  dialog: Json[];
  dialogById: Map<string, Json>;
  npcById: Map<string, Json>;
  codexQuest: Array<{ relativePath: string; hash: string; value: Json }>;
  codexQuestByMainId: Map<string, { relativePath: string; hash: string; value: Json }>;
  codexQuestFailures: Array<{ relativePath: string; reason: string }>;
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
  questTopologies: Map<string, QuestTopology>;
  questFamilyComponents: Map<string, string[]>;
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
      const subseries = asArray(value.subseries).flatMap((item) => {
        const subseriesId = text(item.id);
        const subseriesQuestIds = Array.isArray(item.questIds)
          ? item.questIds.map(idText).filter((questId): questId is string => Boolean(questId))
          : [];
        if (!subseriesId || subseriesQuestIds.length === 0) return [];
        const subseriesTitleValue = asObject(item.title);
        return [
          {
            id: subseriesId,
            title: {
              ...(text(subseriesTitleValue["zh-CN"])
                ? { "zh-CN": text(subseriesTitleValue["zh-CN"])! }
                : {}),
              ...(text(subseriesTitleValue.en) ? { en: text(subseriesTitleValue.en)! } : {}),
            },
            questIds: subseriesQuestIds,
            order: typeof item.order === "number" ? item.order : undefined,
          },
        ];
      });
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
          subseries,
          reason: text(value.reason),
          evidence: Array.isArray(value.evidence)
            ? value.evidence.filter((item): item is string => typeof item === "string")
            : [],
          reviewedAt: text(value.reviewedAt),
          temporary: value.temporary === true,
          obsolete: value.obsolete === true,
        },
      ];
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export type QuestRegionOverride = {
  questId: string;
  regionId: string;
  reason?: string;
  evidence?: string[];
};

async function loadQuestRegionOverrides(): Promise<Map<string, QuestRegionOverride>> {
  const relativePath = "data/curated/genshin-story-family-overrides.json";
  try {
    const raw = await readFile(resolve(process.cwd(), relativePath), "utf8");
    const parsed = asObject(JSON.parse(raw));
    const overrides = new Map<string, QuestRegionOverride>();
    for (const item of asArray(parsed.questRegionOverrides)) {
      const questId = idText(item.questId);
      const regionId = text(item.regionId);
      if (!questId || !regionId) continue;
      overrides.set(questId, {
        questId,
        regionId,
        reason: text(item.reason),
        evidence: Array.isArray(item.evidence)
          ? item.evidence.filter((e): e is string => typeof e === "string")
          : [],
      });
    }
    return overrides;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
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
    object.textId ??
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

const questMarkerPattern = /\$(?:HIDDEN|UNRELEASED|TEST|DEBUG)\$?/i;

export function isForbiddenStoryTitle(title: string | undefined): boolean {
  if (!title) return false;
  return (
    /[（(]\s*(?:test|hide|debug)\s*[)）]/iu.test(title) ||
    /^[（(]\s*test/iu.test(title) ||
    questMarkerPattern.test(title) ||
    /【已废弃】|\[已废弃\]/u.test(title)
  );
}

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
  const mainId = idText(main.id ?? main.mainQuestId);
  if (mainId === "5003") return "test_or_placeholder";
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
  if (isForbiddenStoryTitle(title))
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

async function readJsonSafe(
  root: string,
  relativePath: string,
): Promise<{ value: unknown; hash: string } | undefined> {
  try {
    const raw = await readFile(join(root, relativePath), "utf8");
    return { value: JSON.parse(raw), hash: sha256(raw) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    return undefined;
  }
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
      failures: [
        {
          relativePath: binQuestDir,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
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
  const mainQuestRelationEdges: QuestRelationEdge[] = [];
  for (const row of asArray(mainQuestRelationsValue)) {
    const mainId = idText(row.mainQuestID ?? row.mainQuestId ?? row.id);
    if (!mainId) continue;
    const relatedIds = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map((item) => idText(item)).filter((item): item is string => Boolean(item))
        : [];
    const related: string[] = [];
    for (const [rawField, rawValue] of Object.entries(row)) {
      if (rawField === "mainQuestID" || rawField === "mainQuestId" || rawField === "id") continue;
      const values = relatedIds(rawValue);
      if (values.length) {
        related.push(...values);
        for (const [rawIndex, toQuestId] of values.entries()) {
          mainQuestRelationEdges.push({
            fromQuestId: mainId,
            toQuestId,
            relationType:
              rawField === "JPHNIKNHFBL" || rawField === "GPIJAIFIKDI"
                ? "main_quest_relation_a"
                : rawField === "GCOCPOOBMEE" || rawField === "KMJMAGOIBID"
                  ? "main_quest_relation_b"
                  : "main_quest_relation_unknown",
            rawRelationType: rawField,
            rawField,
            rawIndex,
            sourceFile: mainQuestRelationsPath,
            sourcePath: `rows[mainQuestID=${mainId}].${rawField}[${rawIndex}]`,
            sourceHash: mainQuestRelationsHash ?? "",
            derived: false,
            confidence: 1,
            metadata: { direction: "source_related_ids" },
          });
        }
      }
    }
    if (related.length) mainQuestRelations.set(mainId, [...new Set(related)]);
  }
  const quest = asArray(byKey.quest.value);
  const chapter = asArray(byKey.chapter.value);
  const questCodex = asArray(byKey.questCodex.value);
  const talk = [
    ...asArray(byKey.talk0.value).map((row) => ({ ...row, __sourceFile: inputPaths.talk0 })),
    ...asArray(byKey.talk1.value).map((row) => ({ ...row, __sourceFile: inputPaths.talk1 })),
  ];
  const dialog = asArray(byKey.dialog.value);
  const npc = asArray(byKey.npc.value);
  const avatar = asArray(byKey.avatar.value);
  const binQuest = await loadBinQuestRecords(root);
  // The registry scans lightweight identity metadata for every source family.
  // Dialogue bodies are loaded only after an exact narrative Talk identity is
  // requested; NpcGroup contributes relation provenance without becoming a
  // public dialogue source.
  const talkRegistry = await buildTalkSourceRegistry(root, {
    parseKinds: [],
    concurrency: 32,
    dialogueIdsToIndex: talk
      .map((row) => idText(row.initDialog ?? row.initDialogId))
      .filter((id): id is string => Boolean(id)),
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
  const chapterById = new Map(
    chapter.flatMap((row) => {
      const id = idText(row.id ?? row.chapterId);
      return id ? [[id, row] as const] : [];
    }),
  );
  const chapterByMainId = new Map<string, Json>();
  // MainQuest.chapterId is the complete membership relation. PACJEJCGPLN is
  // only an anchor list in this source snapshot, so it must never be treated
  // as the exhaustive chapter-to-quest index.
  for (const [mainId, row] of mainQuestById) {
    const chapterId = idText(row.chapterId);
    const chapterRow = chapterId ? chapterById.get(chapterId) : undefined;
    if (chapterRow) chapterByMainId.set(mainId, chapterRow);
  }
  for (const row of chapter) {
    const chapterQuestIds = Array.isArray(row.PACJEJCGPLN) ? row.PACJEJCGPLN : [];
    for (const value of chapterQuestIds) {
      const mainId = idText(value);
      if (mainId && !chapterByMainId.has(mainId)) chapterByMainId.set(mainId, row);
    }
  }
  const groupRows = new Map<string, Json[]>();
  for (const row of chapter) {
    const groupId = idText(row.groupId);
    if (!groupId) continue;
    const rows = groupRows.get(groupId) ?? [];
    rows.push(row);
    groupRows.set(groupId, rows);
  }
  const usableChapterGroups = new Set<string>();
  const chapterGroupTitleByLocale: Inputs["chapterGroupTitleByLocale"] = {
    "zh-CN": new Map(),
    en: new Map(),
  };
  for (const [groupId, rows] of groupRows) {
    const cities = new Set(rows.map((row) => idText(row.cityId)).filter(Boolean));
    const styles = new Set(rows.map((row) => text(row.IMFDDPKLIDD ?? row.LINLPCFFGFC)).filter(Boolean));
    // A type label can differ within a valid group (some chapters include
    // related world-quest records); mixed physical regions or chapter styles
    // are the stronger conflict signals.
    if (cities.size <= 1 && styles.size <= 1) usableChapterGroups.add(groupId);
    for (const locale of locales) {
      const imageTitles = new Set(
        rows
          .map(
            (row) =>
              resolveLocalizedText(textMaps, locale, row.chapterImageTitleTextMapHash)?.value,
          )
          .filter((value): value is string => Boolean(value)),
      );
      const canonicalImageTitle = imageTitles.size === 1 ? [...imageTitles][0] : undefined;
      if (canonicalImageTitle) {
        chapterGroupTitleByLocale[locale].set(groupId, canonicalImageTitle);
        continue;
      }
      const chapterPrefixes = new Set(
        rows
          .map((row) => {
            const chapterNum = resolveLocalizedText(
              textMaps,
              locale,
              row.chapterNumTextMapHash ?? row.numTextMapHash,
            )?.value;
            return chapterFamilyPrefix(chapterNum);
          })
          .filter((value): value is string => Boolean(value)),
      );
      if (chapterPrefixes.size === 1)
        chapterGroupTitleByLocale[locale].set(groupId, [...chapterPrefixes][0]!);
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
  Object.assign(inputHashes, binQuest.inputHashes);
  const storyFamilyOverrides = await loadStoryFamilyOverrides();
  const questRegionOverrides = await loadQuestRegionOverrides();
  const questRegionByMainId = indexQuestRegions(talk);

  const reputationQuestFile = await readJsonSafe(
    root,
    "ExcelBinOutput/ReputationQuestExcelConfigData.json",
  );
  const tribalReputationQuestFile = await readJsonSafe(
    root,
    "ExcelBinOutput/TribalReputationQuestExcelConfigData.json",
  );
  const reputationRequestFile = await readJsonSafe(
    root,
    "ExcelBinOutput/ReputationRequestExcelConfigData.json",
  );

  const reputationRegionByMainId = new Map<string, { regionId: string; evidence: string }>();
  if (reputationQuestFile) {
    if (reputationQuestFile.hash)
      inputHashes["ExcelBinOutput/ReputationQuestExcelConfigData.json"] = reputationQuestFile.hash;
    for (const row of asArray(reputationQuestFile.value)) {
      const parentQuestId = idText(row.parentQuestId);
      const cityId = typeof row.cityId === "number" ? row.cityId : undefined;
      const reg = cityId ? cityRegions[cityId]?.id : undefined;
      if (parentQuestId && reg) {
        reputationRegionByMainId.set(parentQuestId, {
          regionId: reg,
          evidence: `ExcelBinOutput/ReputationQuestExcelConfigData.json:parentQuestId=${parentQuestId}.cityId=${cityId}`,
        });
      }
    }
  }
  if (tribalReputationQuestFile) {
    if (tribalReputationQuestFile.hash)
      inputHashes["ExcelBinOutput/TribalReputationQuestExcelConfigData.json"] =
        tribalReputationQuestFile.hash;
    for (const row of asArray(tribalReputationQuestFile.value)) {
      const parentQuestId = idText(row.parentQuestId);
      if (parentQuestId && !reputationRegionByMainId.has(parentQuestId)) {
        reputationRegionByMainId.set(parentQuestId, {
          regionId: "natlan",
          evidence: `ExcelBinOutput/TribalReputationQuestExcelConfigData.json:parentQuestId=${parentQuestId}`,
        });
      }
    }
  }
  if (reputationRequestFile) {
    if (reputationRequestFile.hash)
      inputHashes["ExcelBinOutput/ReputationRequestExcelConfigData.json"] =
        reputationRequestFile.hash;
    const questSubToMain = new Map(
      asArray(byKey.quest.value).flatMap((q) => {
        const subId = idText(q.subId ?? q.id);
        const mainId = idText(q.mainId ?? q.mainQuestId);
        return subId && mainId ? [[subId, mainId] as const] : [];
      }),
    );
    for (const row of asArray(reputationRequestFile.value)) {
      const questId = idText(row.questId);
      const mainId = questId ? questSubToMain.get(questId) : undefined;
      if (!mainId || reputationRegionByMainId.has(mainId)) continue;
      const iconName = text(row.iconName) ?? "";
      let reg: string | undefined;
      if (iconName.includes("Mengde")) reg = "mondstadt";
      else if (iconName.includes("Liyue")) reg = "liyue";
      else if (iconName.includes("Inazuma")) reg = "inazuma";
      else if (iconName.includes("Sumeru")) reg = "sumeru";
      else if (iconName.includes("Fontaine")) reg = "fontaine";
      else if (iconName.includes("Natlan")) reg = "natlan";
      if (reg) {
        reputationRegionByMainId.set(mainId, {
          regionId: reg,
          evidence: `ExcelBinOutput/ReputationRequestExcelConfigData.json:questId=${questId}.iconName=${iconName}`,
        });
      }
    }
  }

  const baseRelationEdges: QuestRelationEdge[] = [
    ...binQuest.records.flatMap((record) => record.relationEdges),
    ...talkRegistry.npcGroupRelations,
    ...mainQuestRelationEdges,
  ];
  const mainQuestIds = mainQuest
    .map((row) => idText(row.id ?? row.mainQuestId))
    .filter((id): id is string => Boolean(id));
  const upstreamOrder = new Map(mainQuestIds.map((id, index) => [id, index] as const));
  const questTopologies = buildQuestTopologies(
    mainQuestIds,
    baseRelationEdges,
    new Map(),
    upstreamOrder,
    { binRecords: binQuest.records },
  );
  const questFamilyComponents = connectedQuestComponents(
    mainQuestIds,
    [...questTopologies.values()]
      .flatMap((topology) => topology.derivedRelationEdges ?? [])
      // A finished-state check is a prerequisite, not evidence that two
      // quests belong to the same narrative family.  Family discovery uses
      // only explicit main-quest ordering and aggregate membership here.
      .filter((edge) => ["starts_after", "aggregate_of"].includes(edge.relationType)),
    {
      compatible: (leftQuestId, rightQuestId) => {
        const leftRegion = questRegionByMainId.get(leftQuestId)?.regionId;
        const rightRegion = questRegionByMainId.get(rightQuestId)?.regionId;
        if (leftRegion && rightRegion && leftRegion !== rightRegion) return false;
        const leftType = questType(mainQuestById.get(leftQuestId)?.type);
        const rightType = questType(mainQuestById.get(rightQuestId)?.type);
        return leftType === rightType || leftType === "other" || rightType === "other";
      },
    },
  );

  const resolvedTalksByMainId = new Map<string, ResolvedQuestTalks>();
  const resolvedTalkRowsByMainId = new Map<string, Json[]>();
  const resolvedTalkDialogRowsByMainId = new Map<string, Json[]>();
  const talkRowById = new Map(
    talk.flatMap((row) => {
      const talkId = idText(row.id ?? row.talkId);
      return talkId ? [[talkId, row] as const] : [];
    }),
  );
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
      relationEdges: baseRelationEdges,
    });
    resolvedTalksByMainId.set(mainId, resolved);
    const rows: Json[] = [];
    const dialogueRows: Json[] = [];
    for (const candidate of resolved.candidates) {
      // Ambiguous and availability-only candidates remain in provenance/audit
      // but are quarantined from the public narrative body.
      if (candidate.status !== "resolved") continue;
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
          __subQuestId: candidate.subQuestId,
          __subQuestIds: candidate.subQuestIds,
        };
        dialogueRows.push(normalizedRow);
      }
      const componentAnalysis = analyzeDialogueComponents(
        asset.dialogueRows,
        asset.rootDialogueIds,
      );
      const roots = componentAnalysis.traversalRoots;
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
          __subQuestId: candidate.subQuestId,
          __subQuestIds: candidate.subQuestIds,
          __graphHasNoRoot: !asset.rootDialogueIds.length && asset.dialogueRows.length > 0,
          __dialogueComponentCount: componentAnalysis.componentCount,
          __rootlessComponentCount: componentAnalysis.rootlessComponentCount,
          __stronglyConnectedComponents: componentAnalysis.stronglyConnectedComponents,
          __unreachableDialogueIds: componentAnalysis.unreachableDialogueIds,
        });
      }
    }
    // Legacy Talk rows can point directly into DialogExcel without a
    // standalone BinOutput/Talk asset. Preserve that exact identity bridge
    // before reporting the Talk as missing.
    for (const talkId of [...resolved.unresolvedTalkIds]) {
      if (resolved.ambiguousTalkIds.includes(talkId)) continue;
      const talkRow = talkRowById.get(talkId);
      const explicitInitDialog = idText(talkRow?.initDialog ?? talkRow?.initDialogId);
      const conventionalInitDialog = `${talkId}01`;
      const initDialog = [explicitInitDialog, conventionalInitDialog].find(
        (dialogId): dialogId is string => Boolean(dialogId && dialogById.has(dialogId)),
      );
      if (!initDialog) continue;
      rows.push({
        id: `${talkId}:${initDialog}:legacy`,
        initDialog,
        questId: mainId,
        __sourceFile: inputPaths.dialog,
        __talkId: talkId,
        __sourceKind: "quest",
        __relationEvidence: "legacy_path_match",
      });
      resolved.resolvedTalkIds.push(talkId);
      resolved.unresolvedTalkIds = resolved.unresolvedTalkIds.filter((id) => id !== talkId);
      resolved.candidates.push({
        talkId,
        sourceKind: "quest",
        sourceFile: inputPaths.dialog,
        confidence: 1,
        score: 1,
        status: "resolved",
        evidence: "legacy_path_match",
        evidences: [
          {
            kind: "legacy_path_match",
            evidenceClass: "identity",
            confidence: 1,
            sourceFile: inputPaths.dialog,
            details: { initDialogId: initDialog, match: "dialog_excel_exact" },
          },
        ],
        resolutionReason: "dialog_excel_init_dialog_exact",
      });
    }
    resolvedTalkRowsByMainId.set(mainId, rows);
    resolvedTalkDialogRowsByMainId.set(mainId, dialogueRows);
  }
  // From this point onward every resolved asset has been normalized into the
  // per-main dialogue maps. Keep only lightweight candidate provenance so the
  // full bilingual conversion does not retain a second copy of every graph.
  for (const resolved of resolvedTalksByMainId.values()) {
    for (const candidate of resolved.candidates) candidate.asset = undefined;
  }
  talkRegistry.releaseLoadedAssets();

  return {
    root,
    mainQuest,
    mainQuestById,
    mainQuestRelations,
    quest,
    questByMainId,
    chapter,
    chapterById,
    chapterByMainId,
    usableChapterGroups,
    chapterGroupTitleByLocale,
    questRegionByMainId,
    reputationRegionByMainId,
    questRegionOverrides,
    questCodex,
    talk,
    dialog,
    dialogById,
    npcById,
    codexQuest,
    codexQuestByMainId,
    codexQuestFailures,
    npc,
    avatar,
    textMaps,
    inputHashes,
    binQuest: binQuest.records,
    binQuestByMainId: binQuest.byMainId,
    binQuestFailures: binQuest.failures,
    talkRegistry,
    resolvedTalksByMainId,
    resolvedTalkRowsByMainId,
    resolvedTalkDialogRowsByMainId,
    questRelationEdges: baseRelationEdges,
    storyFamilyOverrides,
    questTopologies,
    questFamilyComponents,
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

function resolveSeriesId(_inputs: Inputs, _mainId: string, main: Json): string | undefined {
  // Raw MainQuest relation columns have no verified parent/child semantics.
  // Series inheritance is therefore limited to an explicit source series;
  // curated overrides and structural aggregate edges handle known gaps.
  return directSeriesId(main);
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
    .filter((value): value is string => Boolean(value) && !isForbiddenStoryTitle(value));
  const prefixes = new Map<string, number>();
  for (const title of titles) {
    const match = title.match(/^(.+?)[·・:：]\s*.+$/u);
    if (!match?.[1]) continue;
    const prefix = match[1].trim();
    if (isForbiddenStoryTitle(prefix)) continue;
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  const preferredPrefix = preferredTitle?.match(/^(.+?)[·・:：]\s*.+$/u)?.[1]?.trim();
  if (
    preferredPrefix &&
    !isForbiddenStoryTitle(preferredPrefix) &&
    prefixes.size > 1 &&
    prefixes.has(preferredPrefix)
  ) {
    return preferredPrefix;
  }
  const repeatedPrefix = [...prefixes.entries()]
    .filter(([prefix, count]) => count >= 2 && !isForbiddenStoryTitle(prefix))
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0];
  if (repeatedPrefix) return repeatedPrefix;
  const nonTestMembers = members.filter((row) => {
    const title = questTitleForSeries(inputs, row, locale);
    return title && !isForbiddenStoryTitle(title);
  });
  if (nonTestMembers.length > 1) return locale === "en" ? "Quest Series" : "连续任务";
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
  "魔神任务",
  "Archon Quests",
]);

export function chapterStoryOrder(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/终章|尾声|\b(?:finale|epilogue|requiem)\b/iu.test(value)) return 9000;
  if (/间章|幕间|\b(?:interlude|intermezzo)\b/iu.test(value)) return 550;

  const chineseNumber = (raw: string): number | undefined => {
    const digits: Record<string, number> = {
      零: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    if (/^\d+$/u.test(raw)) return Number(raw);
    if ([...raw].every((char) => char in digits))
      return [...raw].reduce((value, char) => value * 10 + digits[char]!, 0);
    const parts = raw.split("十");
    if (parts.length === 2)
      return (
        (parts[0] ? (digits[parts[0]] ?? 0) : 1) * 10 + (parts[1] ? (digits[parts[1]] ?? 0) : 0)
      );
    return undefined;
  };
  const englishOrdinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const romanValues: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };

  const parseOrdinal = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const lower = raw.toLocaleLowerCase("en");
    let order = chineseNumber(lower);
    if (order === undefined && lower in englishOrdinals) order = englishOrdinals[lower];
    if (order === undefined && /^[ivxlcdm]+$/u.test(lower)) {
      order = 0;
      for (let index = 0; index < lower.length; index += 1) {
        const current = romanValues[lower[index]!] ?? 0;
        const next = romanValues[lower[index + 1]!] ?? 0;
        order += current < next ? -current : current;
      }
    }
    return order !== undefined ? order * 100 : undefined;
  };

  // Prioritize Act first so acts within a chapter don't all match chapter number
  const actMatch =
    value.match(/第\s*([一二三四五六七八九十零\d]+)\s*幕/u) ??
    value.match(
      /\bact\s+(\d+|[ivxlcdm]+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/iu,
    );
  if (actMatch?.[1]) {
    const actOrder = parseOrdinal(actMatch[1]);
    if (actOrder !== undefined) return actOrder;
  }

  if (/序章|序曲|序幕|序奏|\b(?:prologue|prelude)\b/iu.test(value)) return 50;

  const numbered =
    value.match(/第\s*([一二三四五六七八九十零\d]+)\s*(?:章|部|篇)/u) ??
    value.match(
      /(?:part|chapter|movement|volume)\s+(\d+|[ivxlcdm]+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)/iu,
    ) ??
    value.match(/(?:its|part)\s+([一二三四五六七八九十零\d]+)/iu);
  if (numbered?.[1]) {
    const chapOrder = parseOrdinal(numbered[1]);
    if (chapOrder !== undefined) return chapOrder;
  }
  return undefined;
}

function chapterFamilyPrefix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const chinese = value.match(
    /^(.+?)(?:\s*第[一二三四五六七八九十零\d]+(?:章|幕|部|篇)|[·・:：]\s*(?:序曲|序章|终章|尾声|第))/u,
  );
  if (chinese?.[1]) return chinese[1].trim();
  const english = value.match(
    /^(.+?)(?::\s*(?:part\s+|chapter\s+|movement\s+|act\s+|prelude|prologue|finale|epilogue))/iu,
  );
  return english?.[1]?.trim();
}

function storyFamilyOverrideFor(inputs: Inputs, mainId: string): StoryFamilyOverride | undefined {
  return inputs.storyFamilyOverrides.find(
    (override) => !override.obsolete && override.questIds.includes(mainId),
  );
}

function regionForMainQuest(inputs: Inputs, mainId: string): string | undefined {
  const main = inputs.mainQuestById.get(mainId);
  const chapterId = idText(main?.chapterId);
  const chapter = chapterId ? inputs.chapterById.get(chapterId) : undefined;
  const cityId = typeof chapter?.cityId === "number" ? chapter.cityId : undefined;
  return (
    (cityId ? cityRegions[cityId]?.id : undefined) ??
    inputs.questRegionByMainId.get(mainId)?.regionId
  );
}

function slugifyIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveArchonStoryFamily(
  chapterId: string | undefined,
  chapterNum: string | undefined,
  locale: Locale,
  rawCityId?: number,
): {
  id: string;
  title: string;
  provenance: "derived";
  catalogRegionId: string;
  familyOrder: number;
} | undefined {
  const idNum = chapterId ? Number(chapterId) : undefined;
  const numStr = chapterNum ?? "";

  // 1. Prologue (序章)
  if ((idNum && idNum >= 1001 && idNum <= 1003) || /序章|Prologue/i.test(numStr)) {
    return {
      id: "genshin:aq:prologue",
      title:
        locale === "en"
          ? "Archon Quest · Prologue: Song of the Dragon and Freedom"
          : "魔神任务 · 序章「巨龙与自由之歌」",
      provenance: "derived",
      catalogRegionId: "mondstadt",
      familyOrder: 100,
    };
  }

  // 2. Chapter I (第一章)
  if ((idNum && idNum >= 1101 && idNum <= 1105) || /第一章|Chapter I\b/i.test(numStr)) {
    return {
      id: "genshin:aq:chapter-1",
      title:
        locale === "en"
          ? "Archon Quest · Chapter I: Farewell, Archaic Lord"
          : "魔神任务 · 第一章「辞行久远之躯」",
      provenance: "derived",
      catalogRegionId: "liyue",
      familyOrder: 100,
    };
  }

  // 3. Chapter II (第二章)
  if (
    (idNum && ((idNum >= 1201 && idNum <= 1204) || idNum === 1206)) ||
    /第二章|Chapter II\b/i.test(numStr)
  ) {
    return {
      id: "genshin:aq:chapter-2",
      title:
        locale === "en"
          ? "Archon Quest · Chapter II: Omnipresence Over Mortals"
          : "魔神任务 · 第二章「千手百眼，天下人间」",
      provenance: "derived",
      catalogRegionId: "inazuma",
      familyOrder: 100,
    };
  }

  // 4. Chapter III (第三章)
  if (
    (idNum && ((idNum >= 1301 && idNum <= 1306) || idNum === 1308)) ||
    /第三章|Chapter III\b/i.test(numStr)
  ) {
    return {
      id: "genshin:aq:chapter-3",
      title:
        locale === "en"
          ? "Archon Quest · Chapter III: Akasha Pulses, the Kalpa Flame Rises"
          : "魔神任务 · 第三章「虚空鼓动，劫火高扬」",
      provenance: "derived",
      catalogRegionId: "sumeru",
      familyOrder: 100,
    };
  }

  // 5. Chapter IV (第四章)
  if ((idNum && idNum >= 1400 && idNum <= 1406) || /第四章|Chapter IV\b/i.test(numStr)) {
    return {
      id: "genshin:aq:chapter-4",
      title:
        locale === "en"
          ? "Archon Quest · Chapter IV: Masquerade of the Guilty"
          : "魔神任务 · 第四章「罪人舞步旋」",
      provenance: "derived",
      catalogRegionId: "fontaine",
      familyOrder: 100,
    };
  }

  // 6. Chapter V (第五章)
  if ((idNum && idNum >= 1500 && idNum <= 1506) || /第五章|Chapter V\b/i.test(numStr)) {
    return {
      id: "genshin:aq:chapter-5",
      title:
        locale === "en"
          ? "Archon Quest · Chapter V: Incandescent Ode of Resurrection"
          : "魔神任务 · 第五章「炽烈的还魂诗」",
      provenance: "derived",
      catalogRegionId: "natlan",
      familyOrder: 100,
    };
  }

  // 7. Nod-Krai / Welkin Moon (空月之歌)
  if (
    (idNum && idNum >= 1600 && idNum <= 1611) ||
    /空月之歌|Welkin Moon|第六章|Chapter VI\b/i.test(numStr)
  ) {
    return {
      id: "genshin:aq:nod-krai",
      title:
        locale === "en" ? "Archon Quest · Song of the Welkin Moon" : "魔神任务 · 空月之歌",
      provenance: "derived",
      catalogRegionId: "nod_krai",
      familyOrder: 100,
    };
  }

  // 8. Chapter VII (第七章)
  if ((idNum && idNum >= 1700 && idNum <= 1701) || /第七章|Chapter VII\b/i.test(numStr)) {
    return {
      id: "genshin:aq:chapter-7",
      title:
        locale === "en"
          ? "Archon Quest · Chapter VII: Everwinter Without Mercy"
          : "魔神任务 · 第七章「无神怜爱的雪国」",
      provenance: "derived",
      catalogRegionId: "snezhnaya",
      familyOrder: 100,
    };
  }

  // 9. Interlude (间章)
  if (
    (idNum && (idNum === 1205 || idNum === 1207 || idNum === 1307 || idNum === 1004)) ||
    /间章|Interlude/i.test(numStr)
  ) {
    let regionId = "liyue";
    if (idNum === 1307 || rawCityId === 4) regionId = "sumeru";
    else if (idNum === 1004 || rawCityId === 1) regionId = "mondstadt";
    else if (rawCityId && cityRegions[rawCityId]) regionId = cityRegions[rawCityId]!.id;
    return {
      id: `genshin:aq:interlude:${regionId}`,
      title: locale === "en" ? "Archon Quest · Interlude Chapter" : "魔神任务 · 间章",
      provenance: "derived",
      catalogRegionId: regionId,
      familyOrder: 150,
    };
  }

  return undefined;
}

export function resolvePersonalLineStoryFamily(
  inputs: Inputs,
  chapterRow: Json | undefined,
  chapterId: string | undefined,
  chapterTitle: string | undefined,
  locale: Locale,
): {
  id: string;
  title: string;
  provenance: "derived";
  catalogRegionId?: string;
  familyOrder: number;
  chapterOrder?: number;
} | undefined {
  if (!chapterRow) return undefined;
  const style = text(chapterRow.IMFDDPKLIDD ?? chapterRow.LINLPCFFGFC);
  if (style !== "CHAPTER_STYLE_TYPE_PERSONALLINE") return undefined;

  const charNameResolution =
    resolveLocalizedText(inputs.textMaps, locale, chapterRow.chapterImageTitleTextMapHash) ??
    resolveLocalizedText(inputs.textMaps, "zh-CN", chapterRow.chapterImageTitleTextMapHash);
  if (!charNameResolution?.value) return undefined;
  const charName = charNameResolution.value;

  const charNameEnResolution =
    resolveLocalizedText(inputs.textMaps, "en", chapterRow.chapterImageTitleTextMapHash) ??
    charNameResolution;
  const charSlug = slugifyIdentifier(charNameEnResolution.value);

  const chapterNumResolution =
    resolveLocalizedText(
      inputs.textMaps,
      locale,
      chapterRow.chapterNumTextMapHash ?? chapterRow.numTextMapHash,
    ) ??
    resolveLocalizedText(
      inputs.textMaps,
      "zh-CN",
      chapterRow.chapterNumTextMapHash ?? chapterRow.numTextMapHash,
    );
  const chapterNum = chapterNumResolution?.value ?? "";

  let familyTitle: string;
  if (locale === "zh-CN") {
    const match = chapterNum.match(/^(.+?之章)/u);
    const prefix = match ? match[1] : chapterNum.split(/\s+/u)[0];
    familyTitle = prefix ? `${charName} · ${prefix}` : `${charName} · 传说任务`;
  } else {
    const match = chapterNum.match(/^(.+?\s+Chapter)/iu);
    const prefix = match ? match[1] : chapterNum.split(/:\s*Act|\s+Act/iu)[0];
    familyTitle = prefix ? `${charName}: ${prefix}` : `${charName}: Story Quest`;
  }

  const rawCityId = typeof chapterRow.cityId === "number" ? chapterRow.cityId : undefined;
  const catalogRegionId = rawCityId ? cityRegions[rawCityId]?.id : undefined;

  return {
    id: `genshin:personal-line:${charSlug || (chapterId ?? "unknown")}`,
    title: familyTitle,
    provenance: "derived",
    catalogRegionId,
    familyOrder: 200,
    chapterOrder: chapterStoryOrder(chapterTitle),
  };
}

function resolveStoryFamily(
  inputs: Inputs,
  mainId: string,
  locale: Locale,
  chapterId: string | undefined,
  chapterTitle: string | undefined,
  resolvedSeriesTitle: string | undefined,
  seriesId: string | undefined,
  chapterStyle?: string,
  resolvedQuestType?: QuestType,
  chapterRow?: Json,
  rawCityId?: number,
  chapterNum?: string,
): {
  id?: string;
  title?: string;
  provenance: "upstream" | "derived" | "curated" | "fallback";
  catalogRegionId?: string;
  familyOrder?: number;
  chapterOrder?: number;
  subseriesId?: string;
  subseriesTitle?: string;
  subseriesOrder?: number;
} {
  const override = storyFamilyOverrideFor(inputs, mainId);
  if (override) {
    const subseries = override.subseries?.find((item) => item.questIds.includes(mainId));
    return {
      id: override.id,
      title: override.title?.[locale] ?? override.title?.["zh-CN"] ?? override.id,
      provenance: "curated",
      catalogRegionId:
        override.catalogRegionId ?? regionForMainQuest(inputs, override.questIds[0] ?? mainId),
      familyOrder: override.order,
      chapterOrder: override.chapterOrders?.[chapterId ?? ""] ?? chapterStoryOrder(chapterTitle),
      subseriesId: subseries?.id,
      subseriesTitle: subseries?.title?.[locale] ?? subseries?.title?.["zh-CN"] ?? subseries?.id,
      subseriesOrder: subseries?.order,
    };
  }

  const resolvedChapterRow =
    chapterRow ??
    (chapterId ? inputs.chapterById.get(chapterId) : undefined) ??
    inputs.chapterByMainId.get(mainId);

  // 1. Archon Quest convergence
  if (resolvedQuestType === "archon_quest" || chapterStyle === "CHAPTER_STYLE_TYPE_AQ") {
    const aqFamily = resolveArchonStoryFamily(chapterId, chapterNum, locale, rawCityId);
    if (aqFamily) {
      return {
        ...aqFamily,
        chapterOrder: chapterStoryOrder(chapterTitle),
      };
    }
  }

  // 2. Personal line convergence
  if (chapterStyle === "CHAPTER_STYLE_TYPE_PERSONALLINE") {
    const personalFamily = resolvePersonalLineStoryFamily(
      inputs,
      resolvedChapterRow,
      chapterId,
      chapterTitle,
      locale,
    );
    if (personalFamily) {
      return personalFamily;
    }
  }

  const chapterGroupId = idText(resolvedChapterRow?.groupId);
  const chapterGroup =
    chapterGroupId && inputs.usableChapterGroups.has(chapterGroupId) ? chapterGroupId : undefined;
  const chapterFamilyTitle = chapterGroup
    ? inputs.chapterGroupTitleByLocale[locale].get(chapterGroup)
    : undefined;

  // Group membership is stronger than a per-quest series field. For example,
  // Forest Book chapters share a chapter group while individual MainQuest
  // rows expose different series IDs.
  if (chapterGroup && chapterFamilyTitle) {
    return {
      id: `genshin:chapter-group:${chapterGroup}`,
      title: chapterFamilyTitle,
      provenance: "derived",
      chapterOrder: override?.chapterOrders?.[chapterId ?? ""] ?? chapterStoryOrder(chapterTitle),
    };
  }

  const meaningfulSeries =
    resolvedSeriesTitle &&
    !genericStoryFamilyTitles.has(resolvedSeriesTitle.trim()) &&
    !isForbiddenStoryTitle(resolvedSeriesTitle.trim())
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

  const topology = inputs.questTopologies.get(mainId);
  const aggregateParent = topology?.aggregateParentQuestId;
  if (aggregateParent) {
    const parent = inputs.mainQuestById.get(aggregateParent);
    const parentTitle = parent ? questTitleForSeries(inputs, parent, locale) : undefined;
    if (parentTitle) {
      return {
        id: `genshin:aggregate:${aggregateParent}`,
        title: parentTitle,
        provenance: "derived",
        chapterOrder: chapterStoryOrder(chapterTitle),
      };
    }
  }

  const component = inputs.questFamilyComponents.get(mainId) ?? [];
  if (component.length > 1 && component.length <= 20) {
    const componentTitle =
      chapterTitle?.split(/[·:：]/u, 1)[0]?.trim() ||
      (locale === "en" ? "Related Quest Series" : "关联任务系列");
    const rootId = [...component].sort(
      (left, right) => Number(left) - Number(right) || left.localeCompare(right),
    )[0]!;
    return {
      id: `genshin:relation-component:${rootId}`,
      title: componentTitle,
      provenance: "derived",
      chapterOrder: chapterStoryOrder(chapterTitle),
    };
  }

  return {
    // A numeric/generic series field without a human-readable series title is
    // not enough to manufacture a visible one-task family.
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
  const codexTitle = codexFile?.value.NFFJLFOECKD ?? codexFile?.value.HEDPNHPBMJH;
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
  return idText(value.MFANMBMKKLC ?? value.IMJHJGBNMMD ?? value.mainQuestId ?? value.mainId ?? value.id);
}

function codexText(value: Json, key: string): unknown {
  return value[key];
}

function dialogueId(row: Json): string | undefined {
  return idText(row.GFLDJMJKIKE ?? row.id ?? row.dialogId);
}

function isPlayerRole(role: Json): boolean {
  const type = text(role.type);
  const id = idText(role.id);
  if (type === "TALK_ROLE_PLAYER") return true;
  if (
    id === "主角" ||
    id === "玩家" ||
    id === "PLAYER" ||
    id === "Player" ||
    id === "10000005" ||
    id === "10000007"
  ) {
    return true;
  }
  return false;
}

function isBlackScreenRole(role: Json): boolean {
  const type = text(role.type);
  const id = idText(role.id);
  return (
    type?.includes("BLACK_SCREEN") === true ||
    id?.startsWith("BLACKSCREEN") === true
  );
}

function isPlaceholderRole(role: Json): boolean {
  const id = idText(role.id);
  if (!id) return false;
  return (id.startsWith("{") && id.endsWith("}")) || id === "****";
}

function talkRoleNpcId(row: Json): string | undefined {
  const role = asObject(row.talkRole);
  if (isPlayerRole(role) || isBlackScreenRole(role) || isPlaceholderRole(role)) return undefined;
  const type = text(role.type);
  const id = idText(role.id);
  return type === "TALK_ROLE_NPC" && id && id !== "0" && id !== "" ? id : undefined;
}

function npcDisplayName(
  inputs: Inputs,
  npcId: string | undefined,
  textMap: Record<string, unknown>,
): string | undefined {
  const npc = npcId ? inputs.npcById.get(npcId) : undefined;
  if (!npc) return undefined;
  const nameHash = npc.nameTextMapHash ?? npc.nameHash;
  const resolvedName = nameHash === undefined ? undefined : tryResolveText(textMap, nameHash);
  if (resolvedName) return resolvedName;
  const explicitName = text(npc.name);
  if (explicitName && !explicitName.startsWith("ConfigNpc_")) return explicitName;
  return undefined;
}

export type SpeakerResolutionMethod =
  | "dialog_textmap"
  | "npc_fallback"
  | "player_identity"
  | "intentionally_nameless"
  | "codex_line_textmap"
  | "unresolved";

export function resolveDialogSpeakerName(
  inputs: Inputs,
  dialogRow: Json,
  textMap: Record<string, unknown>,
  locale: Locale,
): { value?: string; method: SpeakerResolutionMethod } {
  const role = asObject(dialogRow.talkRole);
  if (isPlayerRole(role)) {
    return {
      value: locale === "en" ? "Traveler" : "旅行者",
      method: "player_identity",
    };
  }
  if (isBlackScreenRole(role) || isPlaceholderRole(role) || idText(role.id) === "0") {
    return { value: undefined, method: "intentionally_nameless" };
  }
  const direct = tryResolveText(textMap, dialogRow.talkRoleNameTextMapHash);
  if (direct) return { value: direct, method: "dialog_textmap" };
  const npcId = talkRoleNpcId(dialogRow);
  const fallback = npcDisplayName(inputs, npcId, textMap);
  if (fallback) return { value: fallback, method: "npc_fallback" };

  const body = tryResolveText(textMap, dialogRow.talkContentTextMapHash);
  if (body && /^[（(].+[）)]$/su.test(body.trim())) {
    return {
      value: locale === "en" ? "Traveler" : "旅行者",
      method: "player_identity",
    };
  }

  const npc = npcId ? inputs.npcById.get(npcId) : undefined;
  const scriptDataPath = text(npc?.scriptDataPath);
  const luaDataPath = text(npc?.luaDataPath);
  if (
    (npc && (npc.disableShowName === true || npc.disableShowName === 1)) ||
    scriptDataPath?.startsWith("Data/ScriptData/PropObject") ||
    luaDataPath === "Actor/Npc/TempNPC"
  ) {
    return { value: undefined, method: "intentionally_nameless" };
  }

  return { method: "unresolved" };
}

function buildDialogueGraph(
  inputs: Inputs,
  mainId: string,
  locale: Locale,
  textMap: Record<string, unknown>,
): {
  nodes: QuestRecordPayload["dialogueNodes"];
  edges: QuestRecordPayload["dialogueEdges"];
  participantIds: Set<string>;
  sourceFiles: string[];
  graphHasNoRoot: boolean;
  cycle: boolean;
  cycleNodeIds: string[];
  danglingEdges: string[];
  missingTextNodes: string[];
  missingSpeakerNodes: string[];
  disconnectedComponentCount: number;
  rootlessComponentCount: number;
  stronglyConnectedComponents: string[][];
  unreachableDialogueIds: string[];
} {
  const codexFile = inputs.codexQuestByMainId.get(mainId);
  const dialogById = inputs.dialogById;
  const resolvedTalkDialogRows = inputs.resolvedTalkDialogRowsByMainId.get(mainId) ?? [];
  const resolvedDialogRowsById = new Map<string, Json[]>();
  for (const row of resolvedTalkDialogRows) {
    const id = dialogueId(row);
    if (!id) continue;
    const rows = resolvedDialogRowsById.get(id) ?? [];
    rows.push(row);
    resolvedDialogRowsById.set(id, rows);
  }
  const mergeDialogRows = (rows: Json[]): Json | undefined => {
    if (rows.length === 0) return undefined;
    const ordered = [...rows].sort((left, right) => {
      const leftBody = tryResolveText(textMap, left.talkContentTextMapHash) ? 1 : 0;
      const rightBody = tryResolveText(textMap, right.talkContentTextMapHash) ? 1 : 0;
      if (leftBody !== rightBody) return rightBody - leftBody;
      const leftHash = textRefHash(left.talkContentTextMapHash) ? 1 : 0;
      const rightHash = textRefHash(right.talkContentTextMapHash) ? 1 : 0;
      if (leftHash !== rightHash) return rightHash - leftHash;
      return (text(left.__sourceFile) ?? "").localeCompare(text(right.__sourceFile) ?? "");
    });
    const selected = ordered[0]!;
    const nextDialogs = [
      ...new Set(
        rows.flatMap((row) =>
          Array.isArray(row.nextDialogs)
            ? row.nextDialogs
                .map((value) => idText(value))
                .filter((id): id is string => Boolean(id))
            : [],
        ),
      ),
    ];
    return nextDialogs.length > 0 ? { ...selected, nextDialogs } : selected;
  };
  const resolvedDialogById = new Map(
    [...resolvedDialogRowsById.entries()].flatMap(([id, rows]) => {
      const row = mergeDialogRows(rows);
      return row ? [[id, row] as const] : [];
    }),
  );
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
  const graphHasNoRootForTalk = new Set<string>();
  const missingTextNodes = new Set<string>();
  const missingSpeakerNodes = new Set<string>();
  const danglingEdges = new Set<string>();
  let disconnectedComponentCount = 0;
  let rootlessComponentCount = 0;
  const stronglyConnectedComponents = new Map<string, string[]>();
  const unreachableDialogueIds = new Set<string>();

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
    const nodeKey = uniqueNodeKey(input.nodeKeyBase ?? `quest/${mainId}/dialog/${input.nodeId}`);
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

  function linearizeCodexLines(lines: Json[]): Json[] {
    if (lines.length <= 1) return lines;
    const lineById = new Map<string, Json>();
    lines.forEach((l, idx) => {
      const id = idText(l.BMAHMPOKJEG ?? l.EICGDLLPINH ?? idx) ?? String(idx);
      lineById.set(id, l);
    });
    function getNext(l: Json): string[] {
      const targets: string[] = [];
      const direct = Array.isArray(l.IKBPMKLHLGD)
        ? l.IKBPMKLHLGD
        : Array.isArray(l.MOMDAPFBMBM)
          ? l.MOMDAPFBMBM
          : [];
      for (const t of direct) {
        const id = idText(t);
        if (id) targets.push(id);
      }
      const refs = asArray(l.EDJPJDLLBOJ ?? l.OFKGPGLHIDJ);
      for (const r of refs) {
        const robj = asObject(r);
        const nextId = idText(robj.AAFIOOJDGFN);
        if (nextId) targets.push(nextId);
      }
      return [...new Set(targets)];
    }
    function findReachable(startId: string, stopId?: string): Set<string> {
      const reach = new Set<string>();
      const q = [startId];
      while (q.length) {
        const curr = q.shift()!;
        if (!curr || reach.has(curr) || curr === stopId) continue;
        reach.add(curr);
        const l = lineById.get(curr);
        if (!l) continue;
        for (const n of getNext(l)) q.push(n);
      }
      return reach;
    }
    const visited = new Set<string>();
    const result: Json[] = [];
    function traverse(id: string) {
      if (!id || visited.has(id)) return;
      visited.add(id);
      const l = lineById.get(id);
      if (!l) return;
      result.push(l);
      const next = getNext(l);
      if (next.length === 0) return;
      if (next.length === 1) {
        traverse(next[0]);
        return;
      }
      const branchReachables = next.map((n) => findReachable(n));
      let common: string[] = [];
      if (branchReachables.length > 0) {
        common = [...branchReachables[0]].filter((x) =>
          branchReachables.every((set) => set.has(x)),
        );
      }
      const joinNode = common[0];
      for (const n of next) {
        function traverseBranch(bid: string) {
          if (!bid || visited.has(bid) || bid === joinNode) return;
          visited.add(bid);
          const bl = lineById.get(bid);
          if (!bl) return;
          result.push(bl);
          for (const target of getNext(bl)) {
            traverseBranch(target);
          }
        }
        traverseBranch(n);
      }
      if (joinNode) traverse(joinNode);
    }
    const rootId = idText(lines[0].BMAHMPOKJEG ?? lines[0].EICGDLLPINH ?? 0) ?? "0";
    traverse(rootId);
    for (const l of lines) {
      const id = idText(l.BMAHMPOKJEG ?? l.EICGDLLPINH ?? 0) ?? "";
      if (id && !visited.has(id)) traverse(id);
    }
    return result;
  }

  if (codexFile) {
    const groups = asArray(
      codexFile.value.JIJKODHIEED ??
        codexFile.value.EBNBLBEIFFJ ??
        codexText(codexFile.value, "EBNBLBEIFFJ"),
    );
    groups.forEach((group, groupIndex) => {
      const subquestKey = `quest/${mainId}/subquest/${groupIndex + 1}`;
      const rawLines = asArray(
        group.DCBDMJAPBOK ?? group.PEAKPGNONFA ?? codexText(group, "PEAKPGNONFA"),
      );
      const lines = linearizeCodexLines(rawLines);
      lines.forEach((line, lineIndex) => {
        const lineId =
          idText(line.BMAHMPOKJEG ?? line.EICGDLLPINH ?? lineIndex) ?? String(lineIndex);
        const lineKey = `${groupIndex}:${lineId}`;
        const lineKind = text(line.itemType ?? line.NDANANGPLHB);
        const speakerRaw = line.FKJAFLOBDEI?.textId ?? line.FKJAFLOBDEI ?? line.IILBCFJNPGA;
        const speakerName = tryResolveText(textMap, speakerRaw);
        const narrationRefs = asArray(line.JKPKLAJFBMM ?? line.JOLOODLBEGO);
        narrationRefs.forEach((ref, refIndex) => {
          const textRef = asObject(ref).textId ?? ref;
          const body = tryResolveText(textMap, textRef);
          if (!body) return;
          appendNode({
            nodeId: `codex-${groupIndex}-${lineIndex}-narration-${refIndex}`,
            type: "narration",
            subquestKey,
            body,
            lineKey,
            sourceFile: codexFile.relativePath,
            metadata: {
              textMapHash: hashValue(textRef),
              codexLineKind: lineKind,
            },
          });
        });
        const dialogueRefs = asArray(line.EDJPJDLLBOJ ?? line.OFKGPGLHIDJ);
        dialogueRefs.forEach((ref, refIndex) => {
          const dialogId = idText(ref.POMAEJICHLK ?? ref.AAICCGABILO);
          const dialogRow = dialogId
            ? (resolvedDialogById.get(dialogId) ?? dialogById.get(dialogId))
            : undefined;
          const refText = ref.text?.textId ?? ref.text ?? ref.JGPDCLOJKLC;
          const body =
            tryResolveText(textMap, refText) ??
            (dialogRow ? tryResolveText(textMap, dialogRow.talkContentTextMapHash) : undefined);
          if (!body) return;
          const role = dialogRow ? asObject(dialogRow.talkRole) : {};
          const isPlayer =
            line.FKJAFLOBDEI?.DFKLAEHPOBE === "SpeakerPlayer" ||
            line.itemType === "SelectDialog" ||
            isPlayerRole(role);
          const npcId = dialogRow ? talkRoleNpcId(dialogRow) : undefined;
          const isNarratage =
            line.FKJAFLOBDEI?.DFKLAEHPOBE === "Narratage" ||
            lineKind === "TextLeft" ||
            text(asObject(line.IILBCFJNPGA)?.JOBGILDNLEL) === "Narratage" ||
            text(asObject(ref.JGPDCLOJKLC)?.JOBGILDNLEL) === "Narratage";
          const dialogSpeaker = isNarratage
            ? { value: undefined, method: "intentionally_nameless" as const }
            : isPlayer
              ? { value: speakerName ?? "旅行者", method: "player_identity" as const }
              : dialogRow
                ? resolveDialogSpeakerName(inputs, dialogRow, textMap, locale)
                : speakerName
                  ? { value: speakerName, method: "codex_line_textmap" as const }
                  : { method: "unresolved" as const };
          if (
            npcId &&
            dialogSpeaker.method !== "player_identity" &&
            dialogSpeaker.method !== "intentionally_nameless"
          ) {
            participantIds.add(npcId);
          }
          const isChoice =
            isPlayer ||
            dialogSpeaker.method === "player_identity" ||
            line.FKJAFLOBDEI?.DFKLAEHPOBE === "SpeakerPlayer" ||
            line.itemType === "SelectDialog";
          appendNode({
            nodeId: dialogId ?? `codex-${groupIndex}-${lineIndex}-dialog-${refIndex}`,
            type:
              isChoice
                ? "player_choice"
                : dialogSpeaker.method === "intentionally_nameless"
                  ? "narration"
                  : "dialogue",
            subquestKey,
            speakerKey:
              isPlayer || dialogSpeaker.method === "player_identity"
                ? "player"
                : dialogSpeaker.method === "intentionally_nameless"
                  ? undefined
                  : npcId
                    ? `npc/${npcId}`
                    : undefined,
            speakerName:
              dialogSpeaker.method === "intentionally_nameless"
                ? undefined
                : speakerName ?? dialogSpeaker.value,
            body,
            lineKey,
            sourceFile: codexFile.relativePath,
            metadata: {
              textMapHash: hashValue(refText ?? dialogRow?.talkContentTextMapHash),
              dialogId,
              codexLineKind: lineKind,
              speakerNameResolution: speakerName ? "codex_line_textmap" : dialogSpeaker.method,
            },
          });
        });
        const fromNodeKeys = nodeKeyByLine.get(lineKey) ?? [];
        const nextTargets = Array.isArray(line.IKBPMKLHLGD)
          ? line.IKBPMKLHLGD
          : Array.isArray(line.MOMDAPFBMBM)
            ? line.MOMDAPFBMBM
            : [];
        for (const target of nextTargets) {
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
        dialogueRefs.forEach((ref) => {
          const optTarget = idText(ref.AAFIOOJDGFN);
          const dialogId = idText(ref.POMAEJICHLK ?? ref.AAICCGABILO);
          if (optTarget && dialogId) {
            const optNodeKey = `quest/${mainId}/dialog/${dialogId}`;
            pendingEdges.push({
              fromNodeKeys: [optNodeKey],
              targetLineKey: `${groupIndex}:${optTarget}`,
              type: "choice",
              optionText: nodes.find((node) => node.nodeKey === optNodeKey)?.body,
              sourceFile: codexFile.relativePath,
            });
          }
        });
      });
    });
  }

  if (nodes.length === 0) {
    const resolvedTalkRows = inputs.resolvedTalkRowsByMainId.get(mainId) ?? [];
    const resolvedTalkDialogRowsByKey = new Map<string, Json[]>();
    for (const row of resolvedTalkDialogRows) {
      const talkId = idText(row.__talkId);
      const dialogId = dialogueId(row);
      if (!talkId || !dialogId) continue;
      const key = `${talkId}:${dialogId}`;
      const rows = resolvedTalkDialogRowsByKey.get(key) ?? [];
      rows.push(row);
      resolvedTalkDialogRowsByKey.set(key, rows);
    }
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
      return new RegExp(`(?:^|[/_])(?:MQ|WQ|LQ|EQ|Q)${escaped}(?:[/_]|$)`, "iu").test(performCfg);
    });
    const explicitTalkRows = [...directTalkRows, ...resolvedTalkRows];
    const talkRowsById = new Map(
      explicitTalkRows.flatMap((row) => {
        const id = idText(row.id ?? row.__talkId);
        return id ? [[id, row] as const] : [];
      }),
    );
    const binQuestRecord = inputs.binQuestByMainId.get(mainId);
    const subQuestIdByTalkId = new Map<string, string>();
    if (binQuestRecord) {
      for (const edge of binQuestRecord.relationEdges ?? []) {
        if (edge.relationType === "complete_talk" && edge.talkId && edge.fromQuestId) {
          subQuestIdByTalkId.set(edge.talkId, edge.fromQuestId);
        }
      }
    }
    for (const talk of explicitTalkRows) {
      const talkId = idText(talk.__talkId ?? talk.id);
      if (!talkId) continue;
      if (!subQuestIdByTalkId.has(talkId)) {
        if (talk.__subQuestId) {
          subQuestIdByTalkId.set(talkId, idText(talk.__subQuestId)!);
        } else {
          for (const cond of asArray(talk.beginCond)) {
            const c = asObject(cond);
            if (text(c.type) === "QUEST_COND_STATE_EQUAL") {
              const subId = idText(asArray(c.param)[0]);
              if (subId) {
                subQuestIdByTalkId.set(talkId, subId);
                break;
              }
            }
          }
        }
      }
    }
    const questRows = inputs.questByMainId.get(mainId) ?? [];
    const subquestOrderById = new Map<string, number>();
    const effectiveSubquests = questRows.length ? questRows : (binQuestRecord?.subQuests ?? []);
    effectiveSubquests.forEach((sq, idx) => {
      const id = idText(sq.subId ?? sq.id ?? sq.subQuestId);
      if (id) subquestOrderById.set(id, typeof sq.order === "number" ? sq.order : idx);
    });
    const talkRows = [...talkRowsById.values()].sort((left, right) => {
      const leftTalkId = idText(left.__talkId ?? left.id) ?? "";
      const rightTalkId = idText(right.__talkId ?? right.id) ?? "";
      const leftSubId = subQuestIdByTalkId.get(leftTalkId);
      const rightSubId = subQuestIdByTalkId.get(rightTalkId);
      const leftOrder = leftSubId !== undefined ? (subquestOrderById.get(leftSubId) ?? 99999) : 99999;
      const rightOrder = rightSubId !== undefined ? (subquestOrderById.get(rightSubId) ?? 99999) : 99999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return Number(left.id ?? 0) - Number(right.id ?? 0);
    });
    const traverseTalkRows = (followEmptyNodes: boolean) => {
      for (const talk of talkRows) {
        const talkId = idText(talk.__talkId ?? talk.id);
        const initDialog = idText(talk.initDialog);
        if (!talkId || !initDialog) continue;
        if (talk.__graphHasNoRoot === true) graphHasNoRootForTalk.add(talkId);
        disconnectedComponentCount = Math.max(
          disconnectedComponentCount,
          Number(talk.__dialogueComponentCount ?? 0),
        );
        rootlessComponentCount = Math.max(
          rootlessComponentCount,
          Number(talk.__rootlessComponentCount ?? 0),
        );
        for (const component of Array.isArray(talk.__stronglyConnectedComponents)
          ? talk.__stronglyConnectedComponents
          : []) {
          if (!Array.isArray(component)) continue;
          const ids = component
            .map(idText)
            .filter((id): id is string => Boolean(id))
            .sort();
          if (ids.length) stronglyConnectedComponents.set(ids.join("|"), ids);
        }
        for (const id of Array.isArray(talk.__unreachableDialogueIds)
          ? talk.__unreachableDialogueIds
          : []) {
          const value = idText(id);
          if (value) unreachableDialogueIds.add(value);
        }
        const getDlgRow = (dlgId: string): Json | undefined => {
          const scoped = mergeDialogRows(
            resolvedTalkDialogRowsByKey.get(`${talkId}:${dlgId}`) ?? [],
          );
          const legacy = dialogById.get(dlgId);
          const legacyBody = legacy
            ? tryResolveText(textMap, legacy.talkContentTextMapHash)
            : undefined;
          return scoped ?? (!legacyBody ? (resolvedDialogById.get(dlgId) ?? legacy) : legacy);
        };
        const getNextList = (dlgRow: Json | undefined): string[] => {
          if (!dlgRow || !Array.isArray(dlgRow.nextDialogs)) return [];
          return dlgRow.nextDialogs.map((n) => idText(n)).filter((n): n is string => Boolean(n));
        };
        const findTalkReachable = (startId: string, stopId?: string): Set<string> => {
          const reach = new Set<string>();
          const q = [startId];
          while (q.length) {
            const curr = q.shift()!;
            if (!curr || reach.has(curr) || curr === stopId) continue;
            reach.add(curr);
            const r = getDlgRow(curr);
            for (const n of getNextList(r)) q.push(n);
          }
          return reach;
        };

        const visited = new Set<string>();
        const matchedSubId = subQuestIdByTalkId.get(talkId) ?? idText(talk.__subQuestId);

        const processCurrentNode = (current: string): boolean => {
          const dialogRow = getDlgRow(current);
          if (!dialogRow) {
            danglingEdges.add(`${talkId}:${current}`);
            return false;
          }
          const body = tryResolveText(textMap, dialogRow.talkContentTextMapHash);
          if (!body) missingTextNodes.add(`${talkId}:${current}`);
          const sourceFile = text(dialogRow.__sourceFile) ?? inputPaths.dialog;
          if (body) {
            const role = asObject(dialogRow.talkRole);
            const isPlayer = isPlayerRole(role);
            const npcId = talkRoleNpcId(dialogRow);
            const speaker = resolveDialogSpeakerName(inputs, dialogRow, textMap, locale);
            if (
              npcId &&
              !speaker.value &&
              speaker.method !== "intentionally_nameless" &&
              speaker.method !== "player_identity"
            ) {
              missingSpeakerNodes.add(`${talkId}:${current}`);
            }
            if (
              npcId &&
              speaker.method !== "player_identity" &&
              speaker.method !== "intentionally_nameless"
            ) {
              participantIds.add(npcId);
            }
            appendNode({
              nodeId: current,
              type:
                isPlayer || speaker.method === "player_identity"
                  ? "player_choice"
                  : speaker.method === "intentionally_nameless"
                    ? "narration"
                    : "dialogue",
              subquestKey: `quest/${mainId}/subquest/${matchedSubId ?? idText(dialogRow.__subQuestId) ?? talkId}`,
              speakerKey:
                isPlayer || speaker.method === "player_identity"
                  ? "player"
                  : speaker.method === "intentionally_nameless"
                    ? undefined
                    : npcId
                      ? `npc/${npcId}`
                      : undefined,
              speakerName: speaker.method === "intentionally_nameless" ? undefined : speaker.value,
              body,
              lineKey: `talk:${talkId}:${current}`,
              sourceFile,
              identityScope: talkId,
              nodeKeyBase: `quest/${mainId}/talk/${talkId}/dialog/${current}`,
              metadata: {
                textMapHash: hashValue(dialogRow.talkContentTextMapHash),
                talkId,
                subQuestId: matchedSubId ?? dialogRow.__subQuestId ?? talk.__subQuestId,
                sourceKind: dialogRow.__sourceKind ?? talk.__sourceKind,
                relationEvidence: dialogRow.__relationEvidence ?? talk.__relationEvidence,
                relationEdgeId: dialogRow.__relationEdgeId ?? talk.__relationEdgeId,
                speakerNameResolution: speaker.method,
              },
            });
          }
          const nextList = getNextList(dialogRow);
          for (const nextId of nextList) {
            const nextExists =
              resolvedTalkDialogRowsByKey.has(`${talkId}:${nextId}`) ||
              resolvedDialogById.has(nextId) ||
              dialogById.has(nextId);
            if (!nextExists) danglingEdges.add(`${talkId}:${current}->${nextId}`);
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
          }
          return Boolean(body || followEmptyNodes);
        };

        const traverseLinear = (current: string) => {
          if (!current || visited.has(current)) return;
          visited.add(current);
          const shouldContinue = processCurrentNode(current);
          if (!shouldContinue) return;
          const nextList = getNextList(getDlgRow(current));
          if (nextList.length === 0) return;
          if (nextList.length === 1) {
            traverseLinear(nextList[0]);
            return;
          }
          const branchReachables = nextList.map((n) => findTalkReachable(n));
          let common: string[] = [];
          if (branchReachables.length > 0) {
            common = [...branchReachables[0]].filter((x) =>
              branchReachables.every((set) => set.has(x)),
            );
          }
          const joinNode = common[0];
          for (const n of nextList) {
            const traverseBranch = (bid: string) => {
              if (!bid || visited.has(bid) || bid === joinNode) return;
              visited.add(bid);
              const branchContinue = processCurrentNode(bid);
              if (!branchContinue) return;
              for (const next of getNextList(getDlgRow(bid))) {
                traverseBranch(next);
              }
            };
            traverseBranch(n);
          }
          if (joinNode) traverseLinear(joinNode);
        };

        traverseLinear(initDialog);
      }
    };

    // Legacy DialogExcel is used only if it has a localized body; binary Talk
    // assets are resolved through the scoped Talk registry above.
    traverseTalkRows(true);
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
  const adjacency = new Map<string, string[]>();
  for (const edge of uniqueEdges.values()) {
    const list = adjacency.get(edge.fromNodeKey) ?? [];
    list.push(edge.toNodeKey);
    adjacency.set(edge.fromNodeKey, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleNodeIds = new Set<string>();
  const visit = (nodeKey: string, stack: string[]): void => {
    if (visiting.has(nodeKey)) {
      const index = stack.indexOf(nodeKey);
      for (const item of stack.slice(index >= 0 ? index : 0)) cycleNodeIds.add(item);
      return;
    }
    if (visited.has(nodeKey)) return;
    visiting.add(nodeKey);
    for (const next of adjacency.get(nodeKey) ?? []) visit(next, [...stack, nodeKey]);
    visiting.delete(nodeKey);
    visited.add(nodeKey);
  };
  for (const node of nodes) visit(node.nodeKey, []);
  return {
    nodes,
    edges: [...uniqueEdges.values()],
    participantIds,
    sourceFiles: [...sourceFiles].sort(),
    graphHasNoRoot: graphHasNoRootForTalk.size > 0,
    cycle: cycleNodeIds.size > 0,
    cycleNodeIds: [...cycleNodeIds],
    danglingEdges: [...danglingEdges],
    missingTextNodes: [...missingTextNodes],
    missingSpeakerNodes: [...missingSpeakerNodes],
    disconnectedComponentCount,
    rootlessComponentCount,
    stronglyConnectedComponents: [...stronglyConnectedComponents.values()],
    unreachableDialogueIds: [...unreachableDialogueIds],
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
  const chapterRow = chapterId ? inputs.chapterById.get(chapterId) : undefined;
  const chapterStyle = text(chapterRow?.IMFDDPKLIDD ?? chapterRow?.LINLPCFFGFC);
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
    codexFile?.value.FBAFFJDIIFG ??
    codexFile?.value.ALOHJMPDFKI;
  const chapterTitleResolution =
    resolveLocalizedText(inputs.textMaps, locale, chapterTitleHash) ??
    (text(chapterRow?.title)
      ? { value: text(chapterRow.title)!, locale, hash: undefined }
      : undefined);

  const chapterNumHash =
    chapterRow?.chapterNumTextMapHash ??
    chapterRow?.numTextMapHash ??
    codexFile?.value.LFEGFBHFCBH ??
    codexFile?.value.NNPJABOAJPL;
  const chapterNumResolution = resolveLocalizedText(inputs.textMaps, locale, chapterNumHash);

  const chapterNum = chapterNumResolution?.value;
  const rawChapterTitle = chapterTitleResolution?.value;
  const fullChapterTitle =
    chapterNum && rawChapterTitle
      ? locale === "zh-CN"
        ? `${chapterNum} ${rawChapterTitle}`
        : `${chapterNum}: ${rawChapterTitle}`
      : (rawChapterTitle ?? chapterNum);

  const binQuestRecord = inputs.binQuestByMainId.get(mainId);
  const topology = inputs.questTopologies.get(mainId);

  const rawCityId = typeof chapterRow?.cityId === "number" ? chapterRow.cityId : undefined;
  let regionInfo = rawCityId ? cityRegions[rawCityId] : undefined;
  const talkRegionEvidence = inputs.questRegionByMainId.get(mainId);
  let taskRegionSource: NonNullable<QuestRecordPayload["storyProjection"]>["taskRegionSource"] =
    regionInfo ? "chapter_city" : "unresolved";
  let taskRegionReason: string | undefined;
  const taskRegionEvidence = [
    chapterId ? `${inputPaths.mainQuest}:MainQuest[${mainId}].chapterId=${chapterId}` : undefined,
    chapterRow
      ? `${inputPaths.chapter}:Chapter[${chapterId ?? "anchor"}].cityId=${rawCityId ?? "missing"}`
      : undefined,
    ...(talkRegionEvidence?.talkPathEvidence ?? []),
  ].filter((item): item is string => Boolean(item));
  const taskRegionConflicts: string[] = [];
  if (rawCityId !== undefined && !cityRegions[rawCityId])
    taskRegionConflicts.push(`unmapped_chapter_city_id:${rawCityId}`);
  if (talkRegionEvidence && talkRegionEvidence.candidateRegionIds.length > 1)
    taskRegionConflicts.push(
      `talk_path_region_conflict:${talkRegionEvidence.candidateRegionIds.join(",")}`,
    );
  if (regionInfo && talkRegionEvidence?.regionId && regionInfo.id !== talkRegionEvidence.regionId)
    taskRegionConflicts.push(
      `chapter_city_${regionInfo.id}_conflicts_with_talk_path_${talkRegionEvidence.regionId}`,
    );

  if (!regionInfo) {
    const rep = inputs.reputationRegionByMainId.get(mainId);
    if (rep) {
      regionInfo = regionById.get(rep.regionId);
      if (regionInfo) {
        taskRegionSource = "reputation";
        taskRegionReason = "reputation_quest_city_config";
        taskRegionEvidence.push(rep.evidence);
      }
    }
  }

  if (!regionInfo) {
    const inferredRegionId = talkRegionEvidence?.regionId;
    regionInfo = inferredRegionId ? regionById.get(inferredRegionId) : undefined;
    if (regionInfo) {
      taskRegionSource = "talk_perform_cfg";
      taskRegionReason = "chapter_city_unavailable; unique_exact_quest_talk_path_used";
    }
  }

  if (!regionInfo) {
    const override = inputs.questRegionOverrides.get(mainId);
    if (override) {
      regionInfo = regionById.get(override.regionId);
      if (regionInfo) {
        taskRegionSource = "curated_override";
        taskRegionReason = override.reason ?? "curated_quest_region_override";
        if (override.evidence) taskRegionEvidence.push(...override.evidence);
      }
    }
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
    if (regionInfo && taskRegionSource === "unresolved") {
      taskRegionSource = "chapter_title";
      taskRegionReason = "region_inferred_from_archon_chapter_title_pattern";
      taskRegionEvidence.push(
        `${inputPaths.chapter}:Chapter[${chapterId ?? "anchor"}].title=${fullChapterTitle ?? "unresolved"}`,
      );
    }
  }

  if (!regionInfo) {
    const candidateIds = [
      ...(topology
        ? [
            topology.aggregateParentQuestId,
            ...topology.parentQuestIds,
            ...topology.prerequisiteQuestIds,
            ...(topology.childQuestIds ?? []),
          ]
        : []),
      ...(inputs.mainQuestRelations.get(mainId) ?? []),
    ].filter((id): id is string => Boolean(id));
    for (const candidateId of candidateIds) {
      const parentRep = inputs.reputationRegionByMainId.get(candidateId);
      const parentTalk = inputs.questRegionByMainId.get(candidateId);
      const parentOverride = inputs.questRegionOverrides.get(candidateId);
      const parentMain = inputs.mainQuestById.get(candidateId);
      const parentChap = parentMain ? inputs.chapterByMainId.get(candidateId) : undefined;
      const parentCity =
        parentChap && parentChap.cityId ? cityRegions[Number(parentChap.cityId)] : undefined;
      const inheritedId =
        parentCity?.id ?? parentRep?.regionId ?? parentTalk?.regionId ?? parentOverride?.regionId;
      if (inheritedId) {
        regionInfo = regionById.get(inheritedId);
        if (regionInfo) {
          taskRegionSource = "inherited";
          taskRegionReason = `inherited_from_related_quest:${candidateId}`;
          taskRegionEvidence.push(`relation:quest/${candidateId}->quest/${mainId}`);
          break;
        }
      }
    }
  }

  if (!regionInfo) {
    taskRegionReason = talkRegionEvidence?.candidateRegionIds.length
      ? "no_mapped_chapter_city_and_talk_path_region_is_ambiguous_or_unsupported"
      : chapterRow
        ? "chapter_city_unmapped_and_no_unique_talk_perform_cfg_region"
        : "no_effective_chapter_city_or_unique_talk_perform_cfg_region";
  } else if (taskRegionSource === "talk_perform_cfg") {
    taskRegionReason = "chapter_city_unavailable; unique_exact_quest_talk_path_used";
  } else if (taskRegionSource === "chapter_title") {
    taskRegionReason = "region_inferred_from_archon_chapter_title_pattern";
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
    seriesTitleResolution?.value &&
    !/^\d+$/.test(seriesTitleResolution.value.trim()) &&
    !isForbiddenStoryTitle(seriesTitleResolution.value.trim())
      ? seriesTitleResolution.value
      : resolvedQuestType === "archon_quest"
        ? locale === "en"
          ? "Archon Quests"
          : "魔神任务"
        : undefined;

  const storyFamily = resolveStoryFamily(
    inputs,
    mainId,
    locale,
    chapterId,
    fullChapterTitle,
    resolvedSeriesTitle,
    seriesId,
    chapterStyle,
    resolvedQuestType,
    chapterRow,
    rawCityId,
    chapterNum,
  );
  const catalogRegionId = storyFamily.catalogRegionId ?? resolvedRegionId ?? "other";
  const catalogRegionInfo = catalogRegionId ? regionById.get(catalogRegionId) : undefined;
  const catalogRegionName = catalogRegionInfo
    ? locale === "en"
      ? catalogRegionInfo.en
      : catalogRegionInfo.zh
    : (resolvedRegionName ?? (locale === "en" ? "Other Region" : "其他地区"));

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
    const groups = asArray(
      codexFile.value.JIJKODHIEED ??
        codexFile.value.EBNBLBEIFFJ ??
        codexText(codexFile.value, "EBNBLBEIFFJ"),
    );
    subquests = groups.map((group, groupIndex) => {
      const subquestId = String(groupIndex + 1);
      const titleHash = hashValue(
        group.GKAGCMIHDDB?.textId ?? group.GKAGCMIHDDB ?? codexText(group, "OGEGCCLHIHP"),
      );
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
  } else if (binQuestRecord?.subQuests?.length) {
    subquests = binQuestRecord.subQuests.map((sq, index) => {
      const subquestId = sq.subId;
      const subquestKey = `quest/${mainId}/subquest/${subquestId}`;
      const title =
        (sq.stepDescTextMapHash ? tryResolveText(textMap, sq.stepDescTextMapHash) : undefined) ??
        `Subquest ${subquestId}`;
      return {
        subquestKey,
        subquestId,
        title,
        objective: undefined,
        order: sq.order ?? index,
        completeness: "complete" as const,
        metadata: {
          sourceFile: binQuestRecord.sourceFile,
          stepDescTextMapHash: sq.stepDescTextMapHash,
        },
      };
    });
  }

  const codexSortOrder =
    typeof codexIndexRows[0]?.sortOrder === "number" ? codexIndexRows[0].sortOrder : undefined;
  const questOrder = codexSortOrder ?? Number(main.order ?? mainId);

  const graph = buildDialogueGraph(inputs, mainId, locale, textMap);
  const subquestKeys = new Set(subquests.map((subquest) => subquest.subquestKey));
  const dialogueNodes = graph.nodes.map((node) => ({
    ...node,
    subquestKey:
      node.subquestKey && subquestKeys.has(node.subquestKey) ? node.subquestKey : undefined,
  }));
  const dialogueEdges = graph.edges;
  const dialogueLineageFile = codexFile?.relativePath ?? graph.sourceFiles[0] ?? inputPaths.dialog;
  const dialogueLineageHash =
    codexFile?.hash ??
    inputs.inputHashes[dialogueLineageFile] ??
    inputs.inputHashes[inputPaths.dialog];
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
  const resolvedTalks = inputs.resolvedTalksByMainId.get(mainId);
  const relationEdges = topology?.relationEdges ?? binQuestRecord?.relationEdges ?? [];
  const talkIds = resolvedTalks?.talkIds ?? [];
  const resolvedTalkIds = resolvedTalks?.resolvedTalkIds ?? [];
  const unresolvedTalkIds = resolvedTalks?.unresolvedTalkIds ?? [];
  const talkSourceKinds = [
    ...new Set((resolvedTalks?.candidates ?? []).map((candidate) => candidate.sourceKind)),
  ];
  const isSpecialControl310 = mainId === "310";
  const contentRole: QuestContentRole = isSpecialControl310
    ? "trigger"
    : classifyQuestContentRole({
        bin: binQuestRecord,
        hasExplicitStoryTalk: Boolean(binQuestRecord?.hasCompleteTalk),
        resolvedTalkCount: resolvedTalkIds.length,
        dialogueNodeCount: dialogueNodes.length,
        hasSiblingQuestRelations: relationEdges.some(
          (edge) => edge.relationType === "requires" || edge.relationType === "starts_after",
        ),
        hasProgressOrReward: Boolean(
          binQuestRecord?.contentCounts.QUEST_CONTENT_ADD_QUEST_PROGRESS ||
          main.rewardIdList ||
          main.rewardId,
        ),
        aggregateEvidenceClasses: [
          ...(topology?.aggregateChildQuestIds.length ? ["aggregate_children"] : []),
          ...(binQuestRecord?.contentCounts.QUEST_CONTENT_ADD_QUEST_PROGRESS
            ? ["content_progress"]
            : []),
          ...(binQuestRecord?.execCounts?.QUEST_EXEC_ADD_QUEST_PROGRESS ? ["exec_progress"] : []),
          ...(main.rewardIdList || main.rewardId ? ["reward"] : []),
          ...(!binQuestRecord?.hasCompleteTalk ? ["no_explicit_story_talk"] : []),
        ],
      });
  const expectedTalkIds = talkIds;
  const ambiguousTalkIds = resolvedTalks?.ambiguousTalkIds ?? [];
  const dialogueResolutionStatus: DialogueResolutionStatus = classifyDialogueResolution({
    contentRole,
    hasNarrativeSource: Boolean(codexFile || talkIds.length > 0),
    // A Codex quest file is metadata and subquest structure, not evidence that
    // a dialogue asset exists.  Only explicit Talk IDs or recovered dialogue
    // nodes count as a source reference here; otherwise a control/metadata
    // task must remain metadata-only instead of being reported as missing.
    talkReferenceCount: talkIds.length,
    // This is the number of distinct assets competing for one Talk identity,
    // not the number of Talk IDs in the quest.  A quest with ten resolved Talk
    // IDs is not ambiguous merely because it has ten dialogue segments.
    talkAssetCount: ambiguousTalkIds.length > 0 ? 2 : resolvedTalkIds.length > 0 ? 1 : 0,
    dialogueNodeCount: dialogueNodes.length,
    expectedTalkIds,
    resolvedTalkIds,
    missingTalkIds: unresolvedTalkIds,
    ambiguousTalkIds,
    danglingEdgeCount: graph.danglingEdges.length,
    missingTextCount: graph.missingTextNodes.length,
    graphHasNoRoot: graph.graphHasNoRoot,
    cycle: graph.cycle,
  });
  const completenessReasons = [
    ...(dialogueNodes.length || dialogueResolutionStatus === "not_applicable"
      ? []
      : ["missingDialogue"]),
    ...(subquests.length || dialogueResolutionStatus === "not_applicable"
      ? []
      : ["missingSubquests"]),
  ];
  const warnings = [
    questTypeWarning(originalQuestType),
    visibilityReason === "unresolved_show_type"
      ? `unknown_show_type:${text(main.showType ?? main.questShowType ?? main.visibility)}`
      : undefined,
    titleResolution.method === "unresolved" ? "title_unresolved" : undefined,
  ].filter((warning): warning is string => Boolean(warning));
  const unresolvedSpeakerCount = dialogueNodes.filter(
    (node) =>
      Boolean(node.speakerKey) &&
      !node.speakerName &&
      node.metadata?.speakerNameResolution !== "intentionally_nameless",
  ).length;
  const qualityCode: NonNullable<QuestRecordPayload["qualityCode"]> =
    contentRole === "control" || contentRole === "trigger" || contentRole === "reward"
      ? "control"
      : contentRole === "aggregate"
        ? "aggregate"
        : dialogueNodes.length
          ? unresolvedSpeakerCount > 0 || graph.missingSpeakerNodes.length > 0
            ? "speaker_unresolved"
            : unresolvedTalkIds.length > 0 ||
                dialogueResolutionStatus === "partial" ||
                dialogueResolutionStatus === "talk_asset_ambiguous" ||
                graph.missingTextNodes.length > 0 ||
                graph.danglingEdges.length > 0
              ? "partial_dialogue"
              : "complete"
          : dialogueResolutionStatus === "talk_asset_missing" ||
              dialogueResolutionStatus === "talk_reference_missing"
            ? "source_missing"
            : dialogueResolutionStatus === "graph_incomplete" ||
                dialogueResolutionStatus === "partial" ||
                dialogueResolutionStatus === "talk_asset_ambiguous" ||
                dialogueResolutionStatus === "dialogue_text_missing"
              ? "partial_dialogue"
              : "metadata_only";
  const isNonNarrative = ["control", "trigger", "reward", "aggregate"].includes(contentRole);
  const explicitPrerequisites = [
    ...asArray(main.prerequisites),
    ...asArray(main.BJOCFAJIGLH),
  ].flatMap((row) => {
    const id = idText(row.id ?? row.mainQuestId ?? row.questId);
    return id ? [`quest/${id}`] : [];
  });
  const prerequisites = [
    ...new Set([
      ...explicitPrerequisites,
      ...(topology?.prerequisiteQuestIds ?? []).map((id) => `quest/${id}`),
    ]),
  ];
  const storyProjection: NonNullable<QuestRecordPayload["storyProjection"]> = {
    schemaVersion: 3,
    regionId: catalogRegionId,
    regionTitle: catalogRegionName,
    taskRegionId: resolvedRegionId ?? "other",
    taskRegionSource,
    taskRegionReason,
    taskRegionEvidence,
    taskRegionConflicts: taskRegionConflicts.length ? taskRegionConflicts : undefined,
    familyId: storyFamily.id,
    familyTitle: storyFamily.title,
    familyOrder: storyFamily.familyOrder,
    subseriesId: storyFamily.subseriesId,
    subseriesTitle: storyFamily.subseriesTitle,
    subseriesOrder: storyFamily.subseriesOrder,
    chapterId,
    chapterTitle: fullChapterTitle,
    chapterOrder: storyFamily.chapterOrder,
    entryType: contentRole === "aggregate" ? "collection" : "quest",
    parentQuestId: topology?.aggregateParentQuestId,
    aggregateChildQuestIds: topology?.aggregateChildQuestIds,
  };
  const payload: QuestRecordPayload = {
    questKey: `quest/${mainId}`,
    mainQuestId: mainId,
    questType: resolvedQuestType,
    locale,
    regionId: resolvedRegionId ?? "other",
    region: resolvedRegionName ?? (locale === "en" ? "Other Region" : "其他地区"),
    regionName: resolvedRegionName ?? (locale === "en" ? "Other Region" : "其他地区"),
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
    dialogueDiagnostics: {
      expectedTalkIds,
      resolvedTalkIds,
      missingTalkIds: unresolvedTalkIds,
      ambiguousTalkIds,
      graphHasNoRoot: graph.graphHasNoRoot,
      cycle: graph.cycle,
      cycleNodeIds: graph.cycleNodeIds,
      danglingEdges: graph.danglingEdges,
      missingTextNodes: graph.missingTextNodes,
      missingSpeakerNodes: graph.missingSpeakerNodes,
      disconnectedComponentCount: graph.disconnectedComponentCount,
      rootlessComponentCount: graph.rootlessComponentCount,
      stronglyConnectedComponents: graph.stronglyConnectedComponents,
      unreachableDialogueIds: graph.unreachableDialogueIds,
    },
    questRelationEdges: relationEdges,
    topology: {
      prerequisiteQuestIds:
        topology?.prerequisiteQuestIds ?? prerequisites.map((key) => key.replace(/^quest\//u, "")),
      successorQuestIds: topology?.successorQuestIds ?? [],
      relatedQuestIds: topology?.relatedQuestIds ?? [],
      aggregateChildQuestIds: topology?.aggregateChildQuestIds ?? [],
      parentQuestIds: topology?.parentQuestIds ?? [],
      storyOrder: topology?.storyOrder ?? questOrder,
      orderSource: topology?.orderSource,
      orderConfidence: topology?.orderConfidence,
      rawRelationEdges: topology?.rawRelationEdges,
      derivedRelationEdges: topology?.derivedRelationEdges,
      subQuestIds: topology?.subQuestIds,
      subQuestOrder: topology?.subQuestOrder,
      subQuestRelationEdges: topology?.subQuestRelationEdges,
      aggregateParentQuestId: topology?.aggregateParentQuestId,
      cycle: topology?.cycle,
      cycleNodeIds: topology?.cycleNodeIds,
      danglingEdges: topology?.danglingEdges,
    },
    storyProjection,
    completeness: isNonNarrative
      ? "complete"
      : dialogueNodes.length > 0 && qualityCode === "complete"
        ? "complete"
        : dialogueNodes.length > 0 || resolvedTalkIds.length > 0 || subquests.length > 0
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
      storyProjection,
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
        talkCandidates: (resolvedTalks?.candidates ?? []).map((candidate) => ({
          talkId: candidate.talkId,
          subQuestIds: candidate.subQuestIds,
          sourceKind: candidate.sourceKind,
          sourceFile: candidate.sourceFile,
          status: candidate.status,
          resolutionReason: candidate.resolutionReason,
          relationEdgeId: candidate.relationEdgeId,
          evidence: candidate.evidence,
          evidenceKinds: [...new Set(candidate.evidences?.map((item) => item.kind) ?? [])],
          evidenceClasses: [
            ...new Set(candidate.evidences?.map((item) => item.evidenceClass) ?? []),
          ],
        })),
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
        topology: payload.topology,
        dialogueResolutionStatus: payload.dialogueResolutionStatus,
        dialogueDiagnostics: payload.dialogueDiagnostics,
        talkIds: payload.talkIds,
        resolvedTalkIds: payload.resolvedTalkIds,
        unresolvedTalkIds: payload.unresolvedTalkIds,
        storyProjection: payload.storyProjection,
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

function buildStoryProjection(
  records: NormalizedRecord[],
  locale: Locale = "zh-CN",
): StoryProjectionRegion[] {
  const regionNames: Record<string, string> = Object.fromEntries(
    allRegions.map((r) => [r.id, r.zh]),
  );
  const regionNamesEn: Record<string, string> = Object.fromEntries(
    allRegions.map((r) => [r.id, r.en]),
  );
  const regionOrder: Record<string, number> = Object.fromEntries(
    allRegions.map((r) => [r.id, r.order]),
  );
  const rows = records
    .filter((record) => {
      if (record.locale !== locale || !record.quest) return false;
      const payload = record.quest;
      if (payload.visibility !== "public") return false;
      if (payload.mainQuestId === "5003" || String(payload.mainQuestId) === "5003") return false;
      const title = record.title ?? payload.displayTitle ?? payload.questKey;
      if (
        isForbiddenStoryTitle(title) ||
        isForbiddenStoryTitle(payload.displayTitle) ||
        isForbiddenStoryTitle(payload.chapterTitle) ||
        isForbiddenStoryTitle(payload.storyFamilyTitle) ||
        isForbiddenStoryTitle(payload.seriesTitle) ||
        isForbiddenStoryTitle(payload.storyProjection?.chapterTitle) ||
        isForbiddenStoryTitle(payload.storyProjection?.familyTitle)
      ) {
        return false;
      }
      return true;
    })
    .map((record) => {
      const payload = record.quest!;
      const projection = payload.storyProjection;
      const regionId = projection?.regionId ?? String(payload.regionId ?? "other");
      const familyId = projection?.familyId ?? payload.storyFamilyId;
      const familyTitle = projection?.familyTitle ?? payload.storyFamilyTitle;
      const title = record.title ?? payload.displayTitle ?? payload.questKey;
      const entryType =
        projection?.entryType ?? (payload.contentRole === "aggregate" ? "collection" : "quest");
      return {
        questId: payload.mainQuestId.toString(),
        title,
        order: payload.topology?.storyOrder ?? payload.order ?? 0,
        orderConfidence: payload.topology?.orderConfidence ?? "medium",
        taskRegionId: projection?.taskRegionId ?? String(payload.regionId ?? "other"),
        questType: payload.questType,
        completeness: payload.completeness,
        entryType,
        chapterId: projection?.chapterId,
        chapterTitle: projection?.chapterTitle,
        chapterOrder: projection?.chapterOrder,
        familyId,
        familyTitle,
        familyOrder: projection?.familyOrder ?? payload.storyFamilyOrder,
        familyProvenance: payload.storyFamilyProvenance,
        subseriesId: projection?.subseriesId,
        subseriesTitle: projection?.subseriesTitle,
        subseriesOrder: projection?.subseriesOrder,
        regionId,
        regionTitle:
          projection?.regionTitle ??
          payload.regionName ??
          (locale === "en" ? regionNamesEn[regionId] : regionNames[regionId]) ??
          regionId,
        regionOrder: regionOrder[regionId] ?? 99,
        contentRole: payload.contentRole ?? "unknown",
        dialogueResolutionStatus: payload.dialogueResolutionStatus ?? "not_applicable",
        qualityCode: payload.qualityCode,
        bodyAvailability:
          payload.dialogueNodes.length > 0
            ? "dialogue"
            : payload.subquests.some((subquest) => Boolean(subquest.objective))
              ? "objective_only"
              : "none",
        parentQuestId: projection?.parentQuestId,
        aggregateChildQuestIds: projection?.aggregateChildQuestIds,
      };
    });
  const regionInfo = new Map(
    allRegions.map((region) => [
      region.id,
      { title: locale === "en" ? region.en : region.zh, order: region.order },
    ]),
  );
  const membersByFamily = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.familyId) continue;
    const members = membersByFamily.get(row.familyId) ?? [];
    members.push(row);
    membersByFamily.set(row.familyId, members);
  }
  // A source series ID can span physical task regions. When its localized
  // family name is stable, anchor the catalog entry to the earliest supported
  // task region while preserving each task's actual region separately.
  for (const members of membersByFamily.values()) {
    const taskRegions = new Set(members.map((row) => row.taskRegionId).filter(Boolean));
    if (taskRegions.size < 2) continue;
    const titles = new Set(members.map((row) => row.familyTitle).filter(Boolean));
    const isCurated = members.every((row) => row.familyProvenance === "curated");
    if (!isCurated && titles.size !== 1) continue;
    const firstSupported = [...members]
      .filter((row) => row.orderConfidence !== "low")
      .sort(
        (left, right) => left.order - right.order || left.questId.localeCompare(right.questId),
      )[0];
    if (!firstSupported) continue;
    const primaryRegionId = firstSupported.taskRegionId;
    const primaryRegion = regionInfo.get(primaryRegionId);
    if (!primaryRegion) continue;
    for (const row of members) {
      row.regionId = primaryRegionId;
      row.regionTitle = primaryRegion.title;
      row.regionOrder = primaryRegion.order;
    }
  }

  // Unify family IDs for same-title families in the same region
  const canonicalFamilyIdByRegionAndTitle = new Map<string, string>();
  for (const row of rows) {
    if (!row.familyId || !row.familyTitle) continue;
    const key = `${row.regionId}\u0000${row.familyTitle}`;
    if (!canonicalFamilyIdByRegionAndTitle.has(key)) {
      canonicalFamilyIdByRegionAndTitle.set(key, row.familyId);
    } else {
      row.familyId = canonicalFamilyIdByRegionAndTitle.get(key)!;
    }
  }
  const duplicateCounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.regionId}|${row.familyId ?? "direct"}|${row.subseriesId ?? ""}|${row.chapterId ?? ""}|${row.title}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  const familyGroups = new Map<
    string,
    { regionId: string; familyId: string; explicitOrders: number[]; firstStoryOrder: number }
  >();
  for (const row of rows) {
    if (!row.familyId) continue;
    const key = `${row.regionId}\u0000${row.familyId}`;
    const group = familyGroups.get(key) ?? {
      regionId: row.regionId,
      familyId: row.familyId,
      explicitOrders: [],
      firstStoryOrder: Number.POSITIVE_INFINITY,
    };
    if (typeof row.familyOrder === "number") group.explicitOrders.push(row.familyOrder);
    group.firstStoryOrder = Math.min(group.firstStoryOrder, row.order);
    familyGroups.set(key, group);
  }
  const familyOrderByKey = new Map<string, number>();
  const familyRegions = new Map<
    string,
    typeof familyGroups extends Map<string, infer V> ? V[] : never
  >();
  for (const group of familyGroups.values()) {
    const groups = familyRegions.get(group.regionId) ?? [];
    groups.push(group);
    familyRegions.set(group.regionId, groups);
  }
  for (const groups of familyRegions.values()) {
    const sorted = [...groups].sort((left, right) => {
      const leftExplicit = left.explicitOrders.length
        ? Math.min(...left.explicitOrders)
        : undefined;
      const rightExplicit = right.explicitOrders.length
        ? Math.min(...right.explicitOrders)
        : undefined;
      if (leftExplicit !== undefined && rightExplicit !== undefined) {
        if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
      } else if (leftExplicit !== undefined) {
        return -1;
      } else if (rightExplicit !== undefined) {
        return 1;
      }
      return (
        left.firstStoryOrder - right.firstStoryOrder || left.familyId.localeCompare(right.familyId)
      );
    });
    sorted.forEach((group, index) => {
      const explicit = group.explicitOrders.length ? Math.min(...group.explicitOrders) : undefined;
      familyOrderByKey.set(
        `${group.regionId}\u0000${group.familyId}`,
        explicit ?? (index + 1) * 100,
      );
    });
  }

  const chapterGroups = new Map<
    string,
    { explicitOrders: number[]; firstStoryOrder: number; chapterId: string }
  >();
  for (const row of rows) {
    if (!row.familyId || !row.chapterId) continue;
    const key = `${row.regionId}\u0000${row.familyId}\u0000${row.subseriesId ?? ""}\u0000${row.chapterId}`;
    const group = chapterGroups.get(key) ?? {
      explicitOrders: [],
      firstStoryOrder: Number.POSITIVE_INFINITY,
      chapterId: row.chapterId,
    };
    if (typeof row.chapterOrder === "number") group.explicitOrders.push(row.chapterOrder);
    group.firstStoryOrder = Math.min(group.firstStoryOrder, row.order);
    chapterGroups.set(key, group);
  }
  const chapterOrderByKey = new Map<string, number>();
  const chapterContainers = new Map<
    string,
    Array<[string, typeof chapterGroups extends Map<string, infer V> ? V : never]>
  >();
  for (const [key, group] of chapterGroups) {
    const parentKey = key.split("\u0000").slice(0, 3).join("\u0000");
    const groups = chapterContainers.get(parentKey) ?? [];
    groups.push([key, group]);
    chapterContainers.set(parentKey, groups);
  }
  for (const groups of chapterContainers.values()) {
    const sorted = [...groups].sort(([, left], [, right]) => {
      const leftExplicit = left.explicitOrders.length
        ? Math.min(...left.explicitOrders)
        : undefined;
      const rightExplicit = right.explicitOrders.length
        ? Math.min(...right.explicitOrders)
        : undefined;
      if (leftExplicit !== undefined && rightExplicit !== undefined) {
        if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
      } else if (leftExplicit !== undefined) {
        return -1;
      } else if (rightExplicit !== undefined) {
        return 1;
      }
      return (
        left.firstStoryOrder - right.firstStoryOrder ||
        left.chapterId.localeCompare(right.chapterId)
      );
    });
    sorted.forEach(([key, group], index) => {
      const explicit = group.explicitOrders.length ? Math.min(...group.explicitOrders) : undefined;
      chapterOrderByKey.set(key, explicit ?? (index + 1) * 100);
    });
  }

  const projectionRows = rows.map((row) => {
    const familyKey = row.familyId ? `${row.regionId}\u0000${row.familyId}` : undefined;
    const chapterKey =
      row.familyId && row.chapterId
        ? `${row.regionId}\u0000${row.familyId}\u0000${row.subseriesId ?? ""}\u0000${row.chapterId}`
        : undefined;
    return {
      ...row,
      familyOrder: row.familyOrder ?? (familyKey ? familyOrderByKey.get(familyKey) : undefined),
      chapterOrder:
        row.chapterOrder ?? (chapterKey ? chapterOrderByKey.get(chapterKey) : undefined),
      displayTitle:
        (duplicateCounts.get(
          `${row.regionId}|${row.familyId ?? "direct"}|${row.subseriesId ?? ""}|${row.chapterId ?? ""}|${row.title}`,
        ) ?? 0) > 1
          ? `${row.title}（${row.questId}）`
          : undefined,
    };
  });
  return projectStoryCatalog(projectionRows);
}

function applyStoryProjectionDisplayTitles(
  records: NormalizedRecord[],
  projection: StoryProjectionRegion[],
): void {
  const projectedEntries = new Map<
    string,
    StoryProjectionRegion["families"][number]["quests"][number]
  >();
  const visitEntries = (entries: StoryProjectionRegion["families"][number]["quests"]): void => {
    for (const entry of entries ?? []) {
      projectedEntries.set(entry.questId, entry);
    }
  };
  for (const region of projection) {
    visitEntries(region.quests);
    visitEntries(region.collections);
    for (const family of region.families) {
      visitEntries(family.quests);
      visitEntries(family.collections);
      for (const chapter of family.chapters) {
        visitEntries(chapter.quests);
        visitEntries(chapter.collections);
      }
      for (const subseries of family.subseries ?? []) {
        visitEntries(subseries.quests);
        visitEntries(subseries.collections);
        for (const chapter of subseries.chapters) {
          visitEntries(chapter.quests);
          visitEntries(chapter.collections);
        }
      }
    }
  }
  for (const record of records) {
    const payload = record.quest;
    if (!payload) continue;
    const projected = projectedEntries.get(String(payload.mainQuestId));
    if (!projected) continue;
    const displayTitle = projected.displayTitle;
    if (displayTitle) payload.displayTitle = displayTitle;
    if (payload.storyProjection) {
      payload.storyProjection.displayTitle = displayTitle;
      payload.storyProjection.familyOrder = projected.familyOrder;
      payload.storyProjection.chapterOrder = projected.chapterOrder;
      payload.storyProjection.regionId = projected.regionId;
      payload.storyProjection.regionTitle = projected.regionTitle;
      payload.storyProjection.taskRegionId = projected.taskRegionId;
    }
    payload.storyFamilyOrder = projected.familyOrder;
    payload.chapterOrder = projected.chapterOrder;
    const metadata = record.metadata as Record<string, unknown>;
    const storedProjection = metadata.storyProjection;
    if (storedProjection && typeof storedProjection === "object") {
      Object.assign(storedProjection as Record<string, unknown>, {
        displayTitle,
        familyOrder: projected.familyOrder,
        chapterOrder: projected.chapterOrder,
        regionId: projected.regionId,
        regionTitle: projected.regionTitle,
        taskRegionId: projected.taskRegionId,
      });
    }
  }
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
    // Both locale projections have consumed the normalized source graph.
    // Release it before moving to the next main quest; audit provenance stays
    // in resolvedTalksByMainId and the final records retain their own nodes.
    inputs.resolvedTalkRowsByMainId.delete(mainId);
    inputs.resolvedTalkDialogRowsByMainId.delete(mainId);
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
  const storyProjection = buildStoryProjection(records);
  applyStoryProjectionDisplayTitles(records, storyProjection);
  // Store the complete converter-produced tree once per locale. The read model
  // can filter this immutable projection without reconstructing family,
  // subseries, or chapter membership from individual document metadata.
  for (const locale of locales) {
    const anchor = records.find((record) => record.locale === locale && record.quest);
    if (!anchor) continue;
    (anchor.metadata as Record<string, unknown>).storyCatalogProjection = {
      schemaVersion: 3,
      regions: buildStoryProjection(records, locale),
    };
  }
  failures.push(
    ...inputs.codexQuestFailures.map((failure) => ({
      sourceKey: failure.relativePath,
      reason: `codex_quest_file_unreadable:${failure.reason}`,
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
                (node) =>
                  node.speakerKey &&
                  !node.speakerName &&
                  node.metadata?.speakerNameResolution !== "intentionally_nameless",
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
      schemaVersion: 3,
      storyProjectionSchemaVersion: 3,
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
      storyProjection,
    },
    storyProjection,
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
