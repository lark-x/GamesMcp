import { describe, expect, it } from "vitest";
import { loadConfig } from "@gip/config";
import type { DocumentSummary, GameSummary } from "@gip/contracts";
import type {
  DocumentDetail,
  GenshinMaterial,
  KnowledgeRepository,
  TextBinding,
} from "@gip/domain";
import { createApp } from "./app.js";

const gameId = "00000000-0000-0000-0000-000000000001";
const revisionId = "00000000-0000-0000-0000-0000000000aa";
const documentId = "00000000-0000-0000-0000-0000000000bb";
const segmentId = "00000000-0000-0000-0000-0000000000cc";
const itemDocumentId = "00000000-0000-0000-0000-0000000000bc";

const game: GameSummary = {
  id: gameId,
  slug: "genshin-impact",
  name: "原神",
  status: "active",
  currentRevision: "r4",
};

const revision = {
  id: revisionId,
  gameId,
  revisionNumber: 4,
  sourceBatchId: "00000000-0000-0000-0000-0000000000dd",
  releaseNote: null,
  lifecycleStatus: "published" as const,
  indexStatus: "ready" as const,
  publishedAt: new Date("2026-08-30T00:00:00.000Z"),
  isCurrent: true,
  manifestId: "00000000-0000-0000-0000-0000000000ee",
};

const material: GenshinMaterial = {
  id: "00000000-0000-0000-0000-0000000000f1",
  gameId,
  revisionId,
  stableId: "material/nichang",
  sourceKey: "structured/material/nichang",
  name: "霓裳花",
  locale: "zh-CN",
  provenance: { source: "fixture" },
  category: "local_specialty",
  description: "璃月的鲜花。",
  sources: [],
  usedBy: [],
};

const binding: TextBinding = {
  id: "00000000-0000-0000-0000-0000000000f2",
  gameId,
  revisionId,
  entityType: "character",
  entityStableId: "char/hutao",
  documentId,
  segmentId,
  bindingType: "character_story",
  confidence: 1,
  bindingSource: "direct_upstream",
  metadata: { heading: "故事一" },
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
};

const bookSummary: DocumentSummary = {
  id: documentId,
  sourceKey: "book/7001",
  title: "卷一",
  type: "book",
  gameVersion: "7.0.0",
  locale: "zh-CN",
  revision: "r4",
};

const bookDocument: DocumentDetail = {
  ...bookSummary,
  body: "卷一正文",
  sourceName: "AnimeGameData",
  sourceId: "00000000-0000-0000-0000-0000000000d1",
  provenance: {
    bookStableId: "book/1",
    volumeStableId: "book/1/volume/9001",
    volumeId: 9001,
    sortOrder: 1,
    canonicalKey: "book/7001",
  },
  segments: [
    {
      id: segmentId,
      ordinal: 0,
      headingPath: ["书目一", "卷一"],
      body: "卷一正文",
      startOffset: 0,
      endOffset: 5,
      mentions: [],
    },
  ],
};

const itemSummary: DocumentSummary = {
  id: itemDocumentId,
  sourceKey: "item-codex/30001",
  title: "霓裳花",
  type: "item_description",
  gameVersion: "7.0.0",
  locale: "zh-CN",
  revision: "r4",
  snippet: "璃月的鲜花。",
};

const itemDocument: DocumentDetail = {
  ...itemSummary,
  body: "璃月的鲜花。\n\n常被用于角色培养。",
  sourceName: "AnimeGameData",
  sourceId: "00000000-0000-0000-0000-0000000000d1",
  provenance: {
    canonicalKey: "item-codex/30001",
    upstreamIds: { materialId: "nichang" },
  },
  segments: [],
};

const storySummaries: DocumentSummary[] = [
  {
    id: "00000000-0000-0000-0000-0000000000c1",
    sourceKey: "character/10001/story/101",
    title: "胡桃 · 故事一",
    type: "character_story",
    locale: "zh-CN",
    revision: "r4",
  },
  {
    id: "00000000-0000-0000-0000-0000000000c2",
    sourceKey: "character/10001/story/102",
    title: "胡桃 · 故事二",
    type: "character_story",
    locale: "zh-CN",
    revision: "r4",
  },
];

function makeRepository(overrides: Record<string, unknown> = {}) {
  const repository = {
    getGame: async (id: string) => (id === gameId ? game : null),
    getCapabilities: async () => [
      { capability: "entity_search" as const, enabled: true },
      { capability: "lore_search" as const, enabled: true },
    ],
    listRevisions: async () => [revision],
    getEntityTextBindings: async () => [binding],
    listDocuments: async (_gameId: string, options: { type?: string }) =>
      options.type === "item_description" ? [itemSummary] : [],
    getDocument: async (_gameId: string, id: string) =>
      id === itemDocumentId ? itemDocument : null,
    search: async (_gameId: string, request: { documentTypes?: string[] }) =>
      request.documentTypes?.includes("item_description")
        ? {
            entities: [],
            documents: [itemSummary],
            segments: [],
            revision: "r4",
            revisionId,
            indexStatus: "ready",
          }
        : {
            entities: [],
            documents: [],
            segments: [],
            revision: "",
            indexStatus: "not_ready",
          },
    genshin: {
      listMaterials: async () => [material],
      getMaterial: async (_revision: string, stableId: string) =>
        stableId === material.stableId || stableId === "material/nichang" ? material : null,
    },
    ...overrides,
  } as unknown as KnowledgeRepository;
  return repository;
}

function appWith(overrides: Record<string, unknown> = {}) {
  return createApp({
    repository: makeRepository(overrides),
    config: loadConfig({ NODE_ENV: "test" }),
  });
}

