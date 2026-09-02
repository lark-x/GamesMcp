import { buildManifest, type ExtractorManifest } from "../manifest.js";
import type {
  AnimeTextExtractor,
  ExtractionFailure,
  ExtractionResult,
  ExtractionWarning,
} from "../extractor.js";
import type { AnimeContext } from "../context.js";
import { idValue } from "../helpers.js";
import { loadSourceJson } from "../source-files.js";

export const DIALOGUE_EXTRACTOR_ID = "anime-game-data-dialogue";
export const DIALOGUE_EXTRACTOR_VERSION = "1.0.0";

export const DIALOGUE_REQUIRED_INPUTS = [
  "ExcelBinOutput/DialogExcelConfigData.json",
  "ExcelBinOutput/TalkExcelConfigData_0.json",
  "ExcelBinOutput/TalkExcelConfigData_1.json",
] as const;

export type DialogueNodeType = "dialogue" | "player_choice" | "narration" | "system_text" | "other";

export type DialogueTextResolution = {
  method: "textmap" | "unresolved";
  locale: string | null;
  resolved: boolean;
};

export type DialogueRecord = {
  dialogueNodeKey: string;
  talkId: number | null;
  speakerKey: string | null;
  speakerName: string | null;
  /** The upstream talk-role enum, kept verbatim for provenance. */
  speakerRole: string | null;
  nodeType: DialogueNodeType;
  body: string | null;
  order: number;
  questKey: string | null;
  questId: number | null;
  textResolution: DialogueTextResolution;
};

export type DialogueExtractionResult = ExtractionResult<DialogueRecord> & {
  manifest: ExtractorManifest;
};

type JsonObject = Record<string, unknown>;

type DialogEntry = {
  row: JsonObject;
  sourceIndex: number;
  id: number;
  idKey: string;
};

type TalkEntry = {
  row: JsonObject;
  sourceIndex: number;
  id: number | null;
  idKey: string | null;
};

type TalkAssociation = {
  talkId: number | null;
  questId: number | null;
  questKey: string | null;
};

