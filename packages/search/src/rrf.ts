export const RRF_K = 60;

export type RankedList<T> = Array<{ item: T; key: string }>;

/**
 * Reciprocal Rank Fusion over two ranked lists keyed by stable identity.
 * Lexical and semantic lists contribute independently; duplicates merge.
 */
export function rrfFuse<T>(
  primary: RankedList<T>,
  secondary: RankedList<T> = [],
  k: number = RRF_K,
): Array<{ item: T; key: string; score: number; sources: string[] }> {
  const fused = new Map<string, { item: T; score: number; sources: string[] }>();
  const add = (list: RankedList<T>, source: string) => {
    list.forEach((entry, index) => {
      const contribution = 1 / (k + index + 1);
      const existing = fused.get(entry.key);
      if (existing) {
        existing.score += contribution;
        if (!existing.sources.includes(source)) existing.sources.push(source);
      } else {
        fused.set(entry.key, { item: entry.item, score: contribution, sources: [source] });
      }
    });
  };
  add(primary, "lexical");
  add(secondary, "semantic");
  return [...fused.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.score - left.score);
}
