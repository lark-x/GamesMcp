export type ArchiveMaterial = {
  stableId: string;
  name: string;
  category: string;
  rarity?: number | null;
  description?: string | null;
  sources?: string[];
  usedBy?: string[];
  gameVersion?: string | null;
  locale?: string | null;
  revisionId?: string;
  sourceName?: string;
};
