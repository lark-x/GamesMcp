import { describe, expect, it } from "vitest";
import type { NormalizedRecord } from "@gip/domain";
import { stableEntityId, stratifiedVerificationSample } from "./repository.js";

describe("stable entity identity", () => {
  it("depends on game and source identity, not the display name", () => {
    const gameA = "00000000-0000-0000-0000-000000000001";
    const gameB = "00000000-0000-0000-0000-000000000002";
    const sourceKey = "entities/traveler";

    expect(stableEntityId(gameA, sourceKey)).toBe(stableEntityId(gameA, sourceKey));
    expect(stableEntityId(gameA, sourceKey)).not.toBe(stableEntityId(gameB, sourceKey));
    expect(stableEntityId(gameA, sourceKey)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("verification sampling", () => {
  const makeRecords = (): NormalizedRecord[] =>
    Array.from({ length: 40 }, (_, index): NormalizedRecord => ({
      sourceKey: `book/${index}`,
      recordType: "document",
      documentType: "book",
      title: `Book ${index}`,
      body: "x".repeat(index + 1),
      metadata: {
        verificationRiskFlags:
          index === 37 ? ["format_tags"] : index === 38 ? ["fallback_field"] : [],
      },
      contentHash: String(index),
      parserVersion: "test",
    }));

  it("is reproducible and retains every declared risk layer", () => {
    const records = makeRecords();
    const first = stratifiedVerificationSample(records, "commit", "book");
    const second = stratifiedVerificationSample(records, "commit", "book");
    expect(first.map((record) => record.sourceKey)).toEqual(
      second.map((record) => record.sourceKey),
    );
    expect(first).toHaveLength(30);
    expect(first.some((record) => record.sourceKey === "book/37")).toBe(true);
    expect(first.some((record) => record.sourceKey === "book/38")).toBe(true);
    const lengths = first.map((record) => record.body?.length ?? 0);
    expect(Math.min(...lengths)).toBeLessThanOrEqual(10);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(31);
  });

  it("keeps the length quartiles when the sample budget is tight", () => {
    const sample = stratifiedVerificationSample(makeRecords(), "commit", "book", 6);
    const quartiles = new Set(
      sample.map((record) => Math.min(3, Math.floor(((record.body?.length ?? 1) - 1) / 10))),
    );
    expect(sample).toHaveLength(6);
    expect(quartiles).toEqual(new Set([0, 1, 2, 3]));
    expect(sample.some((record) => record.sourceKey === "book/37")).toBe(true);
    expect(sample.some((record) => record.sourceKey === "book/38")).toBe(true);
  });
});
