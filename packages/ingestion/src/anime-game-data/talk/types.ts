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
  | "talk_excel_relation"
  | "npc_group_condition"
  | "npc_group_trigger"
  | "perform_cfg_exact"
  | "asset_id_exact"
  | "legacy_path_match";

export type TalkEvidenceClass = "narrative" | "identity" | "availability" | "compatibility";

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
  embeddedTalkId?: string;
  schemaSignature?: string;
  metadataScanned?: boolean;
  dialogueRowCount?: number;
  dialogueIds?: string[];
};

export type TalkEvidence = {
  kind: TalkRelationEvidence;
  evidenceClass: TalkEvidenceClass;
  confidence: number;
  relationEdgeId?: string;
  sourceFile?: string;
  details?: Record<string, unknown>;
};

export type TalkCandidate = {
  talkId: string;
  /** The subquest that supplied COMPLETE_TALK, when the source exposes it. */
  subQuestId?: string;
  subQuestIds?: string[];
  sourceKind: TalkSourceKind;
  sourceFile: string;
  confidence: number;
  score?: number;
  status?: "resolved" | "ambiguous" | "rejected";
  evidence: TalkRelationEvidence;
  evidences?: TalkEvidence[];
  asset?: TalkAssetRecord;
  relationEdgeId?: string;
  resolutionReason?: string;
};

export type TalkSourceRegistry = {
  files: TalkSourceFile[];
  assets: TalkAssetRecord[];
  assetsByTalkId: Map<string, TalkAssetRecord[]>;
  assetsByDialogueId?: Map<string, TalkAssetRecord[]>;
  filesByStem: Map<string, TalkSourceFile[]>;
  duplicateTalkIds: Array<{ talkId: string; sourceFiles: string[] }>;
  metadataByTalkId?: Map<string, TalkSourceFile[]>;
  npcGroupRelations: import("../quest/types.js").QuestRelationEdge[];
  coverage: {
    totalFiles: number;
    parsedFiles: number;
    metadataScannedFiles?: number;
    metadataCacheHits?: number;
    eagerParsedByKind?: Record<string, number>;
    lazyLoadedByKind?: Record<string, number>;
    parsedByKind: Record<string, number>;
    fileCountsByKind: Record<string, number>;
    unknownDirectories: string[];
  };
  loadAsset(relativePath: string): Promise<TalkAssetRecord | undefined>;
  findAssets(talkId: string, sourceKind?: TalkSourceKind): Promise<TalkAssetRecord[]>;
  /** Find parsed assets whose dialogue graph contains an exact root/line id. */
  findAssetsByDialogueId(
    dialogueId: string,
    sourceKind?: TalkSourceKind,
  ): Promise<TalkAssetRecord[]>;
  /** Release parsed dialogue bodies after they have been normalized by the converter. */
  releaseLoadedAssets(): void;
};
