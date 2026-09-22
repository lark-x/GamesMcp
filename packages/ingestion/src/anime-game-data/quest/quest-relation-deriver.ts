import type { QuestRelationEdge } from "./types.js";
import type { RawQuestGraph } from "./raw-quest-graph.js";

const finishedStates = new Set(["3", "FINISHED", "COMPLETE", "COMPLETED", "SUCCESS"]);

function mainQuestId(graph: RawQuestGraph, id: string): string {
  return graph.subQuestToMainQuest.get(id) ?? id;
}

function derivedId(
  edge: QuestRelationEdge,
  relationType: string,
  from: string,
  to: string,
): string {
  return `derived:${relationType}:${from}:${to}:${edge.edgeId ?? edge.sourceFile}:${edge.sourcePath ?? ""}`;
}

function asDerived(
  edge: QuestRelationEdge,
  relationType: QuestRelationEdge["relationType"],
  fromQuestId: string,
  toQuestId: string,
  metadata?: Record<string, unknown>,
): QuestRelationEdge {
  return {
    ...edge,
    edgeId: derivedId(edge, relationType, fromQuestId, toQuestId),
    fromQuestId,
    toQuestId,
    relationType,
    derived: true,
    evidenceEdges: [edge.edgeId ?? ""].filter(Boolean),
    metadata: { ...edge.metadata, ...metadata },
  };
}

/**
 * Convert runtime relations into relations that are safe for ordering.  Raw
 * state checks intentionally never enter the ordering graph: a quest checking
 * that B is finished means B is a prerequisite of the quest doing the check.
 */
export function deriveQuestRelations(graph: RawQuestGraph): QuestRelationEdge[] {
  const derived: QuestRelationEdge[] = [];
  for (const edge of graph.edges) {
    if (!edge.toQuestId) continue;
    const from = mainQuestId(graph, edge.fromQuestId);
    const to = mainQuestId(graph, edge.toQuestId);
    if (from === to) continue;
    if (edge.relationType === "quest_state_equal") {
      const state = String(edge.expectedState ?? edge.metadata?.state ?? "").toUpperCase();
      if (finishedStates.has(state)) {
        // Raw edge: current -> dependency. Derived edge: dependency -> current.
        derived.push(
          asDerived(edge, "requires", to, from, {
            expectedState: edge.expectedState ?? edge.metadata?.state,
            direction: "dependency_to_current",
          }),
        );
      }
    } else if (edge.relationType === "main_quest_relation") {
      // The upstream relation table stores the next/related quest on the row
      // for the current quest. Keep that direction as a soft ordering edge;
      // it is never used as evidence stronger than an explicit prerequisite.
      derived.push(asDerived(edge, "starts_after", from, to, { direction: "upstream_row" }));
    } else if (edge.relationType === "aggregate_of" || edge.relationType === "add_quest_progress") {
      // The progress target is the aggregate quest; the source contributes to
      // it.  This edge is structural, not a textual/ordering prerequisite.
      derived.push(
        asDerived(edge, "aggregate_of", to, from, {
          direction: "aggregate_to_child",
          progressTarget: edge.toQuestId,
        }),
      );
    }
  }
  return dedupeDerivedEdges(derived);
}

export function dedupeDerivedEdges(edges: QuestRelationEdge[]): QuestRelationEdge[] {
  const unique = new Map<string, QuestRelationEdge>();
  for (const edge of edges) {
    const key = [edge.relationType, edge.fromQuestId, edge.toQuestId ?? ""].join("|");
    const existing = unique.get(key);
    if (!existing) unique.set(key, edge);
    else {
      existing.evidenceEdges = [
        ...new Set([...(existing.evidenceEdges ?? []), ...(edge.evidenceEdges ?? [])]),
      ];
    }
  }
  return [...unique.values()];
}

export function connectedQuestComponents(
  questIds: string[],
  edges: QuestRelationEdge[],
  options: {
    compatible?: (leftQuestId: string, rightQuestId: string) => boolean;
  } = {},
): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const id of questIds) adjacency.set(id, new Set());
  for (const edge of edges) {
    if (!edge.toQuestId || !adjacency.has(edge.fromQuestId) || !adjacency.has(edge.toQuestId))
      continue;
    // Components are used to discover a family, so structural and prerequisite
    // edges are intentionally treated as undirected here. Ordering still uses
    // the directed derived graph.
    if (!["requires", "starts_after", "aggregate_of"].includes(edge.relationType)) continue;
    if (options.compatible && !options.compatible(edge.fromQuestId, edge.toQuestId)) continue;
    adjacency.get(edge.fromQuestId)!.add(edge.toQuestId);
    adjacency.get(edge.toQuestId)!.add(edge.fromQuestId);
  }
  const result = new Map<string, string[]>();
  const visited = new Set<string>();
  for (const root of questIds) {
    if (visited.has(root)) continue;
    const component: string[] = [];
    const queue = [root];
    visited.add(root);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    for (const id of component) result.set(id, component);
  }
  return result;
}
