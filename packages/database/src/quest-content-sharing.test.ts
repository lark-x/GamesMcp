import { describe, expect, it } from "vitest";
import type { NormalizedRecord } from "@gip/domain";
import { buildSharedQuestContentPack } from "./quest-content-sharing.js";

const GAME_ID = "genshin-fixture";

function fixture(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    sourceKey: "quest/74001/locale/zh-CN",
    recordType: "quest",
    documentType: "world_quest",
    title: "任务标题",
    body: "安：你好，派蒙。",
    locale: "zh-CN",
    metadata: { storyProjection: { familyId: "old-family" } },
    parserVersion: "quest-parser-v2",
    contentHash: "source-record-hash",
    segments: [
      {
        segmentKey: "talk/7400101",
        ordinal: 0,
        headingPath: ["第一幕"],
        body: "你好，派蒙。",
        startOffset: 0,
        endOffset: 7,
        metadata: {},
      },
    ],
    entities: [
      {
        sourceKey: "npc/1",
        name: "派蒙",
        type: "npc",
      },
    ],
    quest: {
      questKey: "quest/74001/locale/zh-CN",
      mainQuestId: "74001",
      questType: "world_quest",
      locale: "zh-CN",
      completeness: "complete",
      subquests: [
        {
          subquestKey: "subquest/7400101",
          subquestId: "7400101",
          title: "第一幕",
          order: 0,
          completeness: "complete",
        },
      ],
      dialogueNodes: [
        {
          nodeKey: "quest/74001/talk/7400101/dialog/1",
          nodeId: "1",
          type: "dialogue",
          subquestKey: "subquest/7400101",
          speakerKey: "npc/1",
          speakerName: "派蒙",
          body: "你好，派蒙。",
          segmentKey: "talk/7400101",
          order: 0,
        },
      ],
      dialogueEdges: [],
      storyProjection: { schemaVersion: 1, familyId: "new-family", familyTitle: "新系列" },
    },
    ...overrides,
  };
}

describe("shared quest content packs", () => {
  it("excludes catalog placement and parser release metadata from text identity", () => {
    const base = buildSharedQuestContentPack(fixture(), GAME_ID)!;
    const moved = fixture({
      title: "另一种目录标题",
      parserVersion: "quest-parser-v3",
      metadata: { storyProjection: { familyId: "different-family" }, topology: { order: 9 } },
      quest: {
        ...fixture().quest!,
        storyProjection: { schemaVersion: 1, familyId: "different-family" },
      },
    });
    expect(buildSharedQuestContentPack(moved, GAME_ID)?.contentHash).toBe(base.contentHash);
  });

  it("changes identity when dialogue content changes and keeps segment references stable", () => {
    const base = buildSharedQuestContentPack(fixture(), GAME_ID)!;
    const changed = fixture({
      quest: {
        ...fixture().quest!,
        dialogueNodes: [
          {
            ...fixture().quest!.dialogueNodes[0]!,
            body: "内容有变化。",
          },
        ],
      },
    });
    expect(buildSharedQuestContentPack(changed, GAME_ID)?.contentHash).not.toBe(base.contentHash);
    expect(base.dialogueNodes[0]?.segmentId).toBe(base.segments[0]?.id);
    expect(base.mentions[0]).toMatchObject({
      segmentId: base.segments[0]?.id,
      entitySourceKey: "npc/1",
      rawText: "派蒙",
    });
  });

  it("keeps localized payloads distinct even when their visible text happens to match", () => {
    expect(buildSharedQuestContentPack(fixture({ locale: "en" }), GAME_ID)?.contentHash).not.toBe(
      buildSharedQuestContentPack(fixture(), GAME_ID)?.contentHash,
    );
  });

  it("keeps identical-looking content isolated between games", () => {
    expect(buildSharedQuestContentPack(fixture(), "genshin")?.contentHash).not.toBe(
      buildSharedQuestContentPack(fixture(), "starrail")?.contentHash,
    );
  });
});
