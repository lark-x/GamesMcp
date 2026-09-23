/**
 * MCP Streamable HTTP protocol smoke test. Exercises a real MCP client
 * (initialize → tools/list → tools/call list_games) plus raw HTTP negative
 * cases: missing auth, invalid auth, invalid session id and the health
 * endpoints. Exit code 0 only when every gate passes.
 *
 * Env:
 *   MCP_SMOKE_URL   endpoint under test (default http://127.0.0.1:4200/mcp)
 *   MCP_SMOKE_TOKEN bearer token; auth negative cases run only when set
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_SMOKE_URL ?? "http://127.0.0.1:4200/mcp";
const token = process.env.MCP_SMOKE_TOKEN ?? "";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function rawPost(body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const endpoint = new URL(url);

  // 1. Real MCP client handshake.
  let client: Client | undefined;
  try {
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });
    client = new Client({ name: "gamesmcp-smoke", version: "0.1.0" });
    await client.connect(transport);
    record("mcp initialize", true);
  } catch (error) {
    record("mcp initialize", false, String(error));
  }

  // 2. tools/list over the same session.
  if (client) {
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      record(
        "tools/list",
        names.includes("list_games") && names.length > 0,
        `${names.length} tools`,
      );
    } catch (error) {
      record("tools/list", false, String(error));
    }

    // 3. First real tool call on the published corpus.
    try {
      const games = (await client.callTool({ name: "list_games", arguments: {} })) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const payload = JSON.parse(games.content?.[0]?.text ?? "{}") as { games?: unknown[] };
      record(
        "tools/call list_games",
        Array.isArray(payload.games) && payload.games.length > 0,
        `games=${payload.games?.length ?? 0}`,
      );
    } catch (error) {
      record("tools/call list_games", false, String(error));
    }

    try {
      await client.close();
    } catch {
      // Session teardown is best-effort in the smoke test.
    }
  }

  // 4. Health endpoints (unauthenticated by design).
  try {
    const health = await fetch(new URL("/health", endpoint));
    record("GET /health", health.status === 200);
  } catch (error) {
    record("GET /health", false, String(error));
  }
  try {
    const ready = await fetch(new URL("/ready", endpoint));
    record("GET /ready", ready.status === 200 || ready.status === 503);
  } catch (error) {
    record("GET /ready", false, String(error));
  }

  // 5. Negative protocol cases. Auth cases require a token to be configured.
  if (token) {
    try {
      const missing = await rawPost(initializeBody());
      record("auth missing → 401", missing.status === 401, `status=${missing.status}`);
    } catch (error) {
      record("auth missing → 401", false, String(error));
    }
    try {
      const invalid = await rawPost(initializeBody(), { Authorization: "Bearer wrong-token" });
      record("auth invalid → 401", invalid.status === 401, `status=${invalid.status}`);
    } catch (error) {
      record("auth invalid → 401", false, String(error));
    }
  } else {
    console.log("SKIP  auth negative cases (no MCP_SMOKE_TOKEN configured)");
  }

  try {
    const invalidSession = await rawPost(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {
        "mcp-session-id": "00000000-0000-0000-0000-000000000000",
        // Auth runs before session validation, so the probe must clear the
        // token gate to actually exercise the invalid-session path.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    );
    record(
      "invalid session → 404",
      invalidSession.status === 404,
      `status=${invalidSession.status}`,
    );
  } catch (error) {
    record("invalid session → 404", false, String(error));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(
    failed.length === 0
      ? `\nMCP HTTP smoke: ${results.length} gates passed.`
      : `\nMCP HTTP smoke: ${failed.length}/${results.length} gates FAILED.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

function initializeBody() {
  return {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "gamesmcp-smoke-negative", version: "0.1.0" },
    },
  };
}

await main();
