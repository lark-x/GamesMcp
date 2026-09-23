import type { TextKind } from "@gip/contracts";

export type GroupMode =
  "none" | "character" | "contact" | "visitor" | "book" | "series" | "category";

export type SortMode = "source_order" | "group_order" | "title" | "custom";

export type TextKindConfig = {
  id: TextKind;
  games: Array<"genshin" | "starrail">;
  navLabel: string;
  itemNoun: string;
  groupLabel: string;
  groupMode: GroupMode;
  sortMode: SortMode;
  supportsSearch: boolean;
  supportsPagination: boolean;
  emptyTitle: string;
};

export const TEXT_KIND_REGISTRY: Record<TextKind, TextKindConfig> = {
  books: {
    id: "books",
    games: ["genshin", "starrail"],
    navLabel: "书籍文献",
    itemNoun: "书籍",
    groupLabel: "书籍系列",
    groupMode: "book",
    sortMode: "group_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无书籍文献",
  },
  "character-stories": {
    id: "character-stories",
    games: ["genshin", "starrail"],
    navLabel: "角色故事",
    itemNoun: "角色故事",
    groupLabel: "角色",
    groupMode: "character",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无角色故事",
  },
  voices: {
    id: "voices",
    games: ["genshin", "starrail"],
    navLabel: "角色语音",
    itemNoun: "语音",
    groupLabel: "角色",
    groupMode: "character",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无角色语音",
  },
  "item-texts": {
    id: "item-texts",
    games: ["genshin", "starrail"],
    navLabel: "物品文本",
    itemNoun: "物品",
    groupLabel: "物品类别",
    groupMode: "category",
    sortMode: "title",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无物品文本",
  },
  messages: {
    id: "messages",
    games: ["starrail"],
    navLabel: "星轨短信",
    itemNoun: "短信",
    groupLabel: "联系人",
    groupMode: "contact",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无星轨短信",
  },
  "train-visitors": {
    id: "train-visitors",
    games: ["starrail"],
    navLabel: "列车访客",
    itemNoun: "访客留言",
    groupLabel: "访客",
    groupMode: "visitor",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无列车访客记录",
  },
  "story-atlas": {
    id: "story-atlas",
    games: ["starrail"],
    navLabel: "剧情回顾",
    itemNoun: "回顾记录",
    groupLabel: "章节",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无剧情回顾",
  },
  discussion: {
    id: "discussion",
    games: ["starrail"],
    navLabel: "场景散篇",
    itemNoun: "对话",
    groupLabel: "场景",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无场景散篇对话",
  },
  "lightcone-lore": {
    id: "lightcone-lore",
    games: ["starrail"],
    navLabel: "光锥故事",
    itemNoun: "光锥故事",
    groupLabel: "命途/稀有度",
    groupMode: "category",
    sortMode: "title",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无光锥故事",
  },
  "relic-lore": {
    id: "relic-lore",
    games: ["starrail"],
    navLabel: "遗器背景",
    itemNoun: "遗器部件",
    groupLabel: "套装",
    groupMode: "series",
    sortMode: "title",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无遗器背景文本",
  },
  tutorials: {
    id: "tutorials",
    games: ["genshin", "starrail"],
    navLabel: "基础教程",
    itemNoun: "教程",
    groupLabel: "类别",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无基础教程",
  },
  guides: {
    id: "guides",
    games: ["genshin", "starrail"],
    navLabel: "引导说明",
    itemNoun: "引导",
    groupLabel: "类别",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无引导说明",
  },
  "exploration-tips": {
    id: "exploration-tips",
    games: ["genshin"],
    navLabel: "探索提示",
    itemNoun: "提示",
    groupLabel: "类别",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无探索提示",
  },
  "system-tips": {
    id: "system-tips",
    games: ["genshin"],
    navLabel: "系统提示",
    itemNoun: "提示",
    groupLabel: "类别",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无系统提示",
  },
  "loading-tips": {
    id: "loading-tips",
    games: ["genshin"],
    navLabel: "加载提示",
    itemNoun: "加载语录",
    groupLabel: "类别",
    groupMode: "none",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无加载提示",
  },
  gcg: {
    id: "gcg",
    games: ["genshin"],
    navLabel: "七圣召唤",
    itemNoun: "卡牌与规则",
    groupLabel: "规则分类",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无七圣召唤说明",
  },
  "activity-tutorials": {
    id: "activity-tutorials",
    games: ["genshin"],
    navLabel: "活动教程",
    itemNoun: "活动说明",
    groupLabel: "活动",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无活动教程",
  },
  mechanics: {
    id: "mechanics",
    games: ["genshin"],
    navLabel: "玩法机制",
    itemNoun: "机制说明",
    groupLabel: "机制类别",
    groupMode: "category",
    sortMode: "source_order",
    supportsSearch: true,
    supportsPagination: true,
    emptyTitle: "暂无玩法机制说明",
  },
};

export function getAvailableKinds(isStarRail: boolean): TextKindConfig[] {
  const gameKey = isStarRail ? "starrail" : "genshin";
  return Object.values(TEXT_KIND_REGISTRY).filter((c) => c.games.includes(gameKey));
}

export function getKindConfig(kind: string | undefined): TextKindConfig {
  if (kind && kind in TEXT_KIND_REGISTRY) {
    return TEXT_KIND_REGISTRY[kind as TextKind];
  }
  return TEXT_KIND_REGISTRY.books;
}
