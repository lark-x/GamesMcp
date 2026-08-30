import { describe, expect, it } from "vitest";
import { assertRetrievalTargets, evaluateGoldenSet } from "./evaluation.js";

describe("retrieval evaluation", () => {
  it("computes top-k recall and tagged metrics", async () => {
    const result = await evaluateGoldenSet(
      [
        {
          query: "旅行者",
          expected_entity_ids: ["entity-1"],
          exact_name: true,
          tags: ["zh", "exact"],
        },
        {
          query: "血亲",
          expected_document_ids: ["document-1"],
          tags: ["lore"],
        },
      ],
      async (golden) =>
        golden.query === "旅行者"
          ? {
              entities: [{ id: "entity-1", name: "旅行者", type: "character", aliases: [] }],
              documents: [],
              segments: [],
              revision: "r1",
              indexStatus: "ready",
            }
          : {
              entities: [],
              documents: [
                { id: "document-1", title: "踏入提瓦特", type: "lore", gameVersion: "fixture" },
              ],
              segments: [],
              revision: "r1",
              indexStatus: "ready",
            },
    );

    expect(result.entityTop5Recall).toBe(1);
    expect(result.documentTop10Recall).toBe(1);
    expect(result.exactNameTop1).toBe(1);
    expect(result.byTag.zh?.entityTop5Recall).toBe(1);
    expect(() =>
      assertRetrievalTargets(result, {
        entityTop5Recall: 0.95,
        documentTop10Recall: 0.9,
        exactNameTop1: 0.98,
      }),
    ).not.toThrow();
  });
});
