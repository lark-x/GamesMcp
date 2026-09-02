import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.js";
import { stableStringify } from "./helpers.js";
import type { ExtractionResult } from "./extractor.js";

function fakeResult(): ExtractionResult<{ id: string }> {
  return {
    extractorId: "test-extractor",
    extractorVersion: "1.0.0",
    records: [{ id: "a" }, { id: "b" }],
    warnings: [],
    failures: [{ code: "x", message: "boom", upstreamId: "1" }],
    coverage: { discovered: 3, converted: 2, failed: 1, coverage: 2 / 3 },
    fieldCoverage: { missingTitle: 0 },
    inputHashes: { "TextMap/TextMapCHS.json": "abc" },
    stats: {},
  };
}

describe("extraction framework", () => {
  it("builds a deterministic manifest with stable content hash", () => {
    const meta = { upstreamCommit: "c1", gameVersion: "7.0.0", locale: "zh-CN" };
    const a = buildManifest(fakeResult(), meta);
    const b = buildManifest(fakeResult(), meta);
    expect(a).toEqual(b);
    expect(a.contentHash).toHaveLength(64);
    expect(a).toMatchObject({ extractor: "test-extractor", converted: 2, failed: 1 });
  });

  it("stableStringify is order-independent for objects", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});
