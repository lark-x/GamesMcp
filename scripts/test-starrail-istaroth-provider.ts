import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  GameProviderRegistry,
  IstarothKnowledgeProvider,
  IstarothMcpClient,
} from "../packages/providers/src/index.js";
import { createMcpServer } from "../apps/mcp-server/src/server.js";
import type { KnowledgeRepository } from "../packages/domain/src/index.js";

const url =
  process.env.STARRAIL_ISTAROTH_INTEGRATION_URL ?? process.env.GAMESMCP_STARRAIL_ISTAROTH_URL;
const output = resolve(
  process.env.STARRAIL_ISTAROTH_E2E_OUTPUT ?? "artifacts/evaluation/starrail-istaroth-e2e.json",
);

if (!url) {
  await writeReport({
    provider: "istaroth",
    game: "starrail",
    skipped: true,
    reason: "STARRAIL_ISTAROTH_INTEGRATION_URL or GAMESMCP_STARRAIL_ISTAROTH_URL is not set",
    generatedAt: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({ skipped: true, reason: "StarRail Istaroth URL is not set", output }),
  );
  process.exit(0);
}

const golden = JSON.parse(
  await readFile("data/evaluation/providers/starrail-istaroth-golden.json", "utf8"),
) as GoldenFile;
const registry = new GameProviderRegistry();
registry.register(
  new IstarothKnowledgeProvider({
    gameSlug: golden.game,
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
  { name: "starrail-istaroth-provider-e2e", version: "0.1.0" },
  { capabilities: {} },
);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

try {
  const cases = [];
  for (const item of golden.cases) {
    const result = await client.callTool({
      name: "search_game_knowledge",
      arguments: {
        game: golden.game,
        query: item.query,
        mode: item.mode,
        intent: "balanced",
        limit: 10,
      },
    });
    const body = parseToolJson(result) as { hits?: SearchHit[] };
    const joined = JSON.stringify(body.hits ?? []);
    const passed =
      !result.isError &&
      (body.hits?.length ?? 0) >= item.minHits &&
      item.mustContainAny.some((needle) => joined.includes(needle));
    cases.push({
      id: item.id,
      category: item.category,
      query: item.query,
      mode: item.mode,
      passed,
      hitCount: body.hits?.length ?? 0,
      documentId: body.hits?.find((hit) => hit.documentId)?.documentId,
    });
  }
  const documentReads = [];
  for (const item of cases.filter((caseResult) => caseResult.documentId).slice(0, 10)) {
    const document = await client.callTool({
      name: "get_game_document",
      arguments: { game: golden.game, document_id: item.documentId, cursor: 0, limit: 20 },
    });
    documentReads.push({
      caseId: item.id,
      documentId: item.documentId,
      passed: !document.isError,
    });
  }
  const hierarchy = cases.find((caseResult) => caseResult.documentId)
    ? await client.callTool({
        name: "get_game_document_hierarchy",
        arguments: {
          game: golden.game,
          document_id: cases.find((caseResult) => caseResult.documentId)?.documentId,
        },
      })
    : undefined;
  const passed = cases.filter((item) => item.passed).length;
  const payload = {
    provider: "istaroth",
    game: golden.game,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    documentReadPassed: documentReads.length >= 10 && documentReads.every((item) => item.passed),
    hierarchyPassed: hierarchy ? !hierarchy.isError : false,
    generatedAt: new Date().toISOString(),
    cases,
    documentReads,
  };
  await writeReport(payload);
  if (payload.failed || !payload.documentReadPassed || !payload.hierarchyPassed)
    throw new Error(`StarRail Istaroth E2E failed; see ${output}`);
  console.log(JSON.stringify({ ok: true, output, passed, failed: payload.failed }));
} finally {
  await client.close();
  await server.close();
  await registry.close();
}

async function writeReport(payload: unknown) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
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
        id: "00000000-0000-0000-0000-000000000002",
        slug: "starrail",
        name: "Honkai: Star Rail",
        status: "active",
      },
    ],
  } as unknown as KnowledgeRepository;
}

interface GoldenFile {
  game: string;
  cases: Array<{
    id: string;
    category: string;
    mode: "hybrid" | "keyword";
    query: string;
    mustContainAny: string[];
    minHits: number;
  }>;
}

interface SearchHit {
  documentId?: string;
}
