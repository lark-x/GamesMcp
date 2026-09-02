import type { AnimeContext } from "../context.js";
import type {
  AnimeTextExtractor,
  ExtractionFailure,
  ExtractionResult,
  ExtractionWarning,
} from "../extractor.js";
import { idValue, stableStringify } from "../helpers.js";
import { buildManifest, type ExtractorManifest } from "../manifest.js";
import { loadSourceJson, type SourceFile } from "../source-files.js";

export const ITEM_TEXT_EXTRACTOR_ID = "anime-game-data-item-text";
export const ITEM_TEXT_EXTRACTOR_VERSION = "1.0.0";

export const ITEM_TEXT_INPUTS = {
  material: "ExcelBinOutput/MaterialExcelConfigData.json",
  materialCodex: "ExcelBinOutput/MaterialCodexExcelConfigData.json",
} as const;

export const ITEM_TEXT_REQUIRED_INPUTS = [
  ITEM_TEXT_INPUTS.material,
  ITEM_TEXT_INPUTS.materialCodex,
] as const;

export const ITEM_TEXT_TYPES = [
  "material",
  "quest_item",
  "weapon",
  "artifact",
  "food",
  "gadget",
  "furnishing",
  "currency",
  "special_item",
  "book_item",
  "other",
] as const;

export type ItemTextItemType = (typeof ITEM_TEXT_TYPES)[number];
export type ItemType = ItemTextItemType;

/**
 * The pinned Material source exposes only ITEM_MATERIAL and ITEM_VIRTUAL.
 * The remaining canonical item classes are reserved for their dedicated
 * upstream tables and are deliberately not inferred from materialType.
 */
export const ITEM_TYPE_MAPPING: Readonly<Record<string, ItemTextItemType>> = {
  ITEM_MATERIAL: "material",
  ITEM_VIRTUAL: "currency",
};

export type ItemTextResolution = {
  method: "textmap" | "unresolved";
  locale: string | null;
  resolved: boolean;
};

export type ItemTextSegment = {
  segmentStableId: string;
  headingPath: string[];
  body: string;
  order: number;
};

export type ItemTextRecord = {
  stableId: string;
  upstreamId: string;
  itemType: ItemTextItemType;
  name: string | null;
  description: string | null;
  specialDescription: string | null;
  storyText: string | null;
  rarity: number | null;
  textResolution: ItemTextResolution;
  segments?: ItemTextSegment[];
};

export type ItemTextExtractionResult = ExtractionResult<ItemTextRecord> & {
  manifest: ExtractorManifest;
};

type JsonObject = Record<string, unknown>;

type TextAttempt = {
  value: string | null;
  locale: string | null;
  resolved: boolean;
};

type ParagraphRange = { start: number; end: number };

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

/** Accept both array fixtures and keyed JSON object dumps. */
function rows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map((item) => asObject(item) ?? {});
  const object = asObject(value);
  return object ? Object.values(object).map((item) => asObject(item) ?? {}) : [];
}

