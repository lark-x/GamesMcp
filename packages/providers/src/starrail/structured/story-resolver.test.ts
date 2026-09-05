import { describe, expect, it } from "vitest";
import { StarRailDialogueExtractor } from "./dialogue.js";
import { StarRailWorldChapterResolver } from "./world-chapter.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";

describe("StarRail Structured Story Pipeline (Phase 3)", () => {
  const mockResolver: StarRailTextMapResolver = {
    resolve: (id: string | number) => {
      const map: Record<string, string> = {
        "1001": "空间站「黑塔」",
        "2001": "序章 · 今天是明天的前夜",
        "3001": "三月七",
        "3002": "这只是一场噩梦，快醒醒！",
        "3003": "你是谁？",
        "3004": "这里是哪里？",
      };
      return map[String(id)] ?? String(id);
    },
  } as unknown as StarRailTextMapResolver;

  describe("StarRailDialogueExtractor", () => {
    it("directly extracts structured dialogue nodes and options from JSON without regex guessing", () => {
      const extractor = new StarRailDialogueExtractor({ resolver: mockResolver });

      const sampleStoryJson = {
        MainMissionID: 1000101,
        Nodes: [
          {
            NodeID: "node_1",
            TalkSentenceID: 9001,
            SpeakerName: "3001",
            TalkSentenceText: "3002",
            Options: [
              { OptionID: "opt_1", TextMapHash: "3003", NextNodeID: "node_2" },
              { OptionID: "opt_2", TextMapHash: "3004", NextNodeID: "node_3" },
            ],
          },
        ],
      };

      const nodes = extractor.extractNodes(sampleStoryJson, "Story/Mission/1000101/Story100010101.json");

      expect(nodes.length).toBe(1);
      const node = nodes[0]!;
      expect(node.nodeId).toBe("node_1");
      expect(node.nodeType).toBe("dialogue");
      expect(node.speakerName).toBe("三月七");
      expect(node.body).toBe("这只是一场噩梦，快醒醒！");
      expect(node.options).toHaveLength(2);
      expect(node.options?.[0]?.text).toBe("你是谁？");
      expect(node.options?.[1]?.text).toBe("这里是哪里？");
    });
  });

  describe("StarRailWorldChapterResolver", () => {
    it("falls back to the real WorldDataConfig ID space when config files are absent", async () => {
      const resolver = new StarRailWorldChapterResolver({
        dataDir: "data/fixtures/starrail",
        resolver: mockResolver,
      });

      await resolver.initialize();

      const world = resolver.getWorld(101);
      expect(world).toBeDefined();
      expect(world?.name).toBe("空间站「黑塔」");

      const chapter = resolver.getChapter(100001);
      expect(chapter).toBeDefined();
      expect(chapter?.name).toBe("序幕•第一节");
      expect(chapter?.worldId).toBe(101);
    });
  });
});
