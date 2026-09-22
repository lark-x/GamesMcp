import type { QuestBinRecord, QuestRelationEdge } from "./types.js";

export type RawQuestGraph = {
  questIds: string[];
  subQuestToMainQuest: Map<string, string>;
  edges: QuestRelationEdge[];
  edgesByFromQuest: Map<string, QuestRelationEdge[]>;
  edgesByToQuest: Map<string, QuestRelationEdge[]>;
};

function stableEdgeId(edge: QuestRelationEdge): string {
  return (
    edge.edgeId ??
    [
      edge.fromQuestId,
      edge.toQuestId ?? "",
      edge.fromSubQuestId ?? "",
      edge.toSubQuestId ?? "",
      edge.talkId ?? "",
      edge.relationType,
      edge.sourceFile,
      edge.sourcePath ?? "",
    ].join("|")
  );
}

export function buildRawQuestGraph(input: {
  questIds: string[];
  binRecords?: QuestBinRecord[];
  relationEdges?: QuestRelationEdge[];
}): RawQuestGraph {
  const subQuestToMainQuest = new Map<string, string>();
  for (const record of input.binRecords ?? []) {
    for (const subQuestId of record.subQuestIds)
      subQuestToMainQuest.set(subQuestId, record.mainQuestId);
  }
  const byId = new Map<string, QuestRelationEdge>();
  for (const edge of input.relationEdges ?? []) {
    const normalized = { ...edge, edgeId: stableEdgeId(edge) };
    byId.set(normalized.edgeId!, normalized);
  }
  const edges = [...byId.values()];
  const edgesByFromQuest = new Map<string, QuestRelationEdge[]>();
  const edgesByToQuest = new Map<string, QuestRelationEdge[]>();
  for (const edge of edges) {
    const from = edgesByFromQuest.get(edge.fromQuestId) ?? [];
    from.push(edge);
    edgesByFromQuest.set(edge.fromQuestId, from);
    if (edge.toQuestId) {
      const to = edgesByToQuest.get(edge.toQuestId) ?? [];
      to.push(edge);
      edgesByToQuest.set(edge.toQuestId, to);
    }
  }
  return {
    questIds: [...new Set(input.questIds)],
    subQuestToMainQuest,
    edges,
    edgesByFromQuest,
    edgesByToQuest,
  };
}