function safeInteger(value: unknown): number | undefined {
  const number = idValue(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function idText(value: unknown): string | undefined {
  const id = safeInteger(value);
  return id === undefined ? undefined : String(id);
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareRows(left: JsonObject, right: JsonObject): number {
  return (
    compareOptionalNumbers(safeInteger(left.id), safeInteger(right.id)) ||
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

function compareCodexRows(left: JsonObject, right: JsonObject): number {
  const leftDisuse = left.isDisuse === true ? 1 : 0;
  const rightDisuse = right.isDisuse === true ? 1 : 0;
  return (
    leftDisuse - rightDisuse ||
    compareOptionalNumbers(optionalNumber(left.sortOrder), optionalNumber(right.sortOrder)) ||
    compareOptionalNumbers(safeInteger(left.id), safeInteger(right.id)) ||
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

function resolveText(ctx: AnimeContext, row: JsonObject, keys: string[]): TextAttempt {
  for (const key of keys) {
    const hash = idValue(row[key]);
    if (hash === undefined) continue;
    const resolved = ctx.textResolver.resolveWithFallback(hash);
    if (resolved.resolved && resolved.value) {
      return {
        value: resolved.value,
        locale: resolved.locale,
        resolved: true,
      };
    }
  }
  return { value: null, locale: null, resolved: false };
}

function mapItemType(value: unknown): {
  itemType: ItemTextItemType;
  upstreamValue: string | null;
  known: boolean;
} {
  const upstreamValue = typeof value === "string" && value.trim() ? value.trim() : null;
  const mapped = upstreamValue ? ITEM_TYPE_MAPPING[upstreamValue] : undefined;
  return {
    itemType: mapped ?? "other",
    upstreamValue,
    known: mapped !== undefined,
  };
}

function paragraphRanges(body: string): ParagraphRange[] {
  const result: ParagraphRange[] = [];
  const paragraphPattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const match of body.matchAll(paragraphPattern)) {
    const value = match[0];
    if (!value || match.index === undefined) continue;
    const start = match.index + value.search(/\S/);
    const end = match.index + value.trimEnd().length;
    if (start < end) result.push({ start, end });
  }
  return result;
}

/** Split only at paragraph boundaries; an oversized paragraph remains intact. */
export function segmentItemStoryText(
  stableId: string,
  name: string | null,
  storyText: string,
): ItemTextSegment[] {
  const paragraphs = paragraphRanges(storyText);
  if (!paragraphs.length) return [];

  const groups: ParagraphRange[] = [];
  let current = paragraphs[0];
  if (!current) return [];
  for (const paragraph of paragraphs.slice(1)) {
    if (paragraph.end - current.start <= 2_000) {
      current = { start: current.start, end: paragraph.end };
    } else {
      groups.push(current);
      current = paragraph;
    }
  }
  groups.push(current);

  const heading = name ?? stableId;
  return groups.map((range, order) => ({
    segmentStableId: `${stableId}/segment/${order + 1}`,
    headingPath:
      groups.length > 1 ? [heading, "故事文本", `段落组 ${order + 1}`] : [heading, "故事文本"],
    body: storyText.slice(range.start, range.end).trim(),
    order,
  }));
}

function inputHashesFor(
  sources: Array<Pick<SourceFile<unknown>, "relativePath" | "fileHash">>,
): Record<string, string> {
  return Object.fromEntries(
    sources
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((source) => [source.relativePath, source.fileHash]),
  );
}

function increment(fieldCoverage: Record<string, number>, field: string): void {
  fieldCoverage[field] = (fieldCoverage[field] ?? 0) + 1;
}

function warning(
  warnings: ExtractionWarning[],
  code: string,
  message: string,
  upstreamId: string,
): void {
  warnings.push({ code, message, upstreamId });
}

function storyResolution(
  ctx: AnimeContext,
  material: JsonObject,
  codex: JsonObject | undefined,
): TextAttempt {
  if (codex) {
    return resolveText(ctx, codex, ["storyTextTextMapHash", "storyTextMapHash", "descTextMapHash"]);
  }
  return resolveText(ctx, material, ["storyTextTextMapHash", "storyTextMapHash"]);
}

function textResolutionFor(attempts: TextAttempt[]): ItemTextResolution {
  const firstLocale = attempts.find((attempt) => attempt.locale)?.locale ?? null;
  const hasResolvedText = attempts.some((attempt) => attempt.resolved);
  const name = attempts[0];
  const description = attempts[1];
  return {
    method: hasResolvedText ? "textmap" : "unresolved",
    locale: firstLocale,
    // Special/story text are optional enrichments. Their absence must not
    // make an otherwise complete name + description resolution incomplete.
    resolved: Boolean(name?.resolved && description?.resolved),
  };
}

export class ItemTextExtractor implements AnimeTextExtractor<ItemTextRecord> {
  readonly id = ITEM_TEXT_EXTRACTOR_ID;
  readonly version = ITEM_TEXT_EXTRACTOR_VERSION;
  readonly requiredInputs = [...ITEM_TEXT_REQUIRED_INPUTS];

  async extract(ctx: AnimeContext): Promise<ItemTextExtractionResult> {
    const materialSource = await loadSourceJson<unknown>(ctx, ITEM_TEXT_INPUTS.material);
    const codexSource = await loadSourceJson<unknown>(ctx, ITEM_TEXT_INPUTS.materialCodex);
    const materialRows = rows(materialSource.value).sort(compareRows);
    const codexRows = rows(codexSource.value);
    const codexByMaterial = new Map<number, JsonObject[]>();
    let codexRowsMissingMaterialId = 0;

    for (const codex of codexRows) {
      const materialId = safeInteger(codex.materialId);
      if (materialId === undefined) {
        codexRowsMissingMaterialId += 1;
        continue;
      }
      const related = codexByMaterial.get(materialId) ?? [];
      related.push(codex);
      codexByMaterial.set(materialId, related);
    }

    const warnings: ExtractionWarning[] = [];
    const failures: ExtractionFailure[] = [];
    const records: ItemTextRecord[] = [];
    const seenStableIds = new Set<string>();
    const fieldCoverage: Record<string, number> = {
      missingIds: 0,
      duplicateIds: 0,
      missingName: 0,
      missingDescription: 0,
      missingSpecialDescription: 0,
      missingStoryText: 0,
      missingRarity: 0,
      unknownItemType: 0,
      unresolvedText: 0,
    };
    const itemTypeStats: Record<string, number> = Object.fromEntries(
      ITEM_TEXT_TYPES.map((itemType) => [`itemType.${itemType}`, 0]),
    );
    let duplicateMaterialRows = 0;
    let segmentedRecords = 0;
    let nameResolved = 0;
    let descriptionResolved = 0;
    let specialDescriptionResolved = 0;
    let storyTextResolved = 0;
    let codexRowsLinked = 0;

    for (const material of materialRows) {
      const upstreamId = idText(material.id) ?? "unknown";
      const mappedType = mapItemType(material.itemType);
      itemTypeStats[`itemType.${mappedType.itemType}`] =
        (itemTypeStats[`itemType.${mappedType.itemType}`] ?? 0) + 1;
      if (!mappedType.known) {
        increment(fieldCoverage, "unknownItemType");
        warning(
          warnings,
          "unknown_item_type",
          `Unknown MaterialExcelConfigData itemType ${mappedType.upstreamValue ?? "<missing>"}; mapped to other.`,
          upstreamId,
        );
      }

      const numericId = safeInteger(material.id);
      if (numericId === undefined) {
        increment(fieldCoverage, "missingIds");
        failures.push({
          code: "upstream_id_missing",
          message: "Material row has no safe integer id.",
          upstreamId,
        });
        continue;
      }

      const stableId = `item/${numericId}`;
      if (seenStableIds.has(stableId)) {
        duplicateMaterialRows += 1;
        increment(fieldCoverage, "duplicateIds");
        failures.push({
          code: "duplicate_item_id",
          message: `Material row duplicates item stable ID ${stableId}.`,
          upstreamId,
        });
        continue;
      }
      seenStableIds.add(stableId);

      const codexCandidates = [...(codexByMaterial.get(numericId) ?? [])].sort(compareCodexRows);
      const codex = codexCandidates[0];
      if (codexCandidates.length) codexRowsLinked += codexCandidates.length;

      const nameResolution = resolveText(ctx, material, ["nameTextMapHash"]);
      const descriptionResolution = resolveText(ctx, material, [
        "descriptionTextMapHash",
        "descTextMapHash",
      ]);
      const specialDescriptionResolution = resolveText(ctx, material, [
        "specialDescriptionTextMapHash",
        "specialDescTextMapHash",
      ]);
      const storyTextResolution = storyResolution(ctx, material, codex);
      const rarity = optionalNumber(material.rankLevel) ?? null;

      const name = nameResolution.value;
      const description = descriptionResolution.value;
      const specialDescription = specialDescriptionResolution.value;
      const storyText = storyTextResolution.value;
      const attempts = [
        nameResolution,
        descriptionResolution,
        specialDescriptionResolution,
        storyTextResolution,
      ];
      const textResolution = textResolutionFor(attempts);
      const segments =
        storyText && storyText.length > 2_000
          ? segmentItemStoryText(stableId, name, storyText)
          : undefined;
      if (segments?.length) segmentedRecords += 1;

      if (name !== null) nameResolved += 1;
      else increment(fieldCoverage, "missingName");
      if (description !== null) descriptionResolved += 1;
      else increment(fieldCoverage, "missingDescription");
      if (specialDescription !== null) specialDescriptionResolved += 1;
      else increment(fieldCoverage, "missingSpecialDescription");
      if (storyText !== null) storyTextResolved += 1;
      else increment(fieldCoverage, "missingStoryText");
      if (rarity === null) increment(fieldCoverage, "missingRarity");
      if (!textResolution.resolved) increment(fieldCoverage, "unresolvedText");

      records.push({
        stableId,
        upstreamId,
        itemType: mappedType.itemType,
        name,
        description,
        specialDescription,
        storyText,
        rarity,
        textResolution,
        ...(segments ? { segments } : {}),
      });
    }

    records.sort((left, right) => left.stableId.localeCompare(right.stableId));
    const materialIds = new Set(
      materialRows.flatMap((material) => {
        const id = safeInteger(material.id);
        return id === undefined ? [] : [id];
      }),
    );
    const codexMaterialIds = [...codexByMaterial.keys()];
    const codexRowsOrphaned = codexMaterialIds.filter((id) => !materialIds.has(id)).length;
    const duplicateCodexRows = [...codexByMaterial.values()].reduce(
      (count, related) => count + Math.max(0, related.length - 1),
      0,
    );
    const result: ExtractionResult<ItemTextRecord> = {
      extractorId: this.id,
      extractorVersion: this.version,
      records,
      warnings,
      failures,
      coverage: {
        discovered: materialRows.length,
        converted: records.length,
        failed: failures.length,
        coverage: materialRows.length ? records.length / materialRows.length : 1,
      },
      fieldCoverage,
      inputHashes: inputHashesFor([materialSource, codexSource]),
      stats: {
        sourceRows: materialRows.length,
        materialRows: materialRows.length,
        codexRows: codexRows.length,
        codexMaterialIds: codexMaterialIds.length,
        codexRowsLinked,
        codexRowsOrphaned,
        codexRowsMissingMaterialId,
        duplicateCodexRows,
        duplicateMaterialRows,
        segmentedRecords,
        nameResolved,
        descriptionResolved,
        specialDescriptionResolved,
        storyTextResolved,
        ...itemTypeStats,
      },
    };
    const manifest = buildItemTextManifest(result, ctx);
    return { ...result, manifest };
  }
}

export function buildItemTextManifest(
  result: ExtractionResult<ItemTextRecord>,
  ctx: Pick<AnimeContext, "upstreamCommit" | "gameVersion" | "locale">,
): ExtractorManifest {
  return buildManifest(result, {
    upstreamCommit: ctx.upstreamCommit,
    gameVersion: ctx.gameVersion,
    locale: ctx.locale,
  });
}

export const itemTextExtractor = new ItemTextExtractor();
export const extractor = itemTextExtractor;

export async function extractItemTexts(ctx: AnimeContext): Promise<ItemTextExtractionResult> {
  return itemTextExtractor.extract(ctx);
}

export default itemTextExtractor;
