import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnimeContext } from "../context.js";
import { TextResolver } from "../text-resolver.js";
import { ItemTextExtractor } from "./extractor.js";

const fixtureRoot = resolve("data/fixtures/anime-game-data");
const materialPath = "ExcelBinOutput/MaterialExcelConfigData.json";
const codexPath = "ExcelBinOutput/MaterialCodexExcelConfigData.json";

type JsonObject = Record<string, unknown>;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function fixtureRows(
  materialRows?: JsonObject[],
  codexRows?: JsonObject[],
): Promise<{ materialRows: JsonObject[]; codexRows: JsonObject[] }> {
  return {
    materialRows: materialRows ?? (await readJson<JsonObject[]>(join(fixtureRoot, materialPath))),
    codexRows: codexRows ?? (await readJson<JsonObject[]>(join(fixtureRoot, codexPath))),
  };
}

async function makeFixture(materialRows?: JsonObject[], codexRows?: JsonObject[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anime-game-item-text-"));
  await mkdir(join(root, "ExcelBinOutput"), { recursive: true });
  const rows = await fixtureRows(materialRows, codexRows);
  await Promise.all([
    writeFile(join(root, materialPath), JSON.stringify(rows.materialRows, null, 2)),
    writeFile(join(root, codexPath), JSON.stringify(rows.codexRows, null, 2)),
  ]);
  return root;
}

async function makeContext(
  upstreamDir: string,
  textOverrides: Record<string, string> = {},
): Promise<AnimeContext> {
  const textMap = await readJson<Record<string, unknown>>(
    join(fixtureRoot, "TextMap/TextMap_MediumCHS.json"),
  );
  return {
    upstreamDir,
    upstreamCommit: "fixture-commit",
    upstreamVersion: "fixture-version",
    gameVersion: "7.0.0-fixture",
    locale: "zh-CN",
    textResolver: new TextResolver({
      maps: [{ locale: "zh-CN", values: { ...textMap, ...textOverrides } }],
    }),
    inputHashes: {},
  };
}

async function withFixture<T>(
  materialRows: JsonObject[] | undefined,
  codexRows: JsonObject[] | undefined,
  callback: (upstreamDir: string) => Promise<T>,
): Promise<T> {
  const root = await makeFixture(materialRows, codexRows);
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("ItemTextExtractor", () => {
  it("maps Material item types and joins Codex story text", async () => {
    const rows = await fixtureRows();
    const virtualRow = {
      ...(rows.materialRows[0] ?? {}),
      id: 20003,
      itemType: "ITEM_VIRTUAL",
    };

    await withFixture([...rows.materialRows, virtualRow], rows.codexRows, async (upstreamDir) => {
      const result = await new ItemTextExtractor().extract(await makeContext(upstreamDir));

      expect(result.records).toHaveLength(3);
      expect(result.records[0]).toMatchObject({
        stableId: "item/20001",
        upstreamId: "20001",
        itemType: "material",
        name: "测试材料",
        description: "材料描述",
        specialDescription: "材料特殊效果",
        storyText: "材料描述",
        rarity: 2,
        textResolution: { method: "textmap", locale: "zh-CN", resolved: true },
      });
      expect(result.records.find((record) => record.stableId === "item/20003")).toMatchObject({
        itemType: "currency",
      });
      expect(result.records.find((record) => record.stableId === "item/20002")).toMatchObject({
        rarity: null,
      });
      expect(result.stats).toMatchObject({
        "itemType.material": 1,
        "itemType.currency": 1,
        "itemType.other": 1,
      });
      expect(result.coverage).toMatchObject({ discovered: 3, converted: 3, failed: 0 });
    });
  });

  it("keeps a missing name null without fabricating a value", async () => {
    const materialRows = [
      {
        id: 21001,
        itemType: "ITEM_MATERIAL",
        nameTextMapHash: 999999,
        descTextMapHash: 1008,
        rankLevel: 2,
      },
    ];

    await withFixture(materialRows, [], async (upstreamDir) => {
      const result = await new ItemTextExtractor().extract(await makeContext(upstreamDir));

      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        stableId: "item/21001",
        name: null,
        description: "材料描述",
        specialDescription: null,
        storyText: null,
        rarity: 2,
        textResolution: { method: "textmap", locale: "zh-CN", resolved: false },
      });
      expect(result.fieldCoverage.missingName).toBe(1);
      expect(result.failures).toHaveLength(0);
    });
  });

  it("maps an unknown upstream item type to other and records a warning", async () => {
    const materialRows = [
      {
        id: 22001,
        itemType: "ITEM_FUTURE_UNKNOWN",
        nameTextMapHash: 1006,
        descTextMapHash: 1008,
      },
    ];

    await withFixture(materialRows, [], async (upstreamDir) => {
      const result = await new ItemTextExtractor().extract(await makeContext(upstreamDir));

      expect(result.records[0]?.itemType).toBe("other");
      expect(result.warnings).toContainEqual({
        code: "unknown_item_type",
        message: "Unknown MaterialExcelConfigData itemType ITEM_FUTURE_UNKNOWN; mapped to other.",
        upstreamId: "22001",
      });
      expect(result.stats["itemType.other"]).toBe(1);
      expect(result.fieldCoverage.unknownItemType).toBe(1);
    });
  });

  it("splits long story text at paragraph boundaries only", async () => {
    const storyText = ["甲".repeat(1_300), "乙".repeat(1_300)].join("\n\n");
    const materialRows = [
      {
        id: 23001,
        itemType: "ITEM_MATERIAL",
        nameTextMapHash: 1006,
        descTextMapHash: 1008,
      },
    ];
    const codexRows = [{ id: 33001, materialId: 23001, descTextMapHash: 9001 }];

    await withFixture(materialRows, codexRows, async (upstreamDir) => {
      const result = await new ItemTextExtractor().extract(
        await makeContext(upstreamDir, { "9001": storyText }),
      );
      const record = result.records[0];

      expect(record?.storyText).toBe(storyText);
      expect(record?.segments).toHaveLength(2);
      expect(record?.segments?.[0]).toMatchObject({
        segmentStableId: "item/23001/segment/1",
        order: 0,
      });
      expect(record?.segments?.map((segment) => segment.body).join("\n\n")).toBe(storyText);
      expect(result.stats.segmentedRecords).toBe(1);
    });
  });

  it("builds a deterministic manifest for repeated extraction", async () => {
    await withFixture(undefined, undefined, async (upstreamDir) => {
      const extractor = new ItemTextExtractor();
      const first = await extractor.extract(await makeContext(upstreamDir));
      const second = await extractor.extract(await makeContext(upstreamDir));

      expect(first.manifest).toEqual(second.manifest);
      expect(first.manifest.contentHash).toHaveLength(64);
      expect(first.manifest.stats).toEqual(first.stats);
      expect(first.manifest).toMatchObject({
        extractor: "anime-game-data-item-text",
        upstreamCommit: "fixture-commit",
        gameVersion: "7.0.0-fixture",
        locale: "zh-CN",
      });
    });
  });
});
