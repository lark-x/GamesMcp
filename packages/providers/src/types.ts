export type GameProviderKind = "knowledge";

export type GameProviderCapability =
  "knowledge_search" | "keyword_search" | "document_read" | "document_hierarchy";

export type GameProviderStatus = "available" | "degraded" | "unavailable" | "disabled" | "unknown";

export interface GameProviderHealth {
  id: string;
  game: string;
  kind: GameProviderKind;
  status: GameProviderStatus;
  latencyMs?: number;
  capabilities: GameProviderCapability[];
  checkedAt: string;
  message?: string;
}

export type GameKnowledgeSearchMode = "hybrid" | "keyword";

export type GameKnowledgeSearchIntent = "balanced" | "context" | "variety" | "lookup";

export interface GameKnowledgeSearchRequest {
  game: string;
  query: string;
  mode?: GameKnowledgeSearchMode;
  intent?: GameKnowledgeSearchIntent;
  limit?: number;
}

export interface GameKnowledgeHit {
  game: string;
  provider: string;
  documentId: string;
  title?: string;
  excerpt: string;
  category?: string;
  path?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  citation?: {
    provider: string;
    sourceId?: string;
    path?: string;
  };
}

export interface GameKnowledgeSearchResponse {
  game: string;
  provider: string;
  mode: GameKnowledgeSearchMode;
  hits: GameKnowledgeHit[];
  truncated: boolean;
  rawExcerpt?: string;
}

export interface GameDocumentRequest {
  game: string;
  documentId: string;
  cursor?: number;
  limit?: number;
}

export interface GameDocumentResponse {
  game: string;
  provider: string;
  documentId: string;
  title?: string;
  content: string;
  cursor: number;
  returnedLines: number;
  hasMore: boolean;
  nextCursor: number | null;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}

export interface GameDocumentHierarchyRequest {
  game: string;
  documentId: string;
}

export interface GameDocumentHierarchyResponse {
  game: string;
  provider: string;
  documentId: string;
  hierarchy: unknown;
  truncated: boolean;
}

export interface GameKnowledgeProvider {
  readonly id: string;
  readonly gameSlug: string;
  readonly kind: "knowledge";
  readonly capabilities: GameProviderCapability[];

  health(): Promise<GameProviderHealth>;

  search(request: GameKnowledgeSearchRequest): Promise<GameKnowledgeSearchResponse>;

  getDocument(request: GameDocumentRequest): Promise<GameDocumentResponse>;

  getHierarchy?(request: GameDocumentHierarchyRequest): Promise<GameDocumentHierarchyResponse>;

  close?(): Promise<void>;
}
