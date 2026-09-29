import { describe, expect, it } from "vitest";
import { collectProjectionTreeDuplicates, projectStoryCatalog } from "./story-projection.js";

describe("story projection", () => {
  it("keeps a quest without reliable family evidence directly under its region", () => {
    const result = projectStoryCatalog([
      {
        questId: "76152",
        title: "狮子奋迅",
        order: 1,
        entryType: "collection",
        regionId: "fontaine",
        regionTitle: "枫丹",
        contentRole: "aggregate",
        dialogueResolutionStatus: "not_applicable",
      },
    ]);
    expect(result[0]?.families).toEqual([]);
    expect(result[0]?.collections?.[0]).toMatchObject({
      questId: "76152",
      entryType: "collection",
    });
  });

  it("keeps same-title quest IDs as separate entries in the region projection", () => {
    const result = projectStoryCatalog([
      {
        questId: "76148",
        title: "狮子奋迅",
        order: 1,
        regionId: "fontaine",
        regionTitle: "枫丹",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
      {
        questId: "76152",
        title: "狮子奋迅",
        order: 2,
        regionId: "fontaine",
        regionTitle: "枫丹",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
    ]);

    expect(result[0]?.quests?.map((quest) => quest.questId)).toEqual(["76148", "76152"]);
    expect(result[0]?.families).toEqual([]);
  });
});

describe("projection tree duplicate detection", () => {
  const row = (questId: string, overrides: Record<string, unknown> = {}) => ({
    questId,
    title: questId,
    order: 1,
    regionId: "mondstadt",
    regionTitle: "蒙德",
    ...overrides,
  });

  it("reports nothing for a clean tree", () => {
    const tree = projectStoryCatalog([row("1001"), row("1002")]);
    expect(collectProjectionTreeDuplicates(tree)).toEqual([]);
  });

  it("reports a quest placed in two different regions", () => {
    const tree = projectStoryCatalog([row("1001"), row("1001", { regionId: "liyue", regionTitle: "璃月" })]);
    expect(collectProjectionTreeDuplicates(tree)).toEqual([
      { questId: "1001", containers: ["liyue", "mondstadt"] },
    ]);
  });

  it("reports a quest placed both directly under its region and inside a family", () => {
    const tree = projectStoryCatalog([
      row("1001"),
      row("1001", { familyId: "fam", familyTitle: "系列" }),
    ]);
    expect(collectProjectionTreeDuplicates(tree)).toEqual([
      { questId: "1001", containers: ["mondstadt", "mondstadt/fam"] },
    ]);
  });
});
