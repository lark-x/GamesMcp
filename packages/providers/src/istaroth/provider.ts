import { GameProviderError, providerErrorFrom } from "../errors.js";
import type {
  GameDocumentHierarchyRequest,
  GameDocumentHierarchyResponse,
  GameDocumentRequest,
  GameDocumentResponse,
  GameKnowledgeProvider,
  GameKnowledgeSearchRequest,
  GameKnowledgeSearchResponse,
  GameProviderCapability,
  GameProviderHealth,
} from "../types.js";
import type { IstarothMcpClientLike } from "./client.js";
import {
  adaptDocumentResult,
  adaptHierarchyResult,
  adaptSearchResult,
  searchBudgetFromLimit,
} from "./adapter.js";

export interface GenshinIstarothProviderConfig {
  gameSlug: string;
  client: IstarothMcpClientLike;
  requestTimeoutMs: number;
  healthCacheMs?: number;
}

const REQUIRED_TOOLS = ["retrieve", "retrieve_bm25", "get_file_content", "get_document_hierarchy"];

export class GenshinIstarothProvider implements GameKnowledgeProvider {
  readonly id = "istaroth";
  readonly kind = "knowledge" as const;
  readonly capabilities: GameProviderCapability[] = [
    "knowledge_search",
    "keyword_search",
    "document_read",
    "document_hierarchy",
  ];

  private cachedHealth: { expiresAt: number; value: GameProviderHealth } | null = null;

  constructor(private readonly config: GenshinIstarothProviderConfig) {}

  get gameSlug(): string {
    return this.config.gameSlug;
  }

  async health(): Promise<GameProviderHealth> {
    const now = Date.now();
    if (this.cachedHealth && this.cachedHealth.expiresAt > now) return this.cachedHealth.value;
    const startedAt = performance.now();
    let health: GameProviderHealth;
    try {
      const tools = await this.config.client.listTools();
      const missing = REQUIRED_TOOLS.filter((tool) => !tools.includes(tool));
      health = {
        id: this.id,
        game: this.gameSlug,
        kind: this.kind,
        status: missing.length ? "degraded" : "available",
        capabilities: this.capabilities.filter((capability) =>
          capabilitySupportedByTools(capability, tools),
        ),
        latencyMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
        message: missing.length ? `Missing Istaroth tools: ${missing.join(", ")}` : undefined,
      };
    } catch (error) {
      const normalized = providerErrorFrom(error);
      health = {
        id: this.id,
        game: this.gameSlug,
        kind: this.kind,
        status: normalized.code === "provider_disabled" ? "disabled" : "unavailable",
        capabilities: [],
        latencyMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
        message: normalized.message,
      };
    }
    this.cachedHealth = {
      expiresAt: now + (this.config.healthCacheMs ?? 15_000),
      value: health,
    };
    return health;
  }

  async search(request: GameKnowledgeSearchRequest): Promise<GameKnowledgeSearchResponse> {
    const limit = Math.min(Math.max(request.limit ?? 5, 1), 10);
    const mode = request.mode ?? "hybrid";
    const tool = mode === "keyword" ? "retrieve_bm25" : "retrieve";
    const startedAt = performance.now();
    try {
      const result = await this.config.client.callTool(
        tool,
        {
          query: request.query,
          intent: request.intent ?? "balanced",
          budget: searchBudgetFromLimit(limit),
          limit,
        },
        this.config.requestTimeoutMs,
      );
      const adapted = adaptSearchResult({
        game: request.game,
        provider: this.id,
        mode,
        limit,
        result,
      });
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool,
        durationMs: performance.now() - startedAt,
        success: true,
        resultCount: adapted.hits.length,
        truncated: adapted.truncated,
      });
      return {
        game: request.game,
        provider: this.id,
        mode,
        hits: adapted.hits,
        truncated: adapted.truncated,
        rawExcerpt: adapted.rawExcerpt,
      };
    } catch (error) {
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool,
        durationMs: performance.now() - startedAt,
        success: false,
        errorCode: providerErrorFrom(error).code,
      });
      throw providerErrorFrom(error);
    }
  }

  async getDocument(request: GameDocumentRequest): Promise<GameDocumentResponse> {
    const cursor = Math.max(Math.floor(request.cursor ?? 0), 0);
    const limit = Math.min(Math.max(Math.floor(request.limit ?? 20), 1), 100);
    const startedAt = performance.now();
    try {
      const result = await this.config.client.callTool(
        "get_file_content",
        {
          document_id: request.documentId,
          file_id: request.documentId,
          cursor,
          limit,
        },
        this.config.requestTimeoutMs,
      );
      const adapted = adaptDocumentResult({
        game: request.game,
        provider: this.id,
        documentId: request.documentId,
        cursor,
        limit,
        result,
      });
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool: "get_file_content",
        durationMs: performance.now() - startedAt,
        success: true,
        resultCount: adapted.returnedLines,
        truncated: adapted.truncated,
      });
      return adapted;
    } catch (error) {
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool: "get_file_content",
        durationMs: performance.now() - startedAt,
        success: false,
        errorCode: providerErrorFrom(error).code,
      });
      throw providerErrorFrom(error);
    }
  }

  async getHierarchy(
    request: GameDocumentHierarchyRequest,
  ): Promise<GameDocumentHierarchyResponse> {
    const startedAt = performance.now();
    try {
      const result = await this.config.client.callTool(
        "get_document_hierarchy",
        { document_id: request.documentId, file_id: request.documentId },
        this.config.requestTimeoutMs,
      );
      const adapted = adaptHierarchyResult({
        game: request.game,
        provider: this.id,
        documentId: request.documentId,
        result,
      });
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool: "get_document_hierarchy",
        durationMs: performance.now() - startedAt,
        success: true,
        resultCount: 1,
        truncated: adapted.truncated,
      });
      return adapted;
    } catch (error) {
      logProviderCall({
        game: request.game,
        provider: this.id,
        tool: "get_document_hierarchy",
        durationMs: performance.now() - startedAt,
        success: false,
        errorCode: providerErrorFrom(error).code,
      });
      throw providerErrorFrom(error);
    }
  }

  async close(): Promise<void> {
    await this.config.client.close();
  }
}

function capabilitySupportedByTools(capability: GameProviderCapability, tools: string[]): boolean {
  switch (capability) {
    case "knowledge_search":
      return tools.includes("retrieve");
    case "keyword_search":
      return tools.includes("retrieve_bm25");
    case "document_read":
      return tools.includes("get_file_content");
    case "document_hierarchy":
      return tools.includes("get_document_hierarchy");
  }
}

function logProviderCall(event: {
  game: string;
  provider: string;
  tool: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  resultCount?: number;
  truncated?: boolean;
}) {
  const payload = {
    provider: event.provider,
    game: event.game,
    tool: event.tool,
    duration_ms: Math.round(event.durationMs),
    success: event.success,
    error_code: event.errorCode,
    result_count: event.resultCount,
    truncated: event.truncated,
  };
  if (event.success) console.info(JSON.stringify({ level: "info", ...payload }));
  else console.warn(JSON.stringify({ level: "warn", ...payload }));
}
