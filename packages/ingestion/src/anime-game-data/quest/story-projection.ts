import type {
  StoryProjectionFamily,
  StoryProjectionQuest,
  StoryProjectionRegion,
} from "./types.js";

export type StoryProjectionInput = StoryProjectionQuest & {
  regionId: string;
  regionTitle: string;
  regionOrder?: number;
  familyId: string;
  familyTitle: string;
  familyOrder?: number;
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
        chapters: [],
        quests: [],
        collections: [],
      } satisfies StoryProjectionFamily;
      region.families.push(family);
    }
    const {
      regionId: _regionId,
      regionTitle: _regionTitle,
      regionOrder: _regionOrder,
      familyId: _familyId,
      familyTitle: _familyTitle,
      familyOrder: _familyOrder,
      chapterId,
      chapterTitle,
      chapterOrder,
      ...entry
    } = row;
    const entryType = row.entryType ?? "quest";
    if (entryType === "collection" || entryType === "aggregate") {
      family.collections ??= [];
      family.collections.push(entry);
    } else if (chapterId) {
      let chapter = family.chapters.find((item) => item.id === chapterId);
      if (!chapter) {
        chapter = {
          id: chapterId,
          title: chapterTitle ?? chapterId,
          order: chapterOrder ?? 0,
          quests: [],
        };
        family.chapters.push(chapter);
      }
      chapter.quests.push(entry);
    } else {
      family.quests ??= [];
      family.quests.push(entry);
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
      for (const chapter of family.chapters) byOrder(chapter.quests);
      if (family.quests) byOrder(family.quests);
      if (family.collections) byOrder(family.collections);
      byOrder(family.chapters);
    }
    byOrder(region.families);
  }
  return byOrder([...regions.values()]);
}
