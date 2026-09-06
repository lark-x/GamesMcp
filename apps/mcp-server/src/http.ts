import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { createMcpRuntime, type McpRuntime } from "./runtime.js";
import { verifyMcpAuth } from "./auth.js";
import { McpSessionManager } from "./session-manager.js";

const SESSION_HEADER = "mcp-session-id";
const MAX_BODY_BYTES = 2_000_000;

interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  id: unknown;
  error: { code: number; message: string; data?: unknown };
}

function jsonRpcError(id: unknown, code: number, message: string): JsonRpcErrorBody {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Array.isArray(chunk) ? Buffer.concat(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Streamable HTTP entry for remote MCP clients. One process hosts many MCP
 * sessions; every session owns its own McpServer+transport pair built from the
 * single shared tool registration in server.ts.
 */
export async function runHttp(): Promise<void> {
  const runtime = await createMcpRuntime();
  const mcpConfig = runtime.config.mcp;
  if (!mcpConfig.httpEnabled) {
    console.error(
      "[mcp:http] MCP_HTTP_ENABLED is false; set MCP_HTTP_ENABLED=true to start the HTTP MCP",
    );
    process.exitCode = 1;
    return;
  }

  const sessions = new McpSessionManager({
    maxSessions: mcpConfig.maxSessions,
    idleTimeoutMs: mcpConfig.sessionIdleTimeoutMs,
    createSession: async (hooks) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sessionId) => hooks.initialized(sessionId),
      });
      transport.onclose = () => hooks.closed();
      const server = createMcpServer(runtime.repository, { providers: runtime.providers });
      await server.connect(transport);
      return { transport, server };
    },
  });
  sessions.start();

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res, runtime, sessions).catch((error) => {
      console.error("[mcp:http] unhandled request error", error);
      sendJson(res, 500, jsonRpcError(null, -32603, "Internal server error"));
    });
  });
  httpServer.headersTimeout = mcpConfig.requestTimeoutMs;
  httpServer.requestTimeout = mcpConfig.requestTimeoutMs;
  httpServer.keepAliveTimeout = 65_000;

  await listen(httpServer, mcpConfig.port, mcpConfig.host);
  const endpoint = `http://${
    mcpConfig.host === "0.0.0.0" ? "127.0.0.1" : mcpConfig.host
  }:${mcpConfig.port}${mcpConfig.path}`;
  console.error(`[mcp:http] Streamable HTTP MCP listening on ${endpoint}`);
  console.error(
    `[mcp:http] auth=${mcpConfig.authToken ? "bearer token" : "disabled (local development)"}, ` +
      `maxSessions=${mcpConfig.maxSessions}, idleTimeoutMs=${mcpConfig.sessionIdleTimeoutMs}`,
  );

  const shutdown = async () => {
    console.error("[mcp:http] shutting down");
    httpServer.close();
    await sessions.stop();
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: McpRuntime,
  sessions: McpSessionManager,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const mcpConfig = runtime.config.mcp;

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "gamesmcp-mcp" });
    return;
  }
  if (url.pathname === "/ready") {
    await handleReady(res, runtime);
    return;
  }
  if (url.pathname !== mcpConfig.path) {
    sendJson(res, 404, { error: { code: "not_found", message: "Unknown endpoint" } });
    return;
  }
  if (!verifyMcpAuth(req, mcpConfig)) {
    // Never log or echo the Authorization header value.
    sendJson(res, 401, jsonRpcError(null, -32001, "Unauthorized"));
    return;
  }

  const sessionId = req.headers[SESSION_HEADER];
  const sessionKey = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, jsonRpcError(null, -32700, "Invalid JSON body"));
      return;
    }
    const method = isRecord(body) && typeof body.method === "string" ? body.method : undefined;

    if (!sessionKey) {
      if (method !== "initialize") {
        sendJson(res, 400, jsonRpcError(null, -32600, "Missing Mcp-Session-Id header"));
        return;
      }
      if (!sessions.hasCapacity()) {
        sendJson(res, 503, jsonRpcError(null, -32002, "mcp_session_limit_reached"));
        return;
      }
      const pair = await sessions.createSessionPair();
      await pair.transport.handleRequest(req, res, body);
      return;
    }

    const session = sessions.get(sessionKey);
    if (!session) {
      sendJson(res, 404, jsonRpcError(null, -32001, "Session not found"));
      return;
    }
    await session.transport.handleRequest(req, res, body);
    return;
  }

  if (req.method === "GET") {
    // GET opens the SSE channel for server-initiated messages and requires an
    // existing session; without a session id it is a protocol error.
    if (!sessionKey) {
      sendJson(res, 400, jsonRpcError(null, -32600, "Missing Mcp-Session-Id header"));
      return;
    }
    const session = sessions.get(sessionKey);
    if (!session) {
      sendJson(res, 404, jsonRpcError(null, -32001, "Session not found"));
      return;
    }
    await session.transport.handleRequest(req, res);
    return;
  }

  if (req.method === "DELETE") {
    if (!sessionKey) {
      sendJson(res, 400, jsonRpcError(null, -32600, "Missing Mcp-Session-Id header"));
      return;
    }
    const session = sessions.get(sessionKey);
    if (!session) {
      sendJson(res, 404, jsonRpcError(null, -32001, "Session not found"));
      return;
    }
    // The SDK transport answers the DELETE and closes itself (onclose fires);
    // closeSession is idempotent and guarantees server teardown.
    await session.transport.handleRequest(req, res);
    await sessions.closeSession(sessionKey);
    return;
  }

  sendJson(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
}

async function handleReady(res: ServerResponse, runtime: McpRuntime): Promise<void> {
  try {
    const games = await runtime.repository.listGames();
    if (games.length === 0) {
      sendJson(res, 503, { status: "not_ready", database: "ready", games: 0 });
      return;
    }
    sendJson(res, 200, { status: "ready", database: "ready", games: games.length });
  } catch {
    sendJson(res, 503, { status: "not_ready", database: "unavailable" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

await runHttp();
