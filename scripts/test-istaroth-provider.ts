import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
const output = resolve(
  process.env.ISTAROTH_E2E_OUTPUT ?? "artifacts/evaluation/genshin-istaroth-e2e.json",
);
if (!url) {
  await writeReport({
    provider: "istaroth",
    game: "genshin",
    skipped: true,
    reason: "ISTAROTH_INTEGRATION_URL or GAMESMCP_ISTAROTH_URL is not set",
    generatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ skipped: true, reason: "Istaroth URL is not set", output }));
  process.exit(0);
}

const golden = JSON.parse(
  await readFile("data/evaluation/providers/genshin-istaroth-golden.json", "utf8"),
) as GoldenFile;
const game = process.env.GAMESMCP_ISTAROTH_GAME_SLUG ?? golden.game;
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

const caseResults: CaseReport[] = [];
const documentChain: DocumentChainReport[] = [];
let failureIsolationPassed: boolean | "skipped" = "skipped";
let recoveryPassed: boolean | "skipped" = "skipped";

try {
  for (const item of golden.cases) {
    const result = await client.callTool({
      name: "search_game_knowledge",
      arguments: { game, query: item.query, mode: item.mode, intent: "balanced", limit: 5 },
    });
    const body = parseToolJson(result) as { hits?: SearchHit[] };
    const joined = JSON.stringify(body.hits ?? []);
    const passed =
      !result.isError &&
      (body.hits?.length ?? 0) >= item.minHits &&
      item.mustContainAny.some((needle) => joined.includes(needle));
    caseResults.push({
      id: item.id,
      query: item.query,
      mode: item.mode,
      passed,
      hitCount: body.hits?.length ?? 0,
      documentId: body.hits?.find((hit) => hit.documentId)?.documentId,
    });
  }

  for (const item of caseResults.filter((caseResult) => caseResult.documentId).slice(0, 5)) {
    const first = await client.callTool({
      name: "get_game_document",
      arguments: { game, document_id: item.documentId, cursor: 0, limit: 5 },
    });
    const firstBody = parseToolJson(first) as {
      documentId?: string;
      content?: string;
      hasMore?: boolean;
      nextCursor?: number | null;
    };
    const second =
      typeof firstBody.nextCursor === "number"
        ? await client.callTool({
            name: "get_game_document",
            arguments: {
              game,
              document_id: item.documentId,
              cursor: firstBody.nextCursor,
              limit: 5,
            },
          })
        : undefined;
    const hierarchy = await client.callTool({
      name: "get_game_document_hierarchy",
      arguments: { game, document_id: item.documentId },
    });
    documentChain.push({
      caseId: item.id,
      documentId: item.documentId ?? "",
      passed:
        !first.isError &&
        Boolean(firstBody.content) &&
        firstBody.documentId === item.documentId &&
        (!firstBody.hasMore || Boolean(second && !second.isError)) &&
        !hierarchy.isError,
    });
  }

  if (process.env.ISTAROTH_E2E_EXPECT_DOWN_URL) {
    const downRegistry = new GameProviderRegistry();
    downRegistry.register(
      new GenshinIstarothProvider({
        gameSlug: game,
        client: new IstarothMcpClient({
          url: process.env.ISTAROTH_E2E_EXPECT_DOWN_URL,
          connectTimeoutMs: 200,
          requestTimeoutMs: 500,
        }),
        requestTimeoutMs: 500,
      }),
    );
    const downServer = createMcpServer(fakeRepository(), { providers: downRegistry });
    const downClient = new Client(
      { name: "istaroth-down-e2e", version: "0.1.0" },
      { capabilities: {} },
    );
    const [downClientTransport, downServerTransport] = InMemoryTransport.createLinkedPair();
    await downServer.connect(downServerTransport);
    await downClient.connect(downClientTransport);
    const failed = await downClient.callTool({
      name: "search_game_knowledge",
      arguments: { game, query: "钟离", mode: "hybrid", limit: 1 },
    });
    failureIsolationPassed = Boolean(failed.isError);
    await downClient.close();
    await downServer.close();
    await downRegistry.close();
  }
  recoveryPassed = process.env.ISTAROTH_E2E_RECOVERY_VERIFIED === "true" ? true : "skipped";

  const passed = caseResults.filter((item) => item.passed).length;
  const failed = caseResults.length - passed;
  const payload = {
    provider: "istaroth",
    game,
    total: caseResults.length,
    passed,
    failed,
    documentChainPassed: documentChain.length >= 5 && documentChain.every((item) => item.passed),
    failureIsolationPassed,
    recoveryPassed,
    generatedAt: new Date().toISOString(),
    cases: caseResults,
    documentChain,
  };
  await writeReport(payload);
  if (
    failed ||
    !payload.documentChainPassed ||
    failureIsolationPassed === false ||
    recoveryPassed === false
  )
    throw new Error(`Istaroth provider E2E failed; see ${output}`);
  console.log(JSON.stringify({ ok: true, output, passed, failed }));
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
        id: "00000000-0000-0000-0000-000000000001",
        slug: "genshin-impact",
        name: "Genshin Impact",
        status: "active",
      },
    ],
  } as unknown as KnowledgeRepository;
}

interface GoldenFile {
  game: string;
  cases: Array<{
    id: string;
    mode: "hybrid" | "keyword";
    query: string;
    mustContainAny: string[];
    minHits: number;
  }>;
}

interface SearchHit {
  documentId?: string;
}

interface CaseReport {
  id: string;
  query: string;
  mode: "hybrid" | "keyword";
  passed: boolean;
  hitCount: number;
  documentId?: string;
}

interface DocumentChainReport {
  caseId: string;
  documentId: string;
  passed: boolean;
}
