import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import type { KnowledgeRepository } from "@gip/domain";
import {
  GameProviderError,
  GameProviderRegistry,
  type GameKnowledgeProvider,
} from "@gip/providers";

const gameId = "00000000-0000-0000-0000-000000000001";
const entityId = "00000000-0000-0000-0000-000000000002";
const itemDocumentId = "00000000-0000-0000-0000-000000000041";

const itemTextDocument = {
  id: itemDocumentId,
  sourceKey: "item-codex/30001",
  title: "霓裳花",
  type: "item_description" as const,
  snippet: "璃月的鲜花。",
  body: "璃月的鲜花。\n\n常被用于角色培养。",
  gameVersion: "7.0.0",
  locale: "zh-CN",
  revision: "r1",
  sourceName: "AnimeGameData",
  sourceId: "00000000-0000-0000-0000-000000000011",
  provenance: { canonicalKey: "item-codex/30001", upstreamIds: { materialId: "nichang" } },
  segments: [],
};

const repository = {
  listGames: async () => [
    { id: gameId, slug: "genshin-impact", name: "原神", status: "active", currentRevision: "r1" },
  ],
  getGame: async (id: string) =>
    id === gameId
      ? {
          id: gameId,
          slug: "genshin-impact",
          name: "原神",
          status: "active",
          currentRevision: "r1",
        }
      : null,
  getCapabilities: async () => [
    { capability: "entity_search" as const, enabled: true },
    { capability: "lore_search" as const, enabled: true },
    { capability: "relationships" as const, enabled: true },
    { capability: "evidence_qa" as const, enabled: true },
  ],
  search: async (_gameId: string, request?: { documentTypes?: string[] }) =>
    request?.documentTypes?.includes("mechanism")
      ? {
          entities: [],
          documents: [
            {
              id: "00000000-0000-0000-0000-000000000040",
              sourceKey: "mechanism/Tutorial/1001",
              title: "超载",
              type: "mechanism" as const,
              snippet: "超载反应会造成火元素范围伤害。",
              revision: "r1",
            },
          ],
          segments: [],
          revision: "r1",
          indexStatus: "ready",
        }
      : request?.documentTypes?.includes("item_description")
        ? {
            entities: [],
            documents: [itemTextDocument],
            segments: [],
            revision: "r1",
            revisionId: "00000000-0000-0000-0000-000000000010",
            indexStatus: "ready",
          }
        : {
            entities: [],
            documents: [],
            segments: [],
            revision: "",
            indexStatus: "not_ready",
          },
  getEntity: async () => null,
  // resolve_entity reads candidates through this port; an empty candidate set is
  // the production path for an unknown name and yields entity_not_found.
  resolveEntityCandidates: async () => [],
  getDocument: async (_gameId: string, documentId: string) =>
    documentId === itemDocumentId ? itemTextDocument : null,
  getRelationships: async () => [],
  searchQuests: async () => [
    {
      questKey: "quest/1001",
      mainQuestId: "1001",
      title: "捕风的异乡人",
      type: "archon_quest" as const,
      chapter: "序章",
      series: "Prologue",
      completeness: "complete" as const,
      locale: "zh-CN",
      documentId: "00000000-0000-0000-0000-000000000020",
      revision: "r1",
      match: "text",
      excerpt: "要寻找岩神的话，一年里只有这一次机会。",
    },
  ],
  searchDialogue: async () => [
    {
      quest: "捕风的异乡人",
      subquest: "quest/1001/subquest/100101",
      speaker: "派蒙",
      text: "旅行者，我们出发吧。",
      dialogueNodeKey: "quest/1001/dialog/1",
      citation: {
        documentId: "00000000-0000-0000-0000-000000000020",
        locale: "zh-CN",
        questKey: "quest/1001",
        subquestKey: "quest/1001/subquest/100101",
        dialogueNodeKey: "quest/1001/dialog/1",
        revision: "00000000-0000-0000-0000-000000000010",
      },
      score: 10,
    },
  ],
  getQuest: async () => ({
    questKey: "quest/1001",
    title: "捕风的异乡人",
    type: "archon_quest" as const,
    locale: "zh-CN",
    gameVersion: "7.0.0",
    documentId: "00000000-0000-0000-0000-000000000020",
    revision: "r1",
    completeness: "complete" as const,
    subquests: [
      {
        subquestKey: "quest/1001/subquest/100101",
        subquestId: "100101",
        title: "与派蒙同行",
        order: 0,
        completeness: "complete" as const,
      },
    ],
    dialogueNodes: [
      {
        nodeKey: "quest/1001/dialog/1",
        nodeId: "1",
        type: "dialogue" as const,
        subquestKey: "quest/1001/subquest/100101",
        speakerKey: "npc/2001",
        speakerName: "派蒙",
        body: "旅行者，我们出发吧。",
        order: 0,
      },
    ],
    dialogueEdges: [],
    participants: [],
    prerequisites: [],
    citations: [
      {
        documentId: "00000000-0000-0000-0000-000000000020",
        locale: "zh-CN",
        questKey: "quest/1001",
        subquestKey: "quest/1001/subquest/100101",
        dialogueNodeKey: "quest/1001/dialog/1",
        revision: "r1",
      },
    ],
    warnings: [],
    nextCursor: null,
  }),
  listRevisions: async () => [
    {
      id: "00000000-0000-0000-0000-000000000010",
      gameId,
      revisionNumber: 1,
      sourceBatchId: "00000000-0000-0000-0000-000000000011",
      lifecycleStatus: "published" as const,
      publishedAt: new Date("2026-08-29T00:00:00Z"),
      isCurrent: true,
      indexStatus: "ready" as const,
      manifestId: "00000000-0000-0000-0000-000000000099",
    },
  ],
} as unknown as KnowledgeRepository;

