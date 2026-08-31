import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { convertQuestSnapshot } from "./anime-game-data-quest-converter.js";

describe("AnimeGameData quest converter", () => {
  it("creates deterministic bilingual quest records with structured dialogue", async () => {
    const first = await convertQuestSnapshot({
      upstreamDir: resolve("data/fixtures/anime-game-data-quests"),
      context: {
        upstreamCommit: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
        upstreamCommitDate: "2026-08-01T00:00:00.000Z",
        gameVersion: "7.0.0",
        upstreamVersionLabel: "CNRELWin7.0.0",
      },
    });
    const second = await convertQuestSnapshot({
      upstreamDir: resolve("data/fixtures/anime-game-data-quests"),
      context: {
        upstreamCommit: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
        upstreamCommitDate: "2026-08-01T00:00:00.000Z",
        gameVersion: "7.0.0",
        upstreamVersionLabel: "CNRELWin7.0.0",
      },
    });

    expect(first.records).toEqual(second.records);
    expect(first.manifest.failures).toEqual([]);
    expect(first.manifest.counts).toMatchObject({
      mainQuests: 1,
      documents: { "zh-CN": 1, en: 1 },
      subquests: 2,
      dialogueNodes: 4,
      dialogueEdges: 2,
    });
    expect(first.records.map((record) => record.sourceKey).sort()).toEqual([
      "quest/1001/locale/en",
      "quest/1001/locale/zh-CN",
    ]);
    expect(first.records[0]?.quest?.dialogueEdges[0]).toMatchObject({
      fromNodeKey: "quest/1001/dialog/1",
      toNodeKey: "quest/1001/dialog/2",
      type: "next",
    });
    expect(first.records.every((record) => record.segments?.length === 2)).toBe(true);
    expect(first.records.every((record) => record.metadata.provenance)).toBe(true);
  });
});
