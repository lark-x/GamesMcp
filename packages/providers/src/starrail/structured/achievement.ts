import { resolve } from "node:path";
import type { StarRailAchievement } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";

export interface AchievementExtractorOptions {
  dataDir: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailAchievementExtractor {
  private readonly dataDir: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: AchievementExtractorOptions) {
    this.dataDir = options.dataDir;
    this.inventory = options.inventory;
    this.resolver = options.resolver;
    this.fixture = options.fixture ?? false;
  }

  private resolveHash(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === "number" || typeof val === "string") {
      return this.resolver.resolve(val);
    }
    if (typeof val === "object") {
      const rec = val as Record<string, unknown>;
      const hash = rec.Hash ?? rec.hash ?? rec.TextMapHash;
      if (hash !== undefined && hash !== null) {
        return this.resolver.resolve(hash as string | number);
      }
    }
    return null;
  }

  public async extractAchievements(): Promise<StarRailAchievement[]> {
    const achItem = this.inventory.items.find((i) => i.path === "ExcelOutput/AchievementData.json");
    if (!achItem) {
      return this.fixture ? this.getBaselineAchievements() : [];
    }

    const rawAchs = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, achItem.path),
    );
    if (!Array.isArray(rawAchs) || rawAchs.length === 0) {
      return this.fixture ? this.getBaselineAchievements() : [];
    }

    // Load series titles
    const seriesItem = this.inventory.items.find(
      (i) => i.path === "ExcelOutput/AchievementSeries.json",
    );
    const seriesMap = new Map<number, string>();
    if (seriesItem) {
      const rawSeries = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, seriesItem.path),
      );
      if (Array.isArray(rawSeries)) {
        for (const s of rawSeries) {
          const sId = Number(s.SeriesID ?? s.ID);
          if (!Number.isInteger(sId)) continue;
          const title = this.resolveHash(s.SeriesTitle) ?? `成就分类 ${sId}`;
          seriesMap.set(sId, title);
        }
      }
    }

    const achievements: StarRailAchievement[] = [];
    for (const a of rawAchs) {
      const id = Number(a.AchievementID ?? a.ID);
      if (!Number.isInteger(id)) continue;

      const title = this.resolveHash(a.AchievementTitle) ?? `成就 ${id}`;
      const description = this.resolveHash(a.AchievementDesc) ?? "";
      const seriesId = Number(a.SeriesID ?? 1);
      const isHidden = a.ShowType === "ShowAfterFinish" || Boolean(a.IsHidden);
      const rewardJade = Number(a.Raid ?? 5);

      achievements.push({
        id,
        title,
        name: title,
        seriesId,
        seriesTitle: seriesMap.get(seriesId),
        description,
        rewardJade,
        isHidden,
        priority: a.Priority ? Number(a.Priority) : undefined,
      });
    }

    if (achievements.length === 0 && this.fixture) {
      return this.getBaselineAchievements();
    }
    return achievements;
  }

  private getBaselineAchievements(): StarRailAchievement[] {
    return [
      {
        id: 4040101,
        title: "通往群星的轨道",
        name: "通往群星的轨道",
        seriesId: 1,
        seriesTitle: "通往群星的轨道",
        description: "登上「星穹列车」，踏上开拓的旅程。",
        rewardJade: 10,
        isHidden: false,
      },
      {
        id: 4050101,
        title: "毁灭的归毁灭",
        name: "毁灭的归毁灭",
        seriesId: 2,
        seriesTitle: "战意奔涌",
        description: "击败反物质军团先锋部队，平息空间站危机。",
        rewardJade: 5,
        isHidden: false,
      },
      {
        id: 4060101,
        title: "猫咪的摇篮",
        name: "猫咪的摇篮",
        seriesId: 3,
        seriesTitle: "与你同行的回忆",
        description: "在列车上与三月七拍照留念。",
        rewardJade: 5,
        isHidden: true,
      },
    ];
  }
}
