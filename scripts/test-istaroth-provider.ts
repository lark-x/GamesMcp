import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  GameProviderRegistry,
  GenshinIstarothProvider,
  IstarothMcpClient,
} from "../packages/providers/src/index.js";
import { createMcpServer } from "../apps/mcp-server/src/server.js";
import type { KnowledgeRepository } from "../packages/domain/src/index.js";

const url = process.env.ISTAROTH_INTEGRATION_URL ?? process.env.GAMESMCP_ISTAROTH_URL;
if (!url) {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: "ISTAROTH_INTEGRATION_URL or GAMESMCP_ISTAROTH_URL is not set",
    }),
  );
  process.exit(0);
}

const game = process.env.GAMESMCP_ISTAROTH_GAME_SLUG ?? "genshin";
const registry = new GameProviderRegistry();
registry.register(
  new GenshinIstarothProvider({
    gameSlug: game,
    client: new IstarothMcpClient({
      url,
      connectTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS ?? 3_000),
      requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
    }),
    requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
  }),
);

const server = createMcpServer(fakeRepository(), { providers: registry });
const client = new Client(
  { name: "istaroth-provider-e2e", version: "0.1.0" },
  { capabilities: {} },
);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

try {
  const queries = [
    "芙宁娜与枫丹预言",
    "坎瑞亚发生了什么",
    "钟离与摩拉克斯身份",
    "纳西妲与世界树",
    "天理的维系者",
    "戴因斯雷布",
    "古名",
    "深渊教团",
    "雷电将军与永恒",
    "温迪和风神",
    "璃月七星",
    "博士切片",
    "散兵与世界树",
    "赤王与花神",
    "若陀龙王",
    "魔神战争",
    "黄金莱茵多特",
    "空月祝福",
    "水神审判",
    "枫丹预言如何解除",
  ];

  const failures: string[] = [];
  let documentId: string | undefined;
  for (const query of queries) {
    const result = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game, query, mode: "hybrid", intent: "balanced", limit: 5 },
    });
    const body = parseToolJson(result) as { hits?: Array<{ documentId?: string }> };
    if (result.isError || !body.hits?.length) failures.push(query);
    documentId ??= body.hits?.find((hit) => hit.documentId)?.documentId;
  }

  const keyword = await client.callTool({
    name: "search_game_knowledge",
    arguments: { game, query: "戴因斯雷布", mode: "keyword", limit: 5 },
  });
  if (keyword.isError || !(parseToolJson(keyword) as { hits?: unknown[] }).hits?.length)
    failures.push("keyword:戴因斯雷布");

  if (!documentId) throw new Error(`No document id found; failed queries: ${failures.join(", ")}`);

  const document = await client.callTool({
    name: "get_game_document",
    arguments: { game, document_id: documentId, cursor: 0, limit: 20 },
  });
  if (document.isError) failures.push(`document:${documentId}`);

  const hierarchy = await client.callTool({
    name: "get_game_document_hierarchy",
    arguments: { game, document_id: documentId },
  });
  if (hierarchy.isError) failures.push(`hierarchy:${documentId}`);

  if (failures.length) throw new Error(`Istaroth provider E2E failures: ${failures.join(", ")}`);
  console.log(JSON.stringify({ ok: true, queryCount: queries.length, documentId }));
} finally {
  await client.close();
  await server.close();
  await registry.close();
}

function parseToolJson(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const content = (result as { content?: unknown[] }).content ?? [];
  const text = content.find((item): item is { text: string } =>
    Boolean(
      item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string",
    ),
  )?.text;
  return text ? JSON.parse(text) : undefined;
}

function fakeRepository(): KnowledgeRepository {
  return {
    listGames: async () => [
      {
        id: "00000000-0000-0000-0000-000000000001",
        slug: "genshin-impact",
        name: "Genshin Impact",
        status: "active",
      },
    ],
  } as unknown as KnowledgeRepository;
}
