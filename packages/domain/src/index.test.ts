import { describe, expect, it } from "vitest";
import { assertPublishable, validateNormalizedRecords } from "./index.js";

const record = {
  sourceKey: "quest/intro",
  recordType: "document",
  title: "A small document",
  body: "Evidence",
  metadata: {},
  contentHash: "hash",
  parserVersion: "test",
} as const;

describe("domain validation", () => {
  it("rejects duplicate source keys and empty records", () => {
    const issues = validateNormalizedRecords([
      record,
      { ...record, title: undefined, body: undefined },
    ]);
    expect(issues.some((issue) => issue.code === "duplicate_source_key")).toBe(true);
    expect(issues.some((issue) => issue.code === "empty_record")).toBe(true);
  });

  it("requires evidence for confirmed claims", () => {
    const issues = validateNormalizedRecords([
      {
        ...record,
        claims: [{ sourceKey: "claim-1", statement: "Fact", status: "confirmed" }],
      },
    ]);
    expect(issues.some((issue) => issue.code === "claim_evidence_required")).toBe(true);
  });

  it("rejects invalid nested references before publication", () => {
    const issues = validateNormalizedRecords([
      {
        ...record,
        entities: [{ sourceKey: "entity-1", name: "角色", type: "not-a-type" as never }],
        relationships: [
          {
            subjectSourceKey: "entity-1",
            objectSourceKey: "missing",
            predicate: "related_to",
          },
        ],
        claims: [
          {
            sourceKey: "claim-1",
            statement: "事实",
            status: "confirmed",
            entitySourceKeys: ["missing"],
            evidence: [{ documentSourceKey: "missing-doc" }],
          },
        ],
      },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid_entity_type",
        "invalid_entity_reference",
        "invalid_claim_entity_reference",
        "invalid_evidence_document_reference",
      ]),
    );
  });

  it("requires a review note before reviewed publication", () => {
    expect(() =>
      assertPublishable({ status: "review_required", errors: [], reviewNote: null }),
    ).toThrow();
    expect(() =>
      assertPublishable({ status: "review_required", errors: [], reviewNote: "approved" }),
    ).not.toThrow();
    expect(() =>
      assertPublishable({ status: "staged", errors: [], reviewNote: "approved" }),
    ).toThrow();
  });

  it("accepts references to known entities and detects conflicting definitions", () => {
    const issues = validateNormalizedRecords(
      [
        {
          ...record,
          entities: [
            { sourceKey: "entity-1", name: "同一实体", type: "character" },
            { sourceKey: "entity-1", name: "不同定义", type: "character" },
          ],
          relationships: [
            { subjectSourceKey: "entity-1", objectSourceKey: "previous", predicate: "related_to" },
          ],
        },
      ],
      new Set(["previous"]),
    );
    expect(issues.map((issue) => issue.code)).toContain("conflicting_entity_definition");
    expect(issues.map((issue) => issue.code)).not.toContain("invalid_entity_reference");
  });
});
