import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DocumentSummary } from "@gip/contracts";
import { documentIdSchema, gameIdSchema, revisionIdSchema } from "@gip/contracts";
import type { GameDomainService, TextBindingType } from "@gip/domain";
import type { KnowledgeRepository } from "@gip/domain";
import { DEFAULT_MCP_RESPONSE_BUDGET, shapeForBudget } from "@gip/search";
import { parseQuery } from "./route-utils.js";

export type TextRoutesDependencies = {
  gameDomain: GameDomainService;
  repository: KnowledgeRepository;
};

const entityTextsParamsSchema = z.object({
  gameId: gameIdSchema,
  entityId: z.string().min(1).max(200),
});

const itemParamsSchema = z.object({
  gameId: gameIdSchema,
  stableId: z.string().min(1).max(200),
});

const entityTextsQuerySchema = z.object({
  binding_type: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const itemSearchQuerySchema = z.object({
  /** Optional for the web catalogue; MCP search keeps its required query contract. */
  query: z.string().trim().min(1).max(200).optional(),
  item_type: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  revisionId: revisionIdSchema.optional(),
});

const textDocumentListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  query: z.string().trim().max(200).optional(),
  locale: z.string().trim().min(1).max(40).default("zh-CN"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  revisionId: revisionIdSchema.optional(),
});

const sectionReadParamsSchema = z.object({
  gameId: gameIdSchema,
  documentId: documentIdSchema,
});

const sectionReadQuerySchema = z.object({
  section: z.string().trim().max(200).optional(),
  max_chars: z.coerce.number().int().min(100).max(8_000).default(8_000),
  revisionId: revisionIdSchema.optional(),
});

const voiceQuerySchema = z.object({
  locale: z.string().trim().min(1).max(40).default("zh-CN"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  revisionId: revisionIdSchema.optional(),
});

const mechanicsQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  revisionId: revisionIdSchema.optional(),
});

/** Fastify keeps %2F encoded in params; stable ids use slashes. */
function decodeStableId(value: string): string {
  return decodeURIComponent(value);
}

