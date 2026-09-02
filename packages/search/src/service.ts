import type {
  DocumentSearchRequest,
  DialogueSearchFilters,
  EntityCandidateSearchRequest,
  SearchSurface,
  SearchRepositoryPort,
  SearchMatchType,
  StructuredSearchRequest,
  StructuredSearchKind,
} from "./port.js";
import { rankCandidate, scoreSearchMatch } from "./ranking.js";
import { resolveEntityFromCandidates, type ResolvedEntity } from "./entity-resolver.js";
import { shapeForBudget, type McpResponseBudget, type ShapedPage } from "./token-budget.js";

export type SearchCoreStructuredHit = {
  kind: StructuredSearchKind;
  stableId: string;
  name: string;
  score: number;
  matchedBy: string;
};

export type SearchCoreDialogueHit = {
  quest: string;
  subquest: string | null;
  speaker: string | null;
  text: string;
  dialogueNodeKey: string;
  citation: {
    documentId: string;
    locale: string;
    questKey: string;
    subquestKey?: string;
    dialogueNodeKey: string;
    revision: string;
  };
  score: number;
};

export type SearchCoreDocumentHit = {
  document: {
    id: string;
    sourceKey?: string | null;
    title: string;
    type: string;
    locale?: string | null;
  };
  body: string;
  segmentId?: string | null;
  score: number;
  matchedBy: string;
};

export type SearchCoreResult = {
  structured: SearchCoreStructuredHit[];
  dialogue: SearchCoreDialogueHit[];
  documents: SearchCoreDocumentHit[];
};

export type SearchCoreRequest = {
  gameId: string;
  revisionId: string;
  query: string;
  surfaces?: SearchSurface[];
  documentTypes?: DocumentSearchRequest["documentTypes"];
  structuredKinds?: StructuredSearchRequest["kinds"];
  locales?: string[];
  limit?: number;
};

/**
 * Shared search core over the repository port. Ranking is tiered and
 * deterministic; results are shaped through the token budget for MCP reuse.
 */
export class SearchService {
  constructor(private readonly repository: SearchRepositoryPort) {}

  async searchCore(request: SearchCoreRequest): Promise<SearchCoreResult> {
    const surfaces = new Set(request.surfaces ?? ["structured", "document", "segment", "dialogue"]);
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const [structured, documents, dialogue] = await Promise.all([
      surfaces.has("structured")
        ? this.repository.listStructuredAtRevision({
            gameId: request.gameId,
            revisionId: request.revisionId,
            query: request.query,
            kinds: request.structuredKinds,
            limit: Math.max(limit * 4, 40),
          })
        : Promise.resolve([]),
      surfaces.has("document") || surfaces.has("segment")
        ? this.repository.listDocumentHits({
            gameId: request.gameId,
            revisionId: request.revisionId,
            query: request.query,
            documentTypes: request.documentTypes,
            locales: request.locales,
            includeDocuments: surfaces.has("document"),
            includeSegments: surfaces.has("segment"),
            resultLimit: Math.max(limit * 2, 20),
          })
        : Promise.resolve([]),
      surfaces.has("dialogue")
        ? this.repository.listDialogueHits(request.gameId, request.revisionId, request.query, {
            locale: request.locales?.[0],
          })
        : Promise.resolve([]),
    ]);
    const structuredHits = structured
      .map((item) => {
        const ranked = item.matchType
          ? {
              score: scoreSearchMatch(item.matchType, item.rank),
              matchedBy: item.matchType,
            }
          : rankCandidate(request.query, {
              title: item.name,
              aliases: item.aliases,
              body: item.body,
            });
        return {
          kind: item.kind,
          stableId: item.stableId,
          name: item.name,
          score: ranked.score,
          matchedBy: ranked.matchedBy,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    const documentHits = documents
      .map((item) => {
        const ranked = item.matchType
          ? {
              score: scoreSearchMatch(item.matchType, item.rank),
              matchedBy: item.matchType,
            }
          : rankCandidate(request.query, { title: item.document.title, body: item.body });
        return {
          document: item.document,
          body: item.body,
          segmentId: item.segmentId,
          score: ranked.score,
          matchedBy: ranked.matchedBy,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    const dialogueHits = this.mapDialogueHits(request.query, dialogue)
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(limit, 10));
    return { structured: structuredHits, dialogue: dialogueHits, documents: documentHits };
  }

  async searchText(gameId: string, revisionId: string, query: string): Promise<SearchCoreResult> {
    return this.searchCore({ gameId, revisionId, query });
  }

  async searchDialogue(
    gameId: string,
    revisionId: string,
    query: string,
    filters?: DialogueSearchFilters,
  ): Promise<SearchCoreDialogueHit[]> {
    const dialogue = await this.repository.listDialogueHits(gameId, revisionId, query, filters);
    return this.mapDialogueHits(query, dialogue)
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  }

  async searchLore(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<SearchCoreDocumentHit[]> {
    const documents = await this.repository.listDocumentHits({
      gameId,
      revisionId,
      query,
      includeDocuments: true,
      includeSegments: true,
    });
    return documents
      .map((item) => {
        const ranked = item.matchType
          ? {
              score: scoreSearchMatch(item.matchType, item.rank),
              matchedBy: item.matchType,
            }
          : rankCandidate(query, { title: item.document.title, body: item.body });
        return {
          document: item.document,
          body: item.body,
          segmentId: item.segmentId,
          score: ranked.score,
          matchedBy: ranked.matchedBy,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
  }

  async resolveEntity(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<ResolvedEntity | null> {
    const candidates = await this.resolveEntityCandidates({
      gameId,
      revisionId,
      query,
      limit: 100,
    });
    return resolveEntityFromCandidates(query, candidates);
  }

  async resolveEntityCandidates(request: EntityCandidateSearchRequest) {
    return this.repository.resolveEntityCandidates(request);
  }

  shapeForMcp<T extends { title?: string; excerpt?: string }>(
    hits: T[],
    budget?: McpResponseBudget,
  ): ShapedPage {
    return shapeForBudget(hits, budget);
  }

  private mapDialogueHits(
    query: string,
    dialogue: Array<{
      title: string;
      body: string;
      speaker: string | null;
      questTitle: string | null;
      questType: string | null;
      nodeKey: string;
      subquestKey: string | null;
      citation: SearchCoreDialogueHit["citation"];
      rank?: number;
      matchType?: SearchMatchType;
    }>,
  ): SearchCoreDialogueHit[] {
    return dialogue.map((item) => {
      const ranked = item.matchType
        ? {
            score: scoreSearchMatch(item.matchType, item.rank),
            matchedBy: item.matchType,
          }
        : rankCandidate(query, {
            title: item.title,
            body: item.body,
            speaker: item.speaker,
            questTitle: item.questTitle,
            questType: item.questType,
          });
      return {
        quest: item.questTitle ?? item.title,
        subquest: item.subquestKey,
        speaker: item.speaker,
        text: item.body,
        dialogueNodeKey: item.nodeKey,
        citation: item.citation,
        score: ranked.score,
      };
    });
  }
}
