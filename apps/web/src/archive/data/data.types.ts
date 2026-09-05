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
  passiveName?: string | null;
  passiveDescription?: string | null;
  birthday?: string | null;
  constellation?: string | null;
  weaknesses?: string[];
  rank?: string | null;
  raw?: Record<string, unknown>;
}

/** 上游测试/废弃条目在目录中不展示（原神白盒、星铁内部条目等）。 */
export function isInternalEntry(name: string): boolean {
  return /白盒|测试|[（(]\s*test\s*[）)]|^test[\s:_-]|废弃$|占位|placeholder|^UGC \(|^？+$|^\?{3,}$/i.test(name);
}

export interface DataCategoryConfig {
  kind: DataKind;
  label: (gameId?: string) => string;
  endpoint: string;
  singularName: (gameId?: string) => string;
}
