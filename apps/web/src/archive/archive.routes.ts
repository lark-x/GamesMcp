import type { ArchiveRoute, ArchiveSection } from "./archive.types.js";
export type { ArchiveSection };

/** Parse a hash route into a typed archive route object. */
export function parseArchiveRoute(hash = window.location.hash): ArchiveRoute {
  const raw = hash.replace(/^#/, "");
  if (raw === "story" || raw === "quests" || raw === "story-catalog") {
    return raw === "story-catalog" ? { kind: "story-catalog" } : { kind: "quests" };
  }
  const storyMatch = /^story(?:\/(.+))?$/.exec(raw);
  if (storyMatch) {
    return {
      kind: "story",
      questKey: storyMatch[1] ? decodeURIComponent(storyMatch[1]) : undefined,
    };
  }
  const materialMatch = /^archive\/materials(?:\/(.+))?$/.exec(raw);
  if (materialMatch) {
    return {
      kind: "materials",
      materialId: materialMatch[1] ? decodeURIComponent(materialMatch[1]) : undefined,
    };
  }
  const textMatch = /^text\/([a-z-]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(raw);
  if (textMatch) {
    return {
      kind: "text",
      textKind: textMatch[1],
      bookId: textMatch[2] ? decodeURIComponent(textMatch[2]) : undefined,
      chapterId: textMatch[3] ? decodeURIComponent(textMatch[3]) : undefined,
    };
  }
  return { kind: "unknown" };
}
