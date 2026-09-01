import { describe, expect, it } from "vitest";
import { SEARCH_TIERS, rankCandidate, scoreBodyField, scoreTitleField } from "./ranking.js";
import { resolveEntityFromCandidates } from "./entity-resolver.js";
import { rrfFuse } from "./rrf.js";
import { DEFAULT_MCP_RESPONSE_BUDGET, shapeForBudget } from "./token-budget.js";
import { SearchService } from "./service.js";

describe("tiered ranking", () => {
  it("ranks exact title above prefix above body", () => {
    const exact = rankCandidate("胡桃", { title: "胡桃" });
    const prefix = rankCandidate("胡桃", { title: "胡桃传说" });
    const body = rankCandidate("胡桃", { title: "往生堂", body: "堂主胡桃掌管往生堂" });
    expect(exact.score).toBe(SEARCH_TIERS.exactTitle);
    expect(prefix.score).toBe(SEARCH_TIERS.titlePrefix);
    expect(body.score).toBeLessThan(prefix.score);
    expect(scoreTitleField("胡桃", "胡桃").tier).toBe("exactTitle");
    expect(scoreBodyField("往生堂七十七代堂主", "往生堂七十七代堂主，胡桃").tier).toBe("bodyFts");
  });

  it("applies dialogue boosts for speaker and important quest types", () => {
    const boosted = rankCandidate("派蒙", {
      title: "对话",
      body: "派蒙说",
      speaker: "派蒙",
      questType: "archon_quest",
    });
    const plain = rankCandidate("派蒙", { title: "对话", body: "派蒙说" });
    expect(boosted.score).toBeGreaterThan(plain.score);
  });
});

describe("entity resolver", () => {
  it("resolves alias matches and flags strong ambiguity with candidates", () => {
    const resolved = resolveEntityFromCandidates("摩拉克斯", [
      { id: "1", entityType: "character", canonicalName: "钟离", aliases: ["摩拉克斯"] },
    ]);
    expect(resolved?.matchedBy).toBe("alias");
    expect(resolved?.confidence).toBe(0.95);
    const ambiguous = resolveEntityFromCandidates("旅行者", [
      { id: "1", entityType: "character", canonicalName: "空" },
      { id: "2", entityType: "character", canonicalName: "荧" },
    ]);
    expect(ambiguous?.candidates?.length).toBe(2);
  });
});

describe("rrf fusion", () => {
  it("merges lists and prefers items present in both", () => {
    const fused = rrfFuse(
      [
        { item: "a", key: "a" },
        { item: "b", key: "b" },
      ],
      [{ item: "b", key: "b" }],
    );
    expect(fused[0]?.key).toBe("b");
    expect(fused[0]?.sources).toEqual(["lexical", "semantic"]);
  });
});

describe("token budget", () => {
  it("limits item count, excerpt length, and bytes", () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({
      title: `命中${i}`,
      excerpt: "很".repeat(900),
    }));
    const page = shapeForBudget(hits);
    expect(page.items.length).toBeLessThanOrEqual(DEFAULT_MCP_RESPONSE_BUDGET.maxItems);
    expect(page.truncated).toBe(true);
    expect(page.estimatedBytes).toBeLessThanOrEqual(DEFAULT_MCP_RESPONSE_BUDGET.maxBytes);
    for (const item of page.items) {
      expect((item.excerpt ?? "").length).toBeLessThanOrEqual(
        DEFAULT_MCP_RESPONSE_BUDGET.maxCharsPerExcerpt,
      );
    }
  });
});

describe("search service over port", () => {
  it("ranks structured, document, and dialogue hits", async () => {
    const service = new SearchService({
      listStructuredAtRevision: async () => [
        { kind: "character" as const, name: "胡桃", aliases: [], body: "" },
        { kind: "material" as const, name: "霓裳花", aliases: [], body: "" },
      ],
      listEntityCandidates: async () => [],
      listDialogueHits: async () => [
        {
          key: "q1/n1",
          title: "传说任务",
          body: "胡桃来了",
          speaker: null,
          questTitle: "胡桃传说",
          questType: "story_quest",
          documentId: "d1",
          nodeKey: "n1",
          subquestKey: null,
          citation: {
            documentId: "d1",
            locale: "zh-CN",
            questKey: "q1",
            dialogueNodeKey: "n1",
            revision: "r1",
          },
        },
      ],
      listDocumentHits: async () => [
        {
          key: "doc1",
          document: {
            id: "d1",
            sourceKey: "s1",
            title: "胡桃的故事",
            type: "character_story",
            locale: "zh-CN",
          },
          body: "胡桃的故事正文",
          title: "胡桃的故事",
        },
      ],
    });
    const result = await service.searchText("game", "rev", "胡桃");
    expect(result.structured[0]?.name).toBe("胡桃");
    expect(result.documents[0]?.document.title).toBe("胡桃的故事");
    expect(result.dialogue[0]?.dialogueNodeKey).toBe("n1");
    const lore = await service.searchLore("game", "rev", "胡桃");
    expect(lore.length).toBeGreaterThan(0);
  });
});
