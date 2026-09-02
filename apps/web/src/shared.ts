export type VerificationStatus = string;

export type ImportDiff = {
  added: string[];
  modified: string[];
  deletionCandidates: string[];
  unchanged: string[];
  conflicts: string[];
  unparsed: string[];
};
export type AdminBatch = {
  id: string;
  status: string;
  sourceId: string;
  successCount: number;
  failureCount: number;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  diff?: ImportDiff | null;
  reviewNote?: string | null;
  createdAt?: string;
};
export type AdminRevision = {
  id: string;
  gameId: string;
  revisionNumber: number;
  sourceBatchId?: string;
  releaseNote?: string | null;
  publishedAt?: string | Date;
  isCurrent: boolean;
  indexStatus: string;
};
export type AdminJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  error?: string | null;
  cancelRequested?: boolean;
};
export type AcquisitionStatus = {
  generatedAt?: string;
  conversion?: {
    gameVersion?: string;
    locale?: string;
    accounting?: Record<string, { discovered?: number; converted?: number; excluded?: number }>;
  } | null;
  observations?: {
    total: number;
    snapshots: number;
    sourceCoverage?: Array<{
      name: string;
      category: string;
      complete: boolean;
      latest?: {
        observedCount: number;
        expectedCount: number | null;
        coverage: number | null;
        missingCount: number;
        unexpectedCount: number;
      } | null;
    }>;
    integrity?: { ok: boolean };
  };
  conflicts?: { total: number; open: number; resolved: number };
  releaseGate: {
    ready: boolean;
    manifestComplete: boolean;
    sourceCoverageComplete: boolean;
    observationIntegrity: boolean;
    allSamplesProcessed: boolean;
    exactMatchPerCategory: Record<string, number>;
    openConflicts: number;
    conflictSelectionComplete: boolean;
    backupAvailable: boolean;
    backupAfterCurrentBatches: boolean;
    manualVerificationReady: boolean;
    blockingReasons?: string[];
  };
  latestBackup?: {
    createdAt?: string;
    integrityValid?: boolean;
    afterCurrentBatches?: boolean;
  } | null;
};
export type ReleaseGateState = "passed" | "blocked" | "checking" | "unavailable";
export type ReleaseGateItem = {
  label: string;
  detail: string;
  state: ReleaseGateState;
  action?: { label: string; view: "review" | "verify" | "release" };
};

export type ArchiveCategory = {
  id: string;
  label: string;
  description: string;
  marker: string;
  types: Array<"entity" | "document" | "segment">;
  /** Optional dedicated reader route for domains that are not generic search results. */
  route?:
    | "quests"
    | "codex/voices"
    | "codex/achievements"
    | "codex/books"
    | "codex/character-stories"
    | "codex/items"
    | "codex/mechanics";
  entityType?: string;
  entityTypes?: string[];
  documentType?: string;
  documentTypes?: string[];
};

export const ARCHIVE_CATEGORIES: ArchiveCategory[] = [
  {
    id: "all",
    label: "全部资料",
    description: "浏览所有已发布内容",
    marker: "全",
    types: ["entity", "document", "segment"],
  },
  {
    id: "characters",
    label: "角色",
    description: "人物、别名与关系",
    marker: "角",
    types: ["entity"],
    entityType: "character",
  },
  {
    id: "regions",
    label: "地区与地点",
    description: "国家、区域与场景",
    marker: "域",
    types: ["entity"],
    entityType: "region",
  },
  {
    id: "factions",
    label: "阵营与 NPC",
    description: "组织、势力与非玩家角色",
    marker: "阵",
    types: ["entity"],
    entityTypes: ["faction", "npc"],
  },
  {
    id: "quests",
    label: "任务剧情",
    description: "魔神、传说、世界与活动任务",
    marker: "任",
    types: ["document", "segment"],
    route: "quests",
    documentTypes: [
      "archon_quest",
      "story_quest",
      "world_quest",
      "event_quest",
      "commission",
      "hangout",
      "other",
    ],
  },
  {
    id: "dialogue",
    label: "对话节点",
    description: "任务对话、旁白、选项与分支关系",
    marker: "话",
    types: ["document", "segment"],
    route: "quests",
    documentTypes: [
      "archon_quest",
      "story_quest",
      "world_quest",
      "event_quest",
      "commission",
      "hangout",
      "other",
    ],
  },
  {
    id: "voices",
    label: "角色语音",
    description: "角色语音文本与对应的游戏版本",
    marker: "声",
    types: ["document"],
    route: "codex/voices",
  },
  {
    id: "items",
    label: "物品图鉴",
    description: "物品文本、描述与来源",
    marker: "物",
    types: ["entity", "document", "segment"],
    route: "codex/items",
    entityTypes: ["item"],
    documentTypes: ["item_description"],
  },
  {
    id: "books",
    label: "书籍与设定",
    description: "书籍、世界设定与背景资料",
    marker: "书",
    types: ["document", "segment"],
    route: "codex/books",
    documentTypes: ["book", "lore"],
  },
  {
    id: "character-stories",
    label: "角色故事",
    description: "角色档案、故事与解锁文本",
    marker: "史",
    types: ["document", "segment"],
    route: "codex/character-stories",
    documentType: "character_story",
  },
  {
    id: "achievements",
    label: "成就",
    description: "成就目标、分类与奖励文本",
    marker: "成",
    types: ["document"],
    route: "codex/achievements",
  },
  {
    id: "mechanics",
    label: "教程与机制",
    description: "游戏内教程、帮助与机制说明",
    marker: "机",
    types: ["document", "segment"],
    route: "codex/mechanics",
  },
];

