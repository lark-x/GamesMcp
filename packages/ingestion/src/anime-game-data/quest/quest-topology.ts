import type { QuestRelationEdge, QuestTopology } from "./types.js";
import { classifyQuestContentRole } from "./quest-classifier.js";

function numeric(value: string): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.MAX_SAFE_INTEGER;
}

export function topologicalQuestOrder(
  questIds: string[],
  edges: QuestRelationEdge[],
  upstreamOrder = new Map<string, number>(),
): string[] {
  const ids = [...new Set(questIds)];
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!edge.toQuestId || !indegree.has(edge.fromQuestId) || !indegree.has(edge.toQuestId)) continue;
    if (!new Set(["starts_after", "requires", "quest_state_equal", "main_quest_relation"]).has(edge.relationType)) continue;
    const next = adjacency.get(edge.fromQuestId) ?? new Set<string>();
    if (!next.has(edge.toQuestId)) {
      next.add(edge.toQuestId);
      indegree.set(edge.toQuestId, (indegree.get(edge.toQuestId) ?? 0) + 1);
    }
    adjacency.set(edge.fromQuestId, next);
  }
  const available = ids.filter((id) => indegree.get(id) === 0);
  const sortAvailable = (): void => {
    available.sort(
      (left, right) =>
        (upstreamOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (upstreamOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        numeric(left) - numeric(right) ||
        left.localeCompare(right),
    );
  };
  sortAvailable();
  const result: string[] = [];
  while (available.length) {
    const current = available.shift()!;
    result.push(current);
    for (const target of adjacency.get(current) ?? []) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        available.push(target);
        sortAvailable();
      }
    }
  }
  const remaining = ids.filter((id) => !result.includes(id));
  remaining.sort(
    (left, right) =>
      (upstreamOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (upstreamOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      numeric(left) - numeric(right) ||
      left.localeCompare(right),
  );
  return [...result, ...remaining];
}

export function buildQuestTopologies(
  questIds: string[],
  relationEdges: QuestRelationEdge[],
  contentRoles = new Map<string, QuestTopology["contentRole"]>(),
  upstreamOrder = new Map<string, number>(),
): Map<string, QuestTopology> {
  const topologies = new Map<string, QuestTopology>();
  for (const questId of questIds) {
    const relevant = relationEdges.filter(
      (edge) => edge.fromQuestId === questId || edge.toQuestId === questId,
    );
    const prerequisiteQuestIds = [...new Set(
      relevant
        .filter((edge) => edge.toQuestId === questId)
        .map((edge) => edge.fromQuestId),
    )];
    const childQuestIds = [...new Set(
      relevant
        .filter((edge) => edge.fromQuestId === questId && edge.toQuestId)
        .map((edge) => edge.toQuestId!),
    )];
    topologies.set(questId, {
      questId,
      prerequisiteQuestIds,
      childQuestIds,
      parentQuestIds: prerequisiteQuestIds,
      storyOrder: upstreamOrder.get(questId),
      contentRole:
        contentRoles.get(questId) ??
        classifyQuestContentRole({ hasExplicitStoryTalk: false, resolvedTalkCount: 0, dialogueNodeCount: 0 }),
      relationEdges: relevant,
    });
  }
  const order = topologicalQuestOrder(questIds, relationEdges, upstreamOrder);
  for (const [index, questId] of order.entries()) {
    const topology = topologies.get(questId);
    if (topology) topology.storyOrder = index;
  }
  return topologies;
}
