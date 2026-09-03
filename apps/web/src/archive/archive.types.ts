export type ArchiveSection = "home" | "story" | "data" | "materials" | "text" | "search" | "ask";

export type DataKind = "characters" | "weapons" | "artifacts" | "enemies" | "achievements";

export type ArchiveRoute =
  | { kind: "home" }
  | { kind: "story"; questKey?: string; subquestKey?: string }
  | { kind: "quests" } // legacy alias
  | { kind: "story-catalog" } // legacy alias
  | { kind: "materials"; materialId?: string }
  | { kind: "data"; dataKind: DataKind; itemId?: string }
  | { kind: "text"; textKind: string; bookId?: string; chapterId?: string }
  | { kind: "search"; query?: string }
  | { kind: "ask"; question?: string }
  | { kind: "unknown" };

export interface StoryTreeNode {
  id: string;
  type: "region" | "series" | "chapter" | "quest";
  title: string;
  order?: number;
  questKey?: string;
  children?: StoryTreeNode[];
}

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
  type?: string;
  locale?: string;
};
