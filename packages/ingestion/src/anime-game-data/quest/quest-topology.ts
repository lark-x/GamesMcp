import type { QuestBinRecord, QuestRelationEdge, QuestTopology } from "./types.js";
import { classifyQuestContentRole } from "./quest-classifier.js";
import { buildRawQuestGraph } from "./raw-quest-graph.js";
import { deriveQuestRelations } from "./quest-relation-deriver.js";

function numeric(value: string): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.MAX_SAFE_INTEGER;
}

function orderingEdges(edges: QuestRelationEdge[]): QuestRelationEdge[] {
  return edges.filter(
    (edge) => edge.toQuestId && ["requires", "starts_after"].includes(edge.relationType),
  );
}

function deriveSubQuestEdges(graph: ReturnType<typeof buildRawQuestGraph>): QuestRelationEdge[] {
  const derived: QuestRelationEdge[] = [];
  for (const edge of graph.edges) {
    const fromSubQuestId =
      edge.fromSubQuestId ??
      (graph.subQuestToMainQuest.has(edge.fromQuestId) ? edge.fromQuestId : undefined);
    const toSubQuestId =
      edge.toSubQuestId ??
      (edge.toQuestId && graph.subQuestToMainQuest.has(edge.toQuestId)
        ? edge.toQuestId
        : undefined);
    if (!fromSubQuestId || !toSubQuestId) continue;
    if (edge.relationType !== "quest_state_equal") continue;
    const state = String(edge.expectedState ?? edge.metadata?.state ?? "").toUpperCase();
    if (!(state === "3" || state === "FINISHED" || state === "COMPLETE" || state === "SUCCESS"))
      continue;
    derived.push({
      ...edge,
      edgeId: `derived:sub:requires:${toSubQuestId}:${fromSubQuestId}:${edge.edgeId ?? ""}`,
      fromQuestId: toSubQuestId,
      toQuestId: fromSubQuestId,
      fromSubQuestId: toSubQuestId,
      toSubQuestId: fromSubQuestId,
      relationType: "requires",
      derived: true,
      evidenceEdges: [edge.edgeId ?? ""].filter(Boolean),
      metadata: {
        ...edge.metadata,
        direction: "dependency_subquest_to_current_subquest",
      },
    });
  }
  return derived;
}

function compareQuestIds(left: string, right: string, upstreamOrder: Map<string, number>): number {
  return (
    (upstreamOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (upstreamOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    numeric(left) - numeric(right) ||
    left.localeCompare(right)
  );
}

export type TopologicalOrderResult = {
  order: string[];
  cycle: boolean;
  cycleNodeIds: string[];
};

export function topologicalQuestOrderDetailed(
  questIds: string[],
  edges: QuestRelationEdge[],
  upstreamOrder = new Map<string, number>(),
): TopologicalOrderResult {
  const ids = [...new Set(questIds)];
  const idSet = new Set(ids);
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of orderingEdges(edges)) {
    if (!idSet.has(edge.fromQuestId) || !idSet.has(edge.toQuestId!)) continue;
    const next = adjacency.get(edge.fromQuestId) ?? new Set<string>();
    if (next.has(edge.toQuestId!)) continue;
    next.add(edge.toQuestId!);
    adjacency.set(edge.fromQuestId, next);
    indegree.set(edge.toQuestId!, (indegree.get(edge.toQuestId!) ?? 0) + 1);
  }
  const available = ids
    .filter((id) => indegree.get(id) === 0)
    .sort((a, b) => compareQuestIds(a, b, upstreamOrder));
  const result: string[] = [];
  while (available.length) {
    const current = available.shift()!;
    result.push(current);
    for (const target of adjacency.get(current) ?? []) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        available.push(target);
        available.sort((a, b) => compareQuestIds(a, b, upstreamOrder));
      }
    }
  }
  const cycleNodeIds = ids
    .filter((id) => !result.includes(id))
    .sort((a, b) => compareQuestIds(a, b, upstreamOrder));
  return { order: [...result, ...cycleNodeIds], cycle: cycleNodeIds.length > 0, cycleNodeIds };
}

export function topologicalQuestOrder(
  questIds: string[],
  edges: QuestRelationEdge[],
  upstreamOrder = new Map<string, number>(),
): string[] {
  return topologicalQuestOrderDetailed(questIds, edges, upstreamOrder).order;
}

export type BuildQuestTopologiesOptions = {
  binRecords?: QuestBinRecord[];
};

