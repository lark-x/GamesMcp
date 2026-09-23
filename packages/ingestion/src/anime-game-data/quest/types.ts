export type QuestRelationType =
  | "contains_subquest"
  | "complete_talk"
  | "quest_state_equal"
  | "quest_state_not_equal"
  | "add_quest_progress"
  | "main_quest_relation_a"
  | "main_quest_relation_b"
  | "main_quest_relation_unknown"
  | "talk_excel_relation"
  | "npc_group_condition"
  | "npc_group_trigger"
  | "starts_after"
  | "requires"
  | "aggregate_of"
  | "aggregates"
  | "contains_talk"
  | "story_order";

export type QuestRelationEdge = {
  edgeId?: string;
  fromQuestId: string;
  toQuestId?: string;
  fromSubQuestId?: string;
  toSubQuestId?: string;
  talkId?: string;
  relationType: QuestRelationType;
  rawRelationType?: string;
  sourceFile: string;
  sourcePath?: string;
  rawField?: string;
  rawIndex?: number;
  sourceHash: string;
  derived: boolean;
  confidence: number;
  expectedState?: string | number;
  evidenceEdges?: string[];
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
  execs?: QuestBinContent[];
  contentEdges?: QuestRelationEdge[];
  execEdges?: QuestRelationEdge[];
  containsSubQuestEdges?: QuestRelationEdge[];
  relationEdges: QuestRelationEdge[];
  contentCounts: Record<string, number>;
  execCounts?: Record<string, number>;
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
  | "partial"
  | "not_applicable"
  | "talk_reference_missing"
  | "talk_asset_missing"
  | "talk_asset_ambiguous"
  | "dialogue_text_missing"
  | "graph_incomplete";

export type QuestTopology = {
  questId: string;
  prerequisiteQuestIds: string[];
  successorQuestIds: string[];
  relatedQuestIds: string[];
  aggregateChildQuestIds: string[];
  parentQuestIds: string[];
  storyOrder?: number;
  orderSource?: "topology" | "upstream" | "fallback";
  orderConfidence?: "high" | "medium" | "low";
  contentRole: QuestContentRole;
  relationEdges: QuestRelationEdge[];
  rawRelationEdges?: QuestRelationEdge[];
  derivedRelationEdges?: QuestRelationEdge[];
  subQuestIds?: string[];
  subQuestOrder?: string[];
  subQuestRelationEdges?: QuestRelationEdge[];
  aggregateParentQuestId?: string;
  cycle?: boolean;
  cycleNodeIds?: string[];
  danglingEdges?: QuestRelationEdge[];
};

export type StoryProjectionEntryType = "quest" | "collection" | "aggregate";

export type StoryProjectionQuest = {
  questId: string;
  title: string;
  order: number;
  questType?: string;
  completeness?: "complete" | "partial" | "metadata_only";
  displayTitle?: string;
  entryType?: StoryProjectionEntryType;
  chapterId?: string;
  chapterTitle?: string;
  chapterOrder?: number;
  familyId?: string;
  familyTitle?: string;
  familyOrder?: number;
  subseriesId?: string;
  subseriesTitle?: string;
  subseriesOrder?: number;
  contentRole: QuestContentRole;
  dialogueResolutionStatus: DialogueResolutionStatus;
  qualityCode?: string;
  bodyAvailability?: string;
  parentQuestId?: string;
  aggregateChildQuestIds?: string[];
};

export type StoryProjectionChapter = {
  id: string;
  title: string;
  order: number;
  quests: StoryProjectionQuest[];
  collections?: StoryProjectionQuest[];
};

export type StoryProjectionSubSeries = {
  id: string;
  title: string;
  order: number;
  chapters: StoryProjectionChapter[];
  quests?: StoryProjectionQuest[];
  collections?: StoryProjectionQuest[];
};

export type StoryProjectionFamily = {
  id: string;
  title: string;
  order: number;
  provenance?: "upstream" | "derived" | "curated" | "fallback";
  subseries?: StoryProjectionSubSeries[];
  chapters: StoryProjectionChapter[];
  quests?: StoryProjectionQuest[];
  collections?: StoryProjectionQuest[];
};

export type StoryProjectionRegion = {
  id: string;
  title: string;
  order: number;
  families: StoryProjectionFamily[];
};