function budgetForLimit(limit: number) {
  return {
    ...DEFAULT_MCP_RESPONSE_BUDGET,
    maxItems: Math.min(limit, DEFAULT_MCP_RESPONSE_BUDGET.maxItems),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOrStringValue(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return stringValue(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type BookVolume = {
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

type BookGroup = {
  stableId: string;
  bookStableId: string;
  title: string;
  volumes: BookVolume[];
};

function sourceParts(summary: DocumentSummary): { characterId?: string; storyKey?: string } {
  const match = /^character\/([^/]+)\/story\/(.+)$/.exec(summary.sourceKey ?? "");
  return match ? { characterId: match[1], storyKey: match[2] } : {};
}

function characterStoryFromSummary(summary: DocumentSummary, index: number) {
  const parts = sourceParts(summary);
  const titleParts = summary.title.split(" · ");
  const characterName = titleParts[0]?.trim() || "未知角色";
  const storyTitle = titleParts.length > 1 ? titleParts.slice(1).join(" · ").trim() : summary.title;
  const characterStableId = parts.characterId
    ? `character/${parts.characterId}`
    : `character/${characterName}`;
  return {
    stableId: summary.sourceKey ?? summary.id,
    storyStableId: summary.sourceKey ?? summary.id,
    storyKey: parts.storyKey ?? String(index + 1),
    documentId: summary.id,
    title: storyTitle || summary.title,
    displayTitle: summary.title,
    characterStableId,
    characterName,
    sourceKey: summary.sourceKey ?? null,
    gameVersion: summary.gameVersion ?? null,
    locale: summary.locale ?? null,
    revision: summary.revision,
  };
}

/**
 * Public read-only text routes for the Game Codex API. Every route resolves
 * the public revision before reading, so preview, retired, stale and
 * unindexed revisions cannot leak through this boundary.
 */
export function registerTextRoutes(
  app: FastifyInstance,
  { gameDomain, repository }: TextRoutesDependencies,
): void {
  app.get("/api/games/:gameId/text/entities/:entityId/texts", async (request) => {
    const params = entityTextsParamsSchema.parse(request.params);
    const query = entityTextsQuerySchema.parse(parseQuery(request));
    const revisionId = await gameDomain.requirePublicRevision(params.gameId);
    const entityId = decodeStableId(params.entityId);
    const bindings = await gameDomain.getEntityTexts(
      params.gameId,
      entityId,
      query.binding_type as TextBindingType | undefined,
      revisionId,
    );
    const shaped = shapeForBudget(
      bindings.map((binding) => ({
        ...binding,
        title: binding.bindingType,
        excerpt: JSON.stringify(binding.metadata),
      })),
      budgetForLimit(query.limit),
    );
    return {
      gameId: params.gameId,
      entityId,
      revisionId,
      bindings: shaped.items,
      truncated: shaped.truncated,
      estimatedBytes: shaped.estimatedBytes,
    };
  });

  app.get("/api/games/:gameId/text/items", async (request) => {
    const params = z.object({ gameId: gameIdSchema }).parse(request.params);
    const query = itemSearchQuerySchema.parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    const materials = await gameDomain.listMaterials(params.gameId, revisionId, {
      query: query.query,
      limit: query.limit,
    });
    const filtered = query.item_type
      ? materials.filter(
          (material) => material.category.toLowerCase() === query.item_type?.toLowerCase(),
        )
      : materials;
    const shaped = shapeForBudget(
      filtered.map((material) => ({
        id: material.stableId,
        name: material.name,
        category: material.category,
        title: material.name,
        excerpt: material.description ?? undefined,
      })),
      budgetForLimit(query.limit),
    );
    return {
      gameId: params.gameId,
      revisionId,
      query: query.query ?? null,
      items: shaped.items,
      truncated: shaped.truncated,
      estimatedBytes: shaped.estimatedBytes,
    };
  });

  app.get("/api/games/:gameId/text/books", async (request) => {
    const params = z.object({ gameId: gameIdSchema }).parse(request.params);
    const query = textDocumentListQuerySchema.parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    const summaries = await gameDomain.listDocuments(params.gameId, {
      query: query.q ?? query.query,
      type: "book",
      locale: query.locale,
      limit: query.limit,
      offset: query.offset,
      revisionId,
    });
    const volumes = await Promise.all(
      summaries.map(async (summary, index): Promise<BookVolume & { bookTitle: string }> => {
        let detail: Awaited<ReturnType<GameDomainService["getDocument"]>> | null = null;
        try {
          detail = await gameDomain.getDocument(params.gameId, summary.id, revisionId);
        } catch {
          // A summary remains useful for a catalogue if an optional detail read fails.
        }
        const provenance = (detail?.provenance ?? {}) as Record<string, unknown>;
        const bookSuitId = numberOrStringValue(provenance.bookSuitId);
        const bookStableId =
          stringValue(provenance.bookStableId) ??
          (bookSuitId === undefined ? undefined : String(bookSuitId)) ??
          summary.sourceKey ??
          summary.id;
        const volumeStableId =
          stringValue(provenance.volumeStableId) ?? summary.sourceKey ?? summary.id;
        const volume =
          numberOrStringValue(provenance.volumeId) ??
          numberOrStringValue(provenance.sortOrder) ??
          null;
        const numericOrder =
          numberValue(provenance.sortOrder) ??
          (typeof volume === "number" ? volume : undefined) ??
          index;
        const bookTitle = detail?.segments[0]?.headingPath[0] ?? summary.title;
        return {
          stableId: volumeStableId,
          bookStableId,
          documentId: summary.id,
          title: summary.title,
          volume,
          order: numericOrder,
          segmentCount: detail?.segments.length ?? 0,
          sourceKey: summary.sourceKey,
          gameVersion: summary.gameVersion,
          locale: summary.locale,
          revision: summary.revision,
          bookTitle,
        };
      }),
    );
    const groups = new Map<string, BookGroup>();
    for (const volume of volumes) {
      const current = groups.get(volume.bookStableId) ?? {
        stableId: volume.bookStableId,
        bookStableId: volume.bookStableId,
        title: volume.bookTitle,
        volumes: [],
      };
      if (current.title === current.bookStableId && volume.bookTitle)
        current.title = volume.bookTitle;
      current.volumes.push(volume);
      groups.set(volume.bookStableId, current);
    }
    for (const group of groups.values())
      group.volumes.sort(
        (left, right) => left.order - right.order || left.title.localeCompare(right.title),
      );
    return {
      gameId: params.gameId,
      revisionId,
      locale: query.locale,
      books: [...groups.values()],
      totalVolumes: volumes.length,
      truncated: summaries.length === query.limit,
      nextOffset: summaries.length === query.limit ? query.offset + summaries.length : null,
    };
  });

  app.get("/api/games/:gameId/text/character-stories", async (request) => {
    const params = z.object({ gameId: gameIdSchema }).parse(request.params);
    const query = textDocumentListQuerySchema.parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    const summaries = await gameDomain.listDocuments(params.gameId, {
      query: query.q ?? query.query,
      type: "character_story",
      locale: query.locale,
      limit: query.limit,
      offset: query.offset,
      revisionId,
    });
    const groups = new Map<
      string,
      {
        characterStableId: string;
        characterName: string;
        stories: ReturnType<typeof characterStoryFromSummary>[];
      }
    >();
    summaries.forEach((summary, index) => {
      const story = characterStoryFromSummary(summary, index);
      const current = groups.get(story.characterStableId) ?? {
        characterStableId: story.characterStableId,
        characterName: story.characterName,
        stories: [],
      };
      current.stories.push(story);
      groups.set(story.characterStableId, current);
    });
    for (const group of groups.values())
      group.stories.sort((left, right) => left.storyKey.localeCompare(right.storyKey, "zh-CN"));
    return {
      gameId: params.gameId,
      revisionId,
      locale: query.locale,
      sourceDomain: "FetterStory",
      corpusStatus: summaries.length ? "available" : "character_story_source_empty",
      characters: [...groups.values()],
      totalStories: summaries.length,
      truncated: summaries.length === query.limit,
      nextOffset: summaries.length === query.limit ? query.offset + summaries.length : null,
    };
  });

  app.get("/api/games/:gameId/text/voices", async (request) => {
    const params = z.object({ gameId: gameIdSchema }).parse(request.params);
    const query = voiceQuerySchema.parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    const home = repository.getArchiveHome
      ? await repository.getArchiveHome(params.gameId, {
          locale: query.locale,
          revisionId,
          limit: query.limit,
        })
      : null;
    const category = home?.categories.find((item) => item.id === "voices");
    const count = category?.count ?? 0;
    return {
      gameId: params.gameId,
      revisionId,
      locale: query.locale,
      corpusStatus: count > 0 ? "available" : "voice_source_missing",
      note:
        count > 0 ? null : "当前固定上游快照没有 AvatarVoice 正文源；此页不会展示占位或假数据。",
      count,
      voices: category?.entries ?? [],
    };
  });

  app.get("/api/games/:gameId/text/documents/:documentId/section", async (request) => {
    const params = sectionReadParamsSchema.parse(request.params);
    const query = sectionReadQuerySchema.parse(parseQuery(request));
    return gameDomain.readSection({
      gameId: params.gameId,
      documentId: params.documentId,
      revisionId: query.revisionId,
      section: query.section,
      maxChars: query.max_chars,
    });
  });

  app.get("/api/games/:gameId/text/items/:stableId", async (request) => {
    const params = itemParamsSchema.parse(request.params);
    const query = z.object({ revisionId: revisionIdSchema.optional() }).parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    const item = await gameDomain.getMaterial(
      params.gameId,
      decodeStableId(params.stableId),
      revisionId,
    );
    return { gameId: params.gameId, revisionId, item };
  });

  app.get("/api/games/:gameId/text/mechanics", async (request) => {
    const params = z.object({ gameId: gameIdSchema }).parse(request.params);
    const query = mechanicsQuerySchema.parse(parseQuery(request));
    const revisionId = query.revisionId ?? (await gameDomain.requirePublicRevision(params.gameId));
    return {
      gameId: params.gameId,
      revisionId,
      query: query.query,
      category: query.category ?? null,
      limit: query.limit,
      hits: [],
      truncated: false,
      corpusStatus: "mechanism_source_missing",
      note: "The pinned upstream snapshot (26df1df) contains no tutorial/mechanism body tables; no records are fabricated.",
    };
  });
}
