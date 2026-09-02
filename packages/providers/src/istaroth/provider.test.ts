import { describe, expect, it } from "vitest";
import { GameProviderError } from "../errors.js";
import { GenshinIstarothProvider } from "./provider.js";
import type { IstarothMcpClientLike, McpToolResult } from "./client.js";

class FakeClient implements IstarothMcpClientLike {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  tools = ["retrieve", "retrieve_bm25", "get_file_content", "get_document_hierarchy"];
  result: McpToolResult = {
    structuredContent: {
      hits: [
        {
          document_id: "doc-1",
          title: "枫丹预言",
          excerpt: "芙宁娜与枫丹预言相关。",
          score: 0.9,
          path: "quests/fontaine.md",
        },
      ],
    },
  };

  async listTools() {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return this.result;
  }

  async close() {}
}

function provider(client = new FakeClient()) {
  return new GenshinIstarothProvider({
    gameSlug: "genshin",
    client,
    requestTimeoutMs: 1_000,
    healthCacheMs: 1,
  });
}

describe("GenshinIstarothProvider", () => {
  it("maps hybrid search to retrieve and normalizes structured hits", async () => {
    const client = new FakeClient();
    const response = await provider(client).search({
      game: "genshin",
      query: "芙宁娜 枫丹预言",
      mode: "hybrid",
      intent: "balanced",
      limit: 5,
    });

    expect(client.calls[0]?.name).toBe("retrieve");
    expect(client.calls[0]?.args).toMatchObject({ query: "芙宁娜 枫丹预言", intent: "balanced" });
    expect(response.hits[0]).toMatchObject({
      game: "genshin",
      provider: "istaroth",
      documentId: "doc-1",
      title: "枫丹预言",
    });
  });

  it("maps keyword search to retrieve_bm25", async () => {
    const client = new FakeClient();
    await provider(client).search({
      game: "genshin",
      query: "戴因斯雷布",
      mode: "keyword",
      limit: 3,
    });
    expect(client.calls[0]?.name).toBe("retrieve_bm25");
  });

  it("paginates get_file_content by lines", async () => {
    const client = new FakeClient();
    client.result = { content: [{ type: "text", text: "a\nb\nc\nd" }] };
    const response = await provider(client).getDocument({
      game: "genshin",
      documentId: "doc-1",
      cursor: 1,
      limit: 2,
    });
    expect(client.calls[0]?.name).toBe("get_file_content");
    expect(response.content).toBe("b\nc");
    expect(response.hasMore).toBe(true);
    expect(response.nextCursor).toBe(3);
  });

  it("normalizes hierarchy responses", async () => {
    const client = new FakeClient();
    client.result = { structuredContent: { sections: [{ title: "序章" }] } };
    const response = await provider(client).getHierarchy?.({
      game: "genshin",
      documentId: "doc-1",
    });
    expect(client.calls[0]?.name).toBe("get_document_hierarchy");
    expect(response?.hierarchy).toEqual({ sections: [{ title: "序章" }] });
  });

  it("reports degraded health when required tools are missing", async () => {
    const client = new FakeClient();
    client.tools = ["retrieve"];
    await expect(provider(client).health()).resolves.toMatchObject({
      status: "degraded",
      capabilities: ["knowledge_search"],
    });
  });

  it("normalizes provider errors", async () => {
    const client = new FakeClient();
    client.callTool = async () => {
      throw new Error("request timeout");
    };
    await expect(provider(client).search({ game: "genshin", query: "x" })).rejects.toMatchObject({
      code: "provider_timeout",
    } satisfies Partial<GameProviderError>);
  });

  it("falls back to bounded text parsing for non-structured Istaroth output", async () => {
    const client = new FakeClient();
    client.result = {
      content: [
        {
          type: "text",
          text: "file_id: doc-2\ntitle: 坎瑞亚\n坎瑞亚发生了灾变。",
        },
      ],
    };
    const response = await provider(client).search({ game: "genshin", query: "坎瑞亚" });
    expect(response.hits[0]).toMatchObject({ documentId: "doc-2", title: "坎瑞亚" });
    expect(response.hits[0]?.excerpt.length).toBeLessThanOrEqual(1_200);
  });
});
