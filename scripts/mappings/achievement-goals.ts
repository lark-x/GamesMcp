import type { GenshinAchievementCategory } from "@gip/contracts";

export type AchievementGoalMapping = {
  goalId: string | null;
  goalName: string;
  canonicalCategory: GenshinAchievementCategory;
};

/**
 * The pinned AnimeGameData AchievementGoalExcelConfigData rows, normalized by
 * goal id. The source's first row has no id and is the default goal used by
 * achievements whose goalId is absent.
 */
export const achievementGoalMappings: readonly AchievementGoalMapping[] = [
  { goalId: null, goalName: "天地万象", canonicalCategory: "wonders_of_the_world" },
  { goalId: "17", goalName: "心跳的记忆", canonicalCategory: "memories_of_the_heart" },
  { goalId: "1", goalName: "尘世巡游·第一辑", canonicalCategory: "other" },
  { goalId: "22", goalName: "尘世巡游·第二辑", canonicalCategory: "other" },
  { goalId: "32", goalName: "尘世巡游·第三辑", canonicalCategory: "other" },
  { goalId: "43", goalName: "尘世巡游·第四辑", canonicalCategory: "other" },
  { goalId: "57", goalName: "尘世巡游·第五辑", canonicalCategory: "other" },
  { goalId: "65", goalName: "尘世巡游·第六辑", canonicalCategory: "other" },
  { goalId: "71", goalName: "尘世巡游·第七辑", canonicalCategory: "other" },
  { goalId: "2", goalName: "冒险手艺", canonicalCategory: "other" },
  { goalId: "3", goalName: "英雄之旅", canonicalCategory: "other" },
  { goalId: "4", goalName: "蒙德·风与牧歌的城邦", canonicalCategory: "other" },
  { goalId: "5", goalName: "璃月·岩与契约的海港", canonicalCategory: "other" },
  { goalId: "6", goalName: "元素专家·第一辑", canonicalCategory: "elemental_specialist" },
  { goalId: "36", goalName: "元素专家·第二辑", canonicalCategory: "elemental_specialist" },
  { goalId: "7", goalName: "神射手", canonicalCategory: "other" },
  { goalId: "8", goalName: "挑战者·第一辑", canonicalCategory: "challenger" },
  { goalId: "14", goalName: "挑战者·第二辑", canonicalCategory: "challenger" },
  { goalId: "15", goalName: "挑战者·第三辑", canonicalCategory: "challenger" },
  { goalId: "20", goalName: "挑战者·第四辑", canonicalCategory: "challenger" },
  { goalId: "29", goalName: "挑战者·第五辑", canonicalCategory: "challenger" },
  { goalId: "34", goalName: "挑战者·第六辑", canonicalCategory: "challenger" },
  { goalId: "39", goalName: "挑战者·第七辑", canonicalCategory: "challenger" },
  { goalId: "40", goalName: "挑战者·第八辑", canonicalCategory: "challenger" },
  { goalId: "49", goalName: "挑战者·第九辑", canonicalCategory: "challenger" },
  { goalId: "59", goalName: "挑战者·第十辑", canonicalCategory: "challenger" },
  { goalId: "9", goalName: "秘境与深境螺旋·第一辑", canonicalCategory: "other" },
  { goalId: "10", goalName: "Olah！第一辑", canonicalCategory: "other" },
  { goalId: "11", goalName: "至冬国不相信眼泪·第一辑", canonicalCategory: "other" },
  { goalId: "12", goalName: "岩港往事·第一辑", canonicalCategory: "other" },
  { goalId: "13", goalName: "异世相逢·第一辑", canonicalCategory: "other" },
  { goalId: "21", goalName: "异世相逢·第二辑", canonicalCategory: "other" },
  { goalId: "33", goalName: "异世相逢·第三辑", canonicalCategory: "other" },
  { goalId: "44", goalName: "异世相逢·第四辑", canonicalCategory: "other" },
  { goalId: "53", goalName: "异世相逢·第五辑", canonicalCategory: "other" },
  { goalId: "64", goalName: "异世相逢·第六辑", canonicalCategory: "other" },
  { goalId: "72", goalName: "异世相逢·第七辑", canonicalCategory: "other" },
  { goalId: "16", goalName: "雪山上的来客", canonicalCategory: "other" },
  { goalId: "18", goalName: "世外洞天·第一辑", canonicalCategory: "other" },
  { goalId: "19", goalName: "世外洞天·第二辑", canonicalCategory: "other" },
  { goalId: "23", goalName: "世外洞天·第三辑", canonicalCategory: "other" },
  { goalId: "24", goalName: "稻妻·雷与永恒的群岛·其之一", canonicalCategory: "other" },
  { goalId: "26", goalName: "稻妻·雷与永恒的群岛·其之二", canonicalCategory: "other" },
  { goalId: "27", goalName: "雾海纪行", canonicalCategory: "other" },
  { goalId: "25", goalName: "提瓦特钓鱼指南·第一辑", canonicalCategory: "teyvat_fishing_guide" },
  { goalId: "28", goalName: "白昼之光", canonicalCategory: "other" },
  { goalId: "30", goalName: "岩窟流明", canonicalCategory: "other" },
  { goalId: "31", goalName: "须弥·玄识深藏的雨林", canonicalCategory: "other" },
  { goalId: "35", goalName: "须弥·饰金砂原·其之一", canonicalCategory: "other" },
  { goalId: "38", goalName: "须弥·饰金砂原·其之二", canonicalCategory: "other" },
  { goalId: "37", goalName: "七圣召唤", canonicalCategory: "other" },
  { goalId: "41", goalName: "佑灵砾漠", canonicalCategory: "other" },
  { goalId: "42", goalName: "枫丹·白露澈明的泉舞·其之一", canonicalCategory: "other" },
  { goalId: "45", goalName: "枫丹·白露澈明的泉舞·其之二", canonicalCategory: "other" },
  { goalId: "46", goalName: "枫丹·白露澈明的泉舞·其之三", canonicalCategory: "other" },
  { goalId: "47", goalName: "沉玉成辉", canonicalCategory: "other" },
  { goalId: "48", goalName: "古海狂诗", canonicalCategory: "other" },
  { goalId: "50", goalName: "幻想真境剧诗·第一辑", canonicalCategory: "other" },
  { goalId: "52", goalName: "幻想真境剧诗·第二辑", canonicalCategory: "other" },
  { goalId: "51", goalName: "纳塔·火与竞逐的盟地·其之一", canonicalCategory: "other" },
  { goalId: "55", goalName: "纳塔·火与竞逐的盟地·其之二", canonicalCategory: "other" },
  { goalId: "54", goalName: "对决者·第一辑", canonicalCategory: "challenger" },
  { goalId: "56", goalName: "对决者·第二辑", canonicalCategory: "challenger" },
  { goalId: "61", goalName: "对决者·第三辑", canonicalCategory: "challenger" },
  { goalId: "58", goalName: "千音雅集", canonicalCategory: "other" },
  { goalId: "60", goalName: "圣山残辉", canonicalCategory: "other" },
  { goalId: "62", goalName: "岩灰与刺梨的夏日", canonicalCategory: "other" },
  { goalId: "63", goalName: "挪德卡莱·月与浪迹的乐园·其之一", canonicalCategory: "other" },
  { goalId: "66", goalName: "挪德卡莱·月与浪迹的乐园·其之二", canonicalCategory: "other" },
  { goalId: "67", goalName: "魔山风息", canonicalCategory: "other" },
  { goalId: "68", goalName: "无束的残月", canonicalCategory: "other" },
  { goalId: "69", goalName: "至冬·冰与苍星的圣都·其之一", canonicalCategory: "other" },
  { goalId: "70", goalName: "浮涌的阴影之地", canonicalCategory: "other" },
];

const achievementGoalById = new Map(
  achievementGoalMappings.map((mapping) => [mapping.goalId ?? "", mapping]),
);

export function getAchievementGoalMapping(
  goalId: string | undefined,
): AchievementGoalMapping | undefined {
  return achievementGoalById.get(goalId ?? "");
}
