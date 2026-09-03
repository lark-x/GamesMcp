import type { DataKind } from "../archive.types.js";

export interface DataItemSummary {
  stableId: string;
  name: string;
  category?: string | null;
  rarity?: number | null;
  element?: string | null;
  weaponType?: string | null;
  description?: string | null;
  title?: string | null;
  affiliation?: string | null;
  region?: string | null;
  requirement?: string | null;
  reward?: string | null;
  raw?: Record<string, unknown>;
}

export interface DataCategoryConfig {
  kind: DataKind;
  label: (gameId?: string) => string;
  endpoint: string;
  singularName: (gameId?: string) => string;
}
