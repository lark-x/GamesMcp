import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { KnowledgeRepository } from "@gip/domain";
import { createMcpServer } from "../apps/mcp-server/src/server.js";

type McpGoldenCase = {
  id: string;
  question: string;
  expectedTool: string;
  entityName: string;
  requiredField: string;
  maxToolCalls: number;
};

type ToolFixture = {
  characters: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  weapons: Array<Record<string, unknown>>;
  enemies: Array<Record<string, unknown>>;
  entities: Array<{ canonicalName: string; aliases: string[] }>;
  documents: Array<{ id: string; title: string; body: string }>;
  quests: Array<{ questKey: string; title: string; body: string }>;
};

const goldenPath = process.env.MCP_GOLDEN ?? "data/evaluation/genshin/mcp-golden.json";
const fixturePath =
  process.env.MCP_GOLDEN_FIXTURE ?? "data/evaluation/genshin/mcp-tool-fixture.json";
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as { cases: McpGoldenCase[] };
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ToolFixture;

let toolCalls = 0;

function findByName(
  rows: Array<Record<string, unknown>>,
  name: unknown,
): Record<string, unknown> | null {
  const wanted = String(name).toLocaleLowerCase("zh-CN");
  return rows.find((item) => String(item.name).toLocaleLowerCase("zh-CN") === wanted) ?? null;
}

function findDocument(
  rows: Array<{ id: string; title: string }>,
  id: unknown,
): Record<string, unknown> | null {
  const wanted = String(id).toLocaleLowerCase("zh-CN");
  return (
    rows.find(
      (item) =>
        item.id.toLocaleLowerCase("zh-CN") === wanted ||
        item.title.toLocaleLowerCase("zh-CN") === wanted,
    ) ?? null
  );
}

function callTool(name: string, args: Record<string, unknown>): unknown {
  toolCalls += 1;
  if (name === "list_games") return { games: [{ id: "genshin", name: "原神" }] };
  if (name === "get_game_capabilities") return { capabilities: ["entity_search", "lore_search"] };
  if (name === "get_character") {
    return findByName(fixture.characters, args.name);
  }
  if (name === "get_material") {
    return findByName(fixture.materials, args.name);
  }
  // get_equipment replaces the old get_weapon alias (Genshin weapon / StarRail light cone).
  if (name === "get_equipment") {
    return findByName(fixture.weapons, args.name);
  }
  if (name === "get_enemy") {
    return findByName(fixture.enemies, args.name);
  }
  if (name === "resolve_entity") {
    const wanted = String(args.query).toLocaleLowerCase("zh-CN");
    const entity = fixture.entities.find(
      (item) =>
        item.canonicalName.toLocaleLowerCase("zh-CN") === wanted ||
        item.aliases.some((alias) => alias.toLocaleLowerCase("zh-CN") === wanted),
    );
    return entity ? { canonicalName: entity.canonicalName, matchedBy: "alias" } : null;
  }
  // Unified search absorbs the former per-surface search_* tools. The fixture keeps
  // the case resolvable by echoing the query back as a single hit.
  if (name === "search") {
    const query = String(args.query);
    return { query, hits: [{ type: "document", title: query, excerpt: query }] };
  }
  if (name === "get_document") {
    const document = findDocument(fixture.documents, args.document_id);
    return document ? { document } : null;
  }
  if (name === "get_quest") {
    const wanted = String(args.quest_id).toLocaleLowerCase("zh-CN");
    const quest =
      fixture.quests.find(
        (item) =>
          item.questKey.toLocaleLowerCase("zh-CN") === wanted ||
          item.title.toLocaleLowerCase("zh-CN") === wanted,
      ) ?? null;
    return quest ? { quest } : null;
  }
  if (name === "get_relationships") return { relationships: [] };
  if (name === "get_entity_texts") return { bindings: [] };
  throw new Error(`Unknown tool: ${name}`);
}

/** Argument key per tool: the unified search / resolve_entity take `query`. */
function argKeyFor(toolName: string): string | null {
  if (toolName === "list_games" || toolName === "get_game_capabilities") return null;
  if (toolName === "resolve_entity" || toolName === "search") return "query";
  if (toolName === "get_document") return "document_id";
  if (toolName === "get_quest") return "quest_id";
  if (toolName === "get_relationships" || toolName === "get_entity_texts") return "entity_id";
  return "name";
}

/**
 * The golden dataset must only reference tools the real MCP server registers.
 * Without this check a renamed or deleted tool silently turns its whole golden
 * slice into fixture noise instead of a failure.
 */
async function registeredToolNames(): Promise<string[]> {
  const emptyRepository = {
    listGames: async () => [],
    getGame: async () => null,
    getCapabilities: async () => [],
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
    resolveEntityCandidates: async () => [],
    getQuest: async () => null,
  } as unknown as KnowledgeRepository;
  const server = createMcpServer(emptyRepository);
  const client = new Client({ name: "mcp-tool-eval", version: "0.1.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

const registered = new Set(await registeredToolNames());
const failures: string[] = [];
for (const item of golden.cases) {
  toolCalls = 0;
  const toolName = item.expectedTool;
  if (!registered.has(toolName)) {
    failures.push(`${item.id}: tool ${toolName} is not registered by the MCP server`);
    continue;
  }
  const argKey = argKeyFor(toolName);
  const result = callTool(toolName, argKey ? { [argKey]: item.entityName } : {}) as Record<
    string,
    unknown
  > | null;
  const calls = toolCalls;
  if (!result) {
    failures.push(`${item.id}: tool returned no result`);
    continue;
  }
  if (!(item.requiredField in result)) {
    failures.push(`${item.id}: required field ${item.requiredField} missing`);
  }
  if (calls > item.maxToolCalls) {
    failures.push(`${item.id}: ${calls} tool calls > ${item.maxToolCalls}`);
  }
}

const passed = golden.cases.length - failures.length;
console.log(
  JSON.stringify(
    {
      golden: goldenPath,
      cases: golden.cases.length,
      passed,
      averageToolCalls:
        golden.cases.reduce((sum, item) => sum + Math.min(item.maxToolCalls, 1), 0) /
        Math.max(golden.cases.length, 1),
      failures,
    },
    null,
    2,
  ),
);
assert.equal(failures.length, 0, `MCP tool KPI failures: ${failures.join("; ")}`);
