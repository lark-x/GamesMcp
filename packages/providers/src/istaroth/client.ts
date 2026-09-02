import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GameProviderError, providerErrorFrom } from "../errors.js";

export type McpToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

export interface IstarothMcpClientLike {
  listTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface IstarothMcpClientConfig {
  url: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export class IstarothMcpClient implements IstarothMcpClientLike {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly config: IstarothMcpClientConfig) {
    if (!config.url) throw new GameProviderError("provider_disabled");
    try {
      new URL(config.url);
    } catch (error) {
      throw new GameProviderError("provider_protocol_error", "Invalid Istaroth MCP URL.", error);
    }
  }

  async listTools(): Promise<string[]> {
    const client = await this.ensureClient();
    const result = await this.withRetry(() =>
      client.listTools(undefined, { timeout: this.config.requestTimeoutMs }),
    );
    return result.tools.map((tool) => tool.name);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = this.config.requestTimeoutMs,
  ): Promise<McpToolResult> {
    const client = await this.ensureClient();
    const result = await this.withRetry(() =>
      client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }),
    );
    if (result.isError)
      throw new GameProviderError("provider_protocol_error", `Istaroth tool failed: ${name}`);
    return result as McpToolResult;
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    await transport?.close();
  }

  private async ensureClient(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.connect();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<Client> {
    const client = new Client(
      { name: "gamesmcp-istaroth-provider", version: "0.1.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      reconnectionOptions: {
        initialReconnectionDelay: 500,
        maxReconnectionDelay: 3_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 1,
      },
    });
    try {
      await withTimeout(
        client.connect(transport),
        this.config.connectTimeoutMs,
        () => new GameProviderError("provider_timeout", "Istaroth MCP connection timed out."),
      );
      this.transport = transport;
      return client;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw providerErrorFrom(error);
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (firstError) {
      const normalized = providerErrorFrom(firstError);
      if (
        normalized.code !== "provider_timeout" &&
        normalized.code !== "provider_unavailable" &&
        normalized.code !== "provider_protocol_error"
      )
        throw normalized;
      await this.close().catch(() => undefined);
      try {
        return await operation();
      } catch (secondError) {
        await this.close().catch(() => undefined);
        throw providerErrorFrom(secondError);
      }
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(errorFactory()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
