import { createHash } from "node:crypto";
import type { StarRailCorpusCategory } from "./types.js";

const MAX_SAFE_POSITIVE_INT = 0x1f_ffff_ffff_ffff;

export function naturalId(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_SAFE_POSITIVE_INT) return undefined;
  return number;
}

export function deterministicCorpusId(input: {
  game?: string;
  category: StarRailCorpusCategory;
  identity: string;
}): number {
  const hash = createHash("sha256")
    .update(`${input.game ?? "starrail"}\n${input.category}\n${input.identity}`)
    .digest();
  return hash.readUIntBE(0, 6) % MAX_SAFE_POSITIVE_INT;
}

export function buildStableContentIdentity(input: {
  game?: string;
  category: StarRailCorpusCategory;
  canonicalSourcePath: string;
  semanticKeys?: Array<string | number>;
  normalizedTitle?: string;
}): string {
  const hash = createHash("sha256")
    .update(
      [
        input.game ?? "starrail",
        input.category,
        input.canonicalSourcePath,
        ...(input.semanticKeys?.map(String) ?? []),
        input.normalizedTitle ?? "",
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 16);
  return `hash:${hash}`;
}

export function assertUniqueCorpusIds(
  documents: Array<{ category: StarRailCorpusCategory; id: number; relativePath: string }>,
): void {
  const seen = new Map<string, string>();
  for (const document of documents) {
    const key = `${document.category}:${document.id}`;
    const previous = seen.get(key);
    if (previous)
      throw new Error(
        `Duplicate StarRail corpus id ${key}: ${previous} and ${document.relativePath}`,
      );
    seen.set(key, document.relativePath);
  }
}
