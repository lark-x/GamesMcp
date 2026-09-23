import type { DialogueResolutionStatus, QuestContentRole, QuestBinRecord } from "./types.js";

export type QuestClassificationInput = {
  bin?: QuestBinRecord;
  hasExplicitStoryTalk: boolean;
  resolvedTalkCount: number;
  dialogueNodeCount: number;
  hasSiblingQuestRelations?: boolean;
  hasProgressOrReward?: boolean;
  aggregateEvidenceClasses?: string[];
};

export function classifyQuestContentRole(input: QuestClassificationInput): QuestContentRole {
  const counts = input.bin?.contentCounts ?? {};
  const hasControl = Object.keys(counts).some((key) =>
    /STATE_EQUAL|ADD_QUEST_PROGRESS|QUEST_VAR|TRIGGER|EXEC|LUA_NOTIFY|QUEST_CONTENT_FAIL/iu.test(
      key,
    ),
  );
  const aggregateEvidence = new Set(input.aggregateEvidenceClasses ?? []);
  if (input.hasSiblingQuestRelations) aggregateEvidence.add("relation");
  if (input.hasProgressOrReward) aggregateEvidence.add("progress_or_reward");
  if (counts.QUEST_CONTENT_ADD_QUEST_PROGRESS) aggregateEvidence.add("content_progress");
  if (input.bin?.execCounts?.QUEST_EXEC_ADD_QUEST_PROGRESS) aggregateEvidence.add("exec_progress");
  // Progress/reward/control instructions are common in ordinary narrative
  // quests. A task is a collection only when the source topology explicitly
  // identifies aggregate children; heuristic signal combinations must not
  // hide a real task body as an aggregate entry.
  const hasAggregateSignal = aggregateEvidence.has("aggregate_children");
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
  hasNarrativeSource?: boolean;
  talkReferenceCount: number;
  talkAssetCount: number;
  dialogueNodeCount: number;
  expectedTalkIds?: string[];
  resolvedTalkIds?: string[];
  missingTalkIds?: string[];
  ambiguousTalkIds?: string[];
  danglingEdgeCount?: number;
  missingTextCount?: number;
  graphHasNoRoot?: boolean;
  cycle?: boolean;
}): DialogueResolutionStatus {
  if (
    ["control", "trigger", "reward", "aggregate"].includes(input.contentRole) ||
    (["metadata", "unknown"].includes(input.contentRole) && !input.hasNarrativeSource)
  )
    return "not_applicable";
  if (input.talkReferenceCount === 0) {
    // Codex-only narrative rows can provide a complete body without a Talk
    // identity.  They are resolved from the direct source, whereas an empty
    // narrative row is a missing reference and not a metadata-only control
    // task.
    if (input.dialogueNodeCount > 0) {
      if (input.missingTextCount && input.missingTextCount > 0) return "dialogue_text_missing";
      if (input.danglingEdgeCount && input.danglingEdgeCount > 0) return "graph_incomplete";
      return "resolved";
    }
    return "talk_reference_missing";
  }
  if ((input.ambiguousTalkIds?.length ?? 0) > 0 || input.talkAssetCount > 1)
    return "talk_asset_ambiguous";
  if (
    input.talkAssetCount === 0 ||
    ((input.missingTalkIds?.length ?? 0) > 0 && (input.resolvedTalkIds?.length ?? 0) === 0)
  )
    return "talk_asset_missing";
  if (
    (input.expectedTalkIds?.length ?? input.talkReferenceCount) >
    (input.resolvedTalkIds?.length ?? 0)
  )
    return "partial";
  if (input.missingTextCount && input.missingTextCount > 0) return "dialogue_text_missing";
  if (input.danglingEdgeCount && input.danglingEdgeCount > 0) return "graph_incomplete";
  if (input.dialogueNodeCount === 0) return "dialogue_text_missing";
  return "resolved";
}
