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
  familyId: string;
  familyTitle: string;
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
    };
    let family = region.families.find((item) => item.id === row.familyId);
    if (!family) {
      family = {
        id: row.familyId,
        title: row.familyTitle,
        order: row.familyOrder ?? 0,
        provenance: row.familyProvenance ?? "derived",
        subseries: [],
        chapters: [],
        quests: [],
        collections: [],
      } satisfies StoryProjectionFamily;
      region.families.push(family);
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
    let container: StoryProjectionFamily | StoryProjectionSubSeries = family;
    if (subseriesId) {
      family.subseries ??= [];
      let subseries = family.subseries.find((item) => item.id === subseriesId);
      if (!subseries) {
        subseries = {
          id: subseriesId,
          title: subseriesTitle ?? subseriesId,
          order: subseriesOrder ?? 0,
          chapters: [],
          quests: [],
          collections: [],
        };
        family.subseries.push(subseries);
      }
      container = subseries;
    }
    let chapter: StoryProjectionChapter | undefined;
    if (chapterId) {
      chapter = container.chapters.find((item) => item.id === chapterId);
      if (!chapter) {
        chapter = {
          id: chapterId,
          title: chapterTitle ?? chapterId,
          order: chapterOrder ?? 0,
          quests: [],
          collections: [],
        };
        container.chapters.push(chapter);
      }
    }
    if (entryType === "collection" || entryType === "aggregate") {
      if (chapter) {
        chapter.collections ??= [];
        chapter.collections.push(entry);
      } else {
        container.collections ??= [];
        container.collections.push(entry);
      }
    } else if (chapter) {
      chapter.quests.push(entry);
    } else {
      container.quests ??= [];
      container.quests.push(entry);
    }
    regions.set(row.regionId, region);
  }
  const byOrder = <T extends { order: number }>(items: T[]): T[] =>
    items.sort(
      (left, right) =>
        left.order - right.order || JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  for (const region of regions.values()) {
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
