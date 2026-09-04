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

export function questTypeLabel(
  type:
    | "archon_quest"
    | "story_quest"
    | "world_quest"
    | "event_quest"
    | "commission"
    | "hangout"
    | "other",
): string {
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
