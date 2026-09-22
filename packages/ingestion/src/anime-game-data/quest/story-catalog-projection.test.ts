import { describe, expect, it } from "vitest";
import { projectStoryCatalog } from "./story-projection.js";

describe("story catalog projection", () => {
  it("keeps family-level quests direct and aggregates as collections", () => {
    const regions = projectStoryCatalog([
      {
        questId: "73019",
        title: "料理是快乐的回忆",
        order: 2,
        entryType: "quest",
        regionId: "sumeru",
        regionTitle: "须弥",
        familyId: "genshin:series:73013",
        familyTitle: "愿为一炊之梦",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
      {
        questId: "73013",
        title: "为那菈献上珍馐",
        order: 1,
        entryType: "collection",
        regionId: "sumeru",
        regionTitle: "须弥",
        familyId: "genshin:series:73013",
        familyTitle: "愿为一炊之梦",
        contentRole: "aggregate",
        dialogueResolutionStatus: "not_applicable",
        childQuestIds: ["73019"],
      },
    ]);

    const family = regions[0]?.families[0];
    expect(family?.chapters).toEqual([]);
    expect(family?.quests?.map((entry) => entry.questId)).toEqual(["73019"]);
    expect(family?.collections?.map((entry) => entry.questId)).toEqual(["73013"]);
    expect(family?.collections?.[0]?.childQuestIds).toEqual(["73019"]);
  });

  it("does not merge same-title quests into one entry", () => {
    const regions = projectStoryCatalog([
      {
        questId: "76148",
        title: "狮子奋迅",
        order: 1,
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:series:long-day",
        familyTitle: "山中好长日",
        chapterId: "10132",
        chapterTitle: "山中好长日·第二章 地狱",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
      {
        questId: "76152",
        title: "狮子奋迅",
        order: 2,
        entryType: "collection",
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:series:long-day",
        familyTitle: "山中好长日",
        chapterId: "10132",
        chapterTitle: "山中好长日·第二章 地狱",
        contentRole: "aggregate",
        dialogueResolutionStatus: "not_applicable",
      },
    ]);

    const family = regions[0]?.families[0];
    expect(family?.chapters[0]?.quests).toHaveLength(1);
    expect(family?.collections).toHaveLength(1);
    expect(family?.chapters[0]?.quests[0]?.questId).toBe("76148");
    expect(family?.collections?.[0]?.questId).toBe("76152");
  });
});
