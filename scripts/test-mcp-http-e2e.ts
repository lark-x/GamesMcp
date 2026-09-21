/**
 * Real-data MCP E2E over Streamable HTTP. Drives the published Genshin and
 * StarRail revisions through the same MCP surface remote agents use:
 * characters, equipment, materials, dialogue search, quests and items.
 * Requires a running HTTP MCP with both games ingested.
 *
 * Env:
 *   MCP_E2E_URL    endpoint under test (default http://127.0.0.1:4200/mcp)
 *   MCP_E2E_TOKEN  bearer token when the endpoint requires auth
 *   GENSHIN_GAME_ID / STARRAIL_GAME_ID  optional overrides; resolved via
 *                  list_games by slug when omitted
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_E2E_URL ?? "http://127.0.0.1:4200/mcp";
const token = process.env.MCP_E2E_TOKEN ?? "";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function textOf(callResult: unknown): Record<string, unknown> {
  const content = (callResult as { content?: Array<{ type: string; text?: string }> }).content;
  const first = content?.find((part) => part.type === "text");
  return JSON.parse(first?.text ?? "{}") as Record<string, unknown>;
}

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "gamesmcp-e2e", version: "0.1.0" });
  await client.connect(transport);

  const games = textOf(await client.callTool({ name: "list_games", arguments: {} }));
  const gameList = (games.games ?? []) as Array<{ id: string; slug?: string; name?: string }>;
  record("list_games", gameList.length >= 2, gameList.map((g) => g.slug ?? g.name).join(","));

  const genshin = gameList.find((game) => (game.slug ?? "").includes("genshin")) ?? gameList[0];
  const starrail = gameList.find((game) => (game.slug ?? "").includes("starrail")) ?? gameList[1];
  if (!genshin || !starrail) {
    record("resolve both games", false, "genshin/starrail missing from list_games");
    process.exit(1);
  }

  // Genshin E2E.
  const zhongli = textOf(
    await client.callTool({
      name: "get_character",
      arguments: { game_id: genshin.id, name: "钟离" },
    }),
  ) as { character?: { name?: string } | { error?: unknown } };
  record(
    "genshin get_character 钟离",
    !("error" in zhongli) && (zhongli.character as { name?: string } | undefined)?.name != null,
  );

  const homa = textOf(
    await client.callTool({
      name: "get_equipment",
      arguments: { game_id: genshin.id, name: "护摩之杖" },
    }),
  ) as { equipment?: Record<string, unknown> | { error?: unknown } };
  record("genshin get_equipment 护摩之杖", !("error" in homa) && homa.equipment != null);

  const genshinQuests = textOf(
    await client.callTool({
      name: "search",
      arguments: { game_id: genshin.id, query: "魔神任务", type: "quest", limit: 5 },
    }),
  ) as { hits?: unknown[]; error?: unknown };
  record(
    "genshin search quest 魔神任务",
    !("error" in genshinQuests) && (genshinQuests.hits?.length ?? 0) > 0,
    `hits=${genshinQuests.hits?.length ?? 0}`,
  );

  const genshinItems = textOf(
    await client.callTool({
      name: "search",
      arguments: { game_id: genshin.id, query: "摩拉", type: "item", limit: 5 },
    }),
  ) as { hits?: unknown[]; error?: unknown };
  record(
    "genshin search item 摩拉",
    !("error" in genshinItems) && (genshinItems.hits?.length ?? 0) > 0,
    `hits=${genshinItems.hits?.length ?? 0}`,
  );

  // StarRail E2E.
  const huangquan = textOf(
    await client.callTool({
      name: "get_character",
      arguments: { game_id: starrail.id, name: "黄泉" },
    }),
  ) as { character?: { name?: string } | { error?: unknown } };
  record(
    "starrail get_character 黄泉",
    !("error" in huangquan) && (huangquan.character as { name?: string } | undefined)?.name != null,
  );

  const lightCone = textOf(
    await client.callTool({
      name: "get_equipment",
      arguments: { game_id: starrail.id, name: "行于流逝的岸" },
    }),
  ) as { equipment?: Record<string, unknown> | { error?: unknown } };
  record("starrail get_equipment 行于流逝的岸", !("error" in lightCone) && lightCone.equipment != null);

  const cocolia = textOf(
    await client.callTool({
      name: "search",
      arguments: {
        game_id: starrail.id,
        query: "星核",
        type: "dialogue",
        speaker: "可可利亚",
        limit: 5,
      },
    }),
  ) as { hits?: unknown[]; error?: unknown };
  record(
    "starrail search dialogue 可可利亚+星核",
    !("error" in cocolia) && (cocolia.hits?.length ?? 0) > 0,
    `hits=${cocolia.hits?.length ?? 0}`,
  );

  const starrailQuests = textOf(
    await client.callTool({
      name: "search",
      arguments: { game_id: starrail.id, query: "混乱行至深处", type: "quest", limit: 5 },
    }),
  ) as { hits?: unknown[]; error?: unknown };
  record(
    "starrail search quest 混乱行至深处",
    !("error" in starrailQuests) && (starrailQuests.hits?.length ?? 0) > 0,
    `hits=${starrailQuests.hits?.length ?? 0}`,
  );

  await client.close();

  const failed = results.filter((result) => !result.ok);
  console.log(
    failed.length === 0
      ? `\nMCP real-data E2E: ${results.length} gates passed.`
      : `\nMCP real-data E2E: ${failed.length}/${results.length} gates FAILED.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main().catch((error) => {
  console.error("E2E crashed:", error);
  process.exit(1);
});
