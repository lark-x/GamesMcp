import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  chapterStoryOrder,
  classifyQuestVisibility,
  convertQuestSnapshot,
  questType,
  regionIdFromPerformCfg,
  resolveArchonStoryFamily,
  resolveDialogSpeakerName,
  resolvePersonalLineStoryFamily,
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
    expect(first.manifest.schemaVersion).toBe(3);
    expect(first.manifest.converterVersion).toBe("anime-game-data-quests-v3");
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
    for (const locale of ["zh-CN", "en"]) {
      const anchor = first.records.find((record) => record.locale === locale);
      const persisted = anchor?.metadata.storyCatalogProjection as
        | {
            schemaVersion: number;
            regions: Array<{
              families: Array<{
                chapters: Array<{ quests: Array<{ questId: string; questType: string }> }>;
              }>;
            }>;
          }
        | undefined;
      expect(persisted?.schemaVersion).toBe(3);
      expect(
        persisted?.regions
          .flatMap((region) => region.families)
          .flatMap((family) => family.chapters)
          .flatMap((chapter) => chapter.quests),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ questId: "1001", questType: "archon_quest" }),
        ]),
      );
    }
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

  it("uses MainQuest.chapterId as exact chapter membership and the canonical group title", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, series: undefined })),
      );
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/ChapterExcelConfigData.json", (rows) =>
        rows.map((row) => ({
          ...row,
          groupId: 777,
          cityId: 4,
          chapterImageTitleTextMapHash: 10001,
          PACJEJCGPLN: [],
        })),
      );
    });

    const quest = result.records.find((record) => record.locale === "zh-CN")?.quest;
    expect(quest?.storyProjection).toMatchObject({
      familyId: "genshin:chapter-group:777",
      familyTitle: "捕风的异乡人",
      taskRegionId: "sumeru",
      taskRegionSource: "chapter_city",
    });
  });

  it("keeps unresolved region evidence explicit instead of guessing from a task title", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/ChapterExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, cityId: 999 })),
      );
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, type: "WQ", title: "蒙德的任务" })),
      );
    });

    const quest = result.records.find((record) => record.locale === "zh-CN")?.quest;
    expect(quest?.storyProjection).toMatchObject({
      taskRegionId: "other",
      taskRegionSource: "unresolved",
      taskRegionReason: "chapter_city_unmapped_and_no_unique_talk_perform_cfg_region",
      taskRegionConflicts: ["unmapped_chapter_city_id:999"],
    });
    expect(
      quest?.storyProjection?.taskRegionEvidence?.some((item) => item.endsWith("cityId=999")),
    ).toBe(true);
  });

  it("does not create a synthetic family when neither series nor chapter group is reliable", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, series: undefined })),
      );
    });

    const quest = result.records.find((record) => record.locale === "zh-CN")?.quest;
    const projection = result.records.find((record) => record.locale === "zh-CN")?.metadata
      .storyCatalogProjection as
      { regions: Array<{ families: unknown[]; quests: Array<{ questId: string }> }> } | undefined;
    expect(quest?.storyProjection?.familyId).toBeUndefined();
    expect(projection?.regions[0]?.families).toEqual([]);
    expect(projection?.regions[0]?.quests).toEqual(
      expect.arrayContaining([expect.objectContaining({ questId: "1001" })]),
    );
  });

  it("falls back to NPC names when dialogue speaker hashes are unresolved", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/DialogExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, talkRoleNameTextMapHash: 99999 })),
      );
      await updateJson<JsonRow>(root, "BinOutput/CodexQuest/1001.json", (row) => ({
        ...row,
        EBNBLBEIFFJ: ((row.EBNBLBEIFFJ as JsonRow[]) ?? []).map((group) => ({
          ...group,
          PEAKPGNONFA: ((group.PEAKPGNONFA as JsonRow[]) ?? []).map((line) => ({
            ...line,
            IILBCFJNPGA: { BNJEGIAOKGM: 99999, JOBGILDNLEL: "SpeakerMissing" },
          })),
        })),
      }));
    });

    expect(
      result.records.flatMap((record) =>
        (record.quest?.dialogueNodes ?? []).map((node) => node.speakerName),
      ),
    ).toEqual(["派蒙", "派蒙", "Paimon", "Paimon"]);
    expect(result.manifest.quality.speakerNpcFallbackNodes).toEqual({ "zh-CN": 2, en: 2 });
    expect(result.manifest.quality.speakerUnresolvedNodes).toEqual({ "zh-CN": 0, en: 0 });
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
    expect(questType("IQ")).toBe("commission");
    expect(questType("commission_quest")).toBe("commission");
    expect(questType("HANGOUT")).toBe("hangout");
    expect(questType("WQ")).toBe("world_quest");
  });

  it("uses the coop chapter style to classify hangout events", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/MainQuestExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, type: "LQ" })),
      );
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/ChapterExcelConfigData.json", (rows) =>
        rows.map((row) => ({ ...row, LINLPCFFGFC: "CHAPTER_STYLE_TYPE_COOP_QUEST" })),
      );
    });

    expect(result.records.every((record) => record.quest?.questType === "hangout")).toBe(true);
    expect(result.records.every((record) => record.documentType === "hangout")).toBe(true);
    expect(result.manifest.counts.discoveredByType.hangout).toBe(1);
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
    expect(result.records).toHaveLength(2);
    expect(result.records.every((record) => record.quest?.completeness === "partial")).toBe(true);
    expect(result.manifest.excluded).toEqual([]);
  });

  it("uses opaque quest-talk rows when legacy dialogue hashes are stale", async () => {
    const result = await withFixtureVariant(async (root) => {
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/TalkExcelConfigData_0.json", (rows) => [
        ...rows,
        { id: 43, initDialog: 3, questId: 1001 },
      ]);
      await updateJson<JsonRow[]>(root, "ExcelBinOutput/DialogExcelConfigData.json", (rows) => [
        ...rows,
        {
          GFLDJMJKIKE: 3,
          nextDialogs: [4],
          talkRole: { type: "TALK_ROLE_NONE", id: "" },
          talkContentTextMapHash: 99909,
        },
      ]);
      await updateJson<JsonRow>(root, "BinOutput/CodexQuest/1001.json", (row) => ({
        ...row,
        EBNBLBEIFFJ: [],
      }));
      await updateJson<Record<string, unknown>>(root, "TextMap/TextMapCHS.json", (map) => ({
        ...map,
        "10008": "来自新对白表的正文。",
      }));
      await updateJson<Record<string, unknown>>(root, "TextMap/TextMapEN.json", (map) => ({
        ...map,
        "10008": "Dialogue from the new table.",
      }));
      await mkdir(join(root, "BinOutput/Talk/Quest"), { recursive: true });
      await writeFile(
        join(root, "BinOutput/Talk/Quest/opaque.json"),
        JSON.stringify(
          {
            PFALHAKIILD: [
              {
                OIFGMOHKPOI: 3,
                KMLAFCBMFEI: [4],
                LFGCLPAPB: { _type: "TALK_ROLE_NONE", _id: "" },
                BKABCBAFIKD: 0,
                OACNIBLFFDI: 0,
              },
              {
                OIFGMOHKPOI: 4,
                KMLAFCBMFEI: [],
                LFGCLPAPB: { _type: "TALK_ROLE_NPC", _id: "2001" },
                BKABCBAFIKD: 10007,
                OACNIBLFFDI: 10008,
              },
            ],
          },
          null,
          2,
        ) + "\n",
      );
    });

    const zh = result.records.find((record) => record.locale === "zh-CN");
    expect(zh?.quest?.dialogueNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "来自新对白表的正文。",
          metadata: expect.objectContaining({
            sourceFile: "BinOutput/Talk/Quest/opaque.json",
          }),
        }),
      ]),
    );
    expect(zh?.quest?.dialogueNodes).toHaveLength(1);
  });

  it("classifies temporary rows without relying on numeric id guesses", () => {
    expect(classifyQuestVisibility({ showType: "QUEST_HIDDEN" }, "可见标题")).toBe(
      "hidden_show_type",
    );
    expect(classifyQuestVisibility({}, "测试任务$HIDDEN")).toBe("hidden_show_type");
    expect(classifyQuestVisibility({}, "Quest 12345")).toBe("unresolved_title");
    expect(classifyQuestVisibility({}, "真实任务")).toBe("public");
    expect(classifyQuestVisibility({ id: 5003 }, "真实任务")).toBe("test_or_placeholder");
    expect(classifyQuestVisibility({}, "开发任务(test)")).toBe("test_or_placeholder");
    expect(classifyQuestVisibility({}, "开发任务（test）")).toBe("test_or_placeholder");
    expect(classifyQuestVisibility({}, "隐藏任务(hide)")).toBe("test_or_placeholder");
    expect(classifyQuestVisibility({}, "Hidden Tears")).toBe("public");
    expect(classifyQuestVisibility({}, "Test of Courage")).toBe("public");
    expect(classifyQuestVisibility({}, "Tell Me, Mirror Mirror")).toBe("public");
    expect(classifyQuestVisibility({}, "Gliding Test Quest")).toBe("public");
    expect(classifyQuestVisibility({}, "Timaeus' Alchemy Tutorial")).toBe("public");
    expect(classifyQuestVisibility({}, "In Search of a Hidden Heart")).toBe("public");
  });

  it("extracts canonical regions from performCfg paths with version and event prefixes", () => {
    expect(regionIdFromPerformCfg("QuestDialogue/WQ/Fontaine_4006/Q400601")).toBe("fontaine");
    expect(regionIdFromPerformCfg("QuestDialogue/WQ/4.4HdjV4_40142/Q4014202")).toBe("liyue");
    expect(regionIdFromPerformCfg("QuestDialogue/EQ/V5.8YLYZ_40199/Q4019901")).toBe("natlan");
    expect(regionIdFromPerformCfg("QuestDialogue/EQ/V6.0ActivityNodKraiTour_40207/Q4020702")).toBe(
      "nod_krai",
    );
    expect(regionIdFromPerformCfg("QuestDialogue/WQ/Fishblaster_70535/Q7053502")).toBe("mondstadt");
    expect(regionIdFromPerformCfg("QuestDialogue/WQ/FishingJoy_70046/Q7004601")).toBe("fontaine");
    expect(regionIdFromPerformCfg("QuestDialogue/EQ/V5.7AutoChess_40204/Q4020401")).toBe("natlan");
    expect(regionIdFromPerformCfg("QuestDialogue/EQ/V6.5TradeShow_40239/Q4023903")).toBe(
      "nod_krai",
    );
    expect(regionIdFromPerformCfg("QuestDialogue/WQ/V4.5CatCafe_70539/Q7053901")).toBe("mondstadt");
    expect(regionIdFromPerformCfg(undefined)).toBeUndefined();
    expect(regionIdFromPerformCfg("invalid/path")).toBeUndefined();
  });

  it("resolves inner monologue to player_identity and prop objects to intentionally_nameless", () => {
    const mockInputs = {
      npcById: new Map([
        [
          "13394",
          {
            id: 13394,
            scriptDataPath: "Data/ScriptData/PropObject/SP_013",
            luaDataPath: "Actor/Npc/TempNPC",
          },
        ],
        [
          "99999",
          {
            id: 99999,
            scriptDataPath: "Data/ScriptData/PropObject/SP_014",
            luaDataPath: "Actor/Npc/TempNPC",
          },
        ],
        [
          "88888",
          {
            id: 88888,
            nameTextMapHash: 8888801,
          },
        ],
      ]),
    } as unknown as Parameters<typeof resolveDialogSpeakerName>[0];

    const textMapZh = {
      100: "（吊水箱的绳子被人做过手脚...）",
      101: "门似乎被锁住了，无法打开。",
      8888801: "普通NPC",
    };
    const textMapEn = {
      100: "(The rope holding the water tank was tampered with...)",
      101: "The door seems to be locked.",
      8888801: "Normal NPC",
    };

    // Case 1: Monologue inner thought on prop NPC -> player_identity
    const monologueZh = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_NPC", id: "13394" },
        talkContentTextMapHash: 100,
      },
      textMapZh,
      "zh-CN",
    );
    expect(monologueZh).toEqual({ value: "旅行者", method: "player_identity" });

    const monologueEn = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_NPC", id: "13394" },
        talkContentTextMapHash: 100,
      },
      textMapEn,
      "en",
    );
    expect(monologueEn).toEqual({ value: "Traveler", method: "player_identity" });

    // Case 2: Inanimate prop object without inner thought -> intentionally_nameless
    const propObject = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_NPC", id: "99999" },
        talkContentTextMapHash: 101,
      },
      textMapZh,
      "zh-CN",
    );
    expect(propObject).toEqual({ value: undefined, method: "intentionally_nameless" });

    // Case 3: Normal NPC with TextMap name -> npc_fallback
    const normalNpc = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_NPC", id: "88888" },
        talkContentTextMapHash: 101,
      },
      textMapZh,
      "zh-CN",
    );
    expect(normalNpc).toEqual({ value: "普通NPC", method: "npc_fallback" });

    // Case 4: Black screen and placeholder roles -> intentionally_nameless
    const blackScreen = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_BLACK_SCREEN" },
        talkContentTextMapHash: 101,
      },
      textMapZh,
      "zh-CN",
    );
    expect(blackScreen).toEqual({ value: undefined, method: "intentionally_nameless" });

    const placeholder = resolveDialogSpeakerName(
      mockInputs,
      {
        talkRole: { type: "TALK_ROLE_NPC", id: "{QuestNpcID}" },
        talkContentTextMapHash: 101,
      },
      textMapZh,
      "zh-CN",
    );
    expect(placeholder).toEqual({ value: undefined, method: "intentionally_nameless" });
  });

  it("determines correct chronological ordering in chapterStoryOrder", () => {
    // Act ordering: Act 1 < Act 2 < Act 3 < Act 4
    const act1 = chapterStoryOrder("第一幕");
    const act2 = chapterStoryOrder("第二幕");
    const act3 = chapterStoryOrder("第三幕");
    const act4 = chapterStoryOrder("第四幕");
    expect(act1).toBe(100);
    expect(act2).toBe(200);
    expect(act3).toBe(300);
    expect(act4).toBe(400);
    expect(act1! < act2! && act2! < act3! && act3! < act4!).toBe(true);

    // Prologue, interlude, epilogue
    const prologue = chapterStoryOrder("序曲");
    const prologueChapter = chapterStoryOrder("序章");
    const interlude = chapterStoryOrder("幕间");
    const interludeChapter = chapterStoryOrder("间章");
    const epilogue = chapterStoryOrder("尾声");
    expect(prologue).toBe(50);
    expect(prologueChapter).toBe(50);
    expect(interlude).toBe(550);
    expect(interludeChapter).toBe(550);
    expect(epilogue).toBe(9000);
    expect(prologue! < act1!).toBe(true);
    expect(act4! < interlude!).toBe(true);
    expect(interlude! < epilogue!).toBe(true);

    // English acts
    expect(chapterStoryOrder("Act I")).toBe(100);
    expect(chapterStoryOrder("Act II")).toBe(200);
    expect(chapterStoryOrder("Act IV")).toBe(400);

    // Compound Act + Chapter: Act priority ensures acts within a chapter don't collapse to chapter number
    expect(chapterStoryOrder("第四章 第一幕")).toBe(100);
    expect(chapterStoryOrder("第四章 第二幕")).toBe(200);

    // Chapters without acts
    expect(chapterStoryOrder("第一章")).toBe(100);
    expect(chapterStoryOrder("第四章")).toBe(400);

    // Fallback/empty
    expect(chapterStoryOrder(undefined)).toBeUndefined();
    expect(chapterStoryOrder("")).toBeUndefined();
    expect(chapterStoryOrder("散篇任务")).toBeUndefined();
  });

  it("resolves and unifies Archon Quest families across batches and chapters", () => {
    // Mondstadt Prologue
    const mondstadtZh = resolveArchonStoryFamily("1001", "序章 第一幕", "zh-CN");
    expect(mondstadtZh).toEqual({
      id: "genshin:aq:prologue",
      title: "魔神任务 · 序章「巨龙与自由之歌」",
      provenance: "derived",
      catalogRegionId: "mondstadt",
      familyOrder: 100,
    });
    const mondstadtEn = resolveArchonStoryFamily("1001", "Prologue: Act I", "en");
    expect(mondstadtEn?.title).toBe("Archon Quest · Prologue: Song of the Dragon and Freedom");

    // Liyue Chapter I
    const liyue = resolveArchonStoryFamily("1101", "第一章", "zh-CN");
    expect(liyue).toEqual({
      id: "genshin:aq:chapter-1",
      title: "魔神任务 · 第一章「辞行久远之躯」",
      provenance: "derived",
      catalogRegionId: "liyue",
      familyOrder: 100,
    });

    // Fontaine Chapter IV: 1400, 1401 and 1405 converge into same family
    const fontaine1400 = resolveArchonStoryFamily("1400", "第四章", "zh-CN");
    const fontaine1401 = resolveArchonStoryFamily("1401", "第四章 第一幕", "zh-CN");
    const fontaine1405 = resolveArchonStoryFamily("1405", "第四章 第五幕", "zh-CN");
    expect(fontaine1401).toEqual({
      id: "genshin:aq:chapter-4",
      title: "魔神任务 · 第四章「罪人舞步旋」",
      provenance: "derived",
      catalogRegionId: "fontaine",
      familyOrder: 100,
    });
    expect(fontaine1400?.id).toBe(fontaine1401?.id);
    expect(fontaine1405?.id).toBe(fontaine1401?.id);
    expect(fontaine1405?.title).toBe(fontaine1401?.title);

    // Nod-Krai / Welkin Moon: 1600 and 1611 converge into same family
    const nodKrai1600 = resolveArchonStoryFamily("1600", "空月之歌 第一幕", "zh-CN");
    const nodKrai1611 = resolveArchonStoryFamily("1611", "空月之歌", "zh-CN");
    const nodKraiChapter6 = resolveArchonStoryFamily("1600", "第六章 第一幕", "zh-CN");
    expect(nodKrai1600).toEqual({
      id: "genshin:aq:nod-krai",
      title: "魔神任务 · 空月之歌",
      provenance: "derived",
      catalogRegionId: "nod_krai",
      familyOrder: 100,
    });
    expect(nodKrai1611?.id).toBe(nodKrai1600?.id);
    expect(nodKrai1611?.title).toBe(nodKrai1600?.title);
    expect(nodKraiChapter6?.id).toBe(nodKrai1600?.id);

    // Interludes
    const interludeLiyue = resolveArchonStoryFamily("1205", "间章 第一幕", "zh-CN", 2);
    expect(interludeLiyue).toEqual({
      id: "genshin:aq:interlude:liyue",
      title: "魔神任务 · 间章",
      provenance: "derived",
      catalogRegionId: "liyue",
      familyOrder: 150,
    });
    const interludeSumeru = resolveArchonStoryFamily("1307", "间章", "zh-CN", 4);
    expect(interludeSumeru?.id).toBe("genshin:aq:interlude:sumeru");
    expect(interludeSumeru?.catalogRegionId).toBe("sumeru");

    // Strictly preserve non-AQ chapters: returns undefined
    const worldQuest = resolveArchonStoryFamily("99999", "森林书", "zh-CN");
    expect(worldQuest).toBeUndefined();
  });

  it("resolves personal line story family with character and chapter prefix", () => {
    const mockInputs = {
      textMaps: {
        "zh-CN": {
          1001: "艾梅莉埃",
          1002: "香氛瓶之章 第一幕",
        },
        en: {
          1001: "Emilie",
          1002: "Pomum de Ambra Chapter: Act I",
        },
      },
    } as unknown as Parameters<typeof resolvePersonalLineStoryFamily>[0];

    const personalLineZh = resolvePersonalLineStoryFamily(
      mockInputs,
      {
        LINLPCFFGFC: "CHAPTER_STYLE_TYPE_PERSONALLINE",
        chapterImageTitleTextMapHash: 1001,
        chapterNumTextMapHash: 1002,
        cityId: 5,
      },
      "2050",
      "第一幕 花与血的告别",
      "zh-CN",
    );
    expect(personalLineZh).toEqual({
      id: "genshin:personal-line:emilie",
      title: "艾梅莉埃 · 香氛瓶之章",
      provenance: "derived",
      catalogRegionId: "fontaine",
      familyOrder: 200,
      chapterOrder: 100,
    });

    const personalLineEn = resolvePersonalLineStoryFamily(
      mockInputs,
      {
        LINLPCFFGFC: "CHAPTER_STYLE_TYPE_PERSONALLINE",
        chapterImageTitleTextMapHash: 1001,
        chapterNumTextMapHash: 1002,
        cityId: 5,
      },
      "2050",
      "Act I",
      "en",
    );
    expect(personalLineEn).toEqual({
      id: "genshin:personal-line:emilie",
      title: "Emilie: Pomum de Ambra Chapter",
      provenance: "derived",
      catalogRegionId: "fontaine",
      familyOrder: 200,
      chapterOrder: 100,
    });

    // Non-personal line style returns undefined
    const nonPersonal = resolvePersonalLineStoryFamily(
      mockInputs,
      {
        LINLPCFFGFC: "CHAPTER_STYLE_TYPE_WORLD",
        chapterImageTitleTextMapHash: 1001,
        chapterNumTextMapHash: 1002,
      },
      "2050",
      "世界任务",
      "zh-CN",
    );
    expect(nonPersonal).toBeUndefined();
  });
});

type JsonRow = Record<string, unknown>;
