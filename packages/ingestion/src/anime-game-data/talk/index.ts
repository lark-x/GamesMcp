export { parseTalkAsset, parseTalkAssetValue, schemaSignature } from "./asset-parser.js";
export { parseNpcGroupRelations } from "./npc-group-parser.js";
export { buildTalkSourceRegistry, loadTalkSourceRegistry } from "./source-registry.js";
export { resolveQuestTalks } from "./talk-resolver.js";
export type {
  TalkAssetRecord,
  TalkCandidate,
  TalkDialogueRow,
  TalkRelationEvidence,
  TalkSourceFile,
  TalkSourceKind,
  TalkSourceRegistry,
} from "./types.js";
export type { ResolveQuestTalkInput, ResolvedQuestTalks } from "./talk-resolver.js";