type TextResolutionAttempt = {
  value: string | null;
  locale: string | null;
  resolved: boolean;
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function idKey(value: unknown): string | undefined {
  const id = idValue(value);
  return id === undefined ? undefined : String(id);
}

function sourceTextHash(value: unknown): string | number | undefined {
  const id = idValue(value);
  if (id !== undefined) return id;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleType(row: JsonObject): string | null {
  return nonEmptyText(asObject(row.talkRole)?.type);
}

function nextDialogKeys(row: JsonObject): string[] {
  return asRows(row.nextDialogs).flatMap((value) => {
    const key = idKey(value);
    return key ? [key] : [];
  });
}

function compareNullableIds(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function nodeTypeForRole(role: string | null): DialogueNodeType {
  if (!role) return "other";
  const normalized = role.toUpperCase();
  if (normalized === "TALK_ROLE_PLAYER") return "player_choice";
  if (normalized.includes("NARRATION") || normalized.includes("NARRATOR")) {
    return "narration";
  }
  if (normalized.includes("BLACK_SCREEN") || normalized.includes("SYSTEM")) {
    return "system_text";
  }
  if (
    normalized.includes("NPC") ||
    normalized.includes("AVATAR") ||
    normalized.includes("GADGET")
  ) {
    return "dialogue";
  }
  return "other";
}

function speakerKeyFor(row: JsonObject): string | null {
  const role = asObject(row.talkRole);
  const type = nonEmptyText(role?.type)?.toUpperCase();
  const id = idKey(role?.id);
  if (!type || !id) return null;
  if (type.includes("NPC")) return `npc/${id}`;
  if (type.includes("AVATAR")) return `avatar/${id}`;
  return null;
}

function dialogueNodeKeyFor(id: number, questKey: string | null): string {
  return questKey ? `${questKey}/dialog/${id}` : `dialog/${id}`;
}

function resolveText(ctx: AnimeContext, value: unknown): TextResolutionAttempt {
  const hash = sourceTextHash(value);
  if (hash === undefined) return { value: null, locale: null, resolved: false };
  const resolved = ctx.textResolver.resolveWithFallback(hash);
  return {
    value: resolved.resolved && resolved.value ? resolved.value : null,
    locale: resolved.locale,
    resolved: resolved.resolved && Boolean(resolved.value),
  };
}

function textResolutionFor(
  body: TextResolutionAttempt,
  speakerName: TextResolutionAttempt,
): DialogueTextResolution {
  return {
    method: body.resolved || speakerName.resolved ? "textmap" : "unresolved",
    locale: body.locale ?? speakerName.locale,
    resolved: body.resolved && speakerName.resolved,
  };
}

function incrementField(fieldCoverage: Record<string, number>, field: string): void {
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

function buildDialogEntries(
  value: unknown,
  failures: ExtractionFailure[],
  warnings: ExtractionWarning[],
): { entries: DialogEntry[]; duplicateCount: number } {
  const entries: DialogEntry[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const [sourceIndex, valueAtIndex] of asRows(value).entries()) {
    const row = asObject(valueAtIndex);
    const id = row ? idValue(row.GFLDJMJKIKE ?? row.id ?? row.dialogId) : undefined;
    if (!row || id === undefined) {
      failures.push({
        code: "dialogue_node_key_missing",
        message: "Dialog row has no numeric dialogue node key.",
      });
      continue;
    }
    const key = String(id);
    if (seen.has(key)) {
      duplicateCount += 1;
      warning(warnings, "duplicate_dialogue_node_key", `Duplicate Dialog row: ${key}.`, key);
      failures.push({
        code: "duplicate_dialogue_node_key",
        message: `Dialog row duplicates dialogue node key ${key}.`,
        upstreamId: key,
      });
      continue;
    }
    seen.add(key);
    entries.push({ row, sourceIndex, id, idKey: key });
  }
  return { entries, duplicateCount };
}

function buildTalkEntries(value: unknown): TalkEntry[] {
  return asRows(value).flatMap((valueAtIndex, sourceIndex) => {
    const row = asObject(valueAtIndex);
    if (!row) return [];
    const id = idValue(row.id ?? row.talkId);
    return [{ row, sourceIndex, id: id ?? null, idKey: id === undefined ? null : String(id) }];
  });
}

function buildTalkAssociations(
  dialogByKey: Map<string, DialogEntry>,
  talks: TalkEntry[],
  warnings: ExtractionWarning[],
): {
  associations: Map<string, TalkAssociation>;
  sharedDialogCount: number;
  missingInitDialogCount: number;
  missingTargetCount: number;
} {
  const associations = new Map<string, TalkAssociation>();
  const sortedTalks = [...talks].sort(
    (left, right) => compareNullableIds(left.id, right.id) || left.sourceIndex - right.sourceIndex,
  );
  let sharedDialogCount = 0;
  let missingInitDialogCount = 0;
  let missingTargetCount = 0;

  for (const talk of sortedTalks) {
    const initDialogKey = idKey(talk.row.initDialog);
    if (!initDialogKey) {
      missingInitDialogCount += 1;
      warning(
        warnings,
        "talk_init_dialog_missing",
        "Talk row has no numeric initDialog and cannot be linked to a dialogue graph.",
        talk.idKey ?? String(talk.sourceIndex),
      );
      continue;
    }
    const questIdValue = idValue(talk.row.questId);
    const association: TalkAssociation = {
      talkId: talk.id,
      questId: questIdValue ?? null,
      questKey: questIdValue === undefined ? null : `quest/${questIdValue}`,
    };
    const queue = [initDialogKey];
    const visited = new Set<string>();
    while (queue.length) {
      const currentKey = queue.shift()!;
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);
      const dialog = dialogByKey.get(currentKey);
      if (!dialog) {
        missingTargetCount += 1;
        warning(
          warnings,
          "dialogue_target_missing",
          `Talk graph references missing Dialog row ${currentKey}.`,
          talk.idKey ?? String(talk.sourceIndex),
        );
        continue;
      }
      if (associations.has(currentKey)) {
        sharedDialogCount += 1;
      } else {
        associations.set(currentKey, association);
      }
      for (const nextKey of nextDialogKeys(dialog.row)) queue.push(nextKey);
    }
  }
  return { associations, sharedDialogCount, missingInitDialogCount, missingTargetCount };
}

function inputHashesFor(
  dialog: { relativePath: string; fileHash: string },
  talk0: { relativePath: string; fileHash: string },
  talk1: { relativePath: string; fileHash: string },
): Record<string, string> {
  return Object.fromEntries(
    [dialog, talk0, talk1]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((source) => [source.relativePath, source.fileHash]),
  );
}

async function extractDialogueRecords(
  ctx: AnimeContext,
): Promise<ExtractionResult<DialogueRecord>> {
  const dialogSource = await loadSourceJson<unknown>(ctx, DIALOGUE_REQUIRED_INPUTS[0]);
  const talk0Source = await loadSourceJson<unknown>(ctx, DIALOGUE_REQUIRED_INPUTS[1]);
  const talk1Source = await loadSourceJson<unknown>(ctx, DIALOGUE_REQUIRED_INPUTS[2]);
  const warnings: ExtractionWarning[] = [];
  const failures: ExtractionFailure[] = [];
  const dialogEntriesResult = buildDialogEntries(dialogSource.value, failures, warnings);
  const dialogEntries = dialogEntriesResult.entries;
  const dialogByKey = new Map(dialogEntries.map((entry) => [entry.idKey, entry]));
  const talks = [...buildTalkEntries(talk0Source.value), ...buildTalkEntries(talk1Source.value)];
  const associationResult = buildTalkAssociations(dialogByKey, talks, warnings);
  const fieldCoverage: Record<string, number> = {};
  const records: DialogueRecord[] = [];

  for (const entry of [...dialogEntries].sort(
    (left, right) => left.sourceIndex - right.sourceIndex,
  )) {
    const association = associationResult.associations.get(entry.idKey);
    const questKey = association?.questKey ?? null;
    const bodyResolution = resolveText(ctx, entry.row.talkContentTextMapHash);
    const speakerNameResolution = resolveText(ctx, entry.row.talkRoleNameTextMapHash);
    const body = bodyResolution.value;
    const speakerName = speakerNameResolution.value;
    const talkId = association?.talkId ?? null;
    const questId = association?.questId ?? null;
    const speakerRole = roleType(entry.row);
    const record: DialogueRecord = {
      dialogueNodeKey: dialogueNodeKeyFor(entry.id, questKey),
      talkId,
      speakerKey: speakerKeyFor(entry.row),
      speakerName,
      speakerRole,
      nodeType: nodeTypeForRole(speakerRole),
      body,
      order: records.length,
      questKey,
      questId,
      textResolution: textResolutionFor(bodyResolution, speakerNameResolution),
    };
    records.push(record);

    if (talkId === null) incrementField(fieldCoverage, "missingTalkId");
    if (record.speakerKey === null) incrementField(fieldCoverage, "missingSpeakerKey");
    if (speakerName === null) {
      incrementField(fieldCoverage, "missingSpeakerName");
      warning(
        warnings,
        "speaker_name_unresolved",
        "Speaker name TextMap hash is missing or unresolved.",
        entry.idKey,
      );
    }
    if (speakerRole === null) incrementField(fieldCoverage, "missingSpeakerRole");
    if (body === null) {
      incrementField(fieldCoverage, "missingBody");
      warning(
        warnings,
        "dialogue_body_unresolved",
        "Dialogue body TextMap hash is missing or unresolved.",
        entry.idKey,
      );
    }
    if (questKey === null) incrementField(fieldCoverage, "missingQuestKey");
    if (questId === null) incrementField(fieldCoverage, "missingQuestId");
    if (!record.textResolution.resolved) incrementField(fieldCoverage, "unresolvedText");
  }

  const discovered = asRows(dialogSource.value).length;
  const converted = records.length;
  const failed = failures.length;
  const coverage = discovered === 0 ? 1 : converted / discovered;
  const associatedRecords = records.filter((record) => record.talkId !== null).length;
  const stats: Record<string, number> = {
    dialogRows: discovered,
    talkRows: talks.length,
    associatedDialogRows: associatedRecords,
    unassociatedDialogRows: records.length - associatedRecords,
    duplicateDialogRows: dialogEntriesResult.duplicateCount,
    sharedDialogAssociations: associationResult.sharedDialogCount,
    talksMissingInitDialog: associationResult.missingInitDialogCount,
    missingDialogueTargets: associationResult.missingTargetCount,
    unresolvedBodies: fieldCoverage.missingBody ?? 0,
    unresolvedSpeakerNames: fieldCoverage.missingSpeakerName ?? 0,
  };

  return {
    extractorId: DIALOGUE_EXTRACTOR_ID,
    extractorVersion: DIALOGUE_EXTRACTOR_VERSION,
    records,
    warnings,
    failures,
    coverage: { discovered, converted, failed, coverage },
    fieldCoverage,
    inputHashes: inputHashesFor(dialogSource, talk0Source, talk1Source),
    stats,
  };
}

export function buildDialogueManifest(
  result: ExtractionResult<DialogueRecord>,
  ctx: Pick<AnimeContext, "upstreamCommit" | "gameVersion" | "locale">,
): ExtractorManifest {
  return buildManifest(result, {
    upstreamCommit: ctx.upstreamCommit,
    gameVersion: ctx.gameVersion,
    locale: ctx.locale,
  });
}

export class DialogueExtractor implements AnimeTextExtractor<DialogueRecord> {
  readonly id = DIALOGUE_EXTRACTOR_ID;
  readonly version = DIALOGUE_EXTRACTOR_VERSION;
  readonly requiredInputs = [...DIALOGUE_REQUIRED_INPUTS];

  async extract(ctx: AnimeContext): Promise<DialogueExtractionResult> {
    const result = await extractDialogueRecords(ctx);
    return { ...result, manifest: buildDialogueManifest(result, ctx) };
  }
}

export const dialogueExtractor = new DialogueExtractor();

export async function extractDialogue(ctx: AnimeContext): Promise<DialogueExtractionResult> {
  return dialogueExtractor.extract(ctx);
}
