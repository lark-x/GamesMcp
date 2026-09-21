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
  chapterId: string;
  chapterTitle: string;
  chapterOrder?: number;
};

/** Project data quests into Region → Family → Chapter → Quest without inventing dialogue stages. */
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
      } satisfies StoryProjectionFamily;
      region.families.push(family);
    }
    let chapter = family.chapters.find((item) => item.id === row.chapterId);
    if (!chapter) {
      chapter = {
        id: row.chapterId,
        title: row.chapterTitle,
        order: row.chapterOrder ?? 0,
        quests: [],
      };
      family.chapters.push(chapter);
    }
    const {
      regionId: _regionId,
      regionTitle: _regionTitle,
      regionOrder: _regionOrder,
      familyId: _familyId,
      familyTitle: _familyTitle,
      familyOrder: _familyOrder,
      chapterId: _chapterId,
      chapterTitle: _chapterTitle,
      chapterOrder: _chapterOrder,
      ...quest
    } = row;
    chapter.quests.push(quest);
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
      byOrder(family.chapters);
    }
    byOrder(region.families);
  }
  return byOrder([...regions.values()]);
}
