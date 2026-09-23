import { describe, expect, it } from "vitest";
import { auditPublicStory } from "./public-story-audit.js";

describe("public story audit", () => {
  it("reports duplicate placement, orphan aggregate, cross-region family and empty narrative", () => {
    const report = auditPublicStory([
      { questId: "1", regionId: "a", familyId: "family", contentRole: "story" },
      { questId: "1", regionId: "a", familyId: "family", contentRole: "story" },
      { questId: "2", regionId: "b", familyId: "family", contentRole: "story" },
      { questId: "3", entryType: "collection", aggregateChildQuestIds: [] },
      {
        questId: "4",
        contentRole: "story",
        hasNarrativeSource: true,
        dialogueNodeCount: 0,
      },
    ]);
    expect(report.duplicateQuestPlacements).toEqual([{ questId: "1", placements: 2 }]);
    expect(report.orphanAggregates).toEqual(["3"]);
    expect(report.crossRegionFamilies[0]).toMatchObject({ familyId: "family" });
    expect(report.emptyNarrativeTasks).toEqual(["4"]);
  });
});
