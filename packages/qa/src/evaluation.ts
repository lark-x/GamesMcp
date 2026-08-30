import type { EvidenceAnswer } from "@gip/contracts";

export type QaGoldenCase = {
  id: string;
  question: string;
  expected_document_ids?: string[];
  expected_document_source_keys?: string[];
  expected_segment_ids?: string[];
  should_refuse?: boolean;
  expect_conflict_warning?: boolean;
  tags?: string[];
  notes?: string;
};

export type QaEvaluation = {
  caseCount: number;
  citationCases: number;
  citationPrecision: number | null;
  citationResolvableRate: number | null;
  refusalCases: number;
  refusalRate: number | null;
  hallucinatedCitationCount: number;
  contradictionCount: number;
  byTag: Record<
    string,
    {
      caseCount: number;
      citationPrecision: number | null;
      refusalRate: number | null;
    }
  >;
  failedCases: string[];
};

export type CitationResolver = (citation: EvidenceAnswer["citations"][number]) => Promise<boolean>;
type QaRunner = (testCase: QaGoldenCase) => Promise<EvidenceAnswer>;

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isRefusal(answer: EvidenceAnswer): boolean {
  return (
    answer.confidence === "insufficient" ||
    /当前资料不足|无法确定|资料不足以确定|insufficient/i.test(answer.answer)
  );
}

function citationMatches(
  citation: EvidenceAnswer["citations"][number],
  testCase: QaGoldenCase,
): boolean {
  const expectedDocuments = new Set(testCase.expected_document_ids ?? []);
  const expectedDocumentSourceKeys = new Set(testCase.expected_document_source_keys ?? []);
  const expectedSegments = new Set(testCase.expected_segment_ids ?? []);
  if (!expectedDocuments.size && !expectedDocumentSourceKeys.size && !expectedSegments.size)
    return true;
  return (
    expectedDocuments.has(citation.documentId) ||
    (citation.sourceKey ? expectedDocumentSourceKeys.has(citation.sourceKey) : false) ||
    expectedSegments.has(citation.segmentId)
  );
}

export async function evaluateQaSet(
  cases: QaGoldenCase[],
  runAnswer: QaRunner,
  resolveCitation?: CitationResolver,
): Promise<QaEvaluation> {
  const precisionValues: number[] = [];
  const resolvabilityValues: number[] = [];
  const refusalValues: number[] = [];
  const tagBuckets = new Map<string, { precision: number[]; refusal: number[]; count: number }>();
  const failedCases: string[] = [];
  let citationCases = 0;
  let refusalCases = 0;
  let hallucinatedCitationCount = 0;
  let contradictionCount = 0;

  for (const testCase of cases) {
    try {
      const answer = await runAnswer(testCase);
      const citations = answer.citations;
      const expectedCitationCase =
        Boolean(testCase.expected_document_ids?.length) ||
        Boolean(testCase.expected_document_source_keys?.length) ||
        Boolean(testCase.expected_segment_ids?.length);
      const precision = citations.length
        ? citations.filter((citation) => citationMatches(citation, testCase)).length /
          citations.length
        : expectedCitationCase
          ? 0
          : testCase.should_refuse
            ? 1
            : null;
      if (expectedCitationCase) {
        citationCases += 1;
        if (precision !== null) precisionValues.push(precision);
      }
      if (resolveCitation) {
        const resolved = await Promise.all(citations.map((citation) => resolveCitation(citation)));
        if (resolved.length)
          resolvabilityValues.push(resolved.filter(Boolean).length / resolved.length);
        hallucinatedCitationCount += resolved.filter((value) => !value).length;
      } else {
        hallucinatedCitationCount += citations.filter(
          (citation) => !citation.documentId || !citation.segmentId || !citation.documentTitle,
        ).length;
        if (citations.length) resolvabilityValues.push(1);
      }

      const refused = isRefusal(answer);
      refusalCases += Number(Boolean(testCase.should_refuse));
      if (testCase.should_refuse && refused) refusalValues.push(1);
      else if (testCase.should_refuse) refusalValues.push(0);
      if (
        testCase.expect_conflict_warning &&
        !answer.warnings.some((warning) => /冲突|conflict/i.test(warning))
      )
        contradictionCount += 1;
      if (
        !testCase.expect_conflict_warning &&
        answer.warnings.some((warning) => /冲突|conflict/i.test(warning))
      )
        contradictionCount += 1;

      for (const tag of testCase.tags ?? []) {
        const bucket = tagBuckets.get(tag) ?? { precision: [], refusal: [], count: 0 };
        bucket.count += 1;
        if (precision !== null) bucket.precision.push(precision);
        if (testCase.should_refuse) bucket.refusal.push(refused ? 1 : 0);
        tagBuckets.set(tag, bucket);
      }
    } catch {
      failedCases.push(testCase.id);
    }
  }

  return {
    caseCount: cases.length,
    citationCases,
    citationPrecision: average(precisionValues),
    citationResolvableRate: average(resolvabilityValues),
    refusalCases,
    refusalRate: average(refusalValues),
    hallucinatedCitationCount,
    contradictionCount,
    byTag: Object.fromEntries(
      [...tagBuckets.entries()].map(([tag, bucket]) => [
        tag,
        {
          caseCount: bucket.count,
          citationPrecision: average(bucket.precision),
          refusalRate: average(bucket.refusal),
        },
      ]),
    ),
    failedCases,
  };
}

export function assertQaTargets(
  result: QaEvaluation,
  targets: {
    citationPrecision?: number;
    citationResolvableRate?: number;
    refusalRate?: number;
    hallucinatedCitationCount?: number;
    contradictionCount?: number;
  },
): void {
  if (
    targets.citationPrecision !== undefined &&
    (result.citationPrecision === null || result.citationPrecision < targets.citationPrecision)
  )
    throw new Error(`Citation precision target failed: ${result.citationPrecision}`);
  if (
    targets.citationResolvableRate !== undefined &&
    (result.citationResolvableRate === null ||
      result.citationResolvableRate < targets.citationResolvableRate)
  )
    throw new Error(`Citation resolvability target failed: ${result.citationResolvableRate}`);
  if (
    targets.refusalRate !== undefined &&
    (result.refusalRate === null || result.refusalRate < targets.refusalRate)
  )
    throw new Error(`Refusal-rate target failed: ${result.refusalRate}`);
  if (
    targets.hallucinatedCitationCount !== undefined &&
    result.hallucinatedCitationCount > targets.hallucinatedCitationCount
  )
    throw new Error(`Hallucinated citation target failed: ${result.hallucinatedCitationCount}`);
  if (
    targets.contradictionCount !== undefined &&
    result.contradictionCount > targets.contradictionCount
  )
    throw new Error(`Contradiction target failed: ${result.contradictionCount}`);
}
