import { describe, expect, it } from "vitest";
import { GameProviderError } from "../errors.js";
import {
  IstarothMcpClient,
  type IstarothSdkClientLike,
  type IstarothTransportLike,
} from "./client.js";

class FakeTransport implements IstarothTransportLike {
  closed = false;

  async close() {
    this.closed = true;
  }
}

class FakeSdkClient implements IstarothSdkClientLike {
  connectCalls = 0;
  listToolCalls = 0;
  callToolCalls = 0;

  constructor(
    private readonly behavior: {
      connect?: () => Promise<void>;
      listTools?: () => Promise<{ tools: Array<{ name: string }> }>;
      callTool?: () => Promise<{ content?: Array<{ type?: string; text?: string }> }>;
    } = {},
  ) {}

  async connect() {
    this.connectCalls += 1;
    await this.behavior.connect?.();
  }

  async listTools() {
    this.listToolCalls += 1;
    return await (this.behavior.listTools?.() ??
      Promise.resolve({ tools: [{ name: "retrieve" }] }));
  }

  async callTool() {
    this.callToolCalls += 1;
    return await (this.behavior.callTool?.() ?? Promise.resolve({ content: [] }));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function clientHarness(clients: FakeSdkClient[], transports: FakeTransport[]) {
  return new IstarothMcpClient({
    url: "http://127.0.0.1:8000/mcp",
    connectTimeoutMs: 10,
    requestTimeoutMs: 100,
    clientFactory: () => {
      const client = clients.shift();
      if (!client) throw new Error("no fake client available");
      return client;
    },
    transportFactory: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
  });
}

describe("IstarothMcpClient", () => {
  it("reuses established client", async () => {
    const sdkClient = new FakeSdkClient();
    const transports: FakeTransport[] = [];
    const client = clientHarness([sdkClient], transports);

    await client.listTools();
    await client.listTools();

    expect(sdkClient.connectCalls).toBe(1);
    expect(sdkClient.listToolCalls).toBe(2);
    expect(transports).toHaveLength(1);
  });

  it("concurrent first connection shares promise", async () => {
    const connect = deferred<void>();
    const sdkClient = new FakeSdkClient({ connect: () => connect.promise });
    const transports: FakeTransport[] = [];
    const client = clientHarness([sdkClient], transports);

    const first = client.listTools();
    const second = client.listTools();
    const third = client.listTools();
    connect.resolve();
    await Promise.all([first, second, third]);

    expect(sdkClient.connectCalls).toBe(1);
    expect(sdkClient.listToolCalls).toBe(3);
    expect(transports).toHaveLength(1);
  });

  it("timeout closes broken transport", async () => {
    const hangingConnect = new FakeSdkClient({ connect: () => new Promise(() => undefined) });
    const recoveryClient = new FakeSdkClient();
    const transports: FakeTransport[] = [];
    const client = clientHarness([hangingConnect, recoveryClient], transports);

    await client.listTools();

    expect(hangingConnect.connectCalls).toBe(1);
    expect(transports[0]?.closed).toBe(true);
    expect(recoveryClient.connectCalls).toBe(1);
  });

  it("retry obtains new client", async () => {
    const firstClient = new FakeSdkClient({
      callTool: async () => {
        throw new Error("request timeout");
      },
    });
    const secondClient = new FakeSdkClient();
    const transports: FakeTransport[] = [];
    const client = clientHarness([firstClient, secondClient], transports);

    await expect(client.callTool("retrieve", { query: "钟离" })).resolves.toEqual({ content: [] });

    expect(firstClient.callToolCalls).toBe(1);
    expect(secondClient.callToolCalls).toBe(1);
    expect(transports[0]?.closed).toBe(true);
    expect(transports[1]?.closed).toBe(false);
  });

  it("second failure closes again", async () => {
    const firstClient = new FakeSdkClient({
      callTool: async () => {
        throw new Error("request timeout");
      },
    });
    const secondClient = new FakeSdkClient({
      callTool: async () => {
        throw new Error("json-rpc disconnected");
      },
    });
    const transports: FakeTransport[] = [];
    const client = clientHarness([firstClient, secondClient], transports);

    await expect(client.callTool("retrieve", { query: "钟离" })).rejects.toMatchObject({
      code: "provider_protocol_error",
    } satisfies Partial<GameProviderError>);

    expect(transports[0]?.closed).toBe(true);
    expect(transports[1]?.closed).toBe(true);
  });

  it("does not retry non-retryable tool errors", async () => {
    const sdkClient = new FakeSdkClient({
      callTool: async () => ({ isError: true, content: [] }),
    });
    const transports: FakeTransport[] = [];
    const client = clientHarness([sdkClient], transports);

    await expect(client.callTool("retrieve", { query: "钟离" })).rejects.toMatchObject({
      code: "provider_protocol_error",
    } satisfies Partial<GameProviderError>);

    expect(sdkClient.callToolCalls).toBe(1);
  });

  it("close is idempotent and allows reconnect", async () => {
    const firstClient = new FakeSdkClient();
    const secondClient = new FakeSdkClient();
    const transports: FakeTransport[] = [];
    const client = clientHarness([firstClient, secondClient], transports);

    await client.listTools();
    await client.close();
    await client.close();
    await client.listTools();

    expect(firstClient.connectCalls).toBe(1);
    expect(secondClient.connectCalls).toBe(1);
    expect(transports[0]?.closed).toBe(true);
  });
});
