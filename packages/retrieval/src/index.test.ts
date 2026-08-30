import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  normalizeQuery,
  RetrievalService,
  weightedHybridScore,
} from "./index.js";

describe("retrieval helpers", () => {
  it("normalizes Chinese and English queries", () => {
    expect(normalizeQuery("  旅行者  ")).toBe("旅行者");
    expect(normalizeQuery("ＡＢＣ")).toBe("abc");
  });

  it("prioritizes exact names over semantic fallback", () => {
    expect(weightedHybridScore({ exactName: 1 })).toBeGreaterThan(
      weightedHybridScore({ vector: 1 }),
    );
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("uses entity vector recall when an entity-only search requests semantics", async () => {
    const vectorEntity = {
      id: "00000000-0000-0000-0000-000000000010",
      name: "旅行者",
      type: "character" as const,
      aliases: [],
      score: 0.8,
      match: "vector",
      revision: "r1",
    };
    const repository = {
      search: async () => ({
        entities: [],
        documents: [],
        segments: [],
        revision: "r1",
        indexStatus: "ready",
      }),
      vectorSearch: async () => {
        throw new Error("document vector search should not run for entity-only queries");
      },
      vectorEntitySearch: async () => [{ entity: vectorEntity, score: 0.8 }],
    } as never;
    const service = new RetrievalService(repository, {
      space: { id: "space", model: "model", modelVersion: "1", dimension: 2 },
      embed: async () => [[1, 0]],
    });
    const result = await service.search("game", {
      query: "旅行者",
      types: ["entity"],
      limit: 5,
      debug: true,
    });
    expect(result.entities[0]?.name).toBe("旅行者");
    expect(result.debug?.vector).toBe(true);
  });
});
