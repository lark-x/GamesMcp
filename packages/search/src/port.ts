import type { DocumentSummary } from "@gip/contracts";
import type { DocumentType } from "@gip/contracts";
import type { ResolverCandidate } from "./entity-resolver.js";

export type SearchMatchType = "fts" | "trgm" | "prefix" | "exact";

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

export type StructuredSearchKind =
  | "character"
  | "weapon"
  | "artifact_set"
  | "artifact"
  | "material"
  | "achievement"
  | "enemy"
  | "voice";

export type SearchRepositoryPort = {
  listStructuredAtRevision(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<
    Array<{
      kind: StructuredSearchKind;
      stableId: string;
      name: string;
      aliases: string[];
      body: string;
      /** PostgreSQL rank before the shared-core tier mapping. */
      rank?: number;
      /** PostgreSQL match class; absent only for legacy in-memory fakes. */
      matchType?: SearchMatchType;
    }>
  >;
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
  listDocumentHits(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<
    Array<{
      key: string;
      document: Pick<DocumentSummary, "id" | "sourceKey" | "title" | "type" | "locale"> & {
        type: DocumentType;
      };
      body: string;
      title: string;
      rank?: number;
      matchType?: SearchMatchType;
    }>
  >;
};