function resultJson(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const object = result as { content?: unknown[]; contents?: unknown[] };
  const blocks = object.content ?? object.contents ?? [];
  const text = blocks.find(
    (item): item is { text: string } =>
      item !== null &&
      typeof item === "object" &&
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string",
  )?.text;
  return text ? JSON.parse(text) : undefined;
}

describe("MCP server", () => {
  it("creates the server without opening a transport", () => {
    expect(createMcpServer(repository)).toBeDefined();
  });

  it("exposes the provider-gateway tool and four-resource public contract", async () => {
    const server = createMcpServer(repository);
    const client = new Client(
      { name: "contract-test-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "get_character",
      "get_document",
      "get_enemy",
      "get_entity_texts",
      "get_equipment",
      "get_game_capabilities",
      "get_game_document",
      "get_game_document_hierarchy",
      "get_game_provider_status",
      "get_material",
      "get_quest",
      "get_relationships",
      "list_games",
      "resolve_entity",
      "search",
      "search_game_knowledge",
    ]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      "document://{game_id}/{document_id}",
      "entity://{game_id}/{entity_id}",
      "game://{game_id}",
      "revision://{game_id}/current",
    ]);

    const games = await client.callTool({ name: "list_games", arguments: {} });
    expect((resultJson(games) as { games?: Array<{ slug?: string }> })?.games?.[0]?.slug).toBe(
      "genshin-impact",
    );
    const notReady = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "旅行者", type: "structured", limit: 5 },
    });
    expect(notReady.isError).toBe(true);
    expect((resultJson(notReady) as { error?: { code?: string } })?.error?.code).toBe(
      "index_not_ready",
    );
    const missingEntity = await client.callTool({
      name: "resolve_entity",
      arguments: { game_id: gameId, query: "不存在的实体" },
    });
    expect(missingEntity.isError).toBe(true);
    expect((resultJson(missingEntity) as { error?: { code?: string } })?.error?.code).toBe(
      "entity_not_found",
    );
    const questSearch = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "捕风", type: "quest", locale: "zh-CN", limit: 5 },
    });
    const questBody = resultJson(questSearch) as {
      hits?: Array<{ type?: string; questKey?: string }>;
    };
    expect(questBody.hits?.[0]?.type).toBe("quest");
    expect(questBody.hits?.[0]?.questKey).toBe("quest/1001");
    const dialogueSearch = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "派蒙", type: "dialogue", limit: 5 },
    });
    const dialogueBody = resultJson(dialogueSearch) as {
      hits?: Array<{ type?: string; speaker?: string; excerpt?: string; dialogueNodeKey?: string }>;
    };
    expect(dialogueBody.hits?.[0]?.type).toBe("dialogue");
    expect(dialogueBody.hits?.[0]?.speaker).toBe("派蒙");
    expect(dialogueBody.hits?.[0]?.excerpt).toContain("旅行者");
    expect(dialogueBody.hits?.[0]?.dialogueNodeKey).toBe("quest/1001/dialog/1");
    const questRead = await client.callTool({
      name: "get_quest",
      arguments: { game_id: gameId, quest_id: "1001", locale: "zh-CN", node_limit: 1 },
    });
    expect(
      (resultJson(questRead) as { quest?: { citations?: Array<{ dialogueNodeKey?: string }> } })
        .quest?.citations?.[0]?.dialogueNodeKey,
    ).toBe("quest/1001/dialog/1");
    const missingResource = await client.readResource({
      uri: `entity://${gameId}/${entityId}`,
    });
    expect((resultJson(missingResource) as { error?: { code?: string } })?.error?.code).toBe(
      "entity_not_found",
    );

    await client.close();
    await server.close();
  });

  it("truncates large document tool responses at the caller's limit", async () => {
    const longBody = "证据".repeat(5_000);
    const longDocumentRepository = {
      ...repository,
      getDocument: async () =>
        ({
          id: "00000000-0000-0000-0000-000000000020",
          sourceKey: "lore/long",
          title: "长文档",
          type: "lore" as const,
          gameVersion: "fixture",
          sourceVersion: "snapshot-hash",
          revision: "r1",
          body: longBody,
          sourceName: "Fixture",
          sourceId: "00000000-0000-0000-0000-000000000021",
          segments: [
            {
              id: "00000000-0000-0000-0000-000000000022",
              ordinal: 0,
              headingPath: [],
              body: longBody,
              startOffset: 0,
              endOffset: longBody.length,
              mentions: [],
            },
          ],
        }) as never,
    } as unknown as KnowledgeRepository;
    const server = createMcpServer(longDocumentRepository);
    const client = new Client(
      { name: "document-limit-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "get_document",
      arguments: {
        game_id: gameId,
        document_id: "00000000-0000-0000-0000-000000000020",
        max_chars: 100,
      },
    });
    const output = resultJson(response) as {
      document?: { body?: string; truncated?: boolean; segments?: Array<{ body?: string }> };
    };
    expect(output.document?.body).toHaveLength(100);
    expect(output.document?.segments?.[0]?.body).toHaveLength(100);
    expect(output.document?.truncated).toBe(true);
    const invalidSegment = await client.callTool({
      name: "get_document",
      arguments: {
        game_id: gameId,
        document_id: "00000000-0000-0000-0000-000000000020",
        segment_id: "00000000-0000-0000-0000-000000000023",
        max_chars: 100,
      },
    });
    expect(invalidSegment.isError).toBe(true);
    expect((resultJson(invalidSegment) as { error?: { code?: string } })?.error?.code).toBe(
      "segment_not_found",
    );
    const resource = await client.readResource({
      uri: `document://${gameId}/00000000-0000-0000-0000-000000000020`,
    });
    const resourceOutput = resultJson(resource) as { body?: string; truncated?: boolean };
    expect(resourceOutput.body).toHaveLength(8_000);
    expect(resourceOutput.truncated).toBe(true);
    await client.close();
    await server.close();
  });

  it("resolves the default game when game_id is omitted (Sprint 19)", async () => {
    const server = createMcpServer(repository);
    const client = new Client(
      { name: "default-game-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const capabilities = await client.callTool({
      name: "get_game_capabilities",
      arguments: {},
    });
    expect(capabilities.isError).toBeFalsy();
    expect((resultJson(capabilities) as { game_id?: string })?.game_id).toBe(gameId);

    const ambiguousRepository = {
      ...repository,
      listGames: async () => [
        {
          id: gameId,
          slug: "genshin-impact",
          name: "原神",
          status: "active",
          currentRevision: "r1",
        },
        {
          id: entityId,
          slug: "second-game",
          name: "第二游戏",
          status: "active",
          currentRevision: "r1",
        },
      ],
    };
    const ambiguousServer = createMcpServer(ambiguousRepository as unknown as KnowledgeRepository);
    const ambiguousClient = new Client(
      { name: "ambiguous-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [ambCT, ambST] = InMemoryTransport.createLinkedPair();
    await ambiguousServer.connect(ambST);
    await ambiguousClient.connect(ambCT);
    const ambiguous = await ambiguousClient.callTool({
      name: "get_game_capabilities",
      arguments: {},
    });
    expect(ambiguous.isError).toBe(true);
    expect((resultJson(ambiguous) as { error?: { code?: string } })?.error?.code).toBe(
      "game_id_required",
    );

    await ambiguousClient.close();
    await ambiguousServer.close();
    await client.close();
    await server.close();
  });

  it("shapes unified search results under the response budget (Sprint 20)", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `doc-${index}`,
      title: `文档${index}`,
      type: "book" as const,
      snippet: "很长的摘要".repeat(100),
    }));
    const shapingRepository = {
      ...repository,
      search: async () => ({
        entities: [],
        documents: many,
        segments: [],
        revision: "r1",
        indexStatus: "ready",
      }),
    };
    const server = createMcpServer(shapingRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "budget-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    const result = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "测试", type: "document" },
    });
    expect(result.isError).toBeFalsy();
    const body = resultJson(result) as {
      hits?: Array<Record<string, unknown>>;
      truncated?: boolean;
      estimatedBytes?: number;
    };
    expect(body.hits?.length).toBeLessThanOrEqual(10);
    expect(body.truncated).toBe(true);
    for (const hit of body.hits ?? []) {
      expect(String(hit.excerpt).length).toBeLessThanOrEqual(501);
    }
    await client.close();
    await server.close();
  });

  it("merges every surface into one tagged result list and honours the type filter", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const mergeRepository = {
      ...repository,
      search: async (_gameId: string, request?: { documentTypes?: string[] }) => {
        seen.push({ surface: "search", documentTypes: request?.documentTypes });
        return {
          entities: [],
          documents: [],
          segments: [],
          revision: "r1",
          indexStatus: "ready",
        };
      },
    };
    const server = createMcpServer(mergeRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "merge-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    // Default type=all fans out across dialogue, quests and documents and tags
    // every hit so the model knows which detail tool to drill into next.
    const all = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "旅行者" },
    });
    expect(all.isError).toBeFalsy();
    const allBody = resultJson(all) as {
      type?: string;
      hits?: Array<{ type?: string; title?: string; excerpt?: string }>;
    };
    expect(allBody.type).toBe("all");
    const types = new Set((allBody.hits ?? []).map((hit) => hit.type));
    expect(types.has("dialogue")).toBe(true);
    expect(types.has("quest")).toBe(true);
    for (const hit of allBody.hits ?? []) {
      expect(typeof hit.type).toBe("string");
      expect(typeof hit.title).toBe("string");
    }

    // The quest hit now carries a real body excerpt instead of the literal
    // match-class token ("text") that the old search_quests returned.
    const questHit = (allBody.hits ?? []).find((hit) => hit.type === "quest");
    expect(questHit?.excerpt).toBeDefined();
    expect(questHit?.excerpt).not.toBe("text");

    // type=dialogue must not consult the document/quest surfaces at all.
    seen.length = 0;
    const dialogueOnly = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "旅行者", type: "dialogue" },
    });
    const dialogueBody = resultJson(dialogueOnly) as {
      hits?: Array<{ type?: string }>;
    };
    expect(dialogueOnly.isError).toBeFalsy();
    expect(dialogueBody.hits?.every((hit) => hit.type === "dialogue")).toBe(true);
    expect(seen).toEqual([]);

    await client.close();
    await server.close();
  });

  it("serves structured character and material tools over the shared domain service", async () => {
    const character = {
      id: "00000000-0000-0000-0000-0000000000b1",
      gameId,
      revisionId: "00000000-0000-0000-0000-000000000010",
      stableId: "char/hutao",
      sourceKey: "structured/char/hutao",
      name: "胡桃",
      locale: "zh-CN",
      provenance: {},
      profile: {},
      rarity: 5,
      element: "pyro",
      weaponType: "polearm",
    };
    const weapon = {
      id: "00000000-0000-0000-0000-0000000000d1",
      gameId,
      revisionId: "00000000-0000-0000-0000-000000000010",
      stableId: "weapon/dull-blade",
      sourceKey: "structured/weapon/dull-blade",
      name: "无锋剑",
      locale: "zh-CN",
      provenance: {},
      weaponType: "sword",
      rarity: 1,
      ascensionMaterials: [],
    };
    const enemy = {
      id: "00000000-0000-0000-0000-0000000000e1",
      gameId,
      revisionId: "00000000-0000-0000-0000-000000000010",
      stableId: "enemy/slime",
      sourceKey: "structured/enemy/slime",
      name: "史莱姆",
      locale: "zh-CN",
      provenance: {},
      category: "common",
      drops: [],
      resistances: {},
    };
    const structuredRepository = {
      ...repository,
      genshin: {
        listCharacters: async () => [character],
        listWeapons: async () => [weapon],
        listArtifacts: async () => [],
        listArtifactSets: async () => [],
        listMaterials: async () => [
          {
            id: "00000000-0000-0000-0000-0000000000c1",
            gameId,
            revisionId: "00000000-0000-0000-0000-000000000010",
            stableId: "material/nichang",
            sourceKey: "structured/material/nichang",
            name: "霓裳花",
            locale: "zh-CN",
            provenance: {},
            category: "local_specialty",
            sources: [],
            usedBy: [],
          },
        ],
        listAchievements: async () => [],
        listEnemies: async () => [enemy],
        getCharacter: async () => character,
        getWeapon: async () => weapon,
        getArtifact: async () => null,
        getArtifactSet: async () => null,
        getMaterial: async () => ({
          id: "00000000-0000-0000-0000-0000000000c1",
          gameId,
          revisionId: "00000000-0000-0000-0000-000000000010",
          stableId: "material/nichang",
          sourceKey: "structured/material/nichang",
          name: "霓裳花",
          locale: "zh-CN",
          provenance: {},
          category: "local_specialty",
          sources: [],
          usedBy: [],
        }),
        getAchievement: async () => null,
        getEnemy: async () => enemy,
        findCharacterByNormalizedName: async (_rev: string, normalizedName: string) =>
          normalizedName === "胡桃" ? character : null,
        findWeaponByNormalizedName: async (_rev: string, normalizedName: string) =>
          normalizedName === "无锋剑" ? weapon : null,
        findMaterialByNormalizedName: async (_rev: string, normalizedName: string) =>
          normalizedName === "霓裳花"
            ? {
                id: "00000000-0000-0000-0000-0000000000c1",
                gameId,
                revisionId: "00000000-0000-0000-0000-000000000010",
                stableId: "material/nichang",
                sourceKey: "structured/material/nichang",
                name: "霓裳花",
                locale: "zh-CN",
                provenance: {},
                category: "local_specialty",
                sources: [],
                usedBy: [],
              }
            : null,
        findArtifactByNormalizedName: async () => null,
        findArtifactSetByNormalizedName: async () => null,
        findAchievementByNormalizedName: async () => null,
        findEnemyByNormalizedName: async (_rev: string, normalizedName: string) =>
          normalizedName === "史莱姆" ? enemy : null,
      },
    } as unknown as KnowledgeRepository;
    const server = createMcpServer(structuredRepository);
    const client = new Client(
      { name: "structured-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    const hutao = await client.callTool({
      name: "get_character",
      arguments: { game_id: gameId, name: "胡桃" },
    });
    const hutaoBody = resultJson(hutao) as { character?: { name?: string; rarity?: number } };
    expect(hutaoBody.character?.name).toBe("胡桃");
    expect(hutaoBody.character?.rarity).toBe(5);

    const material = await client.callTool({
      name: "get_material",
      arguments: { game_id: gameId, name: "霓裳花" },
    });
    const materialBody = resultJson(material) as { material?: { name?: string } };
    expect(materialBody.material?.name).toBe("霓裳花");

    const weaponResult = await client.callTool({
      name: "get_equipment",
      arguments: { game_id: gameId, name: "无锋剑" },
    });
    const weaponBody = resultJson(weaponResult) as { equipment?: { weaponType?: string } };
    expect(weaponBody.equipment?.weaponType).toBe("sword");

    const enemyResult = await client.callTool({
      name: "get_enemy",
      arguments: { game_id: gameId, name: "史莱姆" },
    });
    const enemyBody = resultJson(enemyResult) as {
      enemy?: { stableId?: string; drops?: string[] };
    };
    expect(enemyBody.enemy?.stableId).toBe("enemy/slime");
    expect(enemyBody.enemy?.drops).toEqual([]);

    const missing = await client.callTool({
      name: "get_character",
      arguments: { game_id: gameId, name: "不存在的角色" },
    });
    expect(missing.isError).toBe(true);
    expect((resultJson(missing) as { error?: { code?: string } })?.error?.code).toBe(
      "character_not_found",
    );

    await client.close();
    await server.close();
  });

  it("serves item text tools and entity text bindings with budget shaping", async () => {
    const material = {
      id: "00000000-0000-0000-0000-0000000000c1",
      gameId,
      revisionId: "00000000-0000-0000-0000-000000000010",
      stableId: "material/nichang",
      sourceKey: "structured/material/nichang",
      name: "霓裳花",
      locale: "zh-CN",
      provenance: {},
      category: "local_specialty",
      sources: [],
      usedBy: [],
    };
    const bindingsRepository = {
      ...repository,
      getEntityTextBindings: async () => [
        {
          id: "00000000-0000-0000-0000-0000000000d1",
          gameId,
          revisionId: "00000000-0000-0000-0000-000000000010",
          entityType: "material",
          entityStableId: "material/nichang",
          documentId: "00000000-0000-0000-0000-000000000020",
          segmentId: null,
          bindingType: "item_description",
          confidence: null,
          bindingSource: "direct_upstream",
          metadata: { note: "材料描述绑定" },
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
      ],
      genshin: {
        listMaterials: async (_revisionId: string, options?: { query?: string }) =>
          !options?.query || options.query.includes("霓裳") ? [material] : [],
        getMaterial: async () => material,
      },
    };
    const server = createMcpServer(bindingsRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "bindings-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    const texts = await client.callTool({
      name: "get_entity_texts",
      arguments: { entity_id: "material/nichang" },
    });
    const textsBody = resultJson(texts) as {
      bindings?: Array<{ bindingType?: string; documentId?: string }>;
    };
    expect(texts.isError).toBeFalsy();
    expect(textsBody.bindings?.[0]?.bindingType).toBe("item_description");
    expect(textsBody.bindings?.[0]?.documentId).toBe("00000000-0000-0000-0000-000000000020");

    const searchItems = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "霓裳", type: "item" },
    });
    const itemsBody = resultJson(searchItems) as {
      hits?: Array<{ type?: string; title?: string; documentId?: string }>;
      truncated?: boolean;
    };
    expect(searchItems.isError).toBeFalsy();
    expect(itemsBody.hits?.[0]?.type).toBe("item");
    expect(itemsBody.hits?.[0]?.title).toBe("霓裳花");
    expect(itemsBody.hits?.[0]?.documentId).toBe(itemDocumentId);

    const itemText = await client.callTool({
      name: "get_document",
      arguments: { game_id: gameId, document_id: itemDocumentId },
    });
    const itemBody = resultJson(itemText) as { document?: { id?: string; body?: string } };
    expect(itemBody.document?.id).toBe(itemDocumentId);
    expect(itemBody.document?.body).toContain("常被用于角色培养");

    // A non-document id is no longer readable through get_document: the unified
    // search returns document ids, and structured material facts come from get_material.
    const legacyItemText = await client.callTool({
      name: "get_document",
      arguments: { game_id: gameId, document_id: "material/nichang" },
    });
    expect(legacyItemText.isError).toBe(true);

    const mechanics = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "超载", type: "mechanism" },
    });
    const mechanicsBody = resultJson(mechanics) as {
      hits?: Array<{ type?: string; title?: string }>;
    };
    expect(mechanics.isError).toBeFalsy();
    expect(mechanicsBody.hits?.[0]?.type).toBe("mechanism");
    expect(mechanicsBody.hits?.[0]?.title).toBe("超载");

    await client.close();
    await server.close();
  });

  it("never exposes a preview revision through the current MCP resource", async () => {
    const previewOnlyRepository = {
      ...repository,
      listRevisions: async () => [
        {
          id: "00000000-0000-0000-0000-000000000030",
          gameId,
          revisionNumber: 2,
          sourceBatchId: "00000000-0000-0000-0000-000000000031",
          releaseNote: "preview",
          lifecycleStatus: "preview" as const,
          publishedAt: new Date("2026-08-30T00:00:00Z"),
          isCurrent: true,
          indexStatus: "ready" as const,
        },
      ],
    } as unknown as KnowledgeRepository;
    const server = createMcpServer(previewOnlyRepository);
    const client = new Client(
      { name: "revision-isolation-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const resource = await client.readResource({ uri: `revision://${gameId}/current` });
    expect(resultJson(resource)).toBeNull();

    await client.close();
    await server.close();
  });

  it.each([
    ["preparing", "ready", true],
    ["failed", "ready", true],
    ["published", "pending", true],
    ["published", "ready", false],
  ])(
    "requires public revision manifest and state (%s/%s)",
    async (lifecycleStatus, indexStatus, hidden) => {
      const repo = {
        ...repository,
        listRevisions: async () => [
          {
            ...(await repository.listRevisions!())[0]!,
            lifecycleStatus,
            indexStatus,
            manifestId: hidden ? undefined : "00000000-0000-0000-0000-000000000099",
          },
        ],
      } as unknown as KnowledgeRepository;
      const server = createMcpServer(repo);
      const client = new Client({ name: "guard-test", version: "0.1.0" }, { capabilities: {} });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      const result = await client.readResource({ uri: `revision://${gameId}/current` });
      if (hidden) expect(resultJson(result)).toBeNull();
      else expect(resultJson(result)).toBeTruthy();
      await client.close();
      await server.close();
    },
  );

  /**
   * Regression: each surface scores on its own scale (structured/document
   * reach ~8.8, dialogue caps near 6.6). Pure score ordering let a surface
   * with many high-scoring look-alikes evict the surface holding the prose
   * answer, so a query like 水仙十字 returned only card/tutorial rows and no
   * quest or dialogue text at all. Every matching surface now keeps a share
   * of the page.
   */
  it("keeps every matching surface represented instead of letting one evict the rest", async () => {
    const crowdedRepository = {
      ...repository,
      // Many high-scoring structured/document rows, one low-scoring dialogue
      // and one low-scoring quest, mirroring the real failure shape.
      search: async (_gameId: string, request?: { documentTypes?: string[] }) => {
        if (request?.documentTypes?.length) {
          return {
            entities: [],
            documents: [],
            segments: [],
            revision: "r1",
            indexStatus: "ready",
            coreHits: { structured: [], lore: [] },
          };
        }
        return {
          entities: [],
          documents: Array.from({ length: 6 }, (_, i) => ({
            id: "doc-" + i,
            title: "水仙十字之剑" + i,
            type: "mechanism",
            snippet: "水仙十字之剑",
            score: 8.8,
            revision: "r1",
          })),
          segments: [],
          revision: "r1",
          indexStatus: "ready",
          coreHits: {
            structured: Array.from({ length: 6 }, (_, i) => ({
              kind: "material",
              stableId: "mat-" + i,
              name: "水仙十字大冒险" + i,
              body: "水仙十字大冒险",
              score: 8.8,
              matchedBy: "exact",
            })),
            lore: [],
          },
        };
      },
      searchDialogue: async () => [
        {
          quest: "命运的回声",
          subquest: null,
          speaker: "阿兰",
          text: "他们三人曾经在「水仙十字院」里共度过童年的时光。",
          dialogueNodeKey: "quest/6020/dialog/60202045",
          citation: {
            documentId: "d-6020",
            locale: "zh-CN",
            questKey: "quest/6020",
            dialogueNodeKey: "quest/6020/dialog/60202045",
            revision: "r1",
          },
          score: 6.6,
        },
      ],
      searchQuests: async () => [
        {
          questKey: "quest/6023",
          mainQuestId: "6023",
          title: "循着过往的足迹",
          type: "archon_quest" as const,
          chapter: "第七幕",
          series: "空月之歌",
          completeness: "complete" as const,
          locale: "zh-CN",
          documentId: "d-6023",
          revision: "r1",
          match: "text",
          excerpt: "水仙十字",
        },
      ],
    };
    const server = createMcpServer(crowdedRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "quota-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    const result = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "水仙十字", limit: 10 },
    });
    expect(result.isError).toBeFalsy();
    const body = resultJson(result) as { hits?: Array<{ type?: string; title?: string }> };
    const types = new Set((body.hits ?? []).map((hit) => hit.type));
    // The low-scoring prose surfaces must survive the high-scoring crowd.
    expect(types.has("dialogue")).toBe(true);
    expect(types.has("quest")).toBe(true);
    expect((body.hits ?? []).some((hit) => hit.title === "命运的回声")).toBe(true);
    expect((body.hits ?? []).some((hit) => hit.title === "循着过往的足迹")).toBe(true);

    await client.close();
    await server.close();
  });

  /**
   * Regression: the response shaper clamped every result set back to its
   * 10-item / 10KB default, so a caller asking for limit 30 silently got 10.
   * The page size must drive both the item cap and the byte ceiling.
   */
  it("honours the requested page size beyond the default ten items", async () => {
    const manyRepository = {
      ...repository,
      search: async () => ({
        entities: [],
        documents: Array.from({ length: 40 }, (_, i) => ({
          id: "doc-" + i,
          title: "文档" + i,
          type: "book" as const,
          // Long excerpts so the default 10KB byte ceiling really binds: a
          // 30-item page of these cannot fit inside the 10-item allowance.
          snippet: ("摘要" + i + "。").repeat(60),
          score: 5,
          revision: "r1",
        })),
        segments: [],
        revision: "r1",
        indexStatus: "ready",
        coreHits: { structured: [], lore: [] },
      }),
      searchDialogue: async () => [],
      searchQuests: async () => [],
    };
    const server = createMcpServer(manyRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "page-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    for (const limit of [10, 20, 30]) {
      const result = await client.callTool({
        name: "search",
        arguments: { game_id: gameId, query: "文档", limit },
      });
      const body = resultJson(result) as { hits?: unknown[] };
      expect(body.hits?.length).toBe(limit);
    }

    await client.close();
    await server.close();
  });

  /**
   * Regression: the corpus is bilingual (Genshin stores each quest twice,
   * zh-CN plus an en twin with identical dialogue). An unfiltered search used
   * to return English rows for an English query and could mix both languages
   * in one result list. Chinese is now the default reading language and a
   * non-default language must be requested explicitly.
   */
  it("scopes search to Chinese by default and honours an explicit locale", async () => {
    const seen: Array<{ locales?: string[]; locale?: string }> = [];
    const localeRepository = {
      ...repository,
      search: async (_gameId: string, request?: { locales?: string[] }) => {
        seen.push({ locales: request?.locales });
        return {
          entities: [],
          documents: [],
          segments: [],
          revision: "r1",
          indexStatus: "ready",
          coreHits: { structured: [], lore: [] },
        };
      },
      searchDialogue: async (_gameId: string, request: { locale?: string }) => {
        seen.push({ locale: request?.locale });
        return [];
      },
      searchQuests: async (_gameId: string, request: { locale?: string }) => {
        seen.push({ locale: request?.locale });
        return [];
      },
    };
    const server = createMcpServer(localeRepository as unknown as KnowledgeRepository);
    const client = new Client({ name: "locale-client", version: "0.1.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    // Default: every surface is pinned to Chinese.
    seen.length = 0;
    await client.callTool({ name: "search", arguments: { game_id: gameId, query: "请仙" } });
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      if (call.locales) expect(call.locales).toEqual(["zh-CN"]);
      if (call.locale) expect(call.locale).toBe("zh-CN");
    }

    // Explicit request: the caller 's language wins.
    seen.length = 0;
    await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "Rite of Descension", locale: "en" },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      if (call.locales) expect(call.locales).toEqual(["en"]);
      if (call.locale) expect(call.locale).toBe("en");
    }

    await client.close();
    await server.close();
  });

  /**
   * Regression: structured hits used to be read from the legacy `entities`
   * index, which only carries npc/quest/item rows. Weapons, artifacts and relic
   * sets were therefore unreachable from `search` even though they are real
   * published records, and every structured hit was forced to score 0 so it
   * always sorted last with an empty excerpt.
   */
  it("returns weapons and artifact sets from the unified search with excerpts", async () => {
    const weapon = {
      kind: "weapon" as const,
      stableId: "genshin:weapon:13501",
      name: "护摩之杖",
      body: "在早已失落的古老祭仪中，使用的朱赤「柴火杖」。",
      score: 11,
      matchedBy: "exact",
    };
    const relicSet = {
      kind: "artifact_set" as const,
      stableId: "sr_relic_set_302",
      name: "不老者的仙舟",
      body: "使装备者的生命上限提高12%。",
      score: 11,
      matchedBy: "exact",
    };
    const structuredRepository = {
      ...repository,
      search: async () => ({
        entities: [],
        documents: [],
        segments: [],
        revision: "r1",
        indexStatus: "ready",
        coreHits: { structured: [weapon, relicSet], lore: [] },
      }),
    };
    const server = createMcpServer(structuredRepository as unknown as KnowledgeRepository);
    const client = new Client(
      { name: "structured-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);

    const result = await client.callTool({
      name: "search",
      arguments: { game_id: gameId, query: "护摩之杖", type: "structured" },
    });
    expect(result.isError).toBeFalsy();
    const body = resultJson(result) as {
      hits?: Array<{
        type?: string;
        title?: string;
        excerpt?: string;
        stableId?: string;
        structuredKind?: string;
        score?: number;
      }>;
    };
    const names = (body.hits ?? []).map((hit) => hit.title);
    expect(names).toContain("护摩之杖");
    expect(names).toContain("不老者的仙舟");

    const artifact = (body.hits ?? []).find((hit) => hit.title === "不老者的仙舟");
    expect(artifact?.structuredKind).toBe("artifact_set");
    expect(artifact?.excerpt).toContain("生命上限");
    // A real score keeps structured rows competitive instead of pinned to 0.
    expect(artifact?.score).toBeGreaterThan(0);

    await client.close();
    await server.close();
  });

  it("routes provider gateway tools through the registry and shapes results", async () => {
    const registry = new GameProviderRegistry();
    registry.register(fakeKnowledgeProvider());
    const server = createMcpServer(repository, { providers: registry });
    const client = new Client(
      { name: "provider-gateway-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const search = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game_id: "genshin", query: "芙宁娜 枫丹预言", mode: "hybrid", limit: 2 },
    });
    const searchJson = resultJson(search) as {
      hits?: Array<{ documentId?: string; excerpt?: string }>;
      returnedCount?: number;
      estimatedBytes?: number;
    };
    expect(search.isError).not.toBe(true);
    expect(searchJson.returnedCount).toBe(2);
    expect(searchJson.hits?.[0]?.documentId).toBe("doc-1");
    expect(searchJson.hits?.[0]?.excerpt?.length).toBeLessThanOrEqual(500);
    expect(searchJson.estimatedBytes).toBeGreaterThan(0);

    const document = await client.callTool({
      name: "get_game_document",
      arguments: { game_id: "genshin-impact", document_id: "doc-1", cursor: 1, limit: 2 },
    });
    expect(resultJson(document)).toMatchObject({
      game: "genshin",
      documentId: "doc-1",
      content: "line2\nline3",
      hasMore: true,
      nextCursor: 3,
    });

    const hierarchy = await client.callTool({
      name: "get_game_document_hierarchy",
      arguments: { game_id: "genshin", document_id: "doc-1" },
    });
    expect(resultJson(hierarchy)).toMatchObject({
      documentId: "doc-1",
      hierarchy: { sections: [{ title: "第一章" }] },
    });

    const status = await client.callTool({
      name: "get_game_provider_status",
      arguments: { game_id: "genshin" },
    });
    expect(resultJson(status)).toMatchObject({
      game: "genshin",
      providers: [{ id: "istaroth", status: "available" }],
    });

    await client.close();
    await server.close();
  });

  it("keeps old MCP behavior when no provider registry is configured", async () => {
    const server = createMcpServer(repository);
    const client = new Client(
      { name: "provider-missing-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const providerResult = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game_id: "genshin", query: "芙宁娜" },
    });
    expect(providerResult.isError).toBe(true);
    expect((resultJson(providerResult) as { error?: { code?: string } }).error?.code).toBe(
      "game_provider_not_found",
    );

    const games = await client.callTool({ name: "list_games", arguments: {} });
    expect((resultJson(games) as { games?: Array<{ slug?: string }> })?.games?.[0]?.slug).toBe(
      "genshin-impact",
    );

    await client.close();
    await server.close();
  });

  it("routes multiple games through the same provider contract without data leakage", async () => {
    const registry = new GameProviderRegistry();
    registry.register(fakeKnowledgeProvider());
    registry.register(fakeStarRailProvider());
    const server = createMcpServer(repository, { providers: registry });
    const client = new Client(
      { name: "multi-game-provider-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const genshin = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game_id: "genshin-impact", query: "摩拉克斯", limit: 1 },
    });
    expect(resultJson(genshin)).toMatchObject({
      game: "genshin",
      provider: "istaroth",
      hits: [{ game: "genshin", provider: "istaroth" }],
    });

    const starrail = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game_id: "hsr", query: "摩拉克斯", limit: 5 },
    });
    const starrailJson = resultJson(starrail) as {
      game?: string;
      provider?: string;
      hits?: Array<{ game?: string; provider?: string; excerpt?: string }>;
    };
    expect(starrailJson.game).toBe("starrail");
    expect(starrailJson.provider).toBe("starrail-local");
    expect(starrailJson.hits?.every((hit) => hit.game === "starrail")).toBe(true);
    expect(starrailJson.hits?.some((hit) => hit.excerpt?.includes("摩拉克斯"))).toBe(false);

    const wrongDocument = await client.callTool({
      name: "get_game_document",
      arguments: { game_id: "starrail", document_id: "doc-1", cursor: 0, limit: 2 },
    });
    expect(wrongDocument.isError).toBe(true);
    expect((resultJson(wrongDocument) as { error?: { code?: string } }).error?.code).toBe(
      "provider_document_not_found",
    );

    const status = await client.callTool({
      name: "get_game_provider_status",
      arguments: {},
    });
    expect(resultJson(status)).toMatchObject({
      providers: [
        { id: "istaroth", game: "genshin", status: "available" },
        { id: "starrail-local", game: "starrail", status: "available" },
      ],
    });

    await client.close();
    await server.close();
  });
});

