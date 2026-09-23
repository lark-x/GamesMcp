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
      dialogId: `${index + 1}`,
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
    findAssetsByDialogueId: async (dialogueId, sourceKind) =>
      assets.filter(
        (item) =>
          (!sourceKind || item.sourceKind === sourceKind) &&
          item.dialogueRows.some((row) => row.dialogId === dialogueId),
      ),
    releaseLoadedAssets: () => undefined,
  };
}

describe("resolveQuestTalks", () => {
  it("keeps different assets ambiguous instead of preferring a source kind", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      registry: registry([
        asset("free_group", "BinOutput/Talk/FreeGroup/200.json"),
        asset("npc", "BinOutput/Talk/Npc/200.json", 2),
      ]),
    });

    expect(result.ambiguousTalkIds).toEqual(["200"]);
    expect(result.candidates.map((candidate) => candidate.sourceKind)).toEqual([
      "free_group",
      "npc",
    ]);
  });

  it("ignores relation metadata assets that contain no dialogue rows", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      registry: registry([
        asset("npc_group", "BinOutput/Talk/NpcGroup/200.json"),
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
        asset("quest", "BinOutput/Talk/Quest/hashed-alias.json", 2),
        asset("quest", "BinOutput/Talk/Quest/200.json"),
      ]),
    });

    expect(result.ambiguousTalkIds).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.find((candidate) => candidate.sourceFile.endsWith("/200.json")),
    ).toMatchObject({ status: "resolved", resolutionReason: "exact_numeric_asset_path" });
  });

  it("retains only relation edges scoped to the current main quest", async () => {
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [],
      relationEdges: [
        {
          edgeId: "current",
          fromQuestId: "100",
          talkId: "200",
          relationType: "complete_talk",
          sourceFile: "current.json",
          sourceHash: "fixture",
          derived: false,
          confidence: 1,
        },
        {
          edgeId: "unrelated",
          fromQuestId: "999",
          talkId: "999",
          relationType: "complete_talk",
          sourceFile: "unrelated.json",
          sourceHash: "fixture",
          derived: false,
          confidence: 1,
        },
      ],
      registry: registry([asset("quest", "BinOutput/Talk/Quest/200.json")]),
    });

    expect(result.relationEdges.map((edge) => edge.edgeId)).toEqual(["current"]);
  });
});
