import type { QuestRelationEdge } from "../quest/types.js";
import type { TalkSourceKind } from "./types.js";

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

function collectConditionQuestIds(value: unknown): string[] {
  const result: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const object = asObject(item);
    const params = object.param ?? object._param;
    if (Array.isArray(params)) {
      const first = idText(params[0]);
      if (first) result.push(first);
    }
    for (const child of Object.values(object)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return result;
}

/**
 * NpcGroup is a relation source rather than a dialogue source.  The group
 * record tells the client which quest state makes a talk available; it is
 * therefore kept as a raw, provenance-bearing edge and never used as a
 * title or a fuzzy quest match.
 */
export function parseNpcGroupRelations(
  value: Json,
  sourceFile: string,
  sourceHash: string,
): QuestRelationEdge[] {
  const rows = Array.isArray(value.OJACLOOEAMG) ? value.OJACLOOEAMG : [];
  const groupId = ids(value.BMFEMALEAIO)[0] ?? idText(value.groupId);
  const edges: QuestRelationEdge[] = [];
  for (const [index, raw] of rows.entries()) {
    const row = asObject(raw);
    const talkId = idText(row.OIFGMOHKPOI ?? row.talkId ?? row.talk ?? row.id);
    if (!talkId) continue;
    const explicitQuestIds = ids(
      row.CNFDMCLNLGI ?? row.questIds ?? row.mainQuestIds ?? row.questId,
    );
    const conditionQuestIds = collectConditionQuestIds(
      row.FCBOEAHDNOL ?? row.conditions ?? row.condition,
    );
    const questIds = [...new Set([...explicitQuestIds, ...conditionQuestIds])];
    for (const questId of questIds) {
      edges.push({
        fromQuestId: questId,
        toQuestId: undefined,
        talkId,
        relationType: "npc_group_trigger",
        sourceFile,
        sourcePath: `OJACLOOEAMG[${index}]`,
        sourceHash,
        derived: false,
        confidence: explicitQuestIds.includes(questId) ? 1 : 0.8,
        metadata: {
          groupId,
          triggerIndex: index,
          sourceKind: "npc_group" satisfies TalkSourceKind,
        },
      });
    }
  }
  return edges;
}
