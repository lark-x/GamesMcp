import type { SearchRepositoryPort, StructuredSearchKind } from "./port.js";
import { rankCandidate } from "./ranking.js";
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
  score: number;
  matchedBy: string;
};

export type SearchCoreResult = {
  structured: SearchCoreStructuredHit[];
  dialogue: SearchCoreDialogueHit[];
  documents: SearchCoreDocumentHit[];
};

/**
 * Shared search core over the repository port. Ranking is tiered and
 * deterministic; results are shaped through the token budget for MCP reuse.
 */
export class SearchService {
  constructor(private readonly repository: SearchRepositoryPort) {}

  async searchText(gameId: string, revisionId: string, query: string): Promise<SearchCoreResult> {
    const [structured, documents, dialogue] = await Promise.all([
      this.repository.listStructuredAtRevision(gameId, revisionId),
      this.repository.listDocumentHits(gameId, revisionId, query),
      this.repository.listDialogueHits(gameId, revisionId, query),
    ]);
    const structuredHits = structured
      .map((item) => {
        const ranked = rankCandidate(query, {
          title: item.name,
          aliases: item.aliases,
          body: item.body,
        });
        return {
          kind: item.kind,
          stableId: "",
          name: item.name,
          score: ranked.score,
          matchedBy: ranked.matchedBy,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
    const documentHits = documents
      .map((item) => {
        const ranked = rankCandidate(query, { title: item.document.title, body: item.body });
        return {
          document: item.document,
          body: item.body,
          score: ranked.score,
          matchedBy: ranked.matchedBy,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
    const dialogueHits = dialogue
      .map((item) => {
        const ranked = rankCandidate(query, {
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
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
    return { structured: structuredHits, dialogue: dialogueHits, documents: documentHits };
  }

  async searchDialogue(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<SearchCoreDialogueHit[]> {
    const result = await this.searchText(gameId, revisionId, query);
    return result.dialogue;
  }

  async searchLore(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<SearchCoreDocumentHit[]> {
    const result = await this.searchText(gameId, revisionId, query);
    return result.documents;
  }

  async resolveEntity(
    gameId: string,
    revisionId: string,
    query: string,
  ): Promise<ResolvedEntity | null> {
    const candidates = await this.repository.listEntityCandidates(gameId, revisionId);
    return resolveEntityFromCandidates(query, candidates);
  }

  shapeForMcp<T extends { title?: string; excerpt?: string }>(
    hits: T[],
    budget?: McpResponseBudget,
  ): ShapedPage {
    return shapeForBudget(hits, budget);
  }
}
