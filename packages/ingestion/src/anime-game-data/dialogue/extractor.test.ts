import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TextResolver } from "../text-resolver.js";
import type { AnimeContext } from "../context.js";
import { buildDialogueManifest, dialogueExtractor } from "./extractor.js";

const fixtureDir = resolve("data/fixtures/anime-game-data-quests");
const dialogPath = "ExcelBinOutput/DialogExcelConfigData.json";
const talk0Path = "ExcelBinOutput/TalkExcelConfigData_0.json";
const talk1Path = "ExcelBinOutput/TalkExcelConfigData_1.json";

type JsonObject = Record<string, unknown>;

type FixtureOptions = {
  dialogRows?: JsonObject[];
  talk0Rows?: JsonObject[];
  talk1Rows?: JsonObject[];
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function makeFixture(options: FixtureOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anime-game-dialogue-"));
  await mkdir(join(root, "ExcelBinOutput"), { recursive: true });
  const dialogRows =
    options.dialogRows ?? (await readJson<JsonObject[]>(join(fixtureDir, dialogPath)));
  const talk0Rows = options.talk0Rows ?? [{ id: 42, initDialog: 1, questId: 1001 }];
  const talk1Rows = options.talk1Rows ?? [];
  await Promise.all([
    writeFile(join(root, dialogPath), JSON.stringify(dialogRows, null, 2)),
    writeFile(join(root, talk0Path), JSON.stringify(talk0Rows, null, 2)),
    writeFile(join(root, talk1Path), JSON.stringify(talk1Rows, null, 2)),
  ]);
  return root;
}

async function makeContext(
  upstreamDir: string,
  textOverrides: Record<string, string> = {},
): Promise<AnimeContext> {
  const zh = await readJson<Record<string, unknown>>(join(fixtureDir, "TextMap/TextMapCHS.json"));
  const en = await readJson<Record<string, unknown>>(join(fixtureDir, "TextMap/TextMapEN.json"));
  return {
    upstreamDir,
    upstreamCommit: "fixture-commit",
    upstreamVersion: "fixture-version",
    gameVersion: "7.0.0",
    locale: "zh-CN",
    textResolver: new TextResolver({
      maps: [
        { locale: "zh-CN", values: { ...zh, ...textOverrides } },
        { locale: "en-US", values: en },
      ],
    }),
    inputHashes: {},
  };
}

async function withFixture<T>(
  options: FixtureOptions,
  callback: (upstreamDir: string) => Promise<T>,
): Promise<T> {
  const root = await makeFixture(options);
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("DialogueExtractor", () => {
  it("extracts Dialog rows and joins Talk quest metadata", async () => {
    await withFixture({}, async (upstreamDir) => {
      const result = await dialogueExtractor.extract(await makeContext(upstreamDir));
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({
        dialogueNodeKey: "quest/1001/dialog/1",
        talkId: 42,
        speakerKey: "npc/2001",
        speakerName: "派蒙",
        speakerRole: "TALK_ROLE_NPC",
        nodeType: "dialogue",
        body: "旅行者，我们出发吧。",
        order: 0,
        questKey: "quest/1001",
        questId: 1001,
        textResolution: { method: "textmap", locale: "zh-CN", resolved: true },
      });
      expect(result.coverage).toEqual({ discovered: 2, converted: 2, failed: 0, coverage: 1 });
      expect(result.inputHashes).toEqual({
        [dialogPath]: expect.any(String),
        [talk0Path]: expect.any(String),
        [talk1Path]: expect.any(String),
      });
    });
  });

  it("keeps missing speaker names null and reports unresolved text", async () => {
    const dialogRows = [
      {
        GFLDJMJKIKE: 9,
        nextDialogs: [],
        talkRole: { type: "TALK_ROLE_NPC", id: "9999" },
        talkContentTextMapHash: 10005,
        talkRoleNameTextMapHash: 999999,
      },
    ];
    await withFixture(
      { dialogRows, talk0Rows: [{ id: 90, initDialog: 9, questId: 1001 }] },
      async (upstreamDir) => {
        const result = await dialogueExtractor.extract(await makeContext(upstreamDir));
        expect(result.records[0]).toMatchObject({
          speakerKey: "npc/9999",
          speakerName: null,
          body: "旅行者，我们出发吧。",
          textResolution: { method: "textmap", locale: "zh-CN", resolved: false },
        });
        expect(result.fieldCoverage.missingSpeakerName).toBe(1);
        expect(result.warnings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "speaker_name_unresolved", upstreamId: "9" }),
          ]),
        );
      },
    );
  });

  it("distinguishes player choices from a dialogue node with multiple next dialogs", async () => {
    const dialogRows = [
      {
        GFLDJMJKIKE: 1,
        nextDialogs: [2, 3],
        talkRole: { type: "TALK_ROLE_NPC", id: "2001" },
        talkContentTextMapHash: 10005,
        talkRoleNameTextMapHash: 10007,
      },
      {
        GFLDJMJKIKE: 2,
        nextDialogs: [],
        talkRole: { type: "TALK_ROLE_PLAYER", id: "" },
        talkContentTextMapHash: 10006,
        talkRoleNameTextMapHash: 10007,
      },
      {
        GFLDJMJKIKE: 3,
        nextDialogs: [],
        talkRole: { type: "TALK_ROLE_BLACK_SCREEN", id: "" },
        talkContentTextMapHash: 10006,
        talkRoleNameTextMapHash: 10007,
      },
    ];
    await withFixture({ dialogRows }, async (upstreamDir) => {
      const result = await dialogueExtractor.extract(await makeContext(upstreamDir));
      expect(result.records.map((record) => record.nodeType)).toEqual([
        "dialogue",
        "player_choice",
        "system_text",
      ]);
      expect(result.records[1]?.dialogueNodeKey).toBe("quest/1001/dialog/2");
      expect(result.records[1]?.talkId).toBe(42);
    });
  });

  it("cleans rich text through TextResolver", async () => {
    const dialogRows = [
      {
        GFLDJMJKIKE: 11,
        nextDialogs: [],
        talkRole: { type: "TALK_ROLE_NPC", id: "2001" },
        talkContentTextMapHash: 10008,
        talkRoleNameTextMapHash: 10007,
      },
    ];
    await withFixture(
      {
        dialogRows,
        talk0Rows: [{ id: 110, initDialog: 11, questId: 1001 }],
      },
      async (upstreamDir) => {
        const result = await dialogueExtractor.extract(
          await makeContext(upstreamDir, { "10008": "<color=#FF0000>第一行\\n第二行</color>" }),
        );
        expect(result.records[0]?.body).toBe("第一行\n第二行");
        expect(result.records[0]?.textResolution).toEqual({
          method: "textmap",
          locale: "zh-CN",
          resolved: true,
        });
      },
    );
  });

  it("builds the same manifest for identical fixture inputs", async () => {
    const firstRoot = await makeFixture();
    const secondRoot = await makeFixture();
    try {
      const firstContext = await makeContext(firstRoot);
      const secondContext = await makeContext(secondRoot);
      const first = await dialogueExtractor.extract(firstContext);
      const second = await dialogueExtractor.extract(secondContext);
      expect(first.manifest).toEqual(second.manifest);
      expect(buildDialogueManifest(first, firstContext)).toEqual(
        buildDialogueManifest(second, secondContext),
      );
      expect(first.manifest.contentHash).toHaveLength(64);
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