export function entityTypeLabel(type: string): string {
  return (
    {
      character: "角色",
      faction: "阵营",
      region: "地区",
      location: "地点",
      quest: "任务",
      concept: "概念",
      item: "物品",
      npc: "NPC",
    }[type] ?? type
  );
}

export function documentTypeLabel(type: string): string {
  return (
    {
      lore: "世界设定",
      archon_quest: "魔神任务",
      story_quest: "传说任务",
      world_quest: "世界任务",
      book: "书籍",
      character_story: "角色故事",
      item_description: "物品描述",
      event_quest: "活动任务",
      commission: "委托",
      hangout: "邀约任务",
      other: "其他任务",
    }[type] ?? type
  );
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

export type PreviewRoute = {
  candidateId: string;
  buildId?: string;
};

export function parsePreviewRoute(hash = window.location.hash): PreviewRoute | null {
  const match = /^#preview\/([^/?]+)(?:\/([^/?]+))?/.exec(hash);
  if (!match?.[1]) return null;
  return {
    candidateId: decodeURIComponent(match[1]),
    buildId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

export function adminHash(
  view: "intake" | "preview" | "issues" | "history",
  params?: URLSearchParams,
) {
  const query = params?.toString();
  return `admin/${view}${query ? `?${query}` : ""}`;
}

export const verificationStatusLabels: Record<VerificationStatus, string> = {
  not_checked: "未核验",
  exact_match: "逐字一致",
  formatting_only: "仅格式差异",
  mismatch: "内容不一致",
  unavailable_due_unlock: "尚未解锁",
  version_mismatch: "版本不一致",
};

export const verificationCategoryLabels: Record<string, string> = {
  book: "书籍",
  character_story: "角色故事",
  item_description: "物品描述",
};

export function reportMayBeStale(status: AcquisitionStatus, batches: AdminBatch[]): boolean {
  const generatedAt = status.generatedAt ? Date.parse(status.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) return false;
  return batches.some((batch) => {
    const createdAt = batch.createdAt ? Date.parse(batch.createdAt) : Number.NaN;
    return Number.isFinite(createdAt) && createdAt > generatedAt;
  });
}

export function revisionQuery(revisionId?: string): string {
  return revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : "";
}

export function releaseAuditGate(
  label: string,
  status: AcquisitionStatus | null,
  passed: boolean | undefined,
  detail: string,
): ReleaseGateItem {
  return {
    label,
    detail: status ? detail : "采集状态报告不可用",
    state: !status ? "unavailable" : passed ? "passed" : "blocked",
  };
}

export function releaseGateIcon(state: ReleaseGateState): string {
  return { passed: "✓", blocked: "!", checking: "…", unavailable: "—" }[state];
}

export function releaseGateLabel(state: ReleaseGateState): string {
  return { passed: "通过", blocked: "阻塞", checking: "检查中", unavailable: "无法检查" }[state];
}

export function releaseBlockerMessage(code: string): string {
  const messages: Record<string, string> = {
    import_has_errors: "导入批次仍包含错误",
    deletions_unconfirmed: "删除候选尚未全部确认",
    verification_blocked: "游戏内人工核验尚未通过",
    staged_data_missing: "暂存数据不存在",
    source_snapshot_missing: "来源快照不存在",
    acquisition_review_missing: "采集审核尚未完成",
    release_backup_missing: "缺少覆盖当前批次的发布前备份",
  };
  if (code.startsWith("invalid_status:")) return `批次状态不允许发布：${code.split(":")[1]}`;
  return messages[code] ?? code.replaceAll("_", " ");
}

export function releaseBlockerAction(code: string): "review" | "verify" | "release" | undefined {
  if (code.includes("verification")) return "verify";
  if (
    code.includes("import") ||
    code.includes("deletion") ||
    code.includes("status") ||
    code.includes("review")
  )
    return "review";
  if (code.includes("conflict") || code.includes("backup")) return "release";
  return undefined;
}

export function formatReleaseDetails(details: unknown): string {
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return "存在需要处理的附加信息";
  }
}

export function formatReleaseDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function releaseIndexStatusLabel(status: string): string {
  return (
    { ready: "索引就绪", pending: "等待索引", rebuilding: "正在重建", failed: "索引失败" }[
      status
    ] ?? status
  );
}

export function releaseJobTypeLabel(type: string): string {
  return { rebuild_search: "重建搜索索引", generate_embeddings: "生成 Embeddings" }[type] ?? type;
}

export function releaseJobStatusLabel(status: string): string {
  return (
    { completed: "已完成", running: "执行中", failed: "失败", pending: "等待中" }[status] ?? status
  );
}

export function releaseJobIcon(status: string): string {
  return { completed: "✓", running: "↻", failed: "!", pending: "·" }[status] ?? "·";
}
