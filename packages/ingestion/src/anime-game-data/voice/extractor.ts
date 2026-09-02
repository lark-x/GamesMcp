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

export const VOICE_EXTRACTOR_ID = "anime-game-data-voice";
export const VOICE_EXTRACTOR_VERSION = "1.0.0";

export const VOICE_INPUTS = {
  textMap: "TextMap/TextMap_MediumCHS.json",
  avatarVoice: "ExcelBinOutput/AvatarVoiceExcelConfigData.json",
} as const;

export const VOICE_REQUIRED_INPUTS = [VOICE_INPUTS.avatarVoice] as const;

type JsonObject = Record<string, unknown>;

export type VoiceTextResolution = {
  method: "textmap" | "unresolved";
  locale: string | null;
  resolved: boolean;
};

export type VoiceRecord = {
  characterStableId: string;
  voiceStableId: string;
  title: string;
  body: string;
  /** Null means the title did not expose a parseable mentioned character ID. */
  relatedEntityStableId: string | null;
  unlockCondition?: unknown;
  textResolution: VoiceTextResolution;
};

export type VoiceExtractionResult = ExtractionResult<VoiceRecord> & {
  manifest: ExtractorManifest;
};

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function rows(value: unknown): JsonObject[] {
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

function compareRows(left: JsonObject, right: JsonObject): number {
  return (
    compareOptionalNumber(idValue(left.avatarId), idValue(right.avatarId)) ||
    compareOptionalNumber(idValue(left.id ?? left.voiceId), idValue(right.id ?? right.voiceId)) ||
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

function resolveText(
  ctx: AnimeContext,
  row: JsonObject,
  keys: string[],
): { value: string; locale: string | null } | undefined {
  for (const key of keys) {
    const hash = idValue(row[key]);
    if (hash === undefined) continue;
    const resolved = ctx.textResolver.resolveWithFallback(hash);
    if (resolved.resolved && resolved.value) {
      return { value: resolved.value, locale: resolved.locale };
    }
  }
  return undefined;
}

function relatedEntityFromValue(value: unknown): string | null {
  const id = idValue(value);
  return id !== undefined && Number.isSafeInteger(id) ? `char/${id}` : null;
}

/**
 * Parse only stable-ID-shaped targets from About/关于 titles. A plain name
 * cannot safely be converted to an entity ID without an Avatar name map, so
 * it deliberately remains null.
 */
export function parseRelatedEntityStableId(title: string): string | null {
  const stableId = /(?:char|character)[/:](\d+)/i.exec(title);
  if (stableId?.[1]) return `char/${stableId[1]}`;

  const aboutId =
    /(?:^|[\s:：([【])(?:about|关于)\s*[:：]?\s*(?:character|角色)?\s*(?:id\s*[:：]?\s*)?(\d+)/i.exec(
      title,
    );
  return aboutId?.[1] ? `char/${aboutId[1]}` : null;
}

function relatedEntity(row: JsonObject, title: string): string | null {
  for (const key of [
    "relatedEntityStableId",
    "relatedAvatarId",
    "aboutAvatarId",
    "targetAvatarId",
    "mentionAvatarId",
  ]) {
    if (row[key] === undefined || row[key] === null) continue;
    if (key === "relatedEntityStableId" && typeof row[key] === "string") {
      return row[key].trim() || null;
    }
    const fromValue = relatedEntityFromValue(row[key]);
    if (fromValue) return fromValue;
  }
  return parseRelatedEntityStableId(title);
}

function unlockCondition(row: JsonObject): unknown | undefined {
  for (const key of ["unlockCondition", "unlockConditions", "openConds", "finishConds"]) {
    if (row[key] !== undefined && row[key] !== null) return cloneJson(row[key]);
  }
  const unlockFetterLevel = idValue(row.unlockFetterLevel);
  if (unlockFetterLevel !== undefined && Number.isSafeInteger(unlockFetterLevel)) {
    return { unlockFetterLevel };
  }
  return undefined;
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

function emptyVoiceResult(
  ctx: AnimeContext,
  inputHashes: Record<string, string>,
  warnings: ExtractionWarning[],
): VoiceExtractionResult {
  const result: ExtractionResult<VoiceRecord> = {
    extractorId: VOICE_EXTRACTOR_ID,
    extractorVersion: VOICE_EXTRACTOR_VERSION,
    records: [],
    warnings,
    failures: [],
    coverage: { discovered: 0, converted: 0, failed: 0, coverage: 1 },
    fieldCoverage: {},
    inputHashes,
    stats: { sourcePresent: 0, sourceRows: 0 },
  };
  const manifest = buildVoiceManifest(result, ctx);
  return { ...result, manifest };
}

function sortedInputHashes(inputHashes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(inputHashes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function incrementCoverage(fieldCoverage: Record<string, number>, field: string): void {
  fieldCoverage[field] = (fieldCoverage[field] ?? 0) + 1;
}

export class VoiceExtractor implements AnimeTextExtractor<VoiceRecord> {
  readonly id = VOICE_EXTRACTOR_ID;
  readonly version = VOICE_EXTRACTOR_VERSION;
  /** AvatarVoice is an optional source in the pinned AnimeGameData snapshot. */
  readonly requiredInputs = [...VOICE_REQUIRED_INPUTS];

  async extract(ctx: AnimeContext): Promise<VoiceExtractionResult> {
    let voiceSource: SourceFile<unknown>;
    try {
      voiceSource = await loadSourceJson<unknown>(ctx, VOICE_INPUTS.avatarVoice);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const inputHashes = sortedInputHashes({});
      return emptyVoiceResult(ctx, inputHashes, [
        {
          code: "voice_source_missing",
          message: `${VOICE_INPUTS.avatarVoice} is absent; discovered=0 counts source rows only, and no voice records were fabricated`,
        },
      ]);
    }

    const voiceRows = rows(voiceSource.value).sort(compareRows);
    if (!voiceRows.length) {
      const inputHashes = inputHashesFor(voiceSource);
      const result: ExtractionResult<VoiceRecord> = {
        extractorId: this.id,
        extractorVersion: this.version,
        records: [],
        warnings: [
          {
            code: "voice_source_empty",
            message: `${VOICE_INPUTS.avatarVoice} exists but is empty; discovered=0 counts source rows only, and no voice records were fabricated`,
          },
        ],
        failures: [],
        coverage: { discovered: 0, converted: 0, failed: 0, coverage: 1 },
        fieldCoverage: {},
        inputHashes,
        stats: { sourcePresent: 1, sourceRows: 0 },
      };
      const manifest = buildVoiceManifest(result, ctx);
      return { ...result, manifest };
    }

    const warnings: ExtractionWarning[] = [];
    const failures: ExtractionFailure[] = [];
    const records: VoiceRecord[] = [];
    const seenVoiceIds = new Set<string>();
    const fieldCoverage: Record<string, number> = {
      missingIds: 0,
      missingCharacter: 0,
      missingTitle: 0,
      missingBody: 0,
    };
    let duplicateRows = 0;
    let relatedEntityResolved = 0;
    let unlockConditionResolved = 0;

    for (const voice of voiceRows) {
      const voiceId = idValue(voice.id ?? voice.voiceId);
      const avatarId = idValue(voice.avatarId);
      const upstreamId = idText(voice.id ?? voice.voiceId) ?? "unknown";
      if (
        voiceId === undefined ||
        avatarId === undefined ||
        !Number.isSafeInteger(voiceId) ||
        !Number.isSafeInteger(avatarId)
      ) {
        incrementCoverage(fieldCoverage, "missingIds");
        failures.push({
          code: "upstream_id_missing",
          message: "Voice row has no safe integer id/avatarId",
          upstreamId,
        });
        continue;
      }

      const voiceStableId = `voice/${voiceId}`;
      if (seenVoiceIds.has(voiceStableId)) {
        duplicateRows += 1;
        warnings.push({
          code: "duplicate_voice_id",
          message: `Duplicate voice row skipped for ${voiceStableId}`,
          upstreamId,
        });
        failures.push({
          code: "duplicate_voice_id",
          message: `Voice row duplicates voice ID ${voiceStableId}`,
          upstreamId,
        });
        continue;
      }
      seenVoiceIds.add(voiceStableId);

      const title = resolveText(ctx, voice, ["voiceTitleTextMapHash", "titleTextMapHash"]);
      if (!title) {
        incrementCoverage(fieldCoverage, "missingTitle");
        failures.push({
          code: "title_missing",
          message: `Voice title TextMap value is unresolved for ${upstreamId}`,
          upstreamId,
        });
        continue;
      }
      const body = resolveText(ctx, voice, [
        "voiceTextTextMapHash",
        "voiceTextMapHash",
        "textTextMapHash",
      ]);
      if (!body) {
        incrementCoverage(fieldCoverage, "missingBody");
        failures.push({
          code: "body_missing",
          message: `Voice body TextMap value is unresolved for ${upstreamId}`,
          upstreamId,
        });
        continue;
      }

      const relatedEntityStableId = relatedEntity(voice, title.value);
      if (relatedEntityStableId) relatedEntityResolved += 1;
      const condition = unlockCondition(voice);
      if (condition !== undefined) unlockConditionResolved += 1;
      records.push({
        characterStableId: `char/${avatarId}`,
        voiceStableId,
        title: title.value,
        body: body.value,
        relatedEntityStableId,
        ...(condition !== undefined ? { unlockCondition: condition } : {}),
        textResolution: {
          method: "textmap",
          locale: title.locale ?? body.locale ?? ctx.locale,
          resolved: true,
        },
      });
    }

    records.sort((left, right) => left.voiceStableId.localeCompare(right.voiceStableId));
    const inputHashes = inputHashesFor(voiceSource);
    const result: ExtractionResult<VoiceRecord> = {
      extractorId: this.id,
      extractorVersion: this.version,
      records,
      warnings,
      failures,
      coverage: {
        discovered: voiceRows.length,
        converted: records.length,
        failed: failures.length,
        coverage: voiceRows.length ? records.length / voiceRows.length : 1,
      },
      fieldCoverage,
      inputHashes,
      stats: {
        sourcePresent: 1,
        sourceRows: voiceRows.length,
        duplicateRows,
        relatedEntityResolved,
        unlockConditionResolved,
      },
    };
    const manifest = buildVoiceManifest(result, ctx);
    return { ...result, manifest };
  }
}

function inputHashesFor(
  source: Pick<SourceFile<unknown>, "relativePath" | "fileHash">,
): Record<string, string> {
  return { [source.relativePath]: source.fileHash };
}

export function buildVoiceManifest(
  result: ExtractionResult<VoiceRecord>,
  ctx: Pick<AnimeContext, "upstreamCommit" | "gameVersion" | "locale">,
): ExtractorManifest {
  return buildManifest(result, {
    upstreamCommit: ctx.upstreamCommit,
    gameVersion: ctx.gameVersion,
    locale: ctx.locale,
  });
}

export const voiceExtractor = new VoiceExtractor();
export const extractor = voiceExtractor;

export async function extractVoices(ctx: AnimeContext): Promise<VoiceExtractionResult> {
  return voiceExtractor.extract(ctx);
}

export default voiceExtractor;
