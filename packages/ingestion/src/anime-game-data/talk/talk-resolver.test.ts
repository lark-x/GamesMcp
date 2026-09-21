import { describe, expect, it } from "vitest";
import { resolveQuestTalks } from "./talk-resolver.js";
import type { TalkAssetRecord, TalkSourceRegistry } from "./types.js";

function asset(
  sourceKind: TalkAssetRecord["sourceKind"],
  relativePath: string,
  rows = 1,
): TalkAssetRecord {
  return {
    talkId: relativePath
      .split("/")
      .pop()
      ?.replace(/\.json$/u, ""),
    sourceKind,
    relativePath,
    fileHash: relativePath,
    schemaSignature: "PFALHAKIILD",
    dialogueRows: Array.from({ length: rows }, (_, index) => ({
      dialogId: `${relativePath}:${index}`,
      nextDialogIds: [],
      sourceFile: relativePath,
      sourcePath: `PFALHAKIILD[${index}]`,
    })),
    rootDialogueIds: [],
    referencedDialogueIds: [],
    metadata: {},
  };
}

function registry(assets: TalkAssetRecord[]): TalkSourceRegistry {
  return {
    files: [],
    assets,
    assetsByTalkId: new Map(),
    filesByStem: new Map(),
    duplicateTalkIds: [],
    npcGroupRelations: [],
    coverage: {
      totalFiles: 0,
      parsedFiles: 0,
      parsedByKind: {},
      fileCountsByKind: {},
      unknownDirectories: [],
    },
    loadAsset: async () => undefined,
    findAssets: async () => assets,
  };
}

describe("resolveQuestTalks", () => {
  it("prefers the Npc asset for an explicit NpcGroup trigger", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      registry: registry([
        asset("free_group", "BinOutput/Talk/FreeGroup/200.json"),
        asset("npc", "BinOutput/Talk/Npc/200.json"),
      ]),
    });

    expect(result.ambiguousTalkIds).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.sourceKind)).toEqual(["npc"]);
  });

  it("ignores relation metadata assets that contain no dialogue rows", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      registry: registry([
        asset("npc_group", "BinOutput/Talk/NpcGroup/200.json", 0),
        asset("quest", "BinOutput/Talk/Quest/200.json"),
      ]),
    });

    expect(result.ambiguousTalkIds).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.sourceKind)).toEqual(["quest"]);
  });

  it("uses the explicit numeric asset path when a hashed alias is also registered", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      registry: registry([
        asset("quest", "BinOutput/Talk/Quest/hashed-alias.json"),
        asset("quest", "BinOutput/Talk/Quest/200.json"),
      ]),
    });

    expect(result.ambiguousTalkIds).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.sourceFile)).toEqual([
      "BinOutput/Talk/Quest/200.json",
    ]);
  });
});
