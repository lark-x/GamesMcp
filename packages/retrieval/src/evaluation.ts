import type { SearchResult } from "@gip/contracts";

export type GoldenQuery = {
  query: string;
  expected_entity_ids?: string[];
  expected_document_ids?: string[];
  acceptable_aliases?: string[];
  exact_name?: boolean;
  tags?: string[];
  notes?: string;
};

export type RetrievalEvaluation = {
  queryCount: number;
  entityQueries: number;
  documentQueries: number;
  exactNameQueries: number;
  entityTop5Recall: number | null;
  documentTop10Recall: number | null;
  exactNameTop1: number | null;
  byTag: Record<
    string,
    { queryCount: number; entityTop5Recall: number | null; documentTop10Recall: number | null }
  >;
  failedQueries: string[];
};

type SearchGoldenRunner = (golden: GoldenQuery) => Promise<SearchResult>;

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function recall(expected: string[], actual: string[]): number {
  if (!expected.length) return 0;
  const actualSet = new Set(actual);
  return expected.filter((id) => actualSet.has(id)).length / expected.length;
}

function entityKeys(result: SearchResult): string[] {
  return result.entities
    .slice(0, 5)
    .flatMap((entity) => [entity.id, ...(entity.sourceKey ? [entity.sourceKey] : [])]);
}

function documentKeys(result: SearchResult): string[] {
  return result.documents
    .slice(0, 10)
    .flatMap((document) => [document.id, ...(document.sourceKey ? [document.sourceKey] : [])]);
}

export async function evaluateGoldenSet(
  queries: GoldenQuery[],
  runSearch: SearchGoldenRunner,
): Promise<RetrievalEvaluation> {
  const entityRecalls: number[] = [];
  const documentRecalls: number[] = [];
  const exactNameHits: number[] = [];
  const tagBuckets = new Map<string, { entityRecalls: number[]; documentRecalls: number[] }>();
  const failedQueries: string[] = [];

  for (const golden of queries) {
    try {
      const result = await runSearch(golden);
      if (golden.expected_entity_ids?.length) {
        const value = recall(golden.expected_entity_ids, entityKeys(result));
        entityRecalls.push(value);
        for (const tag of golden.tags ?? []) {
          const bucket = tagBuckets.get(tag) ?? { entityRecalls: [], documentRecalls: [] };
          bucket.entityRecalls.push(value);
          tagBuckets.set(tag, bucket);
        }
        if (golden.exact_name) {
          exactNameHits.push(
            golden.expected_entity_ids.some((id) =>
              [result.entities[0]?.id, result.entities[0]?.sourceKey].includes(id),
            )
              ? 1
              : 0,
          );
        }
      }
      if (golden.expected_document_ids?.length) {
        const value = recall(golden.expected_document_ids, documentKeys(result));
        documentRecalls.push(value);
        for (const tag of golden.tags ?? []) {
          const bucket = tagBuckets.get(tag) ?? { entityRecalls: [], documentRecalls: [] };
          bucket.documentRecalls.push(value);
          tagBuckets.set(tag, bucket);
        }
      }
    } catch {
      failedQueries.push(golden.query);
    }
  }

  return {
    queryCount: queries.length,
    entityQueries: entityRecalls.length,
    documentQueries: documentRecalls.length,
    exactNameQueries: exactNameHits.length,
    entityTop5Recall: average(entityRecalls),
    documentTop10Recall: average(documentRecalls),
    exactNameTop1: average(exactNameHits),
    byTag: Object.fromEntries(
      [...tagBuckets.entries()].map(([tag, bucket]) => [
        tag,
        {
          queryCount: Math.max(bucket.entityRecalls.length, bucket.documentRecalls.length),
          entityTop5Recall: average(bucket.entityRecalls),
          documentTop10Recall: average(bucket.documentRecalls),
        },
      ]),
    ),
    failedQueries,
  };
}

export function assertRetrievalTargets(
  result: RetrievalEvaluation,
  targets: { entityTop5Recall?: number; documentTop10Recall?: number; exactNameTop1?: number },
): void {
  if (
    targets.entityTop5Recall !== undefined &&
    (result.entityTop5Recall === null || result.entityTop5Recall < targets.entityTop5Recall)
  )
    throw new Error(`Entity Top-5 Recall target failed: ${result.entityTop5Recall}`);
  if (
    targets.documentTop10Recall !== undefined &&
    (result.documentTop10Recall === null ||
      result.documentTop10Recall < targets.documentTop10Recall)
  )
    throw new Error(`Document Top-10 Recall target failed: ${result.documentTop10Recall}`);
  if (
    targets.exactNameTop1 !== undefined &&
    (result.exactNameTop1 === null || result.exactNameTop1 < targets.exactNameTop1)
  )
    throw new Error(`Exact-name Top-1 target failed: ${result.exactNameTop1}`);
}
