export type PublicStoryAuditRecord = {
  questId: string;
  regionId?: string;
  familyId?: string;
  entryType?: "quest" | "collection" | "aggregate";
  aggregateChildQuestIds?: string[];
  contentRole?: string;
  dialogueNodeCount?: number;
  hasNarrativeSource?: boolean;
};

export type PublicStoryAudit = {
  duplicateQuestPlacements: Array<{ questId: string; placements: number }>;
  orphanAggregates: string[];
  crossRegionFamilies: Array<{ familyId: string; regionIds: string[]; questIds: string[] }>;
  emptyNarrativeTasks: string[];
};

export function auditPublicStory(records: PublicStoryAuditRecord[]): PublicStoryAudit {
  const questCounts = new Map<string, number>();
  const familyRows = new Map<string, PublicStoryAuditRecord[]>();
  for (const record of records) {
    questCounts.set(record.questId, (questCounts.get(record.questId) ?? 0) + 1);
    if (record.familyId) {
      const rows = familyRows.get(record.familyId) ?? [];
      rows.push(record);
      familyRows.set(record.familyId, rows);
    }
  }
  return {
    duplicateQuestPlacements: [...questCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([questId, placements]) => ({ questId, placements }))
      .sort((a, b) => a.questId.localeCompare(b.questId)),
    orphanAggregates: records
      .filter((record) => record.entryType === "collection" || record.entryType === "aggregate")
      .filter((record) => (record.aggregateChildQuestIds?.length ?? 0) === 0)
      .map((record) => record.questId)
      .sort(),
    crossRegionFamilies: [...familyRows.entries()]
      .flatMap(([familyId, rows]) => {
        const regionIds = [...new Set(rows.map((row) => row.regionId).filter(Boolean) as string[])];
        return regionIds.length > 1
          ? [
              {
                familyId,
                regionIds: regionIds.sort(),
                questIds: rows.map((row) => row.questId).sort(),
              },
            ]
          : [];
      })
      .sort((a, b) => a.familyId.localeCompare(b.familyId)),
    emptyNarrativeTasks: records
      .filter((record) => ["story", "story_and_control"].includes(record.contentRole ?? ""))
      .filter((record) => record.hasNarrativeSource && (record.dialogueNodeCount ?? 0) === 0)
      .map((record) => record.questId)
      .sort(),
  };
}
