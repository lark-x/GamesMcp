import { describe, expect, it } from "vitest";
import { GameProviderError, GameProviderRegistry, type GameKnowledgeProvider } from "./index.js";

function fakeProvider(gameSlug: string, id = `fake-${gameSlug}`): GameKnowledgeProvider {
  return {
    id,
    gameSlug,
    kind: "knowledge",
    capabilities: ["knowledge_search", "document_read"],
    health: async () => ({
      id,
      game: gameSlug,
      kind: "knowledge",
      status: "available",
      capabilities: ["knowledge_search", "document_read"],
      checkedAt: new Date(0).toISOString(),
    }),
    search: async (request) => ({
      game: request.game,
      provider: id,
      mode: request.mode ?? "hybrid",
      hits: [],
      truncated: false,
    }),
    getDocument: async (request) => ({
      game: request.game,
      provider: id,
      documentId: request.documentId,
      content: "",
      cursor: 0,
      returnedLines: 0,
      hasMore: false,
      nextCursor: null,
      truncated: false,
    }),
  };
}

describe("GameProviderRegistry", () => {
  it("routes providers by normalized game slug", () => {
    const registry = new GameProviderRegistry();
    registry.register(fakeProvider("genshin"));
    registry.register(fakeProvider("test-game"));

    expect(registry.get("genshin").id).toBe("fake-genshin");
    expect(registry.get("genshin-impact").id).toBe("fake-genshin");
    expect(registry.get("test-game").id).toBe("fake-test-game");
  });

  it("rejects duplicate providers for the same game/kind", () => {
    const registry = new GameProviderRegistry();
    registry.register(fakeProvider("genshin", "a"));
    expect(() => registry.register(fakeProvider("genshin-impact", "b"))).toThrow(GameProviderError);
  });

  it("reports missing games and missing capabilities", () => {
    const registry = new GameProviderRegistry();
    registry.register(fakeProvider("genshin"));

    expect(() => registry.get("missing")).toThrow(/No game knowledge provider/u);
    expect(() => registry.requireCapability("genshin", "document_hierarchy")).toThrow(
      /does not support/u,
    );
  });

  it("merges health without throwing when a provider fails", async () => {
    const registry = new GameProviderRegistry();
    registry.register({
      ...fakeProvider("genshin"),
      health: async () => {
        throw new Error("boom");
      },
    });

    await expect(registry.health("genshin")).resolves.toMatchObject([
      { id: "fake-genshin", status: "unavailable" },
    ]);
  });
});
