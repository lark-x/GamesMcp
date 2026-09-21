import type { DialogueResolutionStatus, QuestContentRole, QuestBinRecord } from "./types.js";

export type QuestClassificationInput = {
  bin?: QuestBinRecord;
  hasExplicitStoryTalk: boolean;
  resolvedTalkCount: number;
  dialogueNodeCount: number;
  hasSiblingQuestRelations?: boolean;
  hasProgressOrReward?: boolean;
};

export function classifyQuestContentRole(input: QuestClassificationInput): QuestContentRole {
  const counts = input.bin?.contentCounts ?? {};
  const hasControl = Object.keys(counts).some((key) =>
    /STATE_EQUAL|ADD_QUEST_PROGRESS|QUEST_VAR|TRIGGER|EXEC|LUA_NOTIFY|QUEST_CONTENT_FAIL/iu.test(
      key,
    ),
  );
  const hasAggregateSignal =
    Boolean(input.hasSiblingQuestRelations) ||
    Boolean(input.hasProgressOrReward) ||
    Boolean(counts.QUEST_CONTENT_ADD_QUEST_PROGRESS);
  if (input.hasExplicitStoryTalk && hasControl) return "story_and_control";
  if (input.hasExplicitStoryTalk || input.resolvedTalkCount > 0 || input.dialogueNodeCount > 0)
    return "story";
  if (hasAggregateSignal) return "aggregate";
  if (counts.QUEST_CONTENT_TRIGGER || counts.QUEST_CONTENT_LUA_NOTIFY) return "trigger";
  if (hasControl) return "control";
  if (input.bin && Object.keys(counts).length) return "metadata";
  return "unknown";
}

export function classifyDialogueResolution(input: {
  contentRole: QuestContentRole;
  talkReferenceCount: number;
  talkAssetCount: number;
  dialogueNodeCount: number;
  danglingEdgeCount?: number;
  missingTextCount?: number;
}): DialogueResolutionStatus {
  if (["control", "trigger", "reward", "aggregate"].includes(input.contentRole))
    return "not_applicable";
  if (input.talkReferenceCount === 0) return "talk_reference_missing";
  if (input.talkAssetCount === 0) return "talk_asset_missing";
  if (input.talkAssetCount > 1) return "talk_asset_ambiguous";
  if (input.missingTextCount && input.missingTextCount > 0) return "dialogue_text_missing";
  if (input.danglingEdgeCount && input.danglingEdgeCount > 0) return "graph_incomplete";
  if (input.dialogueNodeCount === 0) return "dialogue_text_missing";
  return "resolved";
}
