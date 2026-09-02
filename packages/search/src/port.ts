import type { DocumentSummary } from "@gip/contracts";
import type { DocumentType } from "@gip/contracts";
import type { ResolverCandidate } from "./entity-resolver.js";

export type SearchMatchType = "fts" | "trgm" | "prefix" | "exact";

export type SearchSurface = "structured" | "document" | "segment" | "dialogue";

export type DialogueSearchFilters = {
  /** Canonical speaker key or display name. */
  speaker?: string;
  /** Quest key, source key, or exact display title. */
  quest?: string;
  /** Alias accepted by callers that use the persisted field name. */
  questKey?: string;
  nodeType?: string;
  locale?: string;
};

export type EntityCandidateSearchRequest = {
  gameId: string;
  revisionId: string;
  query: string;
  entityTypes?: string[];
  limit?: number;
};

export type StructuredSearchRequest = {
  gameId: string;
  revisionId: string;
  query: string;
  kinds?: StructuredSearchKind[];
  limit?: number;
};

export type StructuredSearchKind =
  | "character"
  | "weapon"
  | "artifact_set"
  | "artifact"
  | "material"
  | "achievement"
  | "enemy"
  | "voice";

export type DocumentSearchRequest = {
  gameId: string;
  revisionId: string;
  query: string;
  documentTypes?: DocumentType[];
  locales?: string[];
  includeDocuments?: boolean;
  includeSegments?: boolean;
  candidateLimit?: number;
  resultLimit?: number;
};

export type StructuredSearchRow = {
  kind: StructuredSearchKind;
  stableId: string;
  name: string;
  aliases: string[];
  body: string;
  /** PostgreSQL rank before the shared-core tier mapping. */
  rank?: number;
  /** PostgreSQL match class; absent only for legacy in-memory fakes. */
  matchType?: SearchMatchType;
};

export type DocumentSearchRow = {
  key: string;
  document: Pick<DocumentSummary, "id" | "sourceKey" | "title" | "type" | "locale"> & {
    type: DocumentType;
  };
  body: string;
  title: string;
  segmentId?: string | null;
  rank?: number;
  matchType?: SearchMatchType;
};

export interface SearchRepositoryPort {
  listStructuredAtRevision(request: StructuredSearchRequest): Promise<StructuredSearchRow[]>;
  listStructuredAtRevision(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<StructuredSearchRow[]>;
  resolveEntityCandidates(request: EntityCandidateSearchRequest): Promise<ResolverCandidate[]>;
  listDialogueHits(
    gameId: string,
    revisionId: string,
    query: string,
    filters?: DialogueSearchFilters,
  ): Promise<
    Array<{
      key: string;
      title: string;
      body: string;
      speaker: string | null;
      questTitle: string | null;
      questType: string | null;
      documentId: string;
      nodeKey: string;
      subquestKey: string | null;
      citation: {
        documentId: string;
        locale: string;
        questKey: string;
        subquestKey?: string;
        dialogueNodeKey: string;
        revision: string;
      };
      rank?: number;
      matchType?: SearchMatchType;
    }>
  >;
  listDocumentHits(request: DocumentSearchRequest): Promise<DocumentSearchRow[]>;
  listDocumentHits(gameId: string, revisionId: string, query: string): Promise<DocumentSearchRow[]>;
}
