/**
 * MCP Performance Benchmark.
 * Measures end-to-end latency of key operations over Streamable HTTP:
 * cold path (first call) vs warm path (in-memory cached call).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_BENCHMARK_URL ?? "http://127.0.0.1:4200/mcp";
const token = process.env.MCP_BENCHMARK_TOKEN ?? "22b48a1c80a0a198b92fe5d526a77a771e71397bf198a31fc2e1ef83a5c7fd74";

interface BenchResult {
  operation: string;
  coldMs: number;
  warmMs: number;
  speedup: string;
  notes: string;
}

async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;
  return { result, durationMs };
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 GamesMcp 全链路检索性能压测基准 (Benchmark)`);
  console.log(`Endpoint: ${url}`);
  console.log(`======================================================\n`);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "gamesmcp-benchmarker", version: "0.1.0" });
  await client.connect(transport);

  // Warmup connection & resolve games
  const gamesRes = await client.callTool({ name: "list_games", arguments: {} });
  const rawGames = (gamesRes as { content?: Array<{ type: string; text?: string }> }).content?.[0]?.text;
  const gamesData = JSON.parse(rawGames ?? "{}") as { games?: Array<{ id: string; slug: string }> };
  const genshin = gamesData.games?.find((g) => g.slug.includes("genshin")) ?? gamesData.games?.[0];

  if (!genshin) {
    console.error("Genshin game not found in platform");
    process.exit(1);
  }

  const results: BenchResult[] = [];

  const benchCases = [
    {
      name: "get_character (钟离)",
      run: () => client.callTool({ name: "get_character", arguments: { game_id: genshin.id, name: "钟离" } }),
      notes: "B-Tree 索引 + 内存图鉴缓存",
    },
    {
      name: "get_character (雷电将军)",
      run: () => client.callTool({ name: "get_character", arguments: { game_id: genshin.id, name: "雷电将军" } }),
      notes: "B-Tree 索引 + 内存图鉴缓存",
    },
    {
      name: "get_equipment (护摩之杖)",
      run: () => client.callTool({ name: "get_equipment", arguments: { game_id: genshin.id, name: "护摩之杖" } }),
      notes: "B-Tree 索引 + 装备缓存",
    },
    {
      name: "get_material (霓裳花)",
      run: () => client.callTool({ name: "get_material", arguments: { game_id: genshin.id, name: "霓裳花" } }),
      notes: "材料图鉴查询",
    },
    {
      name: "get_enemy (风魔龙)",
      run: () => client.callTool({ name: "get_enemy", arguments: { game_id: genshin.id, name: "风魔龙" } }),
      notes: "怪物与首领图鉴查询",
    },
    {
      name: "search: dialogue (温迪)",
      run: () => client.callTool({ name: "search", arguments: { game_id: genshin.id, query: "温迪", type: "dialogue", limit: 5 } }),
      notes: "80万句对白 GIN 倒排索引扫描",
    },
    {
      name: "search: dialogue (欲买桂花同载酒)",
      run: () => client.callTool({ name: "search", arguments: { game_id: genshin.id, query: "欲买桂花同载酒", type: "dialogue", limit: 5 } }),
      notes: "经典台词全文检索",
    },
    {
      name: "search: quest (捕风的异乡人)",
      run: () => client.callTool({ name: "search", arguments: { game_id: genshin.id, query: "捕风的异乡人", type: "quest", limit: 5 } }),
      notes: "任务章节索引扫描",
    },
    {
      name: "search: all (旅行者)",
      run: () => client.callTool({ name: "search", arguments: { game_id: genshin.id, query: "旅行者", type: "all", limit: 5 } }),
      notes: "全库6大面多路并发聚合检索",
    },
  ];

  for (const c of benchCases) {
    const cold = await measure(c.run);
    const warm = await measure(c.run);
    const speedup = warm.durationMs > 0 ? `${(cold.durationMs / warm.durationMs).toFixed(1)}x` : "∞";
    results.push({
      operation: c.name,
      coldMs: cold.durationMs,
      warmMs: warm.durationMs,
      speedup,
      notes: c.notes,
    });
  }

  await client.close();

  // Print results table
  console.log(`| 操作类型 | 首次查询 (Cold) | 二次缓存 (Cached) | 提速倍率 | 优化机制 |`);
  console.log(`| :--- | :--- | :--- | :---: | :--- |`);
  for (const r of results) {
    console.log(`| **${r.operation}** | **${r.coldMs} ms** | **${r.warmMs} ms** | **${r.speedup}** | ${r.notes} |`);
  }
  console.log(`\n======================================================\n`);
}

main().catch(console.error);
