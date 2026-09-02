export interface GameKnowledgeDocument {
  stableId: string;
  game: string;
  category: string;
  title?: string;
  content: string;
  sourcePath: string;
  sourceRef: string;
  metadata?: Record<string, unknown>;
}
