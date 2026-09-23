import { describe, expect, it } from "vitest";
import { buildQuestTopologies } from "./quest-topology.js";
import type { QuestRelationEdge } from "./types.js";

function raw(field: "a" | "b" | "unknown", from: string, to: string): QuestRelationEdge {
  return {
    edgeId: `${field}:${from}:${to}`,
    fromQuestId: from,
    toQuestId: to,
    relationType: `main_quest_relation_${field}`,
    rawField: field,
    rawIndex: 0,
    sourceFile: "MainQuestFmtQuestRelateExcelConfigData.json",
    sourcePath: `rows.${field}[0]`,
    sourceHash: "fixture",
    derived: false,
    confidence: 1,
  };
}

describe("MainQuest relation semantics", () => {
  it("preserves raw evidence without deriving story order", () => {
    const topologies = buildQuestTopologies(
      ["A", "B", "C"],
      [raw("a", "A", "B"), raw("b", "B", "C"), raw("unknown", "C", "A")],
      new Map(),
      new Map([
        ["A", 0],
        ["B", 1],
        ["C", 2],
      ]),
    );

    expect(topologies.get("A")?.relatedQuestIds).toEqual(expect.arrayContaining(["B", "C"]));
    expect(topologies.get("A")?.successorQuestIds).toEqual([]);
    expect(topologies.get("A")?.cycle).toBe(false);
    expect(topologies.get("A")?.orderSource).toBe("upstream");
    expect(topologies.get("A")?.rawRelationEdges).toEqual(
      expect.arrayContaining([expect.objectContaining({ rawField: "a", rawIndex: 0 })]),
    );
  });

  it("keeps aggregate children separate from successors", () => {
    const aggregate: QuestRelationEdge = {
      ...raw("a", "child", "collection"),
      relationType: "add_quest_progress",
    };
    const topology = buildQuestTopologies(["collection", "child"], [aggregate]).get("collection");
    expect(topology?.aggregateChildQuestIds).toEqual(["child"]);
    expect(topology?.successorQuestIds).toEqual([]);
  });
});
