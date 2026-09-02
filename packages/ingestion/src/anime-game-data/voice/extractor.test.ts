import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { TextResolver } from "../text-resolver.js";
import type { AnimeContext } from "../context.js";
import { VoiceExtractor, parseRelatedEntityStableId } from "./extractor.js";

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

describe("VoiceExtractor", () => {
  it("resolves fixture voice title/body and keeps an unparseable relation null", async () => {
    const result = await new VoiceExtractor().extract(await context());

    expect(result.records).toEqual([
      {
        characterStableId: "char/10001",
        voiceStableId: "voice/15001",
        title: "初次见面…",
        body: "你好，我是星海旅人。",
        relatedEntityStableId: null,
        textResolution: { method: "textmap", locale: "zh-CN", resolved: true },
      },
    ]);
    expect(result.coverage).toMatchObject({ discovered: 1, converted: 1, failed: 0 });
  });

  it("parses only stable-ID-shaped About targets", () => {
    expect(parseRelatedEntityStableId("About char/10002")).toBe("char/10002");
    expect(parseRelatedEntityStableId("关于角色 10003")).toBe("char/10003");
    expect(parseRelatedEntityStableId("About Amber")).toBeNull();
  });

  it("reports an absent upstream voice source as zero discovered rows", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "anime-voice-extractor-"));
    try {
      await mkdir(join(temporaryRoot, "TextMap"), { recursive: true });
      await copyFile(
        join(fixtureRoot, "TextMap/TextMap_MediumCHS.json"),
        join(temporaryRoot, "TextMap/TextMap_MediumCHS.json"),
      );

      const result = await new VoiceExtractor().extract(await context(temporaryRoot));

      expect(result.records).toEqual([]);
      expect(result.coverage).toEqual({ discovered: 0, converted: 0, failed: 0, coverage: 1 });
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "voice_source_missing",
          message: expect.stringContaining("discovered=0"),
        }),
      );
      expect(result.manifest).toMatchObject({ discovered: 0, converted: 0, failed: 0 });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("builds a deterministic manifest for the fixture source", async () => {
    const extractor = new VoiceExtractor();
    const first = await extractor.extract(await context());
    const second = await extractor.extract(await context());

    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest.contentHash).toHaveLength(64);
    expect(first.manifest.extractor).toBe("anime-game-data-voice");
  });
});
