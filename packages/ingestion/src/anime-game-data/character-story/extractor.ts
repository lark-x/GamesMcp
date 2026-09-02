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

export const CHARACTER_STORY_EXTRACTOR_ID = "anime-game-data-character-story";
export const CHARACTER_STORY_EXTRACTOR_VERSION = "1.0.0";

export const CHARACTER_STORY_INPUTS = {
  textMap: "TextMap/TextMap_MediumCHS.json",
  avatar: "ExcelBinOutput/AvatarExcelConfigData.json",
  fetterInfo: "ExcelBinOutput/FetterInfoExcelConfigData.json",
  fetterStory: "ExcelBinOutput/FetterStoryExcelConfigData.json",
} as const;

export const CHARACTER_STORY_REQUIRED_INPUTS = [
  CHARACTER_STORY_INPUTS.fetterStory,
  CHARACTER_STORY_INPUTS.avatar,
  CHARACTER_STORY_INPUTS.fetterInfo,
] as const;

type JsonObject = Record<string, unknown>;

export type TextResolution = {
  method: "textmap" | "unresolved";
  locale: string | null;
  resolved: boolean;
};

export type CharacterStorySegment = {
  segmentStableId: string;
  headingPath: string[];
  body: string;
  order: number;
};

export type CharacterStoryUnlockMetadata = {
  /** The first required FETTER_COND_FETTER_LEVEL value, when present. */
  unlockFetterLevel?: number;
  /** Conditions copied from the story row without interpreting unknown types. */
  openConds?: unknown[];
  finishConds?: unknown[];
  /** Conditions copied from the matching FetterInfo row, when available. */
  infoOpenConds?: unknown[];
  infoFinishConds?: unknown[];
  /** Unknown upstream unlock fields are retained for forward compatibility. */
  [key: string]: unknown;
};

export type CharacterStoryRecord = {
  characterStableId: string;
  characterName: string;
  storyStableId: string;
  title: string;
  body: string;
  unlockMetadata: CharacterStoryUnlockMetadata;
  textResolution: TextResolution;
  segments?: CharacterStorySegment[];
};

export type CharacterStoryExtractionResult = ExtractionResult<CharacterStoryRecord> & {
  manifest: ExtractorManifest;
};

type Row = JsonObject;

function asObject(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;
}

/** Accept both the array form used by fixtures and keyed JSON object dumps. */
function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.map((item) => asObject(item) ?? {});
  const object = asObject(value);
  return object ? Object.values(object).map((item) => asObject(item) ?? {}) : [];
}

function idText(value: unknown): string | undefined {
  const id = idValue(value);
  return id !== undefined && Number.isSafeInteger(id) ? String(id) : undefined;
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareRows(left: Row, right: Row): number {
  return (
    compareOptionalNumber(idValue(left.avatarId), idValue(right.avatarId)) ||
    compareOptionalNumber(idValue(left.fetterId), idValue(right.fetterId)) ||
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, cloneJson(item)]),
    );
  }
  return value;
}

function cloneArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value.map(cloneJson) : undefined;
}

function directNumber(row: Row | undefined, keys: string[]): number | undefined {
  if (!row) return undefined;
  for (const key of keys) {
    const value = idValue(row[key]);
    if (value !== undefined && Number.isSafeInteger(value)) return value;
  }
  return undefined;
}

function conditionLevel(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const conditionValue of value) {
    const condition = asObject(conditionValue);
    if (!condition) continue;
    const type = typeof condition.condType === "string" ? condition.condType : "";
    if (!type.toUpperCase().includes("FETTER_LEVEL")) continue;
    const params = Array.isArray(condition.paramList) ? condition.paramList : [];
    for (const param of params) {
      const level = idValue(param);
      if (level !== undefined && Number.isSafeInteger(level)) return level;
    }
  }
  return undefined;
}

function firstDefined(row: Row | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function resolveText(
  ctx: AnimeContext,
  row: Row,
  keys: string[],
): { value: string; raw: string; locale: string | null } | undefined {
  for (const key of keys) {
    const hash = idValue(row[key]);
    if (hash === undefined) continue;
    const resolved = ctx.textResolver.resolveWithFallback(hash);
    if (!resolved.resolved || !resolved.value) continue;
    const raw = ctx.textResolver.tryResolve(hash).raw;
    return { value: resolved.value, raw, locale: resolved.locale };
  }
  return undefined;
}

function findAvatar(avatarRows: Row[], avatarId: number): Row | undefined {
  return avatarRows
    .filter((row) => idValue(row.id) === avatarId)
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))[0];
}

/** Prefer an exact story key, then the character-level FetterInfo row. */
function findFetterInfo(infoRows: Row[], avatarId: number, fetterId: number): Row | undefined {
  return infoRows
    .filter((row) => idValue(row.avatarId) === avatarId)
    .sort((left, right) => {
      const leftExact = idValue(left.fetterId) === fetterId ? 0 : 1;
      const rightExact = idValue(right.fetterId) === fetterId ? 0 : 1;
      return leftExact - rightExact || stableStringify(left).localeCompare(stableStringify(right));
    })[0];
}

