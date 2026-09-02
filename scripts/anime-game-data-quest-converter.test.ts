import { describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyQuestVisibility,
  convertQuestSnapshot,
  questType,
} from "./anime-game-data-quest-converter.js";

const fixture = resolve("data/fixtures/anime-game-data-quests");

async function withFixtureVariant(
  mutate: (root: string) => Promise<void>,
): Promise<Awaited<ReturnType<typeof convertQuestSnapshot>>> {
  const root = await mkdtemp(join(tmpdir(), "anime-game-data-quests-"));
  await cp(fixture, root, { recursive: true });
  try {
    await mutate(root);
    return await convertQuestSnapshot({
      upstreamDir: root,
      context: {
        upstreamCommit: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
        upstreamCommitDate: "2026-08-01T00:00:00.000Z",
        gameVersion: "7.0.0",
        upstreamVersionLabel: "CNRELWin7.0.0",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function updateJson<T>(root: string, relativePath: string, mutate: (value: T) => T) {
  const path = join(root, relativePath);
  const value = JSON.parse(await readFile(path, "utf8")) as T;
  await writeFile(path, JSON.stringify(mutate(value), null, 2) + "\n");
}

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
    expect(first.manifest.schemaVersion).toBe(2);
    expect(first.manifest.converterVersion).toBe("anime-game-data-quests-v1");
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
    expect(first.records.every((record) => record.quest?.visibility === "public")).toBe(true);
    expect(first.records.every((record) => record.quest?.completeness === "complete")).toBe(true);
    expect(first.records.every((record) => record.quest?.completenessReasons?.length === 0)).toBe(
      true,
    );
    expect(first.records[0]?.metadata).toMatchObject({
      titleResolutionMethod: "textmap_direct",
      titleResolutionLocale: first.records[0]?.locale,
    });
    expect(first.records[0]?.quest).toMatchObject({
      chapterId: "1",
      chapterTitle: "序章",
      seriesTitle: "Prologue",
    });
    expect(first.manifest.accounting.accountedCoverage).toBe(1);
  });

  it("records the title fallback chain and resolution locale", async () => {
    const codexFallback = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, titleTextMapHash: 99901 })),
      );
    });
    expect(codexFallback.records[0]?.metadata).toMatchObject({
      titleResolutionMethod: "codex_fallback",
      titleResolutionLocale: "zh-CN",
    });

    const chapterDerived = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, titleTextMapHash: 99901 })),
      );
      await updateJson<JsonRow>(root, "BinOutput/CodexQuest/1001.json", (row) => ({
        ...row,
        HEDPNHPBMJH: 99902,
      }));
    });
    expect(chapterDerived.records[0]?.metadata).toMatchObject({
      titleResolutionMethod: "chapter_derived",
      titleResolutionLocale: "zh-CN",
    });
    expect(chapterDerived.records[0]?.title).toBe("序章");
  });

  it("maps unknown quest types to other and records a warning", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, type: "future_quest_type" })),
      );
    });
    expect(result.records.every((record) => record.quest?.questType === "other")).toBe(true);
    expect(result.records.every((record) => record.documentType === "other")).toBe(true);
    expect(result.manifest.counts.discoveredByType.other).toBe(1);
    expect(result.manifest.warnings).toContainEqual({
      sourceKey: "quest/1001",
      warning: "unknown_quest_type:future_quest_type",
    });
  });

  it("covers commission and hangout quest type aliases", () => {
    expect(questType("commission_quest")).toBe("commission");
    expect(questType("HANGOUT")).toBe("hangout");
    expect(questType("WQ")).toBe("world_quest");
  });

  it("maps unknown showType to unresolved and records a warning", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, showType: "QUEST_FUTURE" })),
      );
    });
    expect(classifyQuestVisibility({ showType: "QUEST_FUTURE" }, "标题")).toBe(
      "unresolved_show_type",
    );
    expect(result.records).toEqual([]);
    expect(result.manifest.warnings).toEqual(
      expect.arrayContaining([
        { sourceKey: "quest/1001/locale/zh-CN", warning: "unknown_show_type:QUEST_FUTURE" },
        { sourceKey: "quest/1001/locale/en", warning: "unknown_show_type:QUEST_FUTURE" },
      ]),
    );
    expect(result.manifest.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "quest/1001/locale/zh-CN",
          reason: "unresolved_show_type",
        }),
      ]),
    );
  });

  it("classifies completeness and emits explicit missing-content reasons", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow>(root, "BinOutput/CodexQuest/1001.json", (row) => ({
        ...row,
        EBNBLBEIFFJ: [],
      }));
    });
    expect(result.manifest.completenessReasons).toEqual(
      expect.arrayContaining([
        { sourceKey: "quest/1001/locale/zh-CN", reasons: ["missingDialogue"] },
        { sourceKey: "quest/1001/locale/en", reasons: ["missingDialogue"] },
      ]),
    );
    expect(result.manifest.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "incomplete_content:partial:missingDialogue" }),
      ]),
    );
  });

  it("classifies temporary rows without relying on numeric id guesses", () => {
    expect(classifyQuestVisibility({ showType: "QUEST_HIDDEN" }, "可见标题")).toBe(
      "hidden_show_type",
    );
    expect(classifyQuestVisibility({}, "测试任务$HIDDEN")).toBe("hidden_show_type");
    expect(classifyQuestVisibility({}, "Quest 12345")).toBe("unresolved_title");
    expect(classifyQuestVisibility({}, "真实任务")).toBe("public");
  });
});

type JsonRow = Record<string, unknown>;
