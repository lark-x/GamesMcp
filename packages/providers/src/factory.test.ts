import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "./factory.js";

describe("createProviderRegistry", () => {
  it("registers StarRail Istaroth entries through the generic provider", () => {
    const registry = createProviderRegistry({
      entries: [
        {
          id: "istaroth",
          game: "starrail",
          kind: "external_mcp",
          enabled: true,
          url: "http://127.0.0.1:8001/mcp",
          connectTimeoutMs: 100,
          requestTimeoutMs: 100,
        },
      ],
    });

    const provider = registry.get("hsr");
    expect(provider.id).toBe("istaroth");
    expect(provider.gameSlug).toBe("starrail");
  });
});
