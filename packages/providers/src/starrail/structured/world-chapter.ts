import { resolve } from "node:path";
import type { StarRailChapter, StarRailWorld } from "./types.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";

export interface WorldChapterResolverOptions {
  dataDir: string;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailWorldChapterResolver {
  private readonly dataDir: string;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;
  private worlds: Map<number, StarRailWorld> = new Map();
  private chapters: Map<number, StarRailChapter> = new Map();
  private initialized = false;

  constructor(options: WorldChapterResolverOptions) {
    this.dataDir = options.dataDir;
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

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // TurnBasedGameData ships world names in WorldDataConfig.json and mission
    // chapters in MissionChapterConfig.json; there is no WorldConfig/ChapterConfig.
    const worldPath = "ExcelOutput/WorldDataConfig.json";
    const rawWorlds = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, worldPath),
    );

    if (Array.isArray(rawWorlds)) {
      for (const row of rawWorlds) {
        const id = Number(row.ID ?? row.WorldID);
        if (!Number.isInteger(id)) continue;
        const name =
          this.resolveHash(row.WorldName) ??
          this.resolveHash(row.WorldNameTextMapHash) ??
          this.resolveHash(row.Name) ??
          `世界 ${id}`;
        const desc = this.resolveHash(row.WorldDesc) ?? undefined;

        this.worlds.set(id, {
          id,
          worldId: id,
          name,
          order: id,
          description: desc,
          sourceFile: worldPath,
        });
      }
    }

    if (this.worlds.size === 0 && this.fixture) {
      this.populateBaselineWorlds();
    }

    const chapterPath = "ExcelOutput/MissionChapterConfig.json";
    const rawChapters = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, chapterPath),
    );
    const chapterOriginMission = new Map<number, number>();
    const chapterFinalMission = new Map<number, number>();

    if (Array.isArray(rawChapters)) {
      for (const row of rawChapters) {
        const id = Number(row.ID ?? row.ChapterID);
        if (!Number.isInteger(id)) continue;
        // ChapterName holds a textmap key that is not present in TextMap; the
        // display name lives in ChapterSequence.Hash. Curated fallbacks win
        // because some ChapterSequence hashes are reused/misassigned upstream.
        const name =
          CHAPTER_FALLBACK_NAMES[id] ??
          this.resolveHash(row.ChapterSequence) ??
          this.resolveHash(row.ChapterName) ??
          this.resolveHash(row.Name);
        const desc = this.resolveHash(row.ChapterDesc) ?? undefined;
        const order = Number(row.ChapterDisplayPriority ?? row.Order ?? id);
        const chapterType =
          typeof row.ChapterType === "string" ? (row.ChapterType as string) : undefined;

        this.chapters.set(id, {
          id,
          chapterId: id,
          worldId: 0,
          name: name ?? CHAPTER_FALLBACK_NAMES[id] ?? `章节 ${id}`,
          order,
          description: desc,
          chapterType,
          sourceFile: chapterPath,
        });
        const origin = Number(row.OriginMainMission);
        const final = Number(row.FinalMainMission);
        if (Number.isInteger(origin) && origin > 0) {
          chapterOriginMission.set(id, origin);
        }
        if (Number.isInteger(final) && final > 0) {
          chapterFinalMission.set(id, final);
        }
      }
    }

    if (this.chapters.size === 0 && this.fixture) {
      this.populateBaselineChapters();
    }

    // MissionChapterConfig carries no WorldID; derive chapter -> world from the
    // WorldID that MainMission rows report for that chapter. Origin/Final
    // missions declared on the chapter take precedence over per-mission noise.
    const mainItem = "ExcelOutput/MainMission.json";
    const rawMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, mainItem),
    );
    const missionWorld = new Map<number, number>();
    if (Array.isArray(rawMissions)) {
      const votes = new Map<number, Map<number, number>>();
      for (const m of rawMissions) {
        const id = Number(m.MainMissionID);
        const worldId = Number(m.WorldID);
        if (Number.isInteger(id) && Number.isInteger(worldId) && worldId > 0) {
          missionWorld.set(id, worldId);
        }
        const chapterId = Number(m.ChapterID);
        if (!Number.isInteger(chapterId) || !Number.isInteger(worldId) || worldId <= 0) continue;
        const tallies = votes.get(chapterId) ?? new Map<number, number>();
        tallies.set(worldId, (tallies.get(worldId) ?? 0) + 1);
        votes.set(chapterId, tallies);
      }
      for (const [chapterId, tallies] of votes) {
        const chapter = this.chapters.get(chapterId);
        if (!chapter) continue;
        let bestWorld = 0;
        let bestCount = 0;
        for (const [worldId, count] of tallies) {
          if (count > bestCount) {
            bestWorld = worldId;
            bestCount = count;
          }
        }
        if (bestWorld > 0) chapter.worldId = bestWorld;
      }
      for (const chapter of this.chapters.values()) {
        const anchor =
          Number(chapterOriginMission.get(Number(chapter.chapterId))) ||
          Number(chapterFinalMission.get(Number(chapter.chapterId)));
        const anchorWorld = anchor > 0 ? missionWorld.get(anchor) : undefined;
        if (anchorWorld && anchorWorld > 0) chapter.worldId = anchorWorld;
        if (!chapter.worldId) {
          const fallback = CHAPTER_FALLBACK_WORLDS[Number(chapter.chapterId)];
          if (fallback) chapter.worldId = fallback;
        }
      }
    }

    this.initialized = true;
  }

  private populateBaselineWorlds(): void {
    // Real WorldDataConfig ID space, used only when the config file is absent
    // (fixture sources).
    const baselines: Array<{ id: number; name: string }> = [
      { id: 100, name: "星穹列车" },
      { id: 101, name: "空间站「黑塔」" },
      { id: 201, name: "雅利洛-Ⅵ" },
      { id: 301, name: "仙舟「罗浮」" },
      { id: 401, name: "匹诺康尼" },
      { id: 501, name: "翁法罗斯" },
      { id: 601, name: "二相乐园" },
      { id: 602, name: "千星城" },
    ];
    for (const b of baselines) {
      this.worlds.set(b.id, {
        id: b.id,
        worldId: b.id,
        name: b.name,
        order: b.id,
        sourceFile: "ExcelOutput/WorldDataConfig.json",
      });
    }
  }

  private populateBaselineChapters(): void {
    const baselines: Array<{ id: number; worldId: number; name: string }> = [
      { id: 100001, worldId: 101, name: "序幕•第一节" },
      { id: 100000, worldId: 101, name: "「均衡」的试炼" },
      { id: 101001, worldId: 201, name: "第一幕•第一节" },
      { id: 102001, worldId: 301, name: "第二幕•第一节" },
      { id: 103001, worldId: 301, name: "第三幕•第一节" },
      { id: 104001, worldId: 501, name: "第四幕•第一节" },
      { id: 105001, worldId: 501, name: "第五幕•第一节" },
    ];
    for (const b of baselines) {
      this.chapters.set(b.id, {
        id: b.id,
        chapterId: b.id,
        worldId: b.worldId,
        name: b.name,
        order: b.id,
        sourceFile: "ExcelOutput/MissionChapterConfig.json",
      });
    }
  }

  public getWorld(worldId: number): StarRailWorld | undefined {
    return this.worlds.get(worldId);
  }

  public getChapter(chapterId: number): StarRailChapter | undefined {
    return this.chapters.get(chapterId);
  }

  public getAllWorlds(): StarRailWorld[] {
    return Array.from(this.worlds.values()).sort((a, b) => a.order - b.order);
  }

  public getAllChapters(): StarRailChapter[] {
    return Array.from(this.chapters.values()).sort((a, b) => a.order - b.order);
  }
}

