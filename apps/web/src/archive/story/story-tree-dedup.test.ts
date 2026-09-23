import { describe, expect, it } from "vitest";
import type { StoryCatalog } from "../../api.js";
import { buildStoryTree, flattenStoryTreeQuests } from "./StoryCatalog.js";

describe("story tree aggregate deduplication", () => {
  it("renders aggregate child 76148 exactly once under collection 76152", () => {
    const entry = (questKey: string, title: string) => ({
      questKey,
      title,
      order: 1,
      completeness: "complete" as const,
      bodyAvailability: "dialogue" as const,
    });
    const catalog: StoryCatalog = {
      gameId: "genshin",
      revisionId: "r-next",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 5,
          chapters: [],
          families: [
            {
              id: "long-day",
              name: "山中好长日",
              order: 1,
              provenance: "curated",
              chapters: [
                {
                  id: "hell",
                  name: "第二章 地狱",
                  order: 2,
                  quests: [entry("quest/76148", "狮子奋迅")],
                  collections: [
                    {
                      ...entry("quest/76152", "狮子奋迅"),
                      entryType: "collection",
                      aggregateChildQuestIds: ["76148"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const flattened = flattenStoryTreeQuests(buildStoryTree([], catalog));
    expect(flattened.filter((item) => item.questKey === "quest/76148")).toHaveLength(1);
  });
});
