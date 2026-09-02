import { existsSync } from "node:fs";
import { GameProviderError } from "../errors.js";
import type {
  GameDocumentRequest,
  GameDocumentResponse,
  GameKnowledgeHit,
  GameKnowledgeProvider,
  GameKnowledgeSearchRequest,
  GameKnowledgeSearchResponse,
  GameProviderCapability,
  GameProviderHealth,
} from "../types.js";
import { buildStarRailCorpus } from "./corpus/builder.js";
import type { GameKnowledgeDocument } from "./corpus/types.js";
import { buildStarRailInventory, type StarRailSourceInventory } from "./source/inventory.js";
import { readStarRailSourceSnapshot, type StarRailSourceSnapshot } from "./source/snapshot.js";
import { StarRailTextMapResolver } from "./source/textmap.js";

export interface StarRailLocalProviderConfig {
  dataDir: string;
  inventoryOutput?: string;
  gameSlug?: string;
}

export class StarRailLocalProvider implements GameKnowledgeProvider {
  readonly id = "starrail-local";
  readonly gameSlug: string;
  readonly kind = "knowledge" as const;
  readonly capabilities: GameProviderCapability[] = [
    "knowledge_search",
    "keyword_search",
    "document_read",
  ];

  private loading: Promise<StarRailLoadedData> | null = null;

  constructor(private readonly config: StarRailLocalProviderConfig) {
    this.gameSlug = config.gameSlug ?? "starrail";
  }

  async health(): Promise<GameProviderHealth> {
    const startedAt = performance.now();
    try {
      const data = await this.ensureLoaded();
      return {
        id: this.id,
        game: this.gameSlug,
        kind: this.kind,
        status: data.documents.length ? "available" : "degraded",
        capabilities: this.capabilities,
        latencyMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
        message: data.documents.length
          ? undefined
          : "StarRail source is readable but no knowledge documents were built.",
      };
    } catch (error) {
      return {
        id: this.id,
        game: this.gameSlug,
        kind: this.kind,
        status: "unavailable",
        capabilities: [],
        latencyMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "StarRail provider unavailable.",
      };
    }
  }

  async search(request: GameKnowledgeSearchRequest): Promise<GameKnowledgeSearchResponse> {
    const data = await this.ensureLoaded();
    const limit = Math.min(Math.max(request.limit ?? 5, 1), 10);
    const scored = data.documents
      .map((document) => ({ document, score: scoreDocument(document, request.query) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    return {
      game: this.gameSlug,
      provider: this.id,
      mode: request.mode ?? "hybrid",
      hits: scored.map(({ document, score }) => hitFromDocument(document, score, request.query)),
      truncated: scored.length >= limit,
    };
  }

  async getDocument(request: GameDocumentRequest): Promise<GameDocumentResponse> {
    const data = await this.ensureLoaded();
    const document = data.documentById.get(request.documentId);
    if (!document) throw new GameProviderError("provider_document_not_found");
    const cursor = Math.max(Math.floor(request.cursor ?? 0), 0);
    const limit = Math.min(Math.max(Math.floor(request.limit ?? 20), 1), 100);
    const lines = document.content.split(/\r?\n/u);
    const page = lines.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length;
    const content = page.join("\n").slice(0, 12_000);
    return {
      game: this.gameSlug,
      provider: this.id,
      documentId: document.stableId,
      title: document.title,
      content,
      cursor,
      returnedLines: page.length,
      hasMore: nextCursor < lines.length,
      nextCursor: nextCursor < lines.length ? nextCursor : null,
      truncated: nextCursor < lines.length || page.join("\n").length > 12_000,
      metadata: document.metadata,
    };
  }

  getSourceSummary(): Promise<StarRailLoadedDataSummary> {
    return this.ensureLoaded().then((data) => ({
      snapshot: data.snapshot,
      inventory: {
        files: data.inventory.totals.files,
        bytes: data.inventory.totals.bytes,
      },
      textMap: data.textMapReport,
      documents: data.documents.length,
      categories: countBy(data.documents.map((document) => document.category)),
    }));
  }

  private async ensureLoaded(): Promise<StarRailLoadedData> {
    if (!existsSync(this.config.dataDir))
      throw new GameProviderError(
        "provider_unavailable",
        `StarRail data directory does not exist: ${this.config.dataDir}`,
      );
    this.loading ??= loadStarRailData(this.config);
    return await this.loading;
  }
}

interface StarRailLoadedData {
  snapshot: StarRailSourceSnapshot;
  inventory: StarRailSourceInventory;
  textMapReport: {
    totalKeys: number;
    resolvedSample: number;
    rssBytes: number;
  };
  documents: GameKnowledgeDocument[];
  documentById: Map<string, GameKnowledgeDocument>;
}

export interface StarRailLoadedDataSummary {
  snapshot: StarRailSourceSnapshot;
  inventory: {
    files: number;
    bytes: number;
  };
  textMap: {
    totalKeys: number;
    resolvedSample: number;
    rssBytes: number;
  };
  documents: number;
  categories: Record<string, number>;
}

async function loadStarRailData(config: StarRailLocalProviderConfig): Promise<StarRailLoadedData> {
  const snapshot = await readStarRailSourceSnapshot(config.dataDir);
  const inventory = await buildStarRailInventory({
    dataDir: config.dataDir,
    sourceRef: snapshot.ref,
    output: config.inventoryOutput,
  });
  const resolver = new StarRailTextMapResolver({
    dataDir: config.dataDir,
    inventory,
    locale: "CHS",
  });
  const textMapReport = await resolver.load();
  const documents = await buildStarRailCorpus({
    dataDir: config.dataDir,
    sourceRef: snapshot.ref,
    inventory,
  });
  return {
    snapshot,
    inventory,
    textMapReport,
    documents,
    documentById: new Map(documents.map((document) => [document.stableId, document])),
  };
}

function scoreDocument(document: GameKnowledgeDocument, query: string): number {
  const haystack = `${document.title ?? ""}\n${document.content}`.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  let score = haystack.includes(normalizedQuery) ? 100 : 0;
  for (const token of queryTokens(normalizedQuery)) {
    if (haystack.includes(token)) score += Math.max(2, token.length);
  }
  for (const gram of charGrams(normalizedQuery, 2)) {
    if (haystack.includes(gram)) score += 1;
  }
  if (document.category === "Story") score += 0.25;
  return score;
}

function hitFromDocument(
  document: GameKnowledgeDocument,
  score: number,
  query: string,
): GameKnowledgeHit {
  return {
    game: "starrail",
    provider: "starrail-local",
    documentId: document.stableId,
    title: document.title,
    excerpt: excerpt(document.content, query),
    category: document.category,
    path: document.sourcePath,
    score,
    metadata: {
      ...document.metadata,
      retrievalBackend: "local-exact-fts-trigram",
    },
    citation: {
      provider: "starrail-local",
      sourceId: document.stableId,
      path: document.sourcePath,
    },
  };
}

function excerpt(content: string, query: string): string {
  const index = content.toLowerCase().indexOf(query.trim().toLowerCase());
  if (index < 0) return content.slice(0, 1_200);
  return content.slice(Math.max(0, index - 240), index + 960);
}

function queryTokens(query: string): string[] {
  return query
    .split(/[\s,，。！？:：;；"'“”‘’()[\]{}<>《》/\\|-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function charGrams(value: string, size: number): string[] {
  const chars = [...value].filter((char) => !/\s/u.test(char));
  const grams: string[] = [];
  for (let index = 0; index + size <= chars.length; index += 1)
    grams.push(chars.slice(index, index + size).join(""));
  return grams;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}
