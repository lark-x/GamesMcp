import { createHash } from "node:crypto";
import type { QuestBinContent, QuestBinRecord, QuestRelationEdge } from "./types.js";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(idText).filter((item): item is string => Boolean(item));
}

function contentRows(row: Json): Json[] {
  return Array.isArray(row.ANBEKNMDKCH)
    ? row.ANBEKNMDKCH.map(asObject)
    : Array.isArray(row.contents)
      ? row.contents.map(asObject)
      : [];
}

function parseMainId(value: Json, relativePath: string): string | undefined {
  const direct = idText(value.mainQuestId ?? value.mainId ?? value.BJAAAKHKKKL);
  if (direct) return direct;
  const stem = relativePath
    .split(/[\\/]/u)
    .pop()
    ?.replace(/\.json$/iu, "");
  return stem && /^\d+$/u.test(stem) ? stem : undefined;
}

function edgeId(edge: QuestRelationEdge): string {
  return [
    edge.fromQuestId,
    edge.toQuestId ?? "",
    edge.talkId ?? "",
    edge.relationType,
    edge.sourceFile,
    edge.sourcePath ?? "",
  ].join("|");
}

export function parseBinQuestFile(
  value: Json,
  relativePath: string,
  sourceHash = createHash("sha256").update(JSON.stringify(value)).digest("hex"),
): QuestBinRecord | undefined {
  const fallbackMainId = parseMainId(value, relativePath);
  const rows = Array.isArray(value.EBNBLBEIFFJ)
    ? value.EBNBLBEIFFJ.map(asObject)
    : Array.isArray(value.subquests)
      ? value.subquests.map(asObject)
      : [];
  const mainQuestId =
    rows
      .map((row) => idText(row.BJAAAKHKKKL ?? row.mainQuestId ?? row.mainId))
      .find((id): id is string => Boolean(id)) ?? fallbackMainId;
  if (!mainQuestId) return undefined;
  const subQuestIds = rows
    .map((row) => idText(row.KCGAKLCHDCC ?? row.subQuestId ?? row.subId ?? row.id))
    .filter((id): id is string => Boolean(id));
  const contents: QuestBinContent[] = [];
  const relationEdges: QuestRelationEdge[] = [];
  const contentCounts: Record<string, number> = {};
  for (const [rowIndex, row] of rows.entries()) {
    const subQuestId =
      idText(row.KCGAKLCHDCC ?? row.subQuestId ?? row.subId ?? row.id) ?? mainQuestId;
    for (const [contentIndex, content] of contentRows(row).entries()) {
      const type = String(content.ALBFHGKNMLK ?? content.type ?? content.contentType ?? "unknown");
      const params = ids(content.OPDGHDAADJC ?? content.params ?? content.param);
      const sourcePath = `EBNBLBEIFFJ[${rowIndex}].ANBEKNMDKCH[${contentIndex}]`;
      const item: QuestBinContent = {
        mainQuestId,
        subQuestId,
        type,
        params,
        sourceFile: relativePath,
        sourcePath,
      };
      contents.push(item);
      contentCounts[type] = (contentCounts[type] ?? 0) + 1;
      if (type === "QUEST_CONTENT_COMPLETE_TALK" && params[0]) {
        relationEdges.push({
          fromQuestId: mainQuestId,
          talkId: params[0],
          relationType: "complete_talk",
          rawRelationType: type,
          sourceFile: relativePath,
          sourcePath,
          sourceHash,
          derived: false,
          confidence: 1,
          metadata: { subQuestId },
        });
      }
      if (type === "QUEST_CONTENT_QUEST_STATE_EQUAL" && params[0]) {
        relationEdges.push({
          fromQuestId: subQuestId,
          toQuestId: params[0],
          relationType: "quest_state_equal",
          rawRelationType: type,
          sourceFile: relativePath,
          sourcePath,
          sourceHash,
          derived: false,
          confidence: 1,
          metadata: { mainQuestId, state: params[1] },
        });
      }
      if (type === "QUEST_CONTENT_ADD_QUEST_PROGRESS" && params[0]) {
        relationEdges.push({
          fromQuestId: subQuestId,
          toQuestId: params[0],
          relationType: "add_quest_progress",
          rawRelationType: type,
          sourceFile: relativePath,
          sourcePath,
          sourceHash,
          derived: false,
          confidence: 1,
          metadata: { mainQuestId, amount: params[1] },
        });
      }
    }
  }
  const deduped = new Map(relationEdges.map((edge) => [edgeId(edge), edge]));
  const completeTalkIds = [
    ...new Set(
      relationEdges
        .filter((edge) => edge.relationType === "complete_talk" && edge.talkId)
        .map((edge) => edge.talkId!),
    ),
  ];
  return {
    mainQuestId,
    sourceFile: relativePath,
    sourceHash,
    subQuestIds: [...new Set(subQuestIds)],
    contents,
    relationEdges: [...deduped.values()],
    contentCounts,
    hasCompleteTalk: completeTalkIds.length > 0,
    completeTalkIds,
  };
}
