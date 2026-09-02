import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnimeContext } from "../context.js";
import type {
  AnimeTextExtractor,
  ExtractionFailure,
  ExtractionResult,
  ExtractionWarning,
} from "../extractor.js";
import { idValue } from "../helpers.js";
import { buildManifest, type ExtractorManifest } from "../manifest.js";
import { cleanUpstreamText } from "../text-resolver.js";
import { loadSourceJson, type SourceFile } from "../source-files.js";

const execFile = promisify(execFileCallback);

export const MECHANISM_EXTRACTOR_ID = "anime-game-data-mechanism";
export const MECHANISM_EXTRACTOR_VERSION = "1.0.0";

/**
 * These are text-bearing tutorial/help tables. Other Guide/Help/Tips tables
 * are inventoried in docs/game-intelligence/tutorial-source-inventory.md but
 * are configuration, trigger, or activity-specific data until their text
 * fields are verified against a complete upstream blob.
 */
export const MECHANISM_INPUTS = {
  tutorial: "ExcelBinOutput/TutorialExcelConfigData.json",
  tutorialDetail: "ExcelBinOutput/TutorialDetailExcelConfigData.json",
  tutorialCatalog: "ExcelBinOutput/TutorialCatalogExcelConfigData.json",
  guideV2: "ExcelBinOutput/GuideV2ExcelConfigData.json",
  pushTips: "ExcelBinOutput/PushTipsConfigData.json",
  pushTipsCodex: "ExcelBinOutput/PushTipsCodexExcelConfigData.json",
  loadingTips: "ExcelBinOutput/LoadingTipsExcelConfigData.json",
  gcgTutorial: "ExcelBinOutput/GCGTutorialTextExcelConfigData.json",
  activitySnowRaceTutorial: "ExcelBinOutput/ActivitySnowRaceHideTutorialExcelConfigData.json",
  alchemySimPotionTutorial: "ExcelBinOutput/AlchemySimPotionTutorialExcelConfigData.json",
  ugcTutorial: "ExcelBinOutput/UgcTutorialExcelConfigData.json",
  handbookQuestGuide: "ExcelBinOutput/HandbookQuestGuideExcelConfigData.json",
} as const;

export const MECHANISM_SOURCE_PATHS = Object.values(MECHANISM_INPUTS);

/**
 * Localization is normally only an asset-path index. It is probed as a
 * fallback for fixtures/upstream variants that carry actual title/body fields,
 * but path-only rows are never counted as mechanism records.
 */
export const MECHANISM_AUXILIARY_INPUTS = {
  localization: "ExcelBinOutput/LocalizationExcelConfigData.json",
} as const;

/** Optional at snapshot level: a sparse checkout may contain none of these files. */
export const MECHANISM_REQUIRED_INPUTS = [...MECHANISM_SOURCE_PATHS];

export type MechanismCategory =
  | "combat"
  | "elemental_reaction"
  | "exploration"
  | "enemy"
  | "boss"
  | "domain"
  | "system"
  | "crafting"
  | "cooking"
  | "fishing"
  | "housing"
  | "activity"
  | "other";

export type MechanismTextResolution = {
  method: "textmap" | "source" | "unresolved";
  locale: string | null;
  resolved: boolean;
};

export type MechanismRecord = {
  documentType: "mechanism";
  mechanismStableId: string;
  category: MechanismCategory;
  title: string;
  body: string;
  relatedEntities?: string[];
  textResolution: MechanismTextResolution;
};

export type MechanismExtractionResult = ExtractionResult<MechanismRecord> & {
  manifest: ExtractorManifest;
};

type JsonObject = Record<string, unknown>;

type SourceWithMethod = SourceFile<unknown> & {
  loadMethod: "disk" | "git-show";
};

type SourceRow = {
  row: JsonObject;
  sourcePath: string;
  sourceIndex: number;
  objectKey?: string;
};

type TextAttempt = {
  value: string | null;
  locale: string | null;
  method: "textmap" | "source" | "unresolved";
  resolved: boolean;
};

type CategoryAttempt = {
  category: MechanismCategory;
  resolved: boolean;
  conflict: boolean;
};

const TITLE_FIELDS = [
  "titleTextMapHash",
  "tutorialTitleTextMapHash",
  "guideTitleTextMapHash",
  "nameTextMapHash",
  "titleHash",
  "title",
  "tutorialTitle",
  "guideTitle",
  "name",
] as const;

