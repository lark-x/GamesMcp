import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { NormalizedRecord } from "@gip/domain";
import { validateNormalizedRecords } from "@gip/domain";
import {
  bookStableId,
  convertAnimeGameData,
  documentStableId,
  segmentBookBody,
  segmentStableId,
  volumeStableId,
} from "./anime-game-data-converter.js";

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
      segments: [
        {
          ordinal: 0,
          headingPath: ["测试书目", "测试书名"],
          segmentKey: "document/book/1/volume/9001/segment/1",
        },
      ],
    });
    expect(result.records.books[0]?.metadata).toMatchObject({
      bookStableId: "book/1",
      volumeStableId: "book/1/volume/9001",
      documentStableId: "document/book/1/volume/9001",
    });
    expect(result.records.books[1]).toMatchObject({
      sourceKey: "book/7003",
      segments: [
        {
          headingPath: ["测试书目", "测试书目·卷二"],
          segmentKey: "document/book/1/volume/9005/segment/1",
        },
      ],
    });
    expect(result.records.books[1]?.metadata).toMatchObject({
      bookStableId: "book/1",
      volumeStableId: "book/1/volume/9005",
      documentStableId: "document/book/1/volume/9005",
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

  it("creates stable volume and paragraph-group segment identities", () => {
    const bookId = bookStableId(42);
    const volumeId = volumeStableId(bookId, 9001);
    const documentId = documentStableId(volumeId);
    const body = Array.from({ length: 3 }, (_, index) => `${"段落内容".repeat(700)}${index}`).join(
      "\n\n",
    );
    const first = segmentBookBody("测试书目", "测试书目·卷一", body, documentId, {
      bookStableId: bookId,
      volumeStableId: volumeId,
    });
    const second = segmentBookBody("测试书目", "测试书目·卷一", body, documentId, {
      bookStableId: bookId,
      volumeStableId: volumeId,
    });

    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      headingPath: ["测试书目", "测试书目·卷一", "段落组 1"],
      segmentKey: segmentStableId(documentId, 0),
    });
    expect(new Set(first.map((segment) => segment.segmentKey)).size).toBe(first.length);
    expect(first.every((segment) => segment.endOffset > segment.startOffset)).toBe(true);

    const combined = segmentBookBody(
      "测试书目",
      "测试书目·卷一",
      "卷一\n第一卷正文\n\n卷二\n第二卷正文",
      documentId,
      { bookStableId: bookId, volumeStableId: volumeId },
    );
    expect(combined.map((segment) => segment.headingPath)).toEqual([
      ["测试书目", "卷一"],
      ["测试书目", "卷二"],
    ]);
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