function fakeKnowledgeProvider(): GameKnowledgeProvider {
  return {
    id: "istaroth",
    gameSlug: "genshin",
    kind: "knowledge",
    capabilities: ["knowledge_search", "keyword_search", "document_read", "document_hierarchy"],
    health: async () => ({
      id: "istaroth",
      game: "genshin",
      kind: "knowledge",
      status: "available",
      capabilities: ["knowledge_search", "keyword_search", "document_read", "document_hierarchy"],
      latencyMs: 2,
      checkedAt: new Date(0).toISOString(),
    }),
    search: async (request) => ({
      game: request.game,
      provider: "istaroth",
      mode: request.mode ?? "hybrid",
      hits: [
        {
          game: request.game,
          provider: "istaroth",
          documentId: "doc-1",
          title: "枫丹预言",
          excerpt: "芙宁娜与枫丹预言相关。".repeat(80),
        },
        {
          game: request.game,
          provider: "istaroth",
          documentId: "doc-2",
          title: "谕示裁定枢机",
          excerpt: "第二条结果。",
        },
        {
          game: request.game,
          provider: "istaroth",
          documentId: "doc-3",
          excerpt: "第三条结果。",
        },
      ],
      truncated: false,
    }),
    getDocument: async (request) => {
      const lines = ["line1", "line2", "line3", "line4"];
      const cursor = request.cursor ?? 0;
      const limit = request.limit ?? 20;
      const page = lines.slice(cursor, cursor + limit);
      const nextCursor = cursor + page.length;
      return {
        game: request.game,
        provider: "istaroth",
        documentId: request.documentId,
        content: page.join("\n"),
        cursor,
        returnedLines: page.length,
        hasMore: nextCursor < lines.length,
        nextCursor: nextCursor < lines.length ? nextCursor : null,
        truncated: nextCursor < lines.length,
      };
    },
    getHierarchy: async (request) => ({
      game: request.game,
      provider: "istaroth",
      documentId: request.documentId,
      hierarchy: { sections: [{ title: "第一章" }] },
      truncated: false,
    }),
  };
}