describe("Text API contracts", () => {
  it("returns entity bindings with document citations from the public revision", async () => {
    const app = appWith();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/entities/char%2Fhutao/texts?binding_type=character_story&limit=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gameId,
      entityId: "char/hutao",
      revisionId,
      bindings: [{ bindingType: "character_story", documentId, segmentId }],
    });
    await app.close();
  });

  it("validates entity text query parameters and reports unknown games", async () => {
    const app = appWith();
    const invalid = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/entities/char%2Fhutao/texts?limit=0`,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/games/00000000-0000-0000-0000-000000000099/text/entities/char%2Fhutao/texts",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("game_not_found");
    await app.close();
  });

  it("searches and shapes item text results with the requested type", async () => {
    const app = appWith({
      genshin: {
        listMaterials: async () => [material],
        getMaterial: async () => material,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items?query=霓裳&item_type=LOCAL_SPECIALTY&limit=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gameId,
      revisionId,
      query: "霓裳",
      items: [
        {
          id: itemDocumentId,
          stableId: itemDocumentId,
          materialStableId: "material/nichang",
          name: "霓裳花",
          category: "local_specialty",
          excerpt: "璃月的鲜花。",
        },
      ],
      truncated: false,
    });
    expect(response.json().estimatedBytes).toBeGreaterThan(0);
    await app.close();
  });

  it("allows the web item catalogue to browse without a query", async () => {
    const app = appWith();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items?limit=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      query: null,
      items: [{ id: itemDocumentId, name: material.name }],
    });
    await app.close();
  });

  it("validates item search parameters and reports unknown games", async () => {
    const app = appWith();
    const invalid = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items?query=霓裳&limit=51`,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/games/00000000-0000-0000-0000-000000000099/text/items?query=霓裳",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("game_not_found");
    await app.close();
  });

  it("returns one item text by stable id and returns 404 when it is absent", async () => {
    const app = appWith();
    const found = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items/material%2Fnichang`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items/material%2Fmissing`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      gameId,
      revisionId,
      item: { stableId: material.stableId },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("material_not_found");
    await app.close();
  });

  it("returns full item text by document id before falling back to material records", async () => {
    const app = appWith();
    const found = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/items/${itemDocumentId}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      gameId,
      revisionId,
      item: {
        stableId: itemDocumentId,
        materialStableId: material.stableId,
        description: "璃月的鲜花。\n\n常被用于角色培养。",
      },
    });
    await app.close();
  });

  it("validates item detail path parameters", async () => {
    const app = appWith();
    const invalid = await app.inject({
      method: "GET",
      url: "/api/games/not-a-uuid/text/items/material%2Fnichang",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("searches mechanism documents through the published text index", async () => {
    const app = appWith({
      search: async () => ({
        entities: [],
        documents: [
          {
            id: "00000000-0000-0000-0000-0000000000d1",
            sourceKey: "mechanism/Tutorial/1001",
            title: "超载",
            type: "mechanism",
            snippet: "超载反应会造成火元素范围伤害。",
            revision: "r4",
          },
        ],
        segments: [],
        revision: "r4",
        indexStatus: "ready",
      }),
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/mechanics?query=超载&category=elemental&limit=3`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gameId,
      revisionId,
      query: "超载",
      category: "elemental",
      limit: 3,
      hits: [{ sourceKey: "mechanism/Tutorial/1001", title: "超载" }],
      truncated: false,
      corpusStatus: "available",
    });
    await app.close();
  });

  it("groups book volumes and preserves stable volume metadata", async () => {
    const app = appWith({
      listDocuments: async () => [bookSummary],
      getDocument: async () => bookDocument,
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/books?locale=zh-CN&limit=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gameId,
      revisionId,
      books: [
        {
          bookStableId: "book/1",
          title: "书目一",
          volumes: [
            {
              stableId: "book/1/volume/9001",
              documentId,
              title: "卷一",
              volume: 9001,
              segmentCount: 1,
            },
          ],
        },
      ],
      totalVolumes: 1,
    });
    await app.close();
  });

  it("aggregates FetterStory documents by character", async () => {
    const app = appWith({ listDocuments: async () => storySummaries });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/character-stories?limit=10`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceDomain: "FetterStory",
      corpusStatus: "available",
      totalStories: 2,
      characters: [
        {
          characterStableId: "character/10001",
          characterName: "胡桃",
          stories: [
            { storyKey: "101", documentId: storySummaries[0]?.id, title: "故事一" },
            { storyKey: "102", documentId: storySummaries[1]?.id, title: "故事二" },
          ],
        },
      ],
    });
    await app.close();
  });

  it("reports missing voice source status without fabricating entries", async () => {
    const app = appWith({
      getArchiveHome: async () => ({
        gameId,
        revision: "r4",
        revisionId,
        locale: "zh-CN",
        categories: [
          {
            id: "voices",
            label: "角色语音",
            description: "角色语音文本",
            count: 0,
            entries: [],
          },
        ],
      }),
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/voices?locale=zh-CN`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      corpusStatus: "voice_source_missing",
      count: 0,
      voices: [],
    });
    await app.close();
  });

  it("exposes section reads with segment citations", async () => {
    const app = appWith({ getDocument: async () => bookDocument });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/documents/${documentId}/section?section=${encodeURIComponent("卷一")}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      documentId,
      title: "卷一",
      headingPath: ["书目一", "卷一"],
      body: "卷一正文",
      citations: [{ documentId, segmentId, revision: "r4" }],
    });
    await app.close();
  });

  it("validates mechanics queries and reports unknown games", async () => {
    const app = appWith();
    const invalid = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/text/mechanics?query=&limit=21`,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/games/00000000-0000-0000-0000-000000000099/text/mechanics?query=超载",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("game_not_found");
    await app.close();
  });
});
