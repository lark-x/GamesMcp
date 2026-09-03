import type { ArchiveRoute, ArchiveSection, DataKind } from "./archive.types.js";
export type { ArchiveSection, DataKind };

/** Parse a hash route into a typed archive route object and perform necessary redirects. */
export function parseArchiveRoute(hash = window.location.hash): ArchiveRoute {
  const raw = hash.replace(/^#/, "");

  // Root / Home
  if (!raw || raw === "home") {
    return { kind: "home" };
  }

  // Legacy Story redirects: #quests or #story-catalog -> #story
  if (raw === "quests" || raw === "story-catalog") {
    window.history.replaceState(null, "", "#story");
    return { kind: "story" };
  }

  // Story: #story, #story/:questKey, #story/:questKey/:subquestKey
  const storyMatch = /^story(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(raw);
  if (storyMatch) {
    return {
      kind: "story",
      questKey: storyMatch[1] ? decodeURIComponent(storyMatch[1]) : undefined,
      subquestKey: storyMatch[2] ? decodeURIComponent(storyMatch[2]) : undefined,
    };
  }

  // Materials: #archive/materials or legacy #codex/materials
  if (raw.startsWith("codex/materials")) {
    const next = raw.replace(/^codex\/materials/, "archive/materials");
    window.history.replaceState(null, "", `#${next}`);
    const matMatch = /^codex\/materials(?:\/(.+))?$/.exec(raw);
    return {
      kind: "materials",
      materialId: matMatch?.[1] ? decodeURIComponent(matMatch[1]) : undefined,
    };
  }
  const materialMatch = /^archive\/materials(?:\/(.+))?$/.exec(raw);
  if (materialMatch) {
    return {
      kind: "materials",
      materialId: materialMatch[1] ? decodeURIComponent(materialMatch[1]) : undefined,
    };
  }

  // Legacy Codex Data redirects -> #archive/:dataKind
  const legacyCodexDataMap: Record<string, DataKind> = {
    characters: "characters",
    weapons: "weapons",
    artifacts: "artifacts",
    enemies: "enemies",
    achievements: "achievements",
  };
  const codexDataMatch =
    /^codex\/(characters|weapons|artifacts|enemies|achievements)(?:\/(.+))?$/.exec(raw);
  if (codexDataMatch) {
    const dataKind = legacyCodexDataMap[codexDataMatch[1]];
    const itemId = codexDataMatch[2] ? decodeURIComponent(codexDataMatch[2]) : undefined;
    const targetHash = itemId
      ? `archive/${dataKind}/${encodeURIComponent(itemId)}`
      : `archive/${dataKind}`;
    window.history.replaceState(null, "", `#${targetHash}`);
    return {
      kind: "data",
      dataKind,
      itemId,
    };
  }

  // Data Browser: #archive/:dataKind (characters, weapons, artifacts, enemies, achievements)
  const dataMatch =
    /^archive\/(characters|weapons|artifacts|enemies|achievements)(?:\/(.+))?$/.exec(raw);
  if (dataMatch) {
    return {
      kind: "data",
      dataKind: dataMatch[1] as DataKind,
      itemId: dataMatch[2] ? decodeURIComponent(dataMatch[2]) : undefined,
    };
  }

  // Legacy Codex Text redirects -> #text/:textKind
  const legacyCodexTextMap: Record<string, string> = {
    books: "books",
    items: "items",
    "character-stories": "character-stories",
    voices: "voices",
    tutorials: "tutorials",
    mechanics: "mechanics",
  };
  const codexTextMatch =
    /^codex\/(books|items|character-stories|voices|tutorials|mechanics)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(
      raw,
    );
  if (codexTextMatch) {
    const textKind = legacyCodexTextMap[codexTextMatch[1]];
    const bookId = codexTextMatch[2] ? decodeURIComponent(codexTextMatch[2]) : undefined;
    const chapterId = codexTextMatch[3] ? decodeURIComponent(codexTextMatch[3]) : undefined;
    const targetParts = ["text", textKind];
    if (bookId) targetParts.push(encodeURIComponent(bookId));
    if (bookId && chapterId) targetParts.push(encodeURIComponent(chapterId));
    window.history.replaceState(null, "", `#${targetParts.join("/")}`);
    return {
      kind: "text",
      textKind,
      bookId,
      chapterId,
    };
  }

  // Text Browser: #text/:textKind (books, items, character-stories, voices, tutorials, mechanics)
  const textMatch = /^text\/([a-z-]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(raw);
  if (textMatch) {
    return {
      kind: "text",
      textKind: textMatch[1],
      bookId: textMatch[2] ? decodeURIComponent(textMatch[2]) : undefined,
      chapterId: textMatch[3] ? decodeURIComponent(textMatch[3]) : undefined,
    };
  }

  // Search: #search or #search?q=...
  if (raw === "search" || raw.startsWith("search?")) {
    const queryStr = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    const params = new URLSearchParams(queryStr);
    return { kind: "search", query: params.get("q") ?? undefined };
  }

  // Ask / QA: #ask or #ask?q=...
  if (raw === "ask" || raw.startsWith("ask?")) {
    const queryStr = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    const params = new URLSearchParams(queryStr);
    return { kind: "ask", question: params.get("q") ?? undefined };
  }

  return { kind: "unknown" };
}
