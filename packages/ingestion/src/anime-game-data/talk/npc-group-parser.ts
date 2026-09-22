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

type ConditionEvidence = {
  questId: string;
  conditionType: string;
  expectedState?: string;
};

function normalizeConditionType(value: unknown): string | undefined {
  const raw = idText(value)?.toUpperCase();
  if (!raw) return undefined;
  const normalized = raw.replace(/^QUEST_COND_/u, "QUEST_");
  return new Set([
    "QUEST_STATE_EQUAL",
    "QUEST_STATE_NOT_EQUAL",
    "QUEST_VAR_EQUAL",
    "QUEST_FINISH",
  ]).has(normalized)
    ? normalized
    : undefined;
}

function collectConditionEvidence(value: unknown): ConditionEvidence[] {
  const result: ConditionEvidence[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const object = asObject(item);
    const conditionType = normalizeConditionType(
      object._type ?? object.type ?? object.conditionType,
    );
    const params = object.param ?? object._param;
    // A numeric first parameter is a quest id only for a known quest condition
    // type. This prevents NPC group scene ids and arbitrary Lua parameters from
    // becoming fake quest relations.
    if (conditionType && Array.isArray(params)) {
      const first = idText(params[0]);
      if (first)
        result.push({
          questId: first,
          conditionType,
          expectedState: idText(params[1]),
        });
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
    const conditionEvidence = collectConditionEvidence(
      row.FCBOEAHDNOL ?? row.conditions ?? row.condition,
    );
    const questIds = [
      ...new Set([...explicitQuestIds, ...conditionEvidence.map((item) => item.questId)]),
    ];
    for (const questId of questIds) {
      const condition = conditionEvidence.find((item) => item.questId === questId);
      if (condition) {
        edges.push({
          fromQuestId: questId,
          talkId,
          relationType: "npc_group_condition",
          rawRelationType: condition.conditionType,
          sourceFile,
          sourcePath: `OJACLOOEAMG[${index}].FCBOEAHDNOL`,
          sourceHash,
          derived: false,
          confidence: 1,
          expectedState: condition.expectedState,
          metadata: {
            groupId,
            triggerIndex: index,
            conditionType: condition.conditionType,
            sourceKind: "npc_group" satisfies TalkSourceKind,
          },
        });
      }
      edges.push({
        fromQuestId: questId,
        toQuestId: undefined,
        talkId,
        relationType: "npc_group_trigger",
        sourceFile,
        sourcePath: `OJACLOOEAMG[${index}]`,
        sourceHash,
        derived: false,
        confidence: explicitQuestIds.includes(questId) ? 1 : 0.9,
        metadata: {
          groupId,
          triggerIndex: index,
          sourceKind: "npc_group" satisfies TalkSourceKind,
          conditionType: condition?.conditionType,
        },
      });
    }
  }
  return edges;
}
