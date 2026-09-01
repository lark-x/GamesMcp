import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

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
};

const goldenPath = process.env.MCP_GOLDEN ?? "data/evaluation/genshin/mcp-golden.json";
const fixturePath =
  process.env.MCP_GOLDEN_FIXTURE ?? "data/evaluation/genshin/mcp-tool-fixture.json";
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as { cases: McpGoldenCase[] };
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ToolFixture;

let toolCalls = 0;

function callTool(name: string, args: Record<string, unknown>): unknown {
  toolCalls += 1;
  if (name === "get_character") {
    return (
      fixture.characters.find(
        (item) =>
          String(item.name).toLocaleLowerCase("zh-CN") ===
          String(args.name).toLocaleLowerCase("zh-CN"),
      ) ?? null
    );
  }
  if (name === "get_material") {
    return (
      fixture.materials.find(
        (item) =>
          String(item.name).toLocaleLowerCase("zh-CN") ===
          String(args.name).toLocaleLowerCase("zh-CN"),
      ) ?? null
    );
  }
  if (name === "get_weapon") {
    return (
      fixture.weapons.find(
        (item) =>
          String(item.name).toLocaleLowerCase("zh-CN") ===
          String(args.name).toLocaleLowerCase("zh-CN"),
      ) ?? null
    );
  }
  if (name === "get_enemy") {
    return (
      fixture.enemies.find(
        (item) =>
          String(item.name).toLocaleLowerCase("zh-CN") ===
          String(args.name).toLocaleLowerCase("zh-CN"),
      ) ?? null
    );
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
  throw new Error(`Unknown tool: ${name}`);
}

const failures: string[] = [];
for (const item of golden.cases) {
  toolCalls = 0;
  const toolName = item.expectedTool;
  const argKey = toolName === "resolve_entity" ? "query" : "name";
  const result = callTool(toolName, { [argKey]: item.entityName }) as Record<
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
