export type ArchiveRoute =
  | { kind: "home" }
  | { kind: "quests" }
  | { kind: "story"; questKey?: string }
  | { kind: "story-catalog" }
  | { kind: "materials"; materialId?: string }
  | { kind: "text"; textKind: string; bookId?: string; chapterId?: string }
  | { kind: "unknown" };

export type StoryTreeNode = {
  id: string;
  type: string;
  title: string;
  parentId?: string;
  order?: number;
  children?: StoryTreeNode[];
};

/** flattened single story entry, regardless of quest API grouping. */
export type StoryEntry = {
  questKey: string;
  title: string;
  type:
    | "archon_quest"
    | "story_quest"
    | "world_quest"
    | "event_quest"
    | "commission"
    | "hangout"
    | "other";
  chapter?: string | null;
  series?: string | null;
  completeness: "complete" | "partial" | "metadata_only";
  locale: string;
};

export type StoryCatalogFilters = {
  query: string;
  type: string;
  locale: string;
};
