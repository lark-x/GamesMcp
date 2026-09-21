import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStarRailInventory } from "../source/inventory.js";
import { StarRailDialogueExtractor } from "./dialogue.js";
import { StarRailStoryResolver } from "./story-resolver.js";
import { StarRailWorldChapterResolver } from "./world-chapter.js";
import { StarRailTextMapResolver } from "../source/textmap.js";

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

      const nodes = extractor.extractNodes(
        sampleStoryJson,
        "Story/Mission/1000101/Story100010101.json",
      );

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
    it("falls back to the real WorldDataConfig ID space when in fixture mode and config files are absent", async () => {
      const resolver = new StarRailWorldChapterResolver({
        dataDir: "data/fixtures/starrail",
        resolver: mockResolver,
        fixture: true,
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

    it("does not populate baseline worlds when in production mode and files are absent", async () => {
      const resolver = new StarRailWorldChapterResolver({
        dataDir: "data/fixtures/starrail",
        resolver: mockResolver,
        fixture: false,
      });

      await resolver.initialize();
      expect(resolver.getWorld(101)).toBeUndefined();
      expect(resolver.getChapter(100001)).toBeUndefined();
    });
  });

  it("keeps validated SubMission/path provenance and uses graph order for the family", async () => {
    const dataDir = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "sr-story-resolver-"));
    await Promise.all([
      mkdir(join(dataDir, "ExcelOutput"), { recursive: true }),
      mkdir(join(dataDir, "TextMap"), { recursive: true }),
      mkdir(join(dataDir, "Story", "Mission", "1000101"), { recursive: true }),
      mkdir(join(dataDir, "Story", "Discussion"), { recursive: true }),
    ]);
    const files: Record<string, unknown> = {
      "TextMap/TextMapCHS.json": {
        "1": "星穹列车",
        "2": "序章",
        "3": "三月七",
        "4": "快醒醒！",
        "5": "第一项任务",
        "6": "前往车厢",
        "7": "沿着站台前进。",
      },
      "ExcelOutput/MainMission.json": [
        {
          MainMissionID: 1000101,
          Type: "Main",
          WorldID: 101,
          ChapterID: 100001,
          Name: { Hash: 5 },
          NextTrackMainMission: 1000102,
        },
        {
          MainMissionID: 1000102,
          Type: "Main",
          WorldID: 101,
          ChapterID: 100001,
          Name: { Hash: 5 },
        },
      ],
      "ExcelOutput/SubMission.json": [
        {
          SubMissionID: 100010101,
          TargetText: { Hash: 6 },
          DescrptionText: { Hash: 7 },
        },
      ],
      "ExcelOutput/TalkSentenceConfig.json": [
        {
          TalkSentenceID: 50001,
          TextmapTalkSentenceName: { Hash: 3 },
          TalkSentenceText: { Hash: 4 },
        },
      ],
      "ExcelOutput/WorldDataConfig.json": [{ ID: 101, WorldName: { Hash: 1 } }],
      "ExcelOutput/MissionChapterConfig.json": [
        { ID: 100001, ChapterSequence: { Hash: 2 }, OriginMainMission: 1000101 },
      ],
      "Story/Mission/1000101/Story100010101.json": {
        OnStartSequece: [{ TaskList: [{ TalkSentenceID: 50001 }] }],
      },
    };
    for (const [relativePath, value] of Object.entries(files)) {
      const fullPath = join(dataDir, relativePath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, JSON.stringify(value), "utf8");
    }

    const inventory = await buildStarRailInventory({ dataDir, sourceRef: "test" });
    const textMap = new StarRailTextMapResolver({ dataDir, inventory, locale: "CHS" });
    await textMap.load();
    const worldChapter = new StarRailWorldChapterResolver({ dataDir, resolver: textMap });
    const result = await new StarRailStoryResolver({
      dataDir,
      sourceRef: "test",
      inventory,
      resolver: textMap,
      worldChapterResolver: worldChapter,
    }).resolveQuests();

    const quest = result.quests.find((item) => item.mainMissionId === 1000101);
    expect(quest).toBeDefined();
    expect(quest).toMatchObject({
      contentRole: "story",
      dialogueResolutionStatus: "resolved",
      topology: { childMissionIds: [1000102], storyOrder: 1 },
    });
    expect(quest?.dialogueNodes).toHaveLength(1);
    expect(quest?.subMissions[0]?.mainMissionId).toBe(1000101);
    expect(quest?.provenance.sourceBindings).toEqual([
      expect.objectContaining({
        relationType: "story_path_main_and_sub_mission_id",
        subMissionId: 100010101,
        confidence: 1,
      }),
    ]);
    const aggregate = result.quests.find((item) => item.mainMissionId === 1000102);
    expect(aggregate).toMatchObject({
      contentRole: "aggregate",
      dialogueResolutionStatus: "not_applicable",
      qualityCode: "aggregate",
    });
  });
});
