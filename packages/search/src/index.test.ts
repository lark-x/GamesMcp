import { describe, expect, it } from "vitest";
import {
  SEARCH_MATCH_TYPE_TIERS,
  SEARCH_TIERS,
  rankCandidate,
  scoreBodyField,
  scoreSearchMatch,
  scoreTitleField,
} from "./ranking.js";
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

  // Chinese text is not segmented by the `simple` PostgreSQL config, so a long
  // sentence query never matches FTS. A literal substring hit is the only
  // reliable signal, and it must outrank the trigram fallback so that a body
  // that genuinely contains the phrase is not filtered out by the rank floor.
  it("ranks a substring hit above the trigram fallback", () => {
    const substring = scoreSearchMatch("substring", 0.6);
    const trigram = scoreSearchMatch("trgm", 0.99);
    const fts = scoreSearchMatch("fts", 0);
    const prefix = scoreSearchMatch("prefix", 0.8);
    expect(SEARCH_MATCH_TYPE_TIERS.substring).toBe(SEARCH_TIERS.substring);
    expect(substring).toBeGreaterThan(trigram);
    expect(substring).toBeGreaterThan(fts);
    expect(substring).toBeLessThan(prefix);
  });

  it("keeps a short Chinese query relevant inside a long dialogue line", () => {
    const query = "第三降临者";
    const line =
      "但在至冬，准确来说是「愚人众」的过往研究里，一般认为它同「第三降临者」有些许联系。";
    // The body contains the phrase verbatim, so the body tier must fire even
    // though the character-overlap ratio against the whole line is tiny.
    expect(scoreBodyField(query, line).tier).toBe("bodyFts");
    // Trigram similarity of the same pair is far below the 0.15 admission
    // threshold, which is exactly the old failure mode.
    const relevant = rankCandidate(query, { title: "槲寄生", body: line });
    const unrelated = rankCandidate(query, { title: "无关任务", body: "今天的天气不错。" });
    expect(relevant.score).toBeGreaterThan(unrelated.score);
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

  it("does not resolve an alias materialized only in another revision", async () => {
    const aliasesByRevision = new Map([
      ["revision-a", []],
      [
        "revision-b",
        [
          {
            id: "entity-1",
            entityType: "character",
            canonicalName: "钟离",
            aliases: ["摩拉克斯"],
            matchTier: "alias" as const,
            matchedText: "摩拉克斯",
          },
        ],
      ],
    ]);
    const service = new SearchService({
      listStructuredAtRevision: async () => [],
      resolveEntityCandidates: async ({ revisionId }) => aliasesByRevision.get(revisionId) ?? [],
      listDialogueHits: async () => [],
      listDocumentHits: async () => [],
    });

    await expect(service.resolveEntity("game", "revision-a", "摩拉克斯")).resolves.toBeNull();
    await expect(service.resolveEntity("game", "revision-b", "摩拉克斯")).resolves.toMatchObject({
      id: "entity-1",
      matchedBy: "alias",
    });
  });

  /**
   * Regression: the SQL port used to admit trigram candidates on
   * similarity > 0.15 alone, so a short CJK query drifted onto unrelated
   * names (摩拉克斯 vs 摩拉急速来 scores 0.22) and resolve_entity answered with
   * a confident-looking wrong entity. The port now applies a raw-similarity
   * floor; this pins the resolver contract for a surviving weak candidate.
   */
  it("does not treat a weak trigram candidate as a confident match", () => {
    const weak = resolveEntityFromCandidates("摩拉克斯", [
      {
        id: "item-1",
        entityType: "item",
        canonicalName: "摩拉急速来",
        matchTier: "trigram" as const,
        matchedText: "摩拉急速来",
        matchConfidence: 0.22,
      },
    ]);
    expect(weak?.matchedBy).toBe("trigram");
    expect(weak?.confidence).toBeLessThan(0.5);
    const exact = resolveEntityFromCandidates("摩拉克斯", [
      { id: "c-1", entityType: "character", canonicalName: "钟离", aliases: ["摩拉克斯"] },
    ]);
    expect(exact?.matchedBy).toBe("alias");
    expect(exact?.confidence).toBe(0.95);
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
        { kind: "character" as const, stableId: "char/hutao", name: "胡桃", aliases: [], body: "" },
        {
          kind: "material" as const,
          stableId: "material/nichang",
          name: "霓裳花",
          aliases: [],
          body: "",
        },
      ],
      resolveEntityCandidates: async () => [],
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
    expect(result.structured[0]?.stableId).toBe("char/hutao");
    expect(result.documents[0]?.document.title).toBe("胡桃的故事");
    expect(result.dialogue[0]?.dialogueNodeKey).toBe("n1");
    const lore = await service.searchLore("game", "rev", "胡桃");
    expect(lore.length).toBeGreaterThan(0);
  });

  it("uses database match metadata and forwards dialogue filters", async () => {
    let receivedFilters: unknown;
    const service = new SearchService({
      listStructuredAtRevision: async () => [
        {
          kind: "character" as const,
          stableId: "char/hutao",
          name: "胡桃",
          aliases: [],
          body: "",
          rank: 0.4,
          matchType: "exact" as const,
        },
      ],
      resolveEntityCandidates: async () => [],
      listDialogueHits: async (_gameId, _revisionId, _query, filters) => {
        receivedFilters = filters;
        return [
          {
            key: "q1/n1",
            title: "传说任务",
            body: "胡桃来了",
            speaker: "胡桃",
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
            rank: 0.4,
            matchType: "fts" as const,
          },
        ];
      },
      listDocumentHits: async () => [],
    });

    await expect(service.searchText("game", "rev", "胡桃")).resolves.toMatchObject({
      structured: [{ score: 10.4, matchedBy: "exact" }],
      dialogue: [{ score: 6.4 }],
    });
    await expect(
      service.searchDialogue("game", "rev", "胡桃", {
        speaker: "胡桃",
        quest: "q1",
        nodeType: "dialogue",
        locale: "zh-CN",
      }),
    ).resolves.toHaveLength(1);
    expect(receivedFilters).toEqual({
      speaker: "胡桃",
      quest: "q1",
      nodeType: "dialogue",
      locale: "zh-CN",
    });
  });
});
