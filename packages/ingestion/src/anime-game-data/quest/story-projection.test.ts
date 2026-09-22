import { describe, expect, it } from "vitest";
import { projectStoryCatalog } from "./story-projection.js";

describe("story projection", () => {
  it("does not invent a chapter for a family-level quest", () => {
    const result = projectStoryCatalog([
      {
        questId: "76152",
        title: "狮子奋迅",
        order: 1,
        entryType: "collection",
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:standalone:fontaine",
        familyTitle: "其他独立任务",
        contentRole: "aggregate",
        dialogueResolutionStatus: "not_applicable",
      },
    ]);
    expect(result[0]?.families[0]?.chapters).toEqual([]);
    expect(result[0]?.families[0]?.collections?.[0]).toMatchObject({
      questId: "76152",
      entryType: "collection",
    });
  });
});
