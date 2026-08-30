import type { ValidationIssue } from "../packages/domain/src/index.ts";

export function failureSourceKey(category: unknown, upstreamId: unknown): string | undefined {
  if (typeof upstreamId !== "string" || !upstreamId.trim()) return undefined;
  if (category === "book") return `book/${upstreamId}`;
  if (category === "character_story") {
    const [avatarId, fetterId] = upstreamId.split(":");
    if (avatarId && fetterId) return `character/${avatarId}/story/${fetterId}`;
  }
  if (category === "item_description") return `item-codex/${upstreamId}`;
  return undefined;
}

export function manifestFailureIssues(
  manifest: Record<string, unknown>,
  category?: string,
): ValidationIssue[] {
  if (!Array.isArray(manifest.failures)) return [];
  return manifest.failures.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const failure = value as Record<string, unknown>;
    if (category && failure.category !== category) return [];
    const sourceKey = failureSourceKey(failure.category, failure.upstreamId);
    const reason = typeof failure.reason === "string" ? failure.reason : "unknown_failure";
    if (!sourceKey) return [];
    return [
      {
        severity: "error" as const,
        code: `anime_conversion_${reason}`,
        message: `AnimeGameData conversion failed: ${reason}`,
        sourceKey,
      },
    ];
  });
}
