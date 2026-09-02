import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import type { KnowledgeRepository } from "@gip/domain";

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

  it("exposes the nineteen-tool and four-resource public contract", async () => {
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
      "get_enemy",
      "get_entity",
      "get_entity_texts",
      "get_game_capabilities",
      "get_item_text",
      "get_lore_document",
      "get_material",
      "get_quest",
      "get_relationships",
      "get_weapon",
      "list_games",
      "resolve_entity",
      "search_dialogue",
      "search_entities",
      "search_items",
      "search_lore",
      "search_mechanics",
      "search_quests",
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
      name: "search_entities",
      arguments: { game_id: gameId, query: "旅行者", limit: 5 },
    });
    expect(notReady.isError).toBe(true);
    expect((resultJson(notReady) as { error?: { code?: string } })?.error?.code).toBe(
      "index_not_ready",
    );
    const missingEntity = await client.callTool({
      name: "get_entity",
      arguments: { game_id: gameId, entity_id: entityId },
    });
    expect(missingEntity.isError).toBe(true);
    expect((resultJson(missingEntity) as { error?: { code?: string } })?.error?.code).toBe(
      "entity_not_found",
    );
    const questSearch = await client.callTool({
      name: "search_quests",
      arguments: { game_id: gameId, query: "捕风", locale: "zh-CN", limit: 5 },
    });
    expect(
      (resultJson(questSearch) as { quests?: Array<{ questKey?: string }> }).quests?.[0]?.questKey,
    ).toBe("quest/1001");
    const dialogueSearch = await client.callTool({
      name: "search_dialogue",
      arguments: { game_id: gameId, query: "派蒙", limit: 5 },
    });
    const dialogueBody = resultJson(dialogueSearch) as {
      hits?: Array<{ speaker?: string; text?: string; dialogueNodeKey?: string }>;
    };
    expect(dialogueBody.hits?.[0]?.speaker).toBe("派蒙");
    expect(dialogueBody.hits?.[0]?.text).toContain("旅行者");
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
      name: "get_lore_document",
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
      name: "get_lore_document",
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

  it("shapes search_lore results under the unified response budget (Sprint 20)", async () => {
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
      name: "search_lore",
      arguments: { game_id: gameId, query: "测试" },
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
      name: "get_weapon",
      arguments: { game_id: gameId, name: "无锋剑" },
    });
    const weaponBody = resultJson(weaponResult) as { weapon?: { weaponType?: string } };
    expect(weaponBody.weapon?.weaponType).toBe("sword");

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
      name: "search_items",
      arguments: { query: "霓裳" },
    });
    const itemsBody = resultJson(searchItems) as {
      items?: Array<{ stableId?: string; materialStableId?: string; name?: string }>;
      truncated?: boolean;
    };
    expect(searchItems.isError).toBeFalsy();
    expect(itemsBody.items?.[0]?.name).toBe("霓裳花");
    expect(itemsBody.items?.[0]?.stableId).toBe(itemDocumentId);
    expect(itemsBody.items?.[0]?.materialStableId).toBe("material/nichang");
    expect(itemsBody.truncated).toBe(false);

    const itemText = await client.callTool({
      name: "get_item_text",
      arguments: { item_id: itemDocumentId },
    });
    const itemBody = resultJson(itemText) as { item?: { stableId?: string; description?: string } };
    expect(itemBody.item?.stableId).toBe(itemDocumentId);
    expect(itemBody.item?.description).toContain("常被用于角色培养");

    const legacyItemText = await client.callTool({
      name: "get_item_text",
      arguments: { item_id: "material/nichang" },
    });
    const legacyItemBody = resultJson(legacyItemText) as { item?: { stableId?: string } };
    expect(legacyItemBody.item?.stableId).toBe("material/nichang");

    const mechanics = await client.callTool({
      name: "search_mechanics",
      arguments: { query: "超载" },
    });
    const mechanicsBody = resultJson(mechanics) as {
      hits?: Array<{ sourceKey?: string }>;
      corpusStatus?: string;
    };
    expect(mechanics.isError).toBeFalsy();
    expect(mechanicsBody.corpusStatus).toBe("available");
    expect(mechanicsBody.hits?.[0]?.sourceKey).toBe("mechanism/Tutorial/1001");

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
});