function addUnknownUnlockFields(
  target: CharacterStoryUnlockMetadata,
  story: Row,
  info: Row | undefined,
): void {
  const keys = [
    "unlockCondition",
    "unlockConditions",
    "unlockType",
    "requiredFetterLevel",
    "unlockFetterLevel",
    "tips",
  ];
  for (const key of keys) {
    // These fields are normalized above; do not overwrite a numeric level
    // with an upstream string representation.
    if (key === "unlockFetterLevel") continue;
    const value = firstDefined(story, [key]) ?? firstDefined(info, [key]);
    if (value !== undefined) target[key] = cloneJson(value);
  }
}

function unlockMetadata(story: Row, info: Row | undefined): CharacterStoryUnlockMetadata {
  const metadata: CharacterStoryUnlockMetadata = {};
  const openConds = cloneArray(story.openConds);
  const finishConds = cloneArray(story.finishConds);
  const infoOpenConds = cloneArray(info?.openConds);
  const infoFinishConds = cloneArray(info?.finishConds);
  if (openConds) metadata.openConds = openConds;
  if (finishConds) metadata.finishConds = finishConds;
  if (infoOpenConds) metadata.infoOpenConds = infoOpenConds;
  if (infoFinishConds) metadata.infoFinishConds = infoFinishConds;

  const level =
    directNumber(story, ["unlockFetterLevel", "requiredFetterLevel", "fetterLevel"]) ??
    directNumber(info, ["unlockFetterLevel", "requiredFetterLevel", "fetterLevel"]) ??
    conditionLevel(story.openConds) ??
    conditionLevel(info?.openConds);
  if (level !== undefined) metadata.unlockFetterLevel = level;
  addUnknownUnlockFields(metadata, story, info);
  return metadata;
}

function incrementCoverage(fieldCoverage: Record<string, number>, field: string): void {
  fieldCoverage[field] = (fieldCoverage[field] ?? 0) + 1;
}

type ParagraphRange = { start: number; end: number };

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

/**
 * Split long stories only at paragraph boundaries. A single oversized
 * paragraph remains intact because character offsets and source text are more
 * useful than an arbitrary character cut.
 */
export function segmentCharacterStoryBody(
  storyStableId: string,
  characterName: string,
  title: string,
  body: string,
): CharacterStorySegment[] {
  const paragraphs = paragraphRanges(body);
  if (!paragraphs.length) return [];

  const groups: ParagraphRange[] = [];
  let current = paragraphs[0];
  for (const paragraph of paragraphs.slice(1)) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (paragraph.end - current.start <= 2_000) {
      current = { start: current.start, end: paragraph.end };
    } else {
      groups.push(current);
      current = paragraph;
    }
  }
  if (current) groups.push(current);

  return groups.map((range, order) => ({
    segmentStableId: `${storyStableId}/segment/${order + 1}`,
    headingPath:
      groups.length > 1 ? [characterName, title, `段落组 ${order + 1}`] : [characterName, title],
    body: body.slice(range.start, range.end).trim(),
    order,
  }));
}

export class CharacterStoryExtractor implements AnimeTextExtractor<CharacterStoryRecord> {
  readonly id = CHARACTER_STORY_EXTRACTOR_ID;
  readonly version = CHARACTER_STORY_EXTRACTOR_VERSION;
  readonly requiredInputs = [...CHARACTER_STORY_REQUIRED_INPUTS];

