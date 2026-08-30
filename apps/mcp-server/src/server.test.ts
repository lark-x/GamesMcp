import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import type { KnowledgeRepository } from "@gip/domain";

const gameId = "00000000-0000-0000-0000-000000000001";
const entityId = "00000000-0000-0000-0000-000000000002";

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
  search: async () => ({
    entities: [],
    documents: [],
    segments: [],
    revision: "",
    indexStatus: "not_ready",
  }),
  getEntity: async () => null,
  getDocument: async () => null,
  getRelationships: async () => [],
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

  it("exposes the seven-tool and four-resource public contract", async () => {
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
      "get_entity",
      "get_game_capabilities",
      "get_lore_document",
      "get_relationships",
      "list_games",
      "search_entities",
      "search_lore",
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
      expect(resultJson(result)).toBe(hidden ? null : expect.anything());
      await client.close();
      await server.close();
    },
  );
});
