import { describe, expect, it } from "vitest";
import { buildQuestTopologies, topologicalQuestOrderDetailed } from "./quest-topology.js";
import type { QuestRelationEdge } from "./types.js";

function edge(
  fromQuestId: string,
  toQuestId: string,
  relationType: QuestRelationEdge["relationType"],
  expectedState?: string,
): QuestRelationEdge {
  return {
    edgeId: `${fromQuestId}-${toQuestId}-${relationType}`,
    fromQuestId,
    toQuestId,
    relationType,
    sourceFile: "fixture",
    sourceHash: "hash",
    derived: relationType === "requires" || relationType === "starts_after",
    confidence: 1,
    expectedState,
  };
}

describe("quest topology", () => {
  it("reverses a finished state check into a prerequisite", () => {
    const topologies = buildQuestTopologies(["A", "B"], [edge("A", "B", "quest_state_equal", "3")]);
    expect(topologies.get("A")?.prerequisiteQuestIds).toEqual(["B"]);
    expect(
      topologicalQuestOrderDetailed(
        ["A", "B"],
        [
          { ...edge("A", "B", "quest_state_equal", "3"), derived: false },
          edge("B", "A", "requires"),
        ],
      ).order,
    ).toEqual(["B", "A"]);
  });

  it("keeps rootless cycles visible in diagnostics", () => {
    const result = topologicalQuestOrderDetailed(
      ["A", "B", "C"],
      [edge("A", "B", "requires"), edge("B", "C", "requires"), edge("C", "A", "requires")],
    );
    expect(result.cycle).toBe(true);
    expect(result.cycleNodeIds).toEqual(["A", "B", "C"]);
  });

  it("keeps the main quest and its subquest evidence in one topology", () => {
    const topologies = buildQuestTopologies(
      ["73013", "73019"],
      [
        edge("7301302", "7301906", "quest_state_equal", "3"),
        edge("73019", "73013", "add_quest_progress"),
      ],
      new Map([
        ["73013", "story_and_control"],
        ["73019", "story"],
      ]),
      new Map([
        ["73013", 0],
        ["73019", 1],
      ]),
      {
        binRecords: [
          {
            mainQuestId: "73013",
            sourceFile: "73013.json",
            sourceHash: "hash",
            subQuestIds: ["7301302"],
            contents: [],
            relationEdges: [],
            contentCounts: {},
            hasCompleteTalk: false,
            completeTalkIds: [],
          },
          {
            mainQuestId: "73019",
            sourceFile: "73019.json",
            sourceHash: "hash",
            subQuestIds: ["7301906"],
            contents: [],
            relationEdges: [],
            contentCounts: {},
            hasCompleteTalk: false,
            completeTalkIds: [],
          },
        ],
      },
    );
    expect(topologies.get("73013")?.prerequisiteQuestIds).toEqual(["73019"]);
    expect(topologies.get("73013")?.subQuestRelationEdges).toEqual([]);
    expect(topologies.get("73013")?.rawRelationEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: "quest_state_equal",
          fromQuestId: "7301302",
        }),
      ]),
    );
  });
});