  async extract(ctx: AnimeContext): Promise<CharacterStoryExtractionResult> {
    const storySource = await loadSourceJson<unknown>(ctx, CHARACTER_STORY_INPUTS.fetterStory);
    const avatarSource = await loadSourceJson<unknown>(ctx, CHARACTER_STORY_INPUTS.avatar);
    const infoSource = await loadSourceJson<unknown>(ctx, CHARACTER_STORY_INPUTS.fetterInfo);

    const storyRows = rows(storySource.value).sort(compareRows);
    const avatarRows = rows(avatarSource.value);
    const infoRows = rows(infoSource.value);
    const warnings: ExtractionWarning[] = [];
    const failures: ExtractionFailure[] = [];
    const records: CharacterStoryRecord[] = [];
    const seenStoryIds = new Set<string>();
    const fieldCoverage: Record<string, number> = {
      missingIds: 0,
      missingCharacter: 0,
      missingCharacterName: 0,
      missingTitle: 0,
      missingBody: 0,
      replacementCharacter: 0,
    };
    let duplicateRows = 0;
    let segmentedRecords = 0;

    for (const story of storyRows) {
      const avatarId = idValue(story.avatarId);
      const fetterId = idValue(story.fetterId);
      const upstreamId = `${idText(story.avatarId) ?? "unknown"}:${idText(story.fetterId) ?? "unknown"}`;
      if (
        avatarId === undefined ||
        fetterId === undefined ||
        !Number.isSafeInteger(avatarId) ||
        !Number.isSafeInteger(fetterId)
      ) {
        incrementCoverage(fieldCoverage, "missingIds");
        failures.push({
          code: "upstream_id_missing",
          message: "Character story row has no safe integer avatarId/fetterId",
          upstreamId,
        });
        continue;
      }

      const characterStableId = `char/${avatarId}`;
      const storyStableId = `${characterStableId}/story/${fetterId}`;
      if (seenStoryIds.has(storyStableId)) {
        duplicateRows += 1;
        warnings.push({
          code: "duplicate_story_id",
          message: `Duplicate character story row skipped for ${storyStableId}`,
          upstreamId,
        });
        failures.push({
          code: "duplicate_story_id",
          message: `Character story row duplicates story ID ${storyStableId}`,
          upstreamId,
        });
        continue;
      }
      seenStoryIds.add(storyStableId);

      const avatar = findAvatar(avatarRows, avatarId);
      if (!avatar) {
        incrementCoverage(fieldCoverage, "missingCharacter");
        failures.push({
          code: "character_missing",
          message: `No AvatarExcelConfigData row for avatar ${avatarId}`,
          upstreamId,
        });
        continue;
      }
      const characterName = resolveText(ctx, avatar, ["nameTextMapHash"]);
      if (!characterName) {
        incrementCoverage(fieldCoverage, "missingCharacterName");
        failures.push({
          code: "character_name_missing",
          message: `Character name TextMap value is unresolved for avatar ${avatarId}`,
          upstreamId,
        });
        continue;
      }

      const title = resolveText(ctx, story, ["storyTitleTextMapHash", "storyTitle2TextMapHash"]);
      if (!title) {
        incrementCoverage(fieldCoverage, "missingTitle");
        failures.push({
          code: "title_missing",
          message: `Character story title TextMap value is unresolved for ${upstreamId}`,
          upstreamId,
        });
        continue;
      }
      const body = resolveText(ctx, story, ["storyContextTextMapHash", "storyContext2TextMapHash"]);
      if (!body) {
        incrementCoverage(fieldCoverage, "missingBody");
        failures.push({
          code: "body_missing",
          message: `Character story body TextMap value is unresolved for ${upstreamId}`,
          upstreamId,
        });
        continue;
      }

      if ([characterName.raw, title.raw, body.raw].some((value) => value.includes("\uFFFD"))) {
        incrementCoverage(fieldCoverage, "replacementCharacter");
        failures.push({
          code: "replacement_character",
          message: `Character story contains a Unicode replacement character for ${upstreamId}`,
          upstreamId,
        });
        continue;
      }

      const info = findFetterInfo(infoRows, avatarId, fetterId);
      if (!info) {
        warnings.push({
          code: "fetter_info_missing",
          message: `No FetterInfoExcelConfigData row found for avatar ${avatarId}`,
          upstreamId,
        });
      }
      const segments =
        body.value.length > 2_000
          ? segmentCharacterStoryBody(storyStableId, characterName.value, title.value, body.value)
          : undefined;
      if (segments?.length) segmentedRecords += 1;

      records.push({
        characterStableId,
        characterName: characterName.value,
        storyStableId,
        title: title.value,
        body: body.value,
        unlockMetadata: unlockMetadata(story, info),
        textResolution: {
          method: "textmap",
          locale: title.locale ?? body.locale ?? characterName.locale ?? ctx.locale,
          resolved: true,
        },
        ...(segments ? { segments } : {}),
      });
    }

    records.sort((left, right) => left.storyStableId.localeCompare(right.storyStableId));
    const inputHashes = inputHashesFor([storySource, avatarSource, infoSource]);
    const result: ExtractionResult<CharacterStoryRecord> = {
      extractorId: this.id,
      extractorVersion: this.version,
      records,
      warnings,
      failures,
      coverage: {
        discovered: storyRows.length,
        converted: records.length,
        failed: failures.length,
        coverage: storyRows.length ? records.length / storyRows.length : 1,
      },
      fieldCoverage,
      inputHashes,
      stats: {
        sourceRows: storyRows.length,
        duplicateRows,
        segmentedRecords,
        avatarRows: avatarRows.length,
        fetterInfoRows: infoRows.length,
      },
    };
    const manifest = buildCharacterStoryManifest(result, ctx);
    return { ...result, manifest };
  }
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

export function buildCharacterStoryManifest(
  result: ExtractionResult<CharacterStoryRecord>,
  ctx: Pick<AnimeContext, "upstreamCommit" | "gameVersion" | "locale">,
): ExtractorManifest {
  return buildManifest(result, {
    upstreamCommit: ctx.upstreamCommit,
    gameVersion: ctx.gameVersion,
    locale: ctx.locale,
  });
}

export const characterStoryExtractor = new CharacterStoryExtractor();
export const extractor = characterStoryExtractor;

export async function extractCharacterStories(
  ctx: AnimeContext,
): Promise<CharacterStoryExtractionResult> {
  return characterStoryExtractor.extract(ctx);
}

export default characterStoryExtractor;