export function buildQuestTopologies(
  questIds: string[],
  relationEdges: QuestRelationEdge[],
  contentRoles = new Map<string, QuestTopology["contentRole"]>(),
  upstreamOrder = new Map<string, number>(),
  options: BuildQuestTopologiesOptions = {},
): Map<string, QuestTopology> {
  const graph = buildRawQuestGraph({ questIds, binRecords: options.binRecords, relationEdges });
  const derivedRelationEdges = deriveQuestRelations(graph);
  const derivedSubQuestEdges = deriveSubQuestEdges(graph);
  const orderResult = topologicalQuestOrderDetailed(questIds, derivedRelationEdges, upstreamOrder);
  const mainIds = new Set(questIds);
  const relevantRaw = (questId: string): QuestRelationEdge[] =>
    graph.edges.filter((edge) => {
      const from = graph.subQuestToMainQuest.get(edge.fromQuestId) ?? edge.fromQuestId;
      const to = edge.toQuestId
        ? (graph.subQuestToMainQuest.get(edge.toQuestId) ?? edge.toQuestId)
        : undefined;
      return from === questId || to === questId;
    });
  const relevantDerived = (questId: string): QuestRelationEdge[] =>
    derivedRelationEdges.filter(
      (edge) => edge.fromQuestId === questId || edge.toQuestId === questId,
    );
  const subQuestIdsByMain = new Map<string, string[]>();
  for (const record of options.binRecords ?? [])
    subQuestIdsByMain.set(record.mainQuestId, record.subQuestIds);
  const topologies = new Map<string, QuestTopology>();
  for (const questId of questIds) {
    const rawRelationEdges = relevantRaw(questId);
    const derived = relevantDerived(questId);
    const prerequisites = [
      ...new Set(
        derived
          .filter(
            (edge) =>
              edge.toQuestId === questId &&
              ["requires", "starts_after"].includes(edge.relationType),
          )
          .map((edge) => edge.fromQuestId),
      ),
    ];
    const children = [
      ...new Set(
        derived
          .filter((edge) => edge.fromQuestId === questId && edge.toQuestId)
          .map((edge) => edge.toQuestId!),
      ),
    ];
    const aggregateParentQuestId = derived.find(
      (edge) => edge.toQuestId === questId && edge.relationType === "aggregate_of",
    )?.fromQuestId;
    const danglingEdges = derived.filter(
      (edge) =>
        (edge.fromQuestId === questId && edge.toQuestId && !mainIds.has(edge.toQuestId)) ||
        (edge.toQuestId === questId && !mainIds.has(edge.fromQuestId)),
    );
    const subQuestIds = subQuestIdsByMain.get(questId) ?? [];
    const subQuestSet = new Set(subQuestIds);
    const subQuestRelationEdges = derivedSubQuestEdges.filter(
      (edge) =>
        subQuestSet.has(edge.fromQuestId) &&
        Boolean(edge.toQuestId && subQuestSet.has(edge.toQuestId)),
    );
    const subQuestUpstreamOrder = new Map(subQuestIds.map((id, index) => [id, index] as const));
    const subQuestOrder = [...subQuestIds].sort(
      (left, right) =>
        (subQuestUpstreamOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (subQuestUpstreamOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        numeric(left) - numeric(right),
    );
    const subQuestOrderResult = topologicalQuestOrderDetailed(
      subQuestIds,
      subQuestRelationEdges,
      subQuestUpstreamOrder,
    );
    const parentQuestIds = [
      ...new Set([...prerequisites, ...(aggregateParentQuestId ? [aggregateParentQuestId] : [])]),
    ];
    topologies.set(questId, {
      questId,
      prerequisiteQuestIds: prerequisites,
      childQuestIds: children,
      parentQuestIds,
      storyOrder: orderResult.order.indexOf(questId),
      contentRole:
        contentRoles.get(questId) ??
        classifyQuestContentRole({
          hasExplicitStoryTalk: false,
          resolvedTalkCount: 0,
          dialogueNodeCount: 0,
        }),
      relationEdges: [...rawRelationEdges, ...derived],
      rawRelationEdges,
      derivedRelationEdges: derived,
      subQuestIds,
      subQuestOrder: subQuestOrderResult.order.length ? subQuestOrderResult.order : subQuestOrder,
      subQuestRelationEdges,
      aggregateParentQuestId,
      cycle: orderResult.cycle && orderResult.cycleNodeIds.includes(questId),
      cycleNodeIds: orderResult.cycleNodeIds.includes(questId) ? orderResult.cycleNodeIds : [],
      danglingEdges,
    });
  }
  return topologies;
}
