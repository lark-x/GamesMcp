export interface StarRailWorld {
  id: string | number;
  worldId: number;
  name: string;
  order: number;
  description?: string;
  sourceFile: string;
}

export interface StarRailChapter {
  id: string | number;
  chapterId: number;
  worldId: number;
  name: string;
  order: number;
  description?: string;
  chapterType?: string;
  sourceFile: string;
}

export interface StarRailDialogueOption {
  id: string;
  text: string;
  nextNodeId?: string;
}

export interface StarRailDialogueNode {
  nodeId: string;
  nodeType: "dialogue" | "option" | "narrator" | "action";
  speakerId?: string | number;
  speakerName?: string;
  body: string;
  order: number;
  options?: StarRailDialogueOption[];
  sourceFile: string;
  sourcePath?: string;
}

export interface StarRailSubMission {
  subMissionId: number;
  mainMissionId: number;
  sequence: number;
  targetText?: string;
  descriptionText?: string;
  dialogueNodes: StarRailDialogueNode[];
}

export type StoryCompleteness = "complete" | "partial" | "metadata_only" | "unresolved";

export type StoryVisibility = "public" | "hidden" | "test" | "internal" | "unreleased" | "unknown";

export interface StarRailStoryQuest {
  mainMissionId: number;
  questKey: string;
  title: string;
  type: string; // e.g. "archon_quest" (开拓任务), "companion_mission" (同行任务), "world_quest" (冒险/散篇)
  seriesTitle?: string;
  worldId?: number | string;
  worldTitle?: string;
  worldName?: string;
  chapterId?: number | string;
  chapterTitle?: string;
  previousMissionIds: number[];
  nextMissionIds: number[];
  sequence?: number;
  displayPriority?: number;
  subMissions: StarRailSubMission[];
  subquests?: StarRailSubMission[];
  dialogueNodes: StarRailDialogueNode[];
  completeness: StoryCompleteness;
  visibility: StoryVisibility;
  provenance: Record<string, unknown>;
}

export interface StarRailCharacter {
  id: string | number;
  name: string;
  rarity: number;
  path: string; // 命途: Destruction, Preservation, Hunt, Erudition, Harmony, Nihility, Abundance, Remembrance
  element: string; // 属性: Physical, Fire, Ice, Thunder, Wind, Quantum, Imaginary
  baseHp: number | null;
  baseAtk: number | null;
  baseDef: number | null;
  baseSpeed: number | null;
  skills: Array<{
    id: number;
    name: string;
    type: string; // Normal, Skill, Ultimate, Talent, Technique
    description: string;
  }>;
  traces: Array<{
    id: number;
    name: string;
    description: string;
    materialCosts: Array<{ id: number | string; count: number }>;
  }>;
  eidolons: Array<{
    rank: number;
    name: string;
    description: string;
  }>;
  ascensionMaterials: Array<{ id: number | string; count: number }>;
  storyIds?: number[];
  voiceLineIds?: number[];
}

export interface StarRailLightCone {
  id: string | number;
  name: string;
  rarity: number;
  path: string;
  baseHp: number | null;
  baseAtk: number | null;
  baseDef: number | null;
  skillName?: string;
  skillDesc?: string;
  superimposeLevels?: Array<{ level: number; desc: string }>;
  ascensionMaterials: Array<{ id: number | string; count: number }>;
  story?: string;
}

export interface StarRailRelic {
  id: string | number;
  name: string;
  setId: number;
  setName: string;
  slotType: "HEAD" | "HAND" | "BODY" | "FOOT" | "OBJECT" | "NECK";
  rarity: number;
  twoPieceBonus?: string;
  fourPieceBonus?: string;
  story?: string;
}

export type MaterialCategory =
  | "character_ascension"
  | "trace"
  | "lightcone_ascension"
  | "exp_material"
  | "lightcone_exp"
  | "relic_exp"
  | "material"
  | "enemy_drop"
  | "weekly_boss"
  | "currency"
  | "synthesis"
  | "consumable"
  | "mission"
  | "event"
  | "other";

export interface MaterialSource {
  type: string;
  description: string;
  stageId?: number | string;
  monsterId?: number | string;
}

export interface MaterialUsage {
  type:
    | "character_ascension"
    | "character_trace"
    | "lightcone_ascension"
    | "character_exp"
    | "relic_exp"
    | "synthesis";
  targetId: string | number;
  targetName?: string;
  count?: number;
}

export interface StarRailMaterial {
  id: string | number;
  name: string;
  category: MaterialCategory;
  rarity?: number;
  description?: string;
  story?: string;
  sources: MaterialSource[];
  usages: MaterialUsage[];
  visibility: "public" | "hidden";
  provenance: Record<string, unknown>;
}

export interface StarRailEnemy {
  id: string | number;
  name: string;
  rank: "MINION" | "ELITE" | "BOSS";
  camp?: string;
  weaknesses: string[];
  resistances: string[];
  baseHp?: number;
  baseAtk?: number;
  baseDef?: number;
  drops: Array<{ itemId: number | string; name?: string }>;
}

export interface StarRailAchievement {
  id: string | number;
  title: string;
  name?: string;
  seriesId: number;
  seriesTitle?: string;
  description: string;
  rewardJade: number | null;
  isHidden: boolean;
  priority?: number;
}
