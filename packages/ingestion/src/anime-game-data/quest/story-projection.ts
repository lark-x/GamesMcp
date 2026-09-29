import type {
  StoryProjectionChapter,
  StoryProjectionFamily,
  StoryProjectionQuest,
  StoryProjectionRegion,
  StoryProjectionSubSeries,
} from "./types.js";

export type StoryProjectionInput = StoryProjectionQuest & {
  regionId: string;
  regionTitle: string;
  regionOrder?: number;
  familyId?: string;
  familyTitle?: string;
  familyOrder?: number;
  familyProvenance?: "upstream" | "derived" | "curated" | "fallback";
  subseriesId?: string;
  subseriesTitle?: string;
  subseriesOrder?: number;
  chapterId?: string;
  chapterTitle?: string;
  chapterOrder?: number;
};

/**
 * Project the already-resolved story structure into the read model.  This
 * function deliberately does not infer a family/chapter from a title or an
 * id: an absent chapter remains a direct family quest.
 */
export function projectStoryCatalog(rows: StoryProjectionInput[]): StoryProjectionRegion[] {
  const regions = new Map<string, StoryProjectionRegion>();
  for (const row of rows) {
    const region = regions.get(row.regionId) ?? {
      id: row.regionId,
      title: row.regionTitle,
      order: row.regionOrder ?? 0,
      families: [],
      quests: [],
      collections: [],
    };
    let family: StoryProjectionFamily | undefined;
    if (row.familyId || row.familyTitle) {
      family = region.families.find(
        (item) =>
          (row.familyId && item.id === row.familyId) ||
          (Boolean(row.familyTitle) && item.title === row.familyTitle),
      );
      if (!family && (row.familyId || row.familyTitle)) {
        const familyId = row.familyId ?? row.familyTitle!;
        family = {
          id: familyId,
          title: row.familyTitle ?? familyId,
          order: row.familyOrder ?? 0,
          provenance: row.familyProvenance ?? "derived",
          subseries: [],
          chapters: [],
          quests: [],
          collections: [],
        } satisfies StoryProjectionFamily;
        region.families.push(family);
      } else if (family) {
        if (typeof row.familyOrder === "number") {
          family.order = Math.min(family.order, row.familyOrder);
        }
        if (row.familyProvenance === "curated" || family.provenance === "fallback") {
          family.provenance = row.familyProvenance ?? family.provenance;
        }
      }
    }
    const { subseriesId, subseriesTitle, subseriesOrder, chapterId, chapterTitle, chapterOrder } =
      row;
    const entryObject: Record<string, unknown> = { ...row };
    for (const key of [
      "regionId",
      "regionTitle",
      "regionOrder",
      "familyId",
      "familyTitle",
      "familyOrder",
      "familyProvenance",
      "subseriesId",
      "subseriesTitle",
      "subseriesOrder",
      "chapterId",
      "chapterTitle",
      "chapterOrder",
    ])
      delete entryObject[key];
    const entry = entryObject as StoryProjectionQuest;
    const entryType = row.entryType ?? "quest";

    const appendUnique = (list: StoryProjectionQuest[], item: StoryProjectionQuest): void => {
      const existingIndex = list.findIndex((q) => q.questId === item.questId);
      if (existingIndex >= 0) {
        list[existingIndex] = { ...list[existingIndex], ...item };
      } else {
        list.push(item);
      }
    };

    if (!family) {
      if (entryType === "collection" || entryType === "aggregate") {
        region.collections ??= [];
        appendUnique(region.collections, entry);
      } else {
        region.quests ??= [];
        appendUnique(region.quests, entry);
      }
      regions.set(region.id, region);
      continue;
    }
    let container: StoryProjectionFamily | StoryProjectionSubSeries = family;
    if (subseriesId || subseriesTitle) {
      family.subseries ??= [];
      let subseries = family.subseries.find(
        (item) =>
          (subseriesId && item.id === subseriesId) ||
          (Boolean(subseriesTitle) && item.title === subseriesTitle),
      );
      if (!subseries && (subseriesId || subseriesTitle)) {
        const sid = subseriesId ?? subseriesTitle!;
        subseries = {
          id: sid,
          title: subseriesTitle ?? sid,
          order: subseriesOrder ?? 0,
          chapters: [],
          quests: [],
          collections: [],
        };
        family.subseries.push(subseries);
      } else if (subseries && typeof subseriesOrder === "number") {
        subseries.order = Math.min(subseries.order, subseriesOrder);
      }
      if (subseries) container = subseries;
    }
    let chapter: StoryProjectionChapter | undefined;
    if (chapterId || chapterTitle) {
      chapter = container.chapters.find(
        (item) =>
          (chapterId && item.id === chapterId) ||
          (Boolean(chapterTitle) && item.title === chapterTitle),
      );
      if (!chapter && (chapterId || chapterTitle)) {
        const cid = chapterId ?? chapterTitle!;
        chapter = {
          id: cid,
          title: chapterTitle ?? cid,
          order: chapterOrder ?? 0,
          quests: [],
          collections: [],
        };
        container.chapters.push(chapter);
      } else if (chapter && typeof chapterOrder === "number") {
        chapter.order = Math.min(chapter.order, chapterOrder);
      }
    }
    if (entryType === "collection" || entryType === "aggregate") {
      if (chapter) {
        chapter.collections ??= [];
        appendUnique(chapter.collections, entry);
      } else {
        container.collections ??= [];
        appendUnique(container.collections, entry);
      }
    } else if (chapter) {
      appendUnique(chapter.quests, entry);
    } else {
      container.quests ??= [];
      appendUnique(container.quests, entry);
    }
    regions.set(row.regionId, region);
  }
  const byOrder = <T extends { order: number; questId?: string; id?: string }>(items: T[]): T[] =>
    items.sort(
      (left, right) =>
        left.order - right.order ||
        (left.questId ?? left.id ?? "").localeCompare(right.questId ?? right.id ?? ""),
    );
  for (const region of regions.values()) {
    byOrder(region.quests ?? []);
    byOrder(region.collections ?? []);
    for (const family of region.families) {
      for (const chapter of family.chapters) {
        byOrder(chapter.quests);
        if (chapter.collections) byOrder(chapter.collections);
      }
      if (family.quests) byOrder(family.quests);
      if (family.collections) byOrder(family.collections);
      byOrder(family.chapters);
      for (const subseries of family.subseries ?? []) {
        for (const chapter of subseries.chapters) {
          byOrder(chapter.quests);
          if (chapter.collections) byOrder(chapter.collections);
        }
        if (subseries.quests) byOrder(subseries.quests);
        if (subseries.collections) byOrder(subseries.collections);
        byOrder(subseries.chapters);
      }
      if (family.subseries) byOrder(family.subseries);
    }
    byOrder(region.families);
  }
  return byOrder([...regions.values()]);
}
