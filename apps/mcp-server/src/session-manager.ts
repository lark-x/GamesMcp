import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface McpSession {
  id: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionPairHooks {
  /** Called with the SDK-issued session id once initialize lands. */
  initialized(sessionId: string): void;
  /** Called when the transport closes (DELETE, idle close, socket teardown). */
  closed(): void;
}

export interface SessionManagerOptions {
  maxSessions: number;
  idleTimeoutMs: number;
  /** Factory wired by http.ts: one transport+server pair per session. The
   * factory must forward hooks into the SDK transport callbacks. */
  createSession: (
    hooks: SessionPairHooks,
  ) => Promise<{ transport: StreamableHTTPServerTransport; server: McpServer }>;
}

/**
 * Owns every initialized Streamable HTTP MCP session in this process. The SDK
 * transport generates the session id during initialize and reports it through
 * onsessioninitialized; entries leave the map via DELETE (transport onclose)
 * or the idle sweeper. State is in-memory by design — this service is
 * stateless-friendly and horizontally scalable only behind sticky sessions.
 */
export class McpSessionManager {
  private readonly sessions = new Map<string, McpSession>();
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(private readonly options: SessionManagerOptions) {}

  start(): void {
    const sweepIntervalMs = Math.min(this.options.idleTimeoutMs, 5 * 60_000);
    this.sweeper = setInterval(() => this.sweepIdleSessions(), sweepIntervalMs);
    this.sweeper.unref();
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.closeSession(id)));
  }

  get size(): number {
    return this.sessions.size;
  }

  hasCapacity(): boolean {
    return this.sessions.size < this.options.maxSessions;
  }

  get(id: string): McpSession | undefined {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = Date.now();
    return session;
  }

  /** Creates a fresh transport+server pair for an initialize request. The pair
   * registers itself under the SDK-issued session id once initialize lands. */
  async createSessionPair(): Promise<{
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  }> {
    const session: McpSession = {
      id: "",
      transport: undefined as unknown as StreamableHTTPServerTransport,
      server: undefined as unknown as McpServer,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const pair = await this.options.createSession({
      initialized: (sessionId) => {
        session.id = sessionId;
        session.lastActivityAt = Date.now();
        this.sessions.set(sessionId, session);
      },
      closed: () => {
        if (session.id) this.sessions.delete(session.id);
        void session.server.close().catch(() => undefined);
      },
    });
    session.transport = pair.transport;
    session.server = pair.server;
    return pair;
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      await session.server.close();
    } catch {
      // Server close must not block transport cleanup.
    }
    try {
      await session.transport.close();
    } catch {
      // Already closed by the SDK when handling DELETE.
    }
  }

  private sweepIdleSessions(): void {
    const deadline = Date.now() - this.options.idleTimeoutMs;
    for (const [id, session] of this.sessions) {
      if (session.lastActivityAt < deadline) void this.closeSession(id);
    }
  }
}
