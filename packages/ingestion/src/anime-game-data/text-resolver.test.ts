import { describe, expect, it } from "vitest";
import { TextResolver, cleanUpstreamText } from "./text-resolver.js";

const primary = {
  locale: "zh-CN",
  values: {
    101: "你好\\n世界",
    102: "<color=#FF0000>红字</color>",
    103: "  ",
    104: "{NICKNAME}旅行",
  },
};
const fallback = { locale: "en-US", values: { 201: "Fallback text" } };

describe("cleanUpstreamText", () => {
  it("strips rich text tags and unescapes newlines", () => {
    expect(cleanUpstreamText("a\\nb")).toBe("a\nb");
    expect(cleanUpstreamText("<color=#FF0000>x</color>")).toBe("x");
    expect(cleanUpstreamText('<image name="pic"/>')).toBe("");
  });
});

describe("TextResolver", () => {
  it("resolves, cleans, and reports lineage hashes", () => {
    const resolver = new TextResolver({ maps: [primary] });
    const result = resolver.resolve(101);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("你好\n世界");
    expect(result.rawSha).toHaveLength(64);
  });

  it("reports unresolved for missing, empty, and whitespace-only values", () => {
    const resolver = new TextResolver({ maps: [primary] });
    expect(resolver.tryResolve(999).resolved).toBe(false);
    expect(resolver.tryResolve(103).resolved).toBe(false);
    expect(() => resolver.resolve(999)).toThrow(/text_hash_missing/);
  });

  it("cleans color tags but keeps inner text as resolved", () => {
    const resolver = new TextResolver({ maps: [primary] });
    expect(resolver.tryResolve(102).value).toBe("红字");
  });

  it("falls back through locales in order and records the winning locale", () => {
    const resolver = new TextResolver({ maps: [primary, fallback] });
    const miss = resolver.resolveWithFallback(201);
    expect(miss).toMatchObject({ value: "Fallback text", locale: "en-US", resolved: true });
    const none = resolver.resolveWithFallback(999);
    expect(none).toMatchObject({ value: null, locale: null, resolved: false });
  });
});
