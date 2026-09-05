export function isStarRailGame(slugOrId?: string, gameName?: string): boolean {
  if (slugOrId) {
    const lower = slugOrId.toLowerCase();
    if (
      lower.includes("starrail") ||
      lower.includes("star-rail") ||
      lower === "hsr" ||
      lower === "df3eb8fb-7a5c-431d-9f54-5db451f0cdd2"
    ) {
      return true;
    }
  }
  if (gameName) {
    const lower = gameName.toLowerCase();
    if (lower.includes("星穹铁道") || lower.includes("星铁") || lower.includes("star rail")) {
      return true;
    }
  }
  return false;
}

export const questTypeOptions = [
  ["", "全部任务"],
  ["archon_quest", "魔神任务"],
  ["story_quest", "传说任务"],
  ["world_quest", "世界任务"],
  ["event_quest", "活动任务"],
  ["commission", "委托"],
  ["hangout", "邀约任务"],
  ["other", "其他任务"],
] as const;

export const starRailQuestTypeOptions = [
  ["", "全部任务"],
  ["archon_quest", "开拓任务"],
  ["story_quest", "同行任务"],
  ["hangout", "开拓续闻"],
  ["world_quest", "冒险任务"],
  ["commission", "日常任务"],
  ["event_quest", "活动任务"],
  ["story", "散篇剧情"],
  ["other", "其他任务"],
] as const;

export function getQuestTypeOptions(isStarRail = false) {
  return isStarRail ? starRailQuestTypeOptions : questTypeOptions;
}

export function questTypeLabel(
  type:
    | "archon_quest"
    | "story_quest"
    | "world_quest"
    | "event_quest"
    | "commission"
    | "hangout"
    | "other"
    | string,
  isStarRail = false,
): string {
  if (isStarRail) {
    const srMap: Record<string, string> = {
      archon_quest: "开拓任务",
      story_quest: "同行任务",
      hangout: "开拓续闻",
      world_quest: "冒险任务",
      commission: "日常任务",
      event_quest: "活动任务",
      story: "散篇剧情",
      other: "其他任务",
    };
    return srMap[type] ?? type;
  }
  return (
    {
      archon_quest: "魔神任务",
      story_quest: "传说任务",
      world_quest: "世界任务",
      event_quest: "活动任务",
      commission: "委托",
      hangout: "邀约任务",
      other: "其他任务",
    }[type] ?? type
  );
}

export function completenessLabel(value: "complete" | "partial" | "metadata_only"): string {
  return (
    {
      complete: "完整",
      partial: "部分",
      metadata_only: "仅元数据",
    }[value] ?? value
  );
}

