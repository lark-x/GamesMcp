import type { StarRailCorpusDocument } from "./types.js";

export interface IstarothManifestEntry {
  category: string;
  title: string;
  id: number;
  relative_path: string;
  min_version: null;
  max_version: null;
}

export function buildIstarothManifest(
  documents: StarRailCorpusDocument[],
): IstarothManifestEntry[] {
  return documents
    .map((document) => ({
      category: document.category,
      title: document.title,
      id: document.id,
      relative_path: document.relativePath,
      min_version: null,
      max_version: null,
    }))
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.id - right.id ||
        left.relative_path.localeCompare(right.relative_path),
    );
}
