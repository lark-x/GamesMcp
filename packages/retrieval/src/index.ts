import type { SearchRequest, SearchResult } from "@gip/contracts";
import type { Id, KnowledgeRepository, VectorEntityHit, VectorSearchHit } from "@gip/domain";

export * from "./evaluation.js";

export type EmbeddingSpace = {
  id: string;
  model: string;
  modelVersion: string;
  dimension: number;
};

export interface EmbeddingProvider {
  readonly space: EmbeddingSpace;
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly space: EmbeddingSpace;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey?: string;
      model: string;
      modelVersion: string;
      dimension: number;
      timeoutMs?: number;
    },
  ) {
    this.space = {
      id: `${options.model}:${options.modelVersion}:${options.dimension}`,
      model: options.model,
      modelVersion: options.modelVersion,
      dimension: options.dimension,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.options.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new EmbeddingError(
          "embedding_http_error",
          `Embedding request failed with status ${response.status}`,
        );
      const data: unknown = await response.json();
      const values = (data as { data?: Array<{ embedding?: unknown }> }).data?.map(
        (item) => item.embedding,
      );
      if (
        !values ||
        values.some(
          (value) => !Array.isArray(value) || value.some((number) => typeof number !== "number"),
        )
      )
        throw new EmbeddingError(
          "embedding_invalid_response",
          "Embedding response has an invalid shape",
        );
      if (values.length !== texts.length)
        throw new EmbeddingError(
          "embedding_count_mismatch",
          "Embedding response count does not match the request",
        );
      const vectors = values as number[][];
      if (vectors.some((vector) => vector.length !== this.options.dimension))
        throw new EmbeddingError(
          "embedding_dimension_mismatch",
          "Embedding response dimension does not match configuration",
        );
      return vectors;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RetrievalService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  async search(gameId: Id, request: SearchRequest): Promise<SearchResult> {
    const result = await this.repository.search(gameId, request);
    if (
      !this.embeddingProvider ||
      !result.revision ||
      (request.types && request.types.length === 0)
    )
      return result;
    try {
      const [vector] = await this.embeddingProvider.embed([request.query]);
      if (!vector) return result;
      const vectorHits =
        request.types?.some((type) => type === "document" || type === "segment") || !request.types
          ? await this.repository.vectorSearch(
              gameId,
              request,
              vector,
              this.embeddingProvider.space.id,
              request.limit ?? 20,
            )
          : [];
      const entityHits =
        request.types?.includes("entity") || !request.types
          ? await this.repository.vectorEntitySearch?.(
              gameId,
              request,
              vector,
              this.embeddingProvider.space.id,
              request.limit ?? 20,
            )
          : [];
      return mergeVectorHits(result, vectorHits, entityHits ?? [], request.debug);
    } catch {
      return {
        ...result,
        debug: request.debug
          ? { ...(result.debug ?? {}), vector: false, vectorError: "semantic search unavailable" }
          : result.debug,
      };
    }
  }
}

function mergeVectorHits(
  result: SearchResult,
  hits: VectorSearchHit[],
  entityHits: VectorEntityHit[],
  debug = false,
): SearchResult {
  const entities = [...result.entities];
  for (const hit of entityHits) {
    const existing = entities.find((item) => item.id === hit.entity.id);
    if (existing) {
      if ((existing.score ?? 0) < hit.score) Object.assign(existing, hit.entity);
      continue;
    }
    entities.push(hit.entity);
  }
  const segments = [...result.segments];
  const documents = [...result.documents];
  for (const hit of hits) {
    if (!segments.some((item) => item.segmentId === hit.segmentId))
      segments.push({
        ...hit.document,
        segmentId: hit.segmentId,
        snippet: hit.snippet,
        score: hit.score,
        match: "vector",
      });
    if (!documents.some((item) => item.id === hit.document.id))
      documents.push({ ...hit.document, score: hit.score, match: "vector" });
  }
  segments.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  documents.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  entities.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return {
    ...result,
    entities: entities.slice(0, 100),
    segments: segments.slice(0, 100),
    documents: documents.slice(0, 100),
    debug: debug ? { ...(result.debug ?? {}), vector: true } : result.debug,
  };
}

export function normalizeQuery(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function weightedHybridScore(scores: {
  exactName?: number;
  exactAlias?: number;
  prefix?: number;
  trigram?: number;
  fullText?: number;
  vector?: number;
}): number {
  return Math.min(
    1,
    (scores.exactName ?? 0) * 1 +
      (scores.exactAlias ?? 0) * 0.95 +
      (scores.prefix ?? 0) * 0.85 +
      (scores.trigram ?? 0) * 0.65 +
      (scores.fullText ?? 0) * 0.55 +
      (scores.vector ?? 0) * 0.45,
  );
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
