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
        aggregateChildQuestIds: ["73019"],
      },
    ]);

    const family = regions[0]?.families[0];
    expect(family?.chapters).toEqual([]);
    expect(family?.quests?.map((entry) => entry.questId)).toEqual(["73019"]);
    expect(family?.collections?.map((entry) => entry.questId)).toEqual(["73013"]);
    expect(family?.collections?.[0]?.aggregateChildQuestIds).toEqual(["73019"]);
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
    expect(family?.collections).toHaveLength(0);
    expect(family?.chapters[0]?.quests[0]?.questId).toBe("76148");
    expect(family?.chapters[0]?.collections?.[0]?.questId).toBe("76152");
  });

  it("merges same-title families in the same region", () => {
    const regions = projectStoryCatalog([
      {
        questId: "76001",
        title: "第一部",
        order: 1,
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:series:long-day-part1",
        familyTitle: "山中好长日",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
      {
        questId: "76002",
        title: "第二部",
        order: 2,
        regionId: "fontaine",
        regionTitle: "枫丹",
        familyId: "genshin:series:long-day-part2",
        familyTitle: "山中好长日",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
    ]);

    expect(regions[0]?.families).toHaveLength(1);
    expect(regions[0]?.families[0]?.title).toBe("山中好长日");
    expect(regions[0]?.families[0]?.quests?.map((q) => q.questId)).toEqual(["76001", "76002"]);
  });

  it("creates family when familyTitle is present but familyId is omitted", () => {
    const regions = projectStoryCatalog([
      {
        questId: "80001",
        title: "捕风的异乡人",
        order: 1,
        regionId: "mondstadt",
        regionTitle: "蒙德",
        familyTitle: "魔神任务 · 序章「巨龙与自由之歌」",
        chapterTitle: "第一幕 捕风的异乡人",
        contentRole: "story",
        dialogueResolutionStatus: "resolved",
      },
    ]);

    expect(regions[0]?.families).toHaveLength(1);
    expect(regions[0]?.families[0]?.title).toBe("魔神任务 · 序章「巨龙与自由之歌」");
    expect(regions[0]?.families[0]?.chapters[0]?.title).toBe("第一幕 捕风的异乡人");
    expect(regions[0]?.families[0]?.chapters[0]?.quests[0]?.questId).toBe("80001");
  });
});
