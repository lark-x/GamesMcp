import { describe, expect, it } from "vitest";
import type { QuestRelationEdge } from "../quest/types.js";
import { resolveQuestTalks } from "./talk-resolver.js";
import type { TalkAssetRecord, TalkSourceRegistry } from "./types.js";

function asset(path: string, ids: string[]): TalkAssetRecord {
  return {
    talkId: "200",
    sourceKind: path.includes("Npc/") ? "npc" : "quest",
    relativePath: path,
    fileHash: path,
    schemaSignature: "fixture",
    dialogueRows: ids.map((dialogId) => ({
      dialogId,
      nextDialogIds: [],
      sourceFile: path,
      sourcePath: dialogId,
    })),
    rootDialogueIds: ids,
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
    findAssetsByDialogueId: async (id) =>
      assets.filter((item) => item.dialogueRows.some((row) => row.dialogId === id)),
    releaseLoadedAssets: () => undefined,
  };
}

describe("Talk ambiguity resolution", () => {
  it("uses exact TalkExcel initDialog evidence to select one content graph", async () => {
    const chosen = asset("BinOutput/Talk/Quest/200.json", ["9001"]);
    const other = asset("BinOutput/Talk/Npc/200.json", ["8001"]);
    const result = await resolveQuestTalks({
      mainQuestId: "100",
      completeTalkIds: ["200"],
      talkRows: [{ id: 200, questId: 100, initDialog: 9001 }],
      registry: registry([chosen, other]),
    });
    expect(result.ambiguousTalkIds).toEqual([]);
    expect(result.candidates.find((item) => item.sourceFile === chosen.relativePath)).toMatchObject(
      {
        status: "resolved",
        resolutionReason: "talk_excel_init_dialog_exact_path",
      },
    );
    expect(result.candidates.find((item) => item.sourceFile === other.relativePath)?.status).toBe(
      "rejected",
    );
  });

  it("never promotes NpcGroup availability evidence into public narrative", async () => {
    const edge: QuestRelationEdge = {
      edgeId: "npc-group",
      fromQuestId: "21009",
      talkId: "200",
      relationType: "npc_group_condition",
      sourceFile: "BinOutput/Talk/NpcGroup/21009.json",
      sourceHash: "fixture",
      derived: false,
      confidence: 1,
    };
    const result = await resolveQuestTalks({
      mainQuestId: "21009",
      talkRows: [],
      relationEdges: [edge],
      registry: registry([asset("BinOutput/Talk/Npc/200.json", ["1"])]),
    });
    expect(result.talkIds).toEqual([]);
    expect(result.auxiliaryTalkIds).toEqual(["200"]);
    expect(result.resolvedTalkIds).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      status: "rejected",
      resolutionReason: "availability_evidence_only",
    });
  });
});
