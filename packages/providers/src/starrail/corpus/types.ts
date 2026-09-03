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

export type StarRailCorpusCategory =
  | "sr_mission"
  | "sr_story"
  | "sr_message"
  | "sr_train_visitor"
  | "sr_book"
  | "sr_character_story"
  | "sr_voiceline"
  | "sr_item_lore";

export interface StarRailCorpusDocument {
  category: StarRailCorpusCategory;
  id: number;
  relativePath: string;
  title: string;
  content: string;
  sourceFiles: string[];
  sourceIds: string[];
  metadata?: Record<string, unknown>;
  hierarchy?: {
    parentId?: string;
    label?: string;
    order?: number;
  };
}

export interface StarRailCorpusBuildResult {
  schemaVersion: 1;
  game: "starrail";
  locale: string;
  sourceCommit: string;
  generatedAt: string;
  documents: StarRailCorpusDocument[];
  metadata: StarRailCorpusMetadata;
}

export interface StarRailCorpusMetadata {
  source: {
    game: "starrail";
    source: "DimbreathBot/TurnBasedGameData";
    sourceCommit: string;
    generatedAt: string;
    generator: "gamesmcp-starrail-corpus";
    generatorVersion: "1";
    locale: string;
  };
  files: Array<{
    category: StarRailCorpusCategory;
    id: number;
    relativePath: string;
    sourceFiles: string[];
    sourceIds: string[];
  }>;
  stats: {
    documents: number;
    chars: number;
    categories: Record<string, number>;
    unresolvedText: number;
    duplicateRejected: number;
    sourceFiles: number;
  };
  issues: Array<{
    code: string;
    message: string;
    sourcePath?: string;
    sourceId?: string;
  }>;
  hierarchy: Record<
    string,
    {
      nodes: Array<{
        key: string;
        title: string;
        children: null;
        file_id: number;
        toc_eligible: boolean;
      }>;
    }
  >;
}
