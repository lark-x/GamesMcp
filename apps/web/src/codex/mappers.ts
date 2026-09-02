import type { ArchiveHomeCategory, ArchiveHomeResponse } from "@gip/contracts";
import type { QuestDetail, QuestSearchHit } from "../api.js";

type RecordValue = Record<string, unknown>;
type QuestType = QuestSearchHit["type"];
type Completeness = QuestSearchHit["completeness"];

const questTypes = new Set<QuestType>([
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
  "commission",
  "hangout",
  "other",
]);
const completenessValues = new Set<Completeness>(["complete", "partial", "metadata_only"]);

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function asOrder(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asQuestType(value: unknown, fallback: QuestType): QuestType {
  return typeof value === "string" && questTypes.has(value as QuestType)
    ? (value as QuestType)
    : fallback;
}

function asCompleteness(value: unknown, fallback: Completeness): Completeness {
  return typeof value === "string" && completenessValues.has(value as Completeness)
    ? (value as Completeness)
    : fallback;
}

/**
 * Normalize the public landing-page payload before it reaches view code.
 * Public endpoints can legitimately return an empty object while a game has
 * no published revision, so this mapper keeps the UI total and predictable.
 */
export function mapArchiveHomeResponse(value: unknown): ArchiveHomeResponse {
  const raw = asRecord(value);
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const categories = rawCategories.map((value): ArchiveHomeCategory => {
    const category = asRecord(value);
    const rawEntries = Array.isArray(category.entries) ? category.entries : [];
    return {
      id: asString(category.id, "unknown"),
      label: asString(category.label, "未分类资料"),
      description: asString(category.description),
      count: asCount(category.count),
      entries: rawEntries.map((value) => {
        const entry = asRecord(value);
        const mapped = {
          id: asString(entry.id),
          name: asString(entry.name, "未命名资料"),
          kind: entry.kind === "entity" ? ("entity" as const) : ("document" as const),
          type: asString(entry.type, "unknown"),
          locale: optionalString(entry.locale),
          documentId: optionalString(entry.documentId),
          anchorId: optionalString(entry.anchorId),
        };
        return mapped;
      }),
    };
  });
  return {
    gameId: asString(raw.gameId),
    revision: asString(raw.revision, asString(raw.latestRevision)),
    locale: asString(raw.locale, "zh-CN"),
    categories,
    revisionId: optionalString(raw.revisionId),
    latestRevision: optionalString(raw.latestRevision),
    latestRevisionId: optionalString(raw.latestRevisionId),
  };
}

type Citation = QuestDetail["citations"][number];

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function mapCitation(
  value: unknown,
  defaults: { documentId: string; locale: string; questKey: string; revision: string },
  nodeByKey: Map<string, QuestDetail["dialogueNodes"][number]>,
): Citation {
  const raw = asRecord(value);
  const dialogueNodeKey = optionalString(raw.dialogueNodeKey);
  const node = dialogueNodeKey ? nodeByKey.get(dialogueNodeKey) : undefined;
  return {
    documentId: asString(raw.documentId, defaults.documentId),
    locale: asString(raw.locale, defaults.locale),
    questKey: asString(raw.questKey, defaults.questKey),
    subquestKey: optionalString(raw.subquestKey) ?? node?.subquestKey,
    dialogueNodeKey,
    segmentId: optionalString(raw.segmentId) ?? node?.segmentId,
    sourceKey: optionalString(raw.sourceKey),
    sourceName: optionalString(raw.sourceName),
    sourceSnapshotId: optionalString(raw.sourceSnapshotId),
    revision: asString(raw.revision, defaults.revision),
  };
}

/**
 * Map a Quest API page into the stable shape used by the reader. Missing
 * citation rows are filled from dialogue nodes so every displayed line keeps
 * a revision/document/node reference.
 */
export function mapQuestDetail(value: unknown, fallback?: QuestSearchHit): QuestDetail {
  const raw = asRecord(value);
  const questKey = asString(raw.questKey, fallback?.questKey ?? "");
  const type = asQuestType(raw.type, fallback?.type ?? "other");
  const completeness = asCompleteness(raw.completeness, fallback?.completeness ?? "partial");
  const locale = asString(raw.locale, fallback?.locale ?? "zh-CN");
  const revision = asString(raw.revision, fallback?.revision ?? "");
  const documentId = asString(raw.documentId, fallback?.documentId ?? "");
  const rawNodes = Array.isArray(raw.dialogueNodes) ? raw.dialogueNodes : [];
  const dialogueNodes = rawNodes.map((value, index) => {
    const node = asRecord(value);
    return {
      nodeKey: asString(node.nodeKey, `${questKey}/dialog/${index + 1}`),
      nodeId:
        typeof node.nodeId === "string" || typeof node.nodeId === "number"
          ? node.nodeId
          : index + 1,
      type: asString(node.type, "dialogue"),
      subquestKey: optionalString(node.subquestKey),
      speakerKey: optionalString(node.speakerKey),
      speakerName: optionalString(node.speakerName),
      body: asString(node.body),
      segmentId: optionalString(node.segmentId),
      order: asOrder(node.order, index),
    };
  });
  const nodeByKey = new Map(dialogueNodes.map((node) => [node.nodeKey, node]));
  const rawCitations = Array.isArray(raw.citations) ? raw.citations : [];
  const citations = rawCitations.map((citation) =>
    mapCitation(citation, { documentId, locale, questKey, revision }, nodeByKey),
  );
  const citationNodeKeys = new Set(
    citations
      .map((citation) => citation.dialogueNodeKey)
      .filter((key): key is string => Boolean(key)),
  );
  for (const node of dialogueNodes) {
    if (citationNodeKeys.has(node.nodeKey)) continue;
    citations.push({
      documentId,
      locale,
      questKey,
      subquestKey: node.subquestKey,
      dialogueNodeKey: node.nodeKey,
      segmentId: node.segmentId,
      revision,
    });
  }

  const rawSubquests = Array.isArray(raw.subquests) ? raw.subquests : [];
  const subquests = rawSubquests.map((value, index) => {
    const subquest = asRecord(value);
    return {
      subquestKey: asString(subquest.subquestKey, `${questKey}/subquest/${index + 1}`),
      subquestId:
        typeof subquest.subquestId === "string" || typeof subquest.subquestId === "number"
          ? subquest.subquestId
          : index + 1,
      title: asString(subquest.title, `阶段 ${index + 1}`),
      objective: optionalString(subquest.objective),
      order: asOrder(subquest.order, index),
      completeness: asCompleteness(subquest.completeness, completeness),
    };
  });
  const rawEdges = Array.isArray(raw.dialogueEdges) ? raw.dialogueEdges : [];
  const dialogueEdges = rawEdges.map((value) => {
    const edge = asRecord(value);
    return {
      fromNodeKey: asString(edge.fromNodeKey),
      toNodeKey: asString(edge.toNodeKey),
      type: asString(edge.type, "next"),
      optionText: optionalString(edge.optionText),
    };
  });
  const rawParticipants = Array.isArray(raw.participants) ? raw.participants : [];
  const participants = rawParticipants.map((value) => {
    const participant = asRecord(value);
    return {
      id: asString(participant.id),
      sourceKey: optionalString(participant.sourceKey) ?? null,
      name: asString(participant.name, "未知角色"),
      type: asString(participant.type, "npc"),
    };
  });
  const rawPrerequisites = Array.isArray(raw.prerequisites) ? raw.prerequisites : [];
  const rawWarnings = Array.isArray(raw.warnings) ? raw.warnings : [];
  const nextCursor = raw.nextCursor === null ? null : optionalString(raw.nextCursor);
  const totalDialogueNodes =
    typeof raw.totalDialogueNodes === "number" && Number.isFinite(raw.totalDialogueNodes)
      ? Math.max(0, Math.floor(raw.totalDialogueNodes))
      : dialogueNodes.length;
  const loadedDialogueNodes =
    typeof raw.loadedDialogueNodes === "number" && Number.isFinite(raw.loadedDialogueNodes)
      ? Math.max(0, Math.floor(raw.loadedDialogueNodes))
      : dialogueNodes.length;
  return {
    questKey,
    mainQuestId: asString(raw.mainQuestId, fallback?.mainQuestId ?? questKey),
    title: asString(raw.title, fallback?.title ?? questKey),
    type,
    chapter: optionalString(raw.chapter) ?? fallback?.chapter ?? null,
    series: optionalString(raw.series) ?? fallback?.series ?? null,
    completeness,
    locale,
    documentId,
    revision,
    match: optionalString(raw.match) ?? fallback?.match,
    gameVersion: optionalString(raw.gameVersion),
    subquests,
    dialogueNodes,
    dialogueEdges,
    participants,
    prerequisites: rawPrerequisites.filter((item): item is string => typeof item === "string"),
    citations: uniqueBy(
      citations,
      (citation) =>
        `${citation.documentId}:${citation.dialogueNodeKey ?? ""}:${citation.segmentId ?? ""}:${citation.revision}`,
    ),
    warnings: rawWarnings.filter((item): item is string => typeof item === "string"),
    totalDialogueNodes,
    loadedDialogueNodes,
    hasMore: typeof raw.hasMore === "boolean" ? raw.hasMore : Boolean(nextCursor),
    nextCursor,
  };
}

/** Merge one cursor page without duplicating nodes, branches, or citations. */
export function mergeQuestPages(current: QuestDetail, next: QuestDetail): QuestDetail {
  const first = mapQuestDetail(current);
  const second = mapQuestDetail(next, first);
  const dialogueNodes = uniqueBy(
    [...first.dialogueNodes, ...second.dialogueNodes],
    (node) => node.nodeKey,
  );
  const dialogueEdges = uniqueBy(
    [...first.dialogueEdges, ...second.dialogueEdges],
    (edge) => `${edge.fromNodeKey}:${edge.toNodeKey}:${edge.type}:${edge.optionText ?? ""}`,
  );
  const citations = uniqueBy(
    [...first.citations, ...second.citations],
    (citation) =>
      `${citation.documentId}:${citation.dialogueNodeKey ?? ""}:${citation.segmentId ?? ""}:${citation.revision}`,
  );
  const participants = uniqueBy(
    [...first.participants, ...second.participants],
    (participant) => participant.id,
  );
  const mapped = mapQuestDetail(
    {
      ...first,
      ...second,
      subquests: second.subquests.length ? second.subquests : first.subquests,
      dialogueNodes,
      dialogueEdges,
      citations,
      participants,
      prerequisites: [...new Set([...first.prerequisites, ...second.prerequisites])],
      warnings: [...new Set([...first.warnings, ...second.warnings])],
    },
    first,
  );
  mapped.totalDialogueNodes = Math.max(
    first.totalDialogueNodes ?? 0,
    second.totalDialogueNodes ?? 0,
    dialogueNodes.length,
  );
  mapped.loadedDialogueNodes = dialogueNodes.length;
  mapped.hasMore = second.hasMore;
  mapped.nextCursor = second.nextCursor;
  return mapped;
}

export type CodexBookVolume = {
  stableId: string;
  bookStableId: string;
  documentId: string;
  title: string;
  volume: number | string | null;
  order: number;
  segmentCount: number;
  sourceKey?: string | null;
  gameVersion?: string | null;
  locale?: string | null;
  revision?: string;
};

export type CodexBook = {
  stableId: string;
  bookStableId: string;
  title: string;
  volumes: CodexBookVolume[];
};

export type CodexBookCatalog = {
  gameId: string;
  revisionId?: string;
  locale: string;
  books: CodexBook[];
  totalVolumes: number;
  truncated: boolean;
  nextOffset?: number | null;
};

export type CodexCharacterStory = {
  stableId: string;
  storyStableId: string;
  storyKey: string;
  documentId: string;
  title: string;
  displayTitle: string;
  characterStableId: string;
  characterName: string;
  sourceKey?: string | null;
  gameVersion?: string | null;
  locale?: string | null;
  revision?: string;
};

export type CodexCharacterStoryGroup = {
  characterStableId: string;
  characterName: string;
  stories: CodexCharacterStory[];
};

export type CodexCharacterStoryCatalog = {
  gameId: string;
  revisionId?: string;
  locale: string;
  sourceDomain: string;
  corpusStatus: string;
  characters: CodexCharacterStoryGroup[];
  totalStories: number;
  truncated: boolean;
  nextOffset?: number | null;
};

export type CodexTextItem = {
  id: string;
  stableId: string;
  name: string;
  category: string;
  rarity?: number | null;
  description?: string | null;
  sources: string[];
  usedBy: string[];
  gameVersion?: string | null;
  locale?: string | null;
  revisionId?: string;
  sourceKey?: string;
  provenance?: Record<string, unknown>;
};

export type CodexVoiceEntry = {
  id: string;
  name: string;
  type: string;
  locale?: string | null;
};

export type CodexVoiceCatalog = {
  gameId: string;
  revisionId?: string;
  locale: string;
  corpusStatus: string;
  note?: string | null;
  count: number;
  voices: CodexVoiceEntry[];
};

export type CodexMechanicsResult = {
  gameId: string;
  revisionId?: string;
  query: string;
  category?: string | null;
  limit: number;
  corpusStatus: string;
  note?: string | null;
  hits: Array<{ title: string; excerpt: string; citation?: Record<string, unknown> }>;
  truncated: boolean;
};

export type CodexSectionRead = {
  documentId: string;
  title: string;
  locale: string;
  revision: string;
  headingPath: string[];
  body: string;
  truncated: boolean;
  citations: Array<{
    documentId: string;
    segmentId?: string;
    locale: string;
    revision: string;
  }>;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return nullableString(value);
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Normalize the grouped volume catalogue returned by the text reader API. */
export function mapBookListResponse(value: unknown): CodexBookCatalog {
  const raw = asRecord(value);
  const rawBooks = Array.isArray(raw.books) ? raw.books : [];
  return {
    gameId: asString(raw.gameId),
    revisionId: optionalString(raw.revisionId),
    locale: asString(raw.locale, "zh-CN"),
    books: rawBooks.map((value, bookIndex) => {
      const book = asRecord(value);
      const rawVolumes = Array.isArray(book.volumes) ? book.volumes : [];
      const volumes = rawVolumes.map((value, volumeIndex): CodexBookVolume => {
        const volume = asRecord(value);
        return {
          stableId: asString(
            volume.stableId,
            asString(volume.volumeStableId, `volume-${volumeIndex + 1}`),
          ),
          bookStableId: asString(
            volume.bookStableId,
            asString(book.bookStableId, asString(book.stableId)),
          ),
          documentId: asString(volume.documentId, asString(volume.id)),
          title: asString(volume.title, "未命名卷").trim(),
          volume: nullableNumberOrString(volume.volume),
          order: asOrder(volume.order, volumeIndex),
          segmentCount: asCount(volume.segmentCount),
          sourceKey: nullableString(volume.sourceKey),
          gameVersion: nullableString(volume.gameVersion),
          locale: nullableString(volume.locale),
          revision: optionalString(volume.revision),
        };
      });
      volumes.sort(
        (left, right) => left.order - right.order || left.title.localeCompare(right.title),
      );
      return {
        stableId: asString(book.stableId, asString(book.bookStableId, `book-${bookIndex + 1}`)),
        bookStableId: asString(book.bookStableId, asString(book.stableId, `book-${bookIndex + 1}`)),
        title: asString(book.title, "未命名书目"),
        volumes,
      };
    }),
    totalVolumes: asCount(raw.totalVolumes),
    truncated: booleanValue(raw.truncated),
    nextOffset:
      raw.nextOffset === null
        ? null
        : typeof raw.nextOffset === "number" && Number.isFinite(raw.nextOffset)
          ? Math.max(0, Math.floor(raw.nextOffset))
          : undefined,
  };
}

/** Normalize FetterStory records into a character-first catalogue. */
export function mapCharacterStoryListResponse(value: unknown): CodexCharacterStoryCatalog {
  const raw = asRecord(value);
  const rawCharacters = Array.isArray(raw.characters) ? raw.characters : [];
  return {
    gameId: asString(raw.gameId),
    revisionId: optionalString(raw.revisionId),
    locale: asString(raw.locale, "zh-CN"),
    sourceDomain: asString(raw.sourceDomain, "FetterStory"),
    corpusStatus: asString(raw.corpusStatus, "character_story_source_empty"),
    characters: rawCharacters.map((value, characterIndex) => {
      const character = asRecord(value);
      const rawStories = Array.isArray(character.stories) ? character.stories : [];
      return {
        characterStableId: asString(character.characterStableId, `character/${characterIndex + 1}`),
        characterName: asString(character.characterName, "未知角色"),
        stories: rawStories.map((value, storyIndex): CodexCharacterStory => {
          const story = asRecord(value);
          return {
            stableId: asString(
              story.stableId,
              asString(story.storyStableId, `story-${storyIndex + 1}`),
            ),
            storyStableId: asString(
              story.storyStableId,
              asString(story.stableId, `story-${storyIndex + 1}`),
            ),
            storyKey: asString(story.storyKey, String(storyIndex + 1)),
            documentId: asString(story.documentId, asString(story.id)),
            title: asString(story.title, "未命名故事"),
            displayTitle: asString(story.displayTitle, asString(story.title, "未命名故事")),
            characterStableId: asString(
              story.characterStableId,
              asString(character.characterStableId, `character/${characterIndex + 1}`),
            ),
            characterName: asString(
              story.characterName,
              asString(character.characterName, "未知角色"),
            ),
            sourceKey: nullableString(story.sourceKey),
            gameVersion: nullableString(story.gameVersion),
            locale: nullableString(story.locale),
            revision: optionalString(story.revision),
          };
        }),
      };
    }),
    totalStories: asCount(raw.totalStories),
    truncated: booleanValue(raw.truncated),
    nextOffset:
      raw.nextOffset === null
        ? null
        : typeof raw.nextOffset === "number" && Number.isFinite(raw.nextOffset)
          ? Math.max(0, Math.floor(raw.nextOffset))
          : undefined,
  };
}

export function mapTextItemListResponse(value: unknown): {
  gameId: string;
  revisionId?: string;
  query: string | null;
  items: CodexTextItem[];
  truncated: boolean;
} {
  const raw = asRecord(value);
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  return {
    gameId: asString(raw.gameId),
    revisionId: optionalString(raw.revisionId),
    query: nullableString(raw.query),
    items: rawItems.map((value, index) => {
      const item = asRecord(value);
      return {
        id: asString(item.id, `item-${index + 1}`),
        stableId: asString(item.stableId, asString(item.id, `item-${index + 1}`)),
        name: asString(item.name, "未命名物品"),
        category: asString(item.category, "other"),
        rarity:
          typeof item.rarity === "number" && Number.isFinite(item.rarity) ? item.rarity : null,
        description: nullableString(item.description) ?? nullableString(item.excerpt),
        sources: stringArray(item.sources),
        usedBy: stringArray(item.usedBy),
        gameVersion: nullableString(item.gameVersion),
        locale: nullableString(item.locale),
        revisionId: optionalString(item.revisionId),
        sourceKey: optionalString(item.sourceKey),
        provenance: asRecord(item.provenance),
      };
    }),
    truncated: booleanValue(raw.truncated),
  };
}

export function mapTextItemDetailResponse(value: unknown): CodexTextItem | null {
  const raw = asRecord(value);
  const item = asRecord(raw.item);
  if (!Object.keys(item).length) return null;
  return mapTextItemListResponse({ items: [item] }).items[0] ?? null;
}

export function mapVoiceListResponse(value: unknown): CodexVoiceCatalog {
  const raw = asRecord(value);
  const rawVoices = Array.isArray(raw.voices) ? raw.voices : [];
  return {
    gameId: asString(raw.gameId),
    revisionId: optionalString(raw.revisionId),
    locale: asString(raw.locale, "zh-CN"),
    corpusStatus: asString(raw.corpusStatus, "voice_source_missing"),
    note: nullableString(raw.note),
    count: asCount(raw.count),
    voices: rawVoices.map((value, index) => {
      const voice = asRecord(value);
      return {
        id: asString(voice.id, `voice-${index + 1}`),
        name: asString(voice.name, "未命名语音"),
        type: asString(voice.type, "voice"),
        locale: nullableString(voice.locale),
      };
    }),
  };
}

export function mapMechanicsResponse(value: unknown): CodexMechanicsResult {
  const raw = asRecord(value);
  const rawHits = Array.isArray(raw.hits) ? raw.hits : [];
  return {
    gameId: asString(raw.gameId),
    revisionId: optionalString(raw.revisionId),
    query: asString(raw.query),
    category: nullableString(raw.category),
    limit: asCount(raw.limit),
    corpusStatus: asString(raw.corpusStatus, "mechanism_source_missing"),
    note: nullableString(raw.note),
    hits: rawHits.map((value, index) => {
      const hit = asRecord(value);
      return {
        title: asString(hit.title, `机制条目 ${index + 1}`),
        excerpt: asString(hit.excerpt, asString(hit.body)),
        citation: asRecord(hit.citation),
      };
    }),
    truncated: booleanValue(raw.truncated),
  };
}

export function mapSectionReadResponse(value: unknown): CodexSectionRead {
  const raw = asRecord(value);
  const rawCitations = Array.isArray(raw.citations) ? raw.citations : [];
  return {
    documentId: asString(raw.documentId),
    title: asString(raw.title, "未命名文档"),
    locale: asString(raw.locale, "zh-CN"),
    revision: asString(raw.revision),
    headingPath: Array.isArray(raw.headingPath)
      ? raw.headingPath.filter((item): item is string => typeof item === "string")
      : [],
    body: asString(raw.body),
    truncated: booleanValue(raw.truncated),
    citations: rawCitations.map((value) => {
      const citation = asRecord(value);
      return {
        documentId: asString(citation.documentId, asString(raw.documentId)),
        segmentId: optionalString(citation.segmentId),
        locale: asString(citation.locale, asString(raw.locale, "zh-CN")),
        revision: asString(citation.revision, asString(raw.revision)),
      };
    }),
  };
}
