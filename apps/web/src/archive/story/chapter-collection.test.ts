import { describe, expect, it } from "vitest";
import type { StoryCatalog } from "../../api.js";
import { buildStoryTree } from "./StoryCatalog.js";

describe("chapter collections", () => {
  it("keeps a collection inside its projected chapter", () => {
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
              id: "family",
              name: "山中好长日",
              order: 1,
              provenance: "curated",
              chapters: [
                {
                  id: "chapter",
                  name: "第二章 地狱",
                  order: 2,
                  quests: [],
                  collections: [
                    {
                      questKey: "quest/76152",
                      title: "狮子奋迅",
                      order: 1,
                      completeness: "complete",
                      bodyAvailability: "none",
                      entryType: "collection",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const family = buildStoryTree([], catalog)[0]?.children?.[0];
    expect(family?.children?.[0]).toMatchObject({ type: "chapter", title: "第二章 地狱" });
    expect(family?.children?.[0]?.children?.[0]).toMatchObject({
      type: "collection",
      title: "狮子奋迅",
    });
  });
});
