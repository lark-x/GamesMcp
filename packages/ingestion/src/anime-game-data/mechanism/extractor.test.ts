import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnimeContext } from "../context.js";
import { TextResolver } from "../text-resolver.js";
import { MECHANISM_INPUTS, MechanismExtractor, mapMechanismCategory } from "./extractor.js";

type JsonObject = Record<string, unknown>;

const sourcePath = MECHANISM_INPUTS.tutorial;

async function makeFixture(
  rows: JsonObject[] = [
    { id: 1, category: "COMBAT", titleTextMapHash: 1001, contentTextMapHash: 1002 },
  ],
  textMap: Record<string, string> = { "1001": "教程标题", "1002": "教程正文" },
  includeSource = true,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anime-mechanism-extractor-"));
  await mkdir(join(root, "TextMap"), { recursive: true });
  await writeFile(join(root, "TextMap/TextMap_MediumCHS.json"), JSON.stringify(textMap, null, 2));
  if (includeSource) {
    await mkdir(join(root, "ExcelBinOutput"), { recursive: true });
    await writeFile(join(root, sourcePath), JSON.stringify(rows, null, 2));
  }
  return root;
}

async function context(upstreamDir: string): Promise<AnimeContext> {
  const textMap = JSON.parse(
    await readFile(join(upstreamDir, "TextMap/TextMap_MediumCHS.json"), "utf8"),
  ) as Record<string, unknown>;
  return {
    upstreamDir,
    upstreamCommit: "fixture-commit",
    upstreamVersion: "fixture-version",
    gameVersion: "7.0.0-fixture",
    locale: "zh-CN",
    textResolver: new TextResolver({ maps: [{ locale: "zh-CN", values: textMap }] }),
    inputHashes: {},
  };
}

describe("MechanismExtractor", () => {
  it("maps explicit source categories without guessing from text", async () => {
    const categories = [
      "combat",
      "elemental_reaction",
      "exploration",
      "enemy",
      "boss",
      "domain",
      "system",
      "crafting",
      "cooking",
      "fishing",
      "housing",
      "activity",
      "other",
    ] as const;
    const rows: JsonObject[] = categories.map((category, index) => ({
      id: index + 1,
      category: category.toUpperCase(),
      titleTextMapHash: 2000 + index * 2,
      contentTextMapHash: 2001 + index * 2,
      ...(category === "combat" ? { relatedEntities: ["enemy/2", "gadget/1"] } : {}),
    }));
    rows.push({
      id: 99,
      category: "NOT_A_SUPPORTED_CATEGORY",
      titleTextMapHash: 2200,
      contentTextMapHash: 2201,
    });
    rows.push({ id: 100, titleTextMapHash: 2202, contentTextMapHash: 2203 });
    const textMap = Object.fromEntries(
      rows.flatMap((row) => [
        [String(row.titleTextMapHash), `标题${String(row.id)}`],
        [String(row.contentTextMapHash), `正文${String(row.id)}`],
      ]),
    );
    const root = await makeFixture(rows, textMap);
    try {
      const result = await new MechanismExtractor().extract(await context(root));
      expect(result.coverage).toEqual({ discovered: 15, converted: 15, failed: 0, coverage: 1 });
      const expectedCategories: Array<[string, string]> = categories.map((category, index) => [
        `mechanism/Tutorial/${index + 1}`,
        category,
      ]);
      expect(
        new Map(result.records.map((record) => [record.mechanismStableId, record.category])),
      ).toEqual(
        new Map<string, string>([
          ...expectedCategories,
          ["mechanism/Tutorial/99", "other"],
          ["mechanism/Tutorial/100", "other"],
        ]),
      );
      expect(result.records[0]?.documentType).toBe("mechanism");
      expect(
        result.records.find(
          (record) => record.mechanismStableId === "mechanism/Tutorial/1",
        ),
      ).toMatchObject({
        relatedEntities: ["enemy/2", "gadget/1"],
        textResolution: { method: "textmap", locale: "zh-CN", resolved: true },
      });
      expect(result.fieldCoverage.unknownCategory).toBe(2);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "mechanism_category_unknown", upstreamId: "Tutorial/99" }),
          expect.objectContaining({ code: "mechanism_category_unknown", upstreamId: "Tutorial/100" }),
        ]),
      );
      expect(mapMechanismCategory({ category: "not-a-category" })).toBe("other");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not fabricate a title when its TextMap value is missing", async () => {
    const root = await makeFixture(
      [{ id: 7, category: "COMBAT", titleTextMapHash: 7001, contentTextMapHash: 7002 }],
      { "7002": "正文存在" },
    );
    try {
      const result = await new MechanismExtractor().extract(await context(root));
      expect(result.records).toEqual([]);
      expect(result.coverage).toEqual({ discovered: 1, converted: 0, failed: 1, coverage: 0 });
      expect(result.fieldCoverage.missingTitle).toBe(1);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ code: "title_missing", upstreamId: "Tutorial/7" }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a completely missing mechanism source honestly", async () => {
    const root = await makeFixture([], {}, false);
    try {
      const result = await new MechanismExtractor().extract(await context(root));
      expect(result.records).toEqual([]);
      expect(result.coverage).toEqual({ discovered: 0, converted: 0, failed: 0, coverage: 1 });
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "mechanism_source_missing",
          message: expect.stringContaining("discovered=0"),
        }),
      );
      expect(result.manifest).toMatchObject({ discovered: 0, converted: 0, failed: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds the same manifest for identical fixture inputs", async () => {
    const firstRoot = await makeFixture();
    const secondRoot = await makeFixture();
    try {
      const extractor = new MechanismExtractor();
      const first = await extractor.extract(await context(firstRoot));
      const second = await extractor.extract(await context(secondRoot));
      expect(first.manifest).toEqual(second.manifest);
      expect(first.manifest).toMatchObject({
        extractor: "anime-game-data-mechanism",
        upstreamCommit: "fixture-commit",
        gameVersion: "7.0.0-fixture",
        locale: "zh-CN",
      });
      expect(first.manifest.contentHash).toHaveLength(64);
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
