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

  it("validates structured quest payloads before import", () => {
    const issues = validateNormalizedRecords([
      {
        sourceKey: "quest/100/locale/zh-CN",
        recordType: "document",
        title: "序章",
        body: "派蒙：我们走吧。",
        documentType: "archon_quest",
        locale: "zh-CN",
        segments: [
          {
            segmentKey: "quest/100/dialog/1",
            ordinal: 0,
            body: "派蒙：我们走吧。",
            startOffset: 0,
            endOffset: 8,
          },
        ],
        quest: {
          questKey: "quest/100",
          mainQuestId: 100,
          questType: "archon_quest",
          locale: "en",
          completeness: "complete",
          subquests: [
            {
              subquestKey: "quest/100/subquest/101",
              subquestId: 101,
              title: "启程",
              order: 0,
              completeness: "complete",
            },
          ],
          dialogueNodes: [
            {
              nodeKey: "quest/100/dialog/1",
              nodeId: 1,
              type: "dialogue",
              subquestKey: "quest/100/subquest/101",
              segmentKey: "quest/100/dialog/1",
              body: "派蒙：我们走吧。",
            },
          ],
          dialogueEdges: [
            {
              fromNodeKey: "quest/100/dialog/1",
              toNodeKey: "quest/100/dialog/missing",
              type: "next",
            },
          ],
        },
        metadata: {},
        contentHash: "hash",
        parserVersion: "test",
      },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["quest_locale_mismatch", "dangling_dialogue_edge"]),
    );
  });
});
