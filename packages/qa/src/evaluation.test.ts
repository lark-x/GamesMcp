import { describe, expect, it } from "vitest";
import type { EvidenceAnswer } from "@gip/contracts";
import { assertQaTargets, evaluateQaSet } from "./evaluation.js";

const citation = {
  documentId: "00000000-0000-0000-0000-000000000001",
  sourceKey: "lore/fixture",
  documentTitle: "Fixture",
  segmentId: "00000000-0000-0000-0000-000000000002",
  quote: "有证据的句子。",
  sourceName: "test",
  gameVersion: "fixture",
  datasetRevision: "r1",
};

function answer(overrides: Partial<EvidenceAnswer> = {}): EvidenceAnswer {
  return {
    answer: "有证据的句子。 [S1]",
    confidence: "high",
    citations: [citation],
    relatedEntities: [],
    datasetRevision: "r1",
    warnings: [],
    ...overrides,
  };
}

describe("QA evaluation", () => {
  it("measures citation precision, resolvability and refusal rate", async () => {
    const result = await evaluateQaSet(
      [
        {
          id: "fact",
          question: "fact",
          expected_document_source_keys: ["lore/fixture"],
          tags: ["fact"],
        },
        { id: "refusal", question: "unknown", should_refuse: true, tags: ["refusal"] },
      ],
      async (testCase) =>
        testCase.should_refuse
          ? answer({ answer: "当前资料不足以确定。", confidence: "insufficient", citations: [] })
          : answer(),
      async () => true,
    );
    expect(result.citationPrecision).toBe(1);
    expect(result.citationResolvableRate).toBe(1);
    expect(result.refusalRate).toBe(1);
    expect(result.hallucinatedCitationCount).toBe(0);
    assertQaTargets(result, {
      citationPrecision: 0.95,
      citationResolvableRate: 1,
      refusalRate: 0.95,
      hallucinatedCitationCount: 0,
      contradictionCount: 0,
    });
  });
});
