import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { DocumentType } from "../packages/contracts/src/index.ts";
import type { NormalizedRecord, QuestRecordPayload } from "../packages/domain/src/index.ts";
import { validateNormalizedRecords } from "../packages/domain/src/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.ts";
import { loadConfig } from "../packages/config/src/index.ts";

export const QUEST_CONVERTER_VERSION = "anime-game-data-quests-v1";
export const DEFAULT_QUEST_UPSTREAM_DIR = "data/upstream/AnimeGameData";
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

const locales = ["zh-CN", "en"] as const;
type Locale = (typeof locales)[number];
type Json = Record<string, unknown>;

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
    talkFallbackMainQuests: number;
  };
  excluded: Array<{ sourceKey: string; reason: string }>;
  failures: Array<{ sourceKey: string; reason: string }>;
  unexplainedMissing: Array<{ scope: string; count: number }>;
};

export type QuestConversionResult = {
  records: NormalizedRecord[];
  manifest: QuestConversionManifest;
};

type Inputs = {
  root: string;
  mainQuest: Json[];
  quest: Json[];
  questByMainId: Map<string, Json[]>;
  chapter: Json[];
  questCodex: Json[];
  talk: Json[];
  dialog: Json[];
  dialogById: Map<string, Json>;
  npcById: Map<string, Json>;
  codexQuest: Array<{ relativePath: string; hash: string; value: Json }>;
  codexQuestByMainId: Map<string, { relativePath: string; hash: string; value: Json }>;
  codexQuestFailures: Array<{ relativePath: string; reason: string }>;
  npc: Json[];
  avatar: Json[];
  textMaps: Record<Locale, Record<string, unknown>>;
  inputHashes: Record<string, string>;
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
  /(?:^|[\s._-])(?:test|debug|tutorial|mirror|placeholder|dummy)(?:$|[\s._-])/i;

export type QuestVisibilityReason =
  | "public"
  | "hidden_show_type"
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
  if (showType && /HIDDEN|UNRELEASED|TEST|DEBUG/i.test(showType)) {
    return /UNRELEASED/i.test(showType) ? "unreleased_marker" : "hidden_show_type";
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

async function loadInputs(root: string): Promise<Inputs> {
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

  const mainQuest = asArray(byKey.mainQuest.value);
  const quest = asArray(byKey.quest.value);
  const chapter = asArray(byKey.chapter.value);
  const questCodex = asArray(byKey.questCodex.value);
  const talk = [...asArray(byKey.talk0.value), ...asArray(byKey.talk1.value)];
  const dialog = asArray(byKey.dialog.value);
  const npc = asArray(byKey.npc.value);
  const avatar = asArray(byKey.avatar.value);
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

  return {
    root,
    mainQuest,
    quest,
    questByMainId,
    chapter,
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
    textMaps: {
      "zh-CN": {
        ...asObject(byKey.textMapChs.value),
        ...asObject(byKey.textMapMediumChs.value),
      },
      en: {
        ...asObject(byKey.textMapEn.value),
        ...asObject(byKey.textMapMediumEn.value),
      },
    },
    inputHashes,
  };
}

function questType(value: unknown): DocumentType | undefined {
  const raw = text(value)?.toLocaleLowerCase("en");
  if (raw === "aq" || raw === "iq" || raw === "archon" || raw === "archon_quest")
    return "archon_quest";
  if (raw === "lq" || raw === "story" || raw === "story_quest") return "story_quest";
  if (raw === "eq" || raw === "event" || raw === "event_quest") return "event_quest";
  if (raw === "wq" || raw === "world" || raw === "world_quest") return "world_quest";
  return undefined;
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
    metadata?: Record<string, unknown>;
  }): string {
    const nodeKey = uniqueNodeKey(`quest/${mainId}/dialog/${input.nodeId}`);
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
    sourceFiles.add(input.sourceFile);
    return nodeKey;
  }

  if (codexFile) {
    const groups = asArray(codexText(codexFile.value, "EBNBLBEIFFJ"));
    groups.forEach((group, groupIndex) => {
      const groupTitleHash = hashValue(codexText(group, "OGEGCCLHIHP"));
      const subquestKey = groupTitleHash ? subquestKeyByTitleHash.get(groupTitleHash) : undefined;
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
          const dialogRow = dialogId ? dialogById.get(dialogId) : undefined;
          const body =
            tryResolveText(textMap, ref.JGPDCLOJKLC) ??
            (dialogRow ? tryResolveText(textMap, dialogRow.talkContentTextMapHash) : undefined);
          if (!body) return;
          const npcId = dialogRow ? talkRoleNpcId(dialogRow) : undefined;
          if (npcId) participantIds.add(npcId);
          appendNode({
            nodeId: dialogId ?? `codex-${groupIndex}-${lineIndex}-dialog-${refIndex}`,
            type: lineKind === "MultiDialog" ? "player_choice" : "dialogue",
            subquestKey,
            speakerKey: npcId ? `npc/${npcId}` : undefined,
            speakerName:
              speakerName ??
              (dialogRow ? tryResolveText(textMap, dialogRow.talkRoleNameTextMapHash) : undefined),
            body,
            lineKey,
            sourceFile: codexFile.relativePath,
            metadata: {
              textMapHash: hashValue(ref.JGPDCLOJKLC ?? dialogRow?.talkContentTextMapHash),
              dialogId,
              codexLineKind: lineKind,
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

  if (!nodes.length) {
    const talkRows = inputs.talk
      .filter((row) => {
        // TalkExcelConfigData carries an explicit questId.  Prefix matching on
        // the talk id is unsafe (e.g. quest 11 also matches 11124), so rows
        // without the relation are deliberately not assigned to a quest.
        return idText(row.questId) === mainId;
      })
      .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0));
    for (const talk of talkRows) {
      const talkId = idText(talk.id);
      const initDialog = idText(talk.initDialog);
      if (!talkId || !initDialog) continue;
      const visited = new Set<string>();
      const queue = [initDialog];
      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const dialogRow = dialogById.get(current);
        if (!dialogRow) continue;
        const body = tryResolveText(textMap, dialogRow.talkContentTextMapHash);
        if (!body) continue;
        const npcId = talkRoleNpcId(dialogRow);
        if (npcId) participantIds.add(npcId);
        appendNode({
          nodeId: current,
          type: "dialogue",
          subquestKey: `quest/${mainId}/subquest/${talkId}`,
          speakerKey: npcId ? `npc/${npcId}` : undefined,
          speakerName: tryResolveText(textMap, dialogRow.talkRoleNameTextMapHash),
          body,
          lineKey: `talk:${talkId}:${current}`,
          sourceFile: inputPaths.dialog,
          metadata: { textMapHash: hashValue(dialogRow.talkContentTextMapHash), talkId },
        });
        for (const next of Array.isArray(dialogRow.nextDialogs) ? dialogRow.nextDialogs : []) {
          const nextId = idText(next);
          if (!nextId) continue;
          edges.push({
            fromNodeKey: `quest/${mainId}/dialog/${current}`,
            toNodeKey: `quest/${mainId}/dialog/${nextId}`,
            type: "next",
            metadata: { sourceFile: inputPaths.dialog, talkId },
          });
          queue.push(nextId);
        }
      }
    }
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
  for (const subquest of payload.subquests) {
    lines.push(`## ${subquest.title}`);
    if (subquest.objective) lines.push(subquest.objective);
    for (const node of payload.dialogueNodes.filter(
      (item) => item.subquestKey === subquest.subquestKey,
    )) {
      const speaker = node.speakerName ? `${node.speakerName}: ` : "";
      lines.push(`${speaker}${node.body}`);
    }
  }
  if (lines.length === 0) return payload.questKey;
  return lines.join("\n");
}

function buildRecord(
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
  const resolvedQuestType = questType(originalQuestType);
  if (!resolvedQuestType)
    throw new Error(`quest_type_out_of_scope:${originalQuestType ?? "missing"}`);
  const questRows = inputs.questByMainId.get(mainId) ?? [];
  const codexIndexRows = inputs.questCodex.filter(
    (row) => idText(row.parentQuestId ?? row.mainQuestId ?? row.mainId) === mainId,
  );
  const titleHash = main.titleTextMapHash ?? main.titleHash ?? codexFile?.value.HEDPNHPBMJH;
  const requestedTitle =
    tryResolveText(requestedTextMap, titleHash) ??
    tryResolveText(requestedTextMap, codexFile?.value.HEDPNHPBMJH);
  const title =
    requestedTitle ??
    tryResolveText(fallbackTextMap, titleHash) ??
    tryResolveText(fallbackTextMap, codexFile?.value.HEDPNHPBMJH) ??
    `Quest ${mainId}`;
  const titleFallbackUsed =
    !tryResolveText(requestedTextMap, titleHash) &&
    Boolean(tryResolveText(fallbackTextMap, titleHash));
  const chapterId = idText(
    main.chapterId ?? main.series ?? codexIndexRows[0]?.chapterId ?? codexFile?.value.PBIOMJGIMAK,
  );
  const chapterRow = inputs.chapter.find((row) => idText(row.id ?? row.chapterId) === chapterId);
  const chapter =
    chapterRow && (chapterRow.titleTextMapHash ?? chapterRow.titleHash) !== undefined
      ? resolveText(
          textMap,
          chapterRow.chapterTitleTextMapHash ?? chapterRow.titleTextMapHash ?? chapterRow.titleHash,
          sourceKey,
          "chapter",
        )
      : tryResolveText(textMap, codexFile?.value.ALOHJMPDFKI);
  const speakerRows = inputs.npcById;
  const subquestKeyByTitleHash = new Map<string, string>();
  const subquests = questRows.map((row, index) => {
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
  const graph = buildDialogueGraph(inputs, mainId, locale, textMap, subquestKeyByTitleHash);
  const subquestKeys = new Set(subquests.map((subquest) => subquest.subquestKey));
  const dialogueNodes = graph.nodes.map((node) => ({
    ...node,
    subquestKey:
      node.subquestKey && subquestKeys.has(node.subquestKey) ? node.subquestKey : undefined,
  }));
  const dialogueEdges = graph.edges;
  const visibilityReason = classifyQuestVisibility(main, requestedTitle);
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
  const payload: QuestRecordPayload = {
    questKey: `quest/${mainId}`,
    mainQuestId: mainId,
    questType: resolvedQuestType,
    locale,
    chapter,
    series: chapterId,
    order: Number(main.order ?? mainId),
    completeness:
      dialogueNodes.length && subquests.length
        ? "complete"
        : dialogueNodes.length || subquests.length
          ? "partial"
          : "metadata_only",
    visibility,
    visibilityReason,
    prerequisites: [...asArray(main.prerequisites), ...asArray(main.BJOCFAJIGLH)].flatMap((row) => {
      const id = idText(row.id ?? row.mainQuestId ?? row.questId);
      return id ? [`quest/${id}`] : [];
    }),
    subquests,
    dialogueNodes,
    dialogueEdges,
    metadata: {
      sourceFile: inputPaths.mainQuest,
      codexSourceFile: codexFile?.relativePath,
      originalQuestType,
      titleTextMapHash: hashValue(titleHash),
      titleFallbackUsed,
      titleUnresolved: title === `Quest ${mainId}`,
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
    metadata: {
      questKey: payload.questKey,
      subquestKey: node.subquestKey,
      dialogueNodeKey: node.nodeKey,
      locale,
    },
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
        sourceFiles: [...new Set([...Object.values(inputPaths), ...graph.sourceFiles])].sort(),
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
            valueHash: requestedTitle ? sha256(requestedTitle) : undefined,
          },
          dialogue: {
            relativeFile: codexFile?.relativePath ?? inputPaths.dialog,
            upstreamId: payload.dialogueNodes.map((node) => node.nodeId),
            hash: codexFile?.hash ?? inputs.inputHashes[inputPaths.dialog],
            valueHash: sha256(stableStringify(payload.dialogueNodes)),
          },
        },
        upstreamIds: {
          mainQuestId: mainId,
          subquestIds: questRows.map((row) => idText(row.subId ?? row.id ?? row.subQuestId) ?? ""),
          dialogueNodeIds: payload.dialogueNodes.map((node) => node.nodeId),
        },
        textMapHashes: {
          ...(hashValue(titleHash) && Number.isSafeInteger(Number(hashValue(titleHash)))
            ? { title: Number(hashValue(titleHash)) }
            : {}),
          dialogue: payload.dialogueNodes
            .map((node) => node.metadata?.textMapHash)
            .filter(
              (value): value is number | number[] =>
                typeof value === "number" || Array.isArray(value),
            ),
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
        visibility: payload.visibility,
        visibilityReason: payload.visibilityReason,
      },
      questPayload: payload,
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
    if (!questType(rawType)) {
      excluded.push({
        sourceKey: `quest/${mainId}`,
        reason: `quest_type_out_of_scope:${rawType ?? "missing"}`,
      });
      excludedDocumentCount += locales.length;
      continue;
    }
    discoveredByType[questType(rawType)!] = (discoveredByType[questType(rawType)!] ?? 0) + 1;
    const mainRecords: NormalizedRecord[] = [];
    for (const locale of locales) {
      try {
        const record = buildRecord(inputs, main, locale, context);
        builtRecords.push(record);
        mainRecords.push(record);
      } catch (error) {
        failures.push({
          sourceKey: `quest/${mainId}/locale/${locale}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const hasBilingualCompletePair =
      mainRecords.length === locales.length &&
      mainRecords.every(
        (record) =>
          record.quest?.visibility === "public" && record.quest.completeness === "complete",
      );
    if (hasBilingualCompletePair) {
      records.push(...mainRecords);
    } else {
      // A public revision is bilingual and atomic: if one locale is hidden,
      // partial, or failed, the matching document in the other locale is also
      // excluded rather than publishing an asymmetric task set.
      for (const record of mainRecords) {
        const payload = record.quest;
        const reason = !payload
          ? "quest_payload_missing"
          : payload.visibility !== "public"
            ? (payload.visibilityReason ?? `visibility:${payload.visibility ?? "unknown"}`)
            : payload.completeness !== "complete"
              ? `incomplete_content:${payload.completeness}`
              : "bilingual_pair_incomplete";
        excluded.push({ sourceKey: record.sourceKey, reason });
        excludedDocumentCount += 1;
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
  const discoveredDocuments = mainQuestRows.length * locales.length;
  const convertedDocuments = records.length;
  const excludedDocuments = excludedDocumentCount;
  const failedDocuments = failures.length;
  const accountedDocuments = convertedDocuments + excludedDocuments + failedDocuments;
  return {
    records,
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
        talkFallbackMainQuests: builtRecords.filter((record) =>
          (record.metadata.questPayload as QuestRecordPayload | undefined)?.dialogueNodes?.some(
            (node) => node.metadata?.talkId,
          ),
        ).length,
      },
      excluded,
      failures,
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
  await writeFile(join(recordsDir, "quests.json"), JSON.stringify(result.records, null, 2) + "\n");
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
