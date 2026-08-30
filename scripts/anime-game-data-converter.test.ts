import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { NormalizedRecord } from "@gip/domain";
import { validateNormalizedRecords } from "@gip/domain";
import { convertAnimeGameData } from "./anime-game-data-converter.js";

// URL.pathname starts with `/D:/...` on Windows.  Convert the fixture URL to
// the native filesystem path so the converter receives the same kind of path
// that the CLI obtains from DATA_DIR/ANIME_GAME_DATA_DIR.
const fixtureDir = fileURLToPath(new URL("../data/fixtures/anime-game-data", import.meta.url));

describe("AnimeGameData converter", () => {
  it("uses the confirmed association chains and accounts for every fixture row", async () => {
    const result = await convertAnimeGameData({
      upstreamDir: fixtureDir,
      context: {
        upstreamCommit: "fixture-commit",
        upstreamVersion: "CNRELWin7.0.0_fixture",
        gameVersion: "7.0.0",
      },
    });
    expect(result.manifest.unexplainedMissing).toEqual([]);
    expect(result.manifest.accountedCoverage).toEqual({
      books: 1,
      characterStories: 1,
      itemDescriptions: 1,
    });
    expect(result.records.books[0]).toMatchObject({
      sourceKey: "book/7001",
      title: "测试书名",
      body: "书籍正文\n第二段",
    });
    expect(result.records.characterStories[0]).toMatchObject({
      sourceKey: "character/10001/story/101",
      body: "角色故事正文\n第二行",
    });
    expect(result.records.items[0]).toMatchObject({
      sourceKey: "item-codex/30001",
      body: "材料描述\n\n材料特殊效果",
    });
    expect(result.records.characterStories[0]?.entities?.[0]).toMatchObject({
      sourceKey: "character/10001",
      type: "character",
    });
    expect(result.records.items[0]?.entities?.[0]).toMatchObject({
      sourceKey: "item/20001",
      type: "item",
    });
    expect(result.records.books[0]?.metadata.verificationRiskFlags).toContain("format_tags");
    expect(result.records.items[0]?.metadata.verificationRiskFlags).toContain(
      "duplicate_item_mapping",
    );
    for (const record of [
      ...result.records.books,
      ...result.records.characterStories,
      ...result.records.items,
    ]) {
      expect(record.metadata.lineage.title).toMatchObject({
        relativeFile: "TextMap/TextMap_MediumCHS.json",
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        readablePath: null,
      });
      expect(record.metadata.rawHash).toMatch(/^[0-9a-f]{64}$/);
      expect(record.metadata.normalizedHash).toBe(record.contentHash);
      expect(record.metadata.verificationRiskFlags).toEqual(expect.any(Array));
    }
    expect(result.records.books[0]?.metadata.lineage).toHaveProperty("localization");
    expect(result.records.books[0]?.metadata.readableFile).toBe("Readable/CHS/FixtureBook.txt");
    expect(result.records.characterStories[0]?.metadata.textMapHashes).toMatchObject({
      title: 1003,
      body: 1004,
    });
    expect(result.records.items[0]?.metadata.upstreamIds).toMatchObject({
      codexId: 30001,
      materialId: 20001,
    });
    expect(result.manifest.failures).toEqual(
      expect.arrayContaining([
        { category: "book", upstreamId: "7999", reason: "document_missing" },
        { category: "character_story", upstreamId: "10001:103", reason: "title_missing" },
        { category: "item_description", upstreamId: "30002", reason: "material_missing" },
      ]),
    );
  });

  it("is deterministic for the same fixture and context", async () => {
    const options = {
      upstreamDir: fixtureDir,
      context: {
        upstreamCommit: "fixture-commit",
        upstreamVersion: "CNRELWin7.0.0_fixture",
        gameVersion: "7.0.0",
      },
    } as const;
    const first = await convertAnimeGameData(options);
    const second = await convertAnimeGameData(options);
    expect(first.records).toEqual(second.records);
    expect(first.manifest).toEqual(second.manifest);
  });

  it("matches the domain NormalizedRecord entity contract", async () => {
    const result = await convertAnimeGameData({
      upstreamDir: fixtureDir,
      context: {
        upstreamCommit: "fixture-commit",
        upstreamVersion: "CNRELWin7.0.0_fixture",
        gameVersion: "7.0.0",
      },
    });
    const records = [
      ...result.records.books,
      ...result.records.characterStories,
      ...result.records.items,
    ] as unknown as NormalizedRecord[];
    expect(
      records.flatMap((record) => record.entities ?? []).every((entity) => "type" in entity),
    ).toBe(true);
    expect(
      validateNormalizedRecords(records).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });
});
