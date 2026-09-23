import { describe, expect, it } from "vitest";
import { analyzeDialogueComponents } from "./dialogue-graph.js";

describe("dialogue graph components", () => {
  it("traverses every disconnected component and reports rootless SCCs", () => {
    const analysis = analyzeDialogueComponents(
      [
        { dialogId: "1", nextDialogIds: ["2"] },
        { dialogId: "2", nextDialogIds: [] },
        { dialogId: "10", nextDialogIds: ["11"] },
        { dialogId: "11", nextDialogIds: ["10"] },
      ],
      ["1"],
    );
    expect(analysis.traversalRoots).toEqual(["1", "10"]);
    expect(analysis.componentCount).toBe(2);
    expect(analysis.rootlessComponentCount).toBe(1);
    expect(analysis.stronglyConnectedComponents).toEqual([["10", "11"]]);
    expect(analysis.unreachableDialogueIds).toEqual([]);
  });
});