function fakeStarRailProvider(): GameKnowledgeProvider {
  return {
    id: "starrail-local",
    gameSlug: "starrail",
    kind: "knowledge",
    capabilities: ["knowledge_search", "keyword_search", "document_read"],
    health: async () => ({
      id: "starrail-local",
      game: "starrail",
      kind: "knowledge",
      status: "available",
      capabilities: ["knowledge_search", "keyword_search", "document_read"],
      latencyMs: 1,
      checkedAt: new Date(0).toISOString(),
    }),
    search: async () => ({
      game: "starrail",
      provider: "starrail-local",
      mode: "hybrid",
      hits: [
        {
          game: "starrail",
          provider: "starrail-local",
          documentId: "starrail/story/belobog/1",
          title: "雅利洛-VI",
          excerpt: "开拓者调查雅利洛-VI 的星核危机。",
        },
      ],
      truncated: false,
    }),
    getDocument: async (request) => {
      if (!request.documentId.startsWith("starrail/"))
        throw new GameProviderError("provider_document_not_found");
      return {
        game: "starrail",
        provider: "starrail-local",
        documentId: request.documentId,
        content: "星铁文档",
        cursor: 0,
        returnedLines: 1,
        hasMore: false,
        nextCursor: null,
        truncated: false,
      };
    },
  };
}