const BODY_FIELDS = [
  "contentTextMapHash",
  "tutorialContentTextMapHash",
  "guideContentTextMapHash",
  "detailTextMapHash",
  "descriptionTextMapHash",
  "descTextMapHash",
  "bodyTextMapHash",
  "textTextMapHash",
  "tipsTextMapHash",
  "textMapHash",
  "body",
  "content",
  "description",
  "detail",
  "text",
  "tips",
  "guideText",
  "tutorialText",
] as const;

const ID_FIELDS = [
  "mechanismStableId",
  "stableId",
  "id",
  "tutorialId",
  "detailId",
  "guideId",
  "tipsId",
  "catalogId",
] as const;

const CATEGORY_FIELDS = [
  "category",
  "mechanismCategory",
  "tutorialCategory",
  "guideCategory",
  "mechanismType",
  "tutorialType",
  "guideType",
  "type",
] as const;

const RELATED_ENTITY_FIELDS = [
  "relatedEntities",
  "relatedEntityStableIds",
  "relatedEntityStableId",
  "relatedEntity",
] as const;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

/** Accept both array dumps and object maps keyed by an upstream ID. */
function rows(value: unknown, sourcePath: string): SourceRow[] {
  if (Array.isArray(value)) {
    return value.map((item, sourceIndex) => ({
      row: asObject(item) ?? {},
      sourcePath,
      sourceIndex,
    }));
  }
  const object = asObject(value);
  if (!object) return [];
  return Object.entries(object).map(([objectKey, item], sourceIndex) => ({
    row: asObject(item) ?? {},
    sourcePath,
    sourceIndex,
    objectKey,
  }));
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Read a source blob from the pinned checkout when it is not materialized by
 * sparse checkout. GIT_NO_LAZY_FETCH keeps a missing promisor blob honest:
 * this path never turns a local extraction into an implicit network fetch.
 */
async function loadSourceFromGitShow(
  ctx: AnimeContext,
  relativePath: string,
): Promise<SourceWithMethod | undefined> {
  try {
    await access(join(ctx.upstreamDir, ".git"));
  } catch {
    return undefined;
  }

  try {
    const result = await execFile("git", ["-C", ctx.upstreamDir, "show", `HEAD:${relativePath}`], {
      encoding: "utf8",
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      maxBuffer: 64 * 1024 * 1024,
    });
    const content = result.stdout;
    const fileHash = createHash("sha256").update(content).digest("hex");
    ctx.inputHashes[relativePath] = fileHash;
    return {
      relativePath,
      fileHash,
      value: JSON.parse(content) as unknown,
      loadMethod: "git-show",
    };
  } catch {
    return undefined;
  }
}

async function loadOptionalSource(
  ctx: AnimeContext,
  relativePath: string,
): Promise<SourceWithMethod | undefined> {
  try {
    return { ...(await loadSourceJson<unknown>(ctx, relativePath)), loadMethod: "disk" };
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return loadSourceFromGitShow(ctx, relativePath);
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function idText(value: unknown): string | undefined {
  const numeric = idValue(value);
  if (numeric !== undefined && Number.isSafeInteger(numeric)) return String(numeric);
  return text(value);
}

function firstDefined(
  row: JsonObject,
  fields: readonly string[],
): { key: string; value: unknown } | undefined {
  for (const key of fields) {
    if (row[key] !== undefined && row[key] !== null) return { key, value: row[key] };
  }
  return undefined;
}

function resolveTextValue(ctx: AnimeContext, fieldKey: string, raw: unknown): TextAttempt {
  const isHashField = fieldKey.toLowerCase().includes("hash");
  const hash = idValue(raw);
  if (hash !== undefined && (isHashField || typeof raw !== "string")) {
    const resolved = ctx.textResolver.resolveWithFallback(hash);
    return {
      value: resolved.resolved && resolved.value ? resolved.value : null,
      locale: resolved.locale,
      method: resolved.resolved && resolved.value ? "textmap" : "unresolved",
      resolved: resolved.resolved && Boolean(resolved.value),
    };
  }
  if (typeof raw === "string" && !isHashField) {
    const value = cleanUpstreamText(raw);
    return {
      value: value || null,
      locale: ctx.locale,
      method: value ? "source" : "unresolved",
      resolved: Boolean(value),
    };
  }
  return { value: null, locale: null, method: "unresolved", resolved: false };
}

function resolveText(ctx: AnimeContext, row: JsonObject, fields: readonly string[]): TextAttempt {
  for (const field of fields) {
    const raw = row[field];
    if (raw === undefined || raw === null) continue;
    const result = resolveTextValue(ctx, field, raw);
    if (result.resolved) return result;
  }
  return { value: null, locale: null, method: "unresolved", resolved: false };
}

function hasTextPayload(source: SourceFile<unknown>): boolean {
  return rows(source.value, source.relativePath).some(({ row }) =>
    [...TITLE_FIELDS, ...BODY_FIELDS].some(
      (field) => row[field] !== undefined && row[field] !== null,
    ),
  );
}

function normalizeCategoryValue(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s./:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function categoryFromValue(value: unknown): MechanismCategory | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeCategoryValue(value);
  const compact = normalized.replace(/_/g, "");
  const direct: Record<string, MechanismCategory> = {
    combat: "combat",
    battle: "combat",
    fighting: "combat",
    elemental_reaction: "elemental_reaction",
    elementalreaction: "elemental_reaction",
    reaction: "elemental_reaction",
    exploration: "exploration",
    explore: "exploration",
    enemy: "enemy",
    monster: "enemy",
    boss: "boss",
    domain: "domain",
    dungeon: "domain",
    system: "system",
    ui: "system",
    crafting: "crafting",
    crafting_system: "crafting",
    forge: "crafting",
    cooking: "cooking",
    fishing: "fishing",
    housing: "housing",
    home: "housing",
    activity: "activity",
    event: "activity",
    other: "other",
    战斗: "combat",
    元素反应: "elemental_reaction",
    元素: "elemental_reaction",
    探索: "exploration",
    敌人: "enemy",
    怪物: "enemy",
    首领: "boss",
    秘境: "domain",
    副本: "domain",
    系统: "system",
    界面: "system",
    锻造: "crafting",
    制作: "crafting",
    烹饪: "cooking",
    钓鱼: "fishing",
    家园: "housing",
    活动: "activity",
  };
  const exact = direct[normalized] ?? direct[compact];
  if (exact) return exact;

  // Upstream enum values often carry a namespace, but the category token is
  // still explicit source metadata rather than an inference from body text.
  const tokenMatches: Array<[string, MechanismCategory]> = [
    ["elementalreaction", "elemental_reaction"],
    ["combat", "combat"],
    ["battle", "combat"],
    ["explor", "exploration"],
    ["boss", "boss"],
    ["enemy", "enemy"],
    ["monster", "enemy"],
    ["domain", "domain"],
    ["dungeon", "domain"],
    ["craft", "crafting"],
    ["forge", "crafting"],
    ["cook", "cooking"],
    ["fish", "fishing"],
    ["hous", "housing"],
    ["system", "system"],
    ["ui", "system"],
    ["activity", "activity"],
    ["event", "activity"],
  ];
  return tokenMatches.find(([token]) => compact.includes(token))?.[1];
}

function categoryValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  const object = asObject(value);
  if (!object) return [];
  return [object.category, object.type, object.value, object.name].filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
}

function classifyCategory(row: JsonObject): CategoryAttempt {
  const candidates: MechanismCategory[] = [];
  for (const field of CATEGORY_FIELDS) {
    if (row[field] === undefined || row[field] === null) continue;
    for (const value of categoryValues(row[field])) {
      const category = categoryFromValue(value);
      if (category) candidates.push(category);
    }
  }
  const unique = [...new Set(candidates)];
  if (unique.length > 1) return { category: "other", resolved: false, conflict: true };
  if (unique[0]) return { category: unique[0], resolved: true, conflict: false };
  return { category: "other", resolved: false, conflict: false };
}

/** Map an explicit source category/type value; unknown values stay `other`. */
export function mapMechanismCategory(row: JsonObject): MechanismCategory {
  return classifyCategory(row).category;
}

function stableIdFor(row: JsonObject, objectKey?: string): string | undefined {
  const explicit = text(row.mechanismStableId) ?? text(row.stableId);
  if (explicit) return explicit;
  const idField = firstDefined(row, ID_FIELDS.slice(2));
  const id = idField ? idText(idField.value) : undefined;
  if (id) return `mechanism/${id}`;
  const keyedId = text(objectKey);
  return keyedId ? `mechanism/${keyedId}` : undefined;
}

function relatedEntityStableId(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  const object = asObject(value);
  if (!object) return undefined;
  return text(object.stableId) ?? text(object.entityStableId) ?? text(object.relatedEntityStableId);
}

function relatedEntities(row: JsonObject): string[] | undefined {
  const result = new Set<string>();
  for (const field of RELATED_ENTITY_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      const stableId = relatedEntityStableId(item);
      if (stableId) result.add(stableId);
    }
  }
  if (!result.size) return undefined;
  return [...result].sort((left, right) => left.localeCompare(right));
}

function warning(
  warnings: ExtractionWarning[],
  code: string,
  message: string,
  upstreamId: string,
): void {
  warnings.push({ code, message, upstreamId });
}

function failure(
  failures: ExtractionFailure[],
  code: string,
  message: string,
  upstreamId: string,
): void {
  failures.push({ code, message, upstreamId });
}

function increment(fieldCoverage: Record<string, number>, field: string): void {
  fieldCoverage[field] = (fieldCoverage[field] ?? 0) + 1;
}

function sortedInputHashes(inputHashes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(inputHashes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sourceUpstreamId(sourceRow: SourceRow, stableId?: string): string {
  if (stableId) return stableId.replace(/^mechanism\//, "");
  if (sourceRow.objectKey) return sourceRow.objectKey;
  return `${sourceRow.sourcePath}#${sourceRow.sourceIndex}`;
}

function emptyResult(
  ctx: AnimeContext,
  warnings: ExtractionWarning[],
  inputHashes: Record<string, string> = {},
  stats: Record<string, number> = {},
): MechanismExtractionResult {
  const result: ExtractionResult<MechanismRecord> = {
    extractorId: MECHANISM_EXTRACTOR_ID,
    extractorVersion: MECHANISM_EXTRACTOR_VERSION,
    records: [],
    warnings,
    failures: [],
    coverage: { discovered: 0, converted: 0, failed: 0, coverage: 1 },
    fieldCoverage: {},
    inputHashes: sortedInputHashes(inputHashes),
    stats: { sourceRows: 0, ...stats },
  };
  return { ...result, manifest: buildMechanismManifest(result, ctx) };
}

async function extractMechanismRecords(ctx: AnimeContext): Promise<MechanismExtractionResult> {
  const sources: SourceWithMethod[] = [];
  const missingPaths: string[] = [];
  for (const relativePath of MECHANISM_SOURCE_PATHS) {
    const source = await loadOptionalSource(ctx, relativePath);
    if (source) sources.push(source);
    else missingPaths.push(relativePath);
  }

  // LocalizationExcelConfigData is an asset locator in the pinned snapshot,
  // not a text table. Only accept it when a source variant explicitly exposes
  // the same title/body fields used by the canonical tutorial tables.
  if (!sources.length) {
    const localization = await loadOptionalSource(ctx, MECHANISM_AUXILIARY_INPUTS.localization);
    if (localization && hasTextPayload(localization)) sources.push(localization);
  }

  if (!sources.length) {
    return emptyResult(
      ctx,
      [
        {
          code: "mechanism_source_missing",
          message:
            "No canonical tutorial/guide/help text source is readable in the snapshot; discovered=0 and no mechanism records were fabricated",
        },
      ],
      {},
      { sourceFilesPresent: 0, sourceFilesMissing: missingPaths.length },
    );
  }

  const sourceRows = sources.flatMap((source) => rows(source.value, source.relativePath));
  if (!sourceRows.length) {
    return emptyResult(
      ctx,
      [
        {
          code: "mechanism_source_empty",
          message:
            "Canonical tutorial/guide/help text sources are present but contain no rows; discovered=0 and no mechanism records were fabricated",
        },
      ],
      sortedInputHashes(
        Object.fromEntries(sources.map((source) => [source.relativePath, source.fileHash])),
      ),
      {
        sourceFilesPresent: sources.length,
        sourceFilesMissing: missingPaths.length,
        diskSourceFiles: sources.filter((source) => source.loadMethod === "disk").length,
        gitSourceFiles: sources.filter((source) => source.loadMethod === "git-show").length,
      },
    );
  }

  const warnings: ExtractionWarning[] = [];
  const failures: ExtractionFailure[] = [];
  const records: MechanismRecord[] = [];
  const seenStableIds = new Set<string>();
  const fieldCoverage: Record<string, number> = {
    missingIds: 0,
    missingTitle: 0,
    missingBody: 0,
    unresolvedText: 0,
    unknownCategory: 0,
    categoryConflict: 0,
    duplicateIds: 0,
  };
  const categoryCounts: Record<MechanismCategory, number> = {
    combat: 0,
    elemental_reaction: 0,
    exploration: 0,
    enemy: 0,
    boss: 0,
    domain: 0,
    system: 0,
    crafting: 0,
    cooking: 0,
    fishing: 0,
    housing: 0,
    activity: 0,
    other: 0,
  };

  for (const sourceRow of sourceRows) {
    const stableId = stableIdFor(sourceRow.row, sourceRow.objectKey);
    const upstreamId = sourceUpstreamId(sourceRow, stableId);
    if (!stableId) {
      increment(fieldCoverage, "missingIds");
      failure(
        failures,
        "upstream_id_missing",
        "Mechanism source row has no stable ID or upstream ID.",
        upstreamId,
      );
      continue;
    }
    if (seenStableIds.has(stableId)) {
      increment(fieldCoverage, "duplicateIds");
      warning(
        warnings,
        "duplicate_mechanism_id",
        `Duplicate mechanism row skipped for ${stableId}.`,
        upstreamId,
      );
      failure(
        failures,
        "duplicate_mechanism_id",
        `Mechanism source row duplicates stable ID ${stableId}.`,
        upstreamId,
      );
      continue;
    }
    seenStableIds.add(stableId);

    const title = resolveText(ctx, sourceRow.row, TITLE_FIELDS);
    if (!title.resolved || !title.value) {
      increment(fieldCoverage, "missingTitle");
      failure(
        failures,
        "title_missing",
        `Mechanism title TextMap value is unresolved for ${upstreamId}.`,
        upstreamId,
      );
      continue;
    }
    const body = resolveText(ctx, sourceRow.row, BODY_FIELDS);
    if (!body.resolved || !body.value) {
      increment(fieldCoverage, "missingBody");
      failure(
        failures,
        "body_missing",
        `Mechanism body TextMap value is unresolved for ${upstreamId}.`,
        upstreamId,
      );
      continue;
    }

    const category = classifyCategory(sourceRow.row);
    categoryCounts[category.category] += 1;
    if (!category.resolved) {
      increment(fieldCoverage, "unknownCategory");
      warning(
        warnings,
        category.conflict ? "mechanism_category_conflict" : "mechanism_category_unknown",
        category.conflict
          ? `Mechanism row has conflicting explicit category values; category=other for ${stableId}.`
          : `Mechanism row has no recognized explicit category; category=other for ${stableId}.`,
        upstreamId,
      );
      if (category.conflict) increment(fieldCoverage, "categoryConflict");
    }

    const textResolution: MechanismTextResolution = {
      method:
        title.method === "textmap" || body.method === "textmap"
          ? "textmap"
          : title.method === "source" || body.method === "source"
            ? "source"
            : "unresolved",
      locale: title.locale ?? body.locale,
      resolved: title.resolved && body.resolved,
    };
    if (!textResolution.resolved) increment(fieldCoverage, "unresolvedText");

    const related = relatedEntities(sourceRow.row);
    records.push({
      documentType: "mechanism",
      mechanismStableId: stableId,
      category: category.category,
      title: title.value,
      body: body.value,
      ...(related ? { relatedEntities: related } : {}),
      textResolution,
    });
  }

  records.sort((left, right) => left.mechanismStableId.localeCompare(right.mechanismStableId));
  const inputHashes = sortedInputHashes(
    Object.fromEntries(sources.map((source) => [source.relativePath, source.fileHash])),
  );
  const discovered = sourceRows.length;
  const converted = records.length;
  const failed = failures.length;
  const result: ExtractionResult<MechanismRecord> = {
    extractorId: MECHANISM_EXTRACTOR_ID,
    extractorVersion: MECHANISM_EXTRACTOR_VERSION,
    records,
    warnings,
    failures,
    coverage: { discovered, converted, failed, coverage: discovered ? converted / discovered : 1 },
    fieldCoverage,
    inputHashes,
    stats: {
      sourceRows: discovered,
      sourceFilesPresent: sources.length,
      sourceFilesMissing: missingPaths.length,
      diskSourceFiles: sources.filter((source) => source.loadMethod === "disk").length,
      gitSourceFiles: sources.filter((source) => source.loadMethod === "git-show").length,
      ...categoryCounts,
    },
  };
  return { ...result, manifest: buildMechanismManifest(result, ctx) };
}

export function buildMechanismManifest(
  result: ExtractionResult<MechanismRecord>,
  ctx: Pick<AnimeContext, "upstreamCommit" | "gameVersion" | "locale">,
): ExtractorManifest {
  return buildManifest(result, {
    upstreamCommit: ctx.upstreamCommit,
    gameVersion: ctx.gameVersion,
    locale: ctx.locale,
  });
}

export class MechanismExtractor implements AnimeTextExtractor<MechanismRecord> {
  readonly id = MECHANISM_EXTRACTOR_ID;
  readonly version = MECHANISM_EXTRACTOR_VERSION;
  readonly requiredInputs = [...MECHANISM_REQUIRED_INPUTS];

  async extract(ctx: AnimeContext): Promise<MechanismExtractionResult> {
    return extractMechanismRecords(ctx);
  }
}

export const mechanismExtractor = new MechanismExtractor();
export const extractor = mechanismExtractor;

export async function extractMechanisms(ctx: AnimeContext): Promise<MechanismExtractionResult> {
  return mechanismExtractor.extract(ctx);
}

export default mechanismExtractor;
