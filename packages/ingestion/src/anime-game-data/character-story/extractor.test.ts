import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TextResolver } from "../text-resolver.js";
import { CharacterStoryExtractor, segmentCharacterStoryBody } from "./extractor.js";
import type { AnimeContext } from "../context.js";

const fixtureRoot = resolve(process.cwd(), "data/fixtures/anime-game-data");

async function context(upstreamDir = fixtureRoot): Promise<AnimeContext> {
  const textMap = JSON.parse(
    await readFile(join(upstreamDir, "TextMap/TextMap_MediumCHS.json"), "utf8"),
  ) as Record<string, unknown>;
  return {
    upstreamDir,
    upstreamCommit: "fixture-commit",
    upstreamVersion: "fixture-version",
    gameVersion: "7.0.0-fixture",
    locale: "zh-CN",
    textResolver: new TextResolver({
      maps: [{ locale: "zh-CN", values: textMap }],
    }),
    inputHashes: {},
  };
}

describe("CharacterStoryExtractor", () => {
  it("resolves character names, story title/body, and stable IDs", async () => {
    const result = await new CharacterStoryExtractor().extract(await context());

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      characterStableId: "char/10001",
      characterName: "星海旅人",
      storyStableId: "char/10001/story/101",
      title: "第一章",
      body: "角色故事正文\n第二行",
      unlockMetadata: {},
      textResolution: { method: "textmap", locale: "zh-CN", resolved: true },
    });
    expect(result.coverage).toMatchObject({ discovered: 4, converted: 1, failed: 3 });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "duplicate_story_id" }));
    expect(Object.keys(result.inputHashes)).toEqual([
      "ExcelBinOutput/AvatarExcelConfigData.json",
      "ExcelBinOutput/FetterInfoExcelConfigData.json",
      "ExcelBinOutput/FetterStoryExcelConfigData.json",
    ]);
  });

  it("accounts for an unresolved title without fabricating a record", async () => {
    const result = await new CharacterStoryExtractor().extract(await context());

    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "title_missing", upstreamId: "10001:103" }),
    );
    expect(result.fieldCoverage.missingTitle).toBe(1);
    expect(result.records.some((record) => record.storyStableId.endsWith("/103"))).toBe(false);
  });

  it("splits long bodies into deterministic paragraph groups", () => {
    const paragraph = "段".repeat(900);
    const body = [paragraph, paragraph, paragraph].join("\n\n");
    const first = segmentCharacterStoryBody("char/10001/story/999", "星海旅人", "长篇", body);
    const second = segmentCharacterStoryBody("char/10001/story/999", "星海旅人", "长篇", body);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      segmentStableId: "char/10001/story/999/segment/1",
      headingPath: ["星海旅人", "长篇", "段落组 1"],
      order: 0,
    });
    expect(first[1]?.order).toBe(1);
    expect(first.map((segment) => segment.body).join("\n\n")).toBe(body);
  });

  it("builds the same manifest for repeated extraction", async () => {
    const extractor = new CharacterStoryExtractor();
    const first = await extractor.extract(await context());
    const second = await extractor.extract(await context());

    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest.contentHash).toHaveLength(64);
    expect(first.manifest).toMatchObject({
      extractor: "anime-game-data-character-story",
      upstreamCommit: "fixture-commit",
      gameVersion: "7.0.0-fixture",
      locale: "zh-CN",
    });
  });
});