// Chapters whose display name cannot be resolved from the textmap (no
// ChapterSequence hash in MissionChapterConfig). Names fall back to official
// activity titles or member-mission titles; worlds anchor known chapters.
const CHAPTER_FALLBACK_NAMES: Record<number, string> = {
  100000: "「均衡」的试炼",
  200110: "寻人记",
  201001: "博物馆经营",
  500401: "支线篇章",
  500501: "支线篇章",
  600001: "空间站支线篇章",
  600011: "空间站支线篇章",
  601021: "雅利洛支线篇章",
  601051: "仙舟同行篇章",
  601061: "同行篇章",
  601071: "同行篇章",
  601081: "我的挚爱，我的血肉",
  601091: "宇宙幻觉之夜",
  601101: "假面双人舞",
  601201: "钟表把戏",
  801411: "以太战线",
  801511: "罗浮异闻",
  801611: "异宠拾遗",
  802001: "客制运单",
  802111: "成为调饮师",
  802211: "停转的时钟",
  802311: "折纸小鸟对对碰",
  802401: "初花剑客行",
  802501: "叩关赛",
  802601: "美梦进行曲",
  802701: "宇宙家装指南",
  803101: "论奇美拉的工作美德",
  803201: "豹豹碰碰大作战",
  803401: "折纸小鸟对对碰",
  803501: "掉进妖精树洞",
  803601: "小小一只大地兽",
  803801: "黄金嗷呜大师赛",
  804001: "鼹鼠之歌",
  804101: "尘灵乱世录",
  804202: "又上骰了！战力党",
  804401: "谁动了我的经费",
  804501: "千星城狂飙飞车",
};

const CHAPTER_FALLBACK_WORLDS: Record<number, number> = {
  100000: 101,
  200110: 401,
  601091: 401,
  802701: 401,
  803601: 501,
};
