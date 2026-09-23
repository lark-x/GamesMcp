import { describe, expect, it } from "vitest";
import { projectStoryCatalog, type StoryProjectionInput } from "./story-projection.js";

describe("complex story family projection", () => {
  it("keeps Narzissenkreuz quests in one family with two subseries", () => {
    const groups = [
      ["水仙的安", ["74001", "74002", "74003", "74004"]],
      ["水仙的追迹", ["74072", "74073", "74074", "74075", "74076", "74077", "74165", "74078"]],
    ] as const;
    const rows: StoryProjectionInput[] = groups.flatMap(([title, ids], groupIndex) =>
      ids.map((questId, index) => ({
        questId,
        title: `任务 ${questId}`,
        order: index,
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:water-nymph-cross",
        familyTitle: "水仙十字系列",
        subseriesId: `subseries:${groupIndex}`,
        subseriesTitle: title,
        subseriesOrder: groupIndex,
        contentRole: "story" as const,
        dialogueResolutionStatus: "resolved" as const,
      })),
    );
    const family = projectStoryCatalog(rows)[0]?.families[0];
    expect(family?.title).toBe("水仙十字系列");
    expect(family?.subseries?.map((item) => item.title)).toEqual(["水仙的安", "水仙的追迹"]);
    expect(
      family?.subseries?.flatMap((item) => item.quests ?? []).map((item) => item.questId),
    ).toEqual([
      "74001",
      "74002",
      "74003",
      "74004",
      "74072",
      "74073",
      "74074",
      "74075",
      "74076",
      "74077",
      "74165",
      "74078",
    ]);
  });
});
