import type { DocumentSummary } from "@gip/contracts";
import type { DocumentType } from "@gip/contracts";

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
  ): Promise<Array<{ kind: StructuredSearchKind; name: string; aliases: string[]; body: string }>>;
  listEntityCandidates(
    gameId: string,
    revisionId: string,
  ): Promise<
    Array<{
      id: string;
      entityType: string;
      canonicalName: string;
      aliases: string[];
      normalized?: string | null;
    }>
  >;
  listDialogueHits(
    gameId: string,
    revisionId: string,
    query: string,
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
    }>
  >;
};
