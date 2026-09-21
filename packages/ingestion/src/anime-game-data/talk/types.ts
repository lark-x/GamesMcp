export type TalkSourceKind =
  | "quest"
  | "npc"
  | "npc_other"
  | "npc_group"
  | "activity"
  | "coop"
  | "storyboard"
  | "gadget"
  | "free_group"
  | "unknown";

export type TalkRelationEvidence =
  | "quest_complete_talk"
  | "talk_excel_quest_id"
  | "npc_group_trigger"
  | "perform_cfg_exact"
  | "asset_id_exact"
  | "legacy_path_match";

export type TalkDialogueRow = {
  dialogId: string;
  nextDialogIds: string[];
  roleType?: string;
  roleId?: string;
  bodyHash?: string;
  speakerNameHash?: string;
  sourceFile: string;
  sourcePath: string;
  schemaKey?: string;
};

export type TalkAssetRecord = {
  talkId?: string;
  sourceKind: TalkSourceKind;
  relativePath: string;
  fileHash: string;
  schemaSignature: string;
  dialogueRows: TalkDialogueRow[];
  rootDialogueIds: string[];
  referencedDialogueIds: string[];
  metadata: Record<string, unknown>;
};

export type TalkSourceFile = {
  relativePath: string;
  sourceKind: TalkSourceKind;
  fileHash?: string;
  fileStem: string;
  parsed: boolean;
  dialogueRowCount?: number;
};

export type TalkCandidate = {
  talkId: string;
  sourceKind: TalkSourceKind;
  sourceFile: string;
  confidence: number;
  evidence: TalkRelationEvidence;
  asset?: TalkAssetRecord;
  relationEdgeId?: string;
};

export type TalkSourceRegistry = {
  files: TalkSourceFile[];
  assets: TalkAssetRecord[];
  assetsByTalkId: Map<string, TalkAssetRecord[]>;
  filesByStem: Map<string, TalkSourceFile[]>;
  duplicateTalkIds: Array<{ talkId: string; sourceFiles: string[] }>;
  npcGroupRelations: import("../quest/types.js").QuestRelationEdge[];
  coverage: {
    totalFiles: number;
    parsedFiles: number;
    parsedByKind: Record<string, number>;
    fileCountsByKind: Record<string, number>;
    unknownDirectories: string[];
  };
  loadAsset(relativePath: string): Promise<TalkAssetRecord | undefined>;
  findAssets(talkId: string, sourceKind?: TalkSourceKind): Promise<TalkAssetRecord[]>;
};
