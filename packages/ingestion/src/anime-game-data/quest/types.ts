export type QuestRelationType =
  | "complete_talk"
  | "quest_state_equal"
  | "add_quest_progress"
  | "main_quest_relation"
  | "npc_group_condition"
  | "npc_group_trigger"
  | "starts_after"
  | "requires"
  | "aggregates"
  | "contains_talk"
  | "story_order";

export type QuestRelationEdge = {
  fromQuestId: string;
  toQuestId?: string;
  talkId?: string;
  relationType: QuestRelationType;
  rawRelationType?: string;
  sourceFile: string;
  sourcePath?: string;
  sourceHash: string;
  derived: boolean;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type QuestBinContent = {
  mainQuestId: string;
  subQuestId: string;
  type: string;
  params: string[];
  sourceFile: string;
  sourcePath: string;
};

export type QuestBinRecord = {
  mainQuestId: string;
  sourceFile: string;
  sourceHash: string;
  subQuestIds: string[];
  contents: QuestBinContent[];
  relationEdges: QuestRelationEdge[];
  contentCounts: Record<string, number>;
  hasCompleteTalk: boolean;
  completeTalkIds: string[];
};

export type QuestContentRole =
  | "story"
  | "story_and_control"
  | "aggregate"
  | "control"
  | "trigger"
  | "reward"
  | "metadata"
  | "unknown";

export type DialogueResolutionStatus =
  | "resolved"
  | "not_applicable"
  | "talk_reference_missing"
  | "talk_asset_missing"
  | "talk_asset_ambiguous"
  | "dialogue_text_missing"
  | "graph_incomplete";

export type QuestTopology = {
  questId: string;
  prerequisiteQuestIds: string[];
  childQuestIds: string[];
  parentQuestIds: string[];
  storyOrder?: number;
  contentRole: QuestContentRole;
  relationEdges: QuestRelationEdge[];
};

export type StoryProjectionQuest = {
  questId: string;
  title: string;
  order: number;
  chapterId?: string;
  chapterTitle?: string;
  familyId?: string;
  familyTitle?: string;
  contentRole: QuestContentRole;
  dialogueResolutionStatus: DialogueResolutionStatus;
};

export type StoryProjectionChapter = {
  id: string;
  title: string;
  order: number;
  quests: StoryProjectionQuest[];
};

export type StoryProjectionFamily = {
  id: string;
  title: string;
  order: number;
  chapters: StoryProjectionChapter[];
};

export type StoryProjectionRegion = {
  id: string;
  title: string;
  order: number;
  families: StoryProjectionFamily[];
};
