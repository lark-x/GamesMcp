import { describe, expect, it } from "vitest";
import { cosineSimilarity, OpenAICompatibleEmbeddingProvider } from "./index.js";

describe("embedding space", () => {
  it("identifies a model and dimension as one space", () => {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "http://localhost",
      model: "model-a",
      modelVersion: "1",
      dimension: 2,
    });
    expect(provider.space.id).toBe("model-a:1:2");
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
});
