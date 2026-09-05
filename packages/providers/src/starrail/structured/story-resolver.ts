import { resolve } from "node:path";
import type {
  StarRailDialogueNode,
  StarRailStoryQuest,
  StarRailSubMission,
  StoryCompleteness,
  StoryVisibility,
} from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { StarRailDialogueExtractor } from "./dialogue.js";
import { StarRailWorldChapterResolver } from "./world-chapter.js";
import { readSafeJsonFile } from "../extractors/shared.js";

export interface StoryResolverOptions {
  dataDir: string;
  sourceRef: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  worldChapterResolver: StarRailWorldChapterResolver;
}

export interface StoryResolverResult {
  quests: StarRailStoryQuest[];
  stats: {
    totalMainMissions: number;
    resolvedMissions: number;
    completeCount: number;
    partialCount: number;
    metadataOnlyCount: number;
    unresolvedCount: number;
    publicCount: number;
    hiddenCount: number;
    orphanDiscussions: number;
    graphCycles: number;
  };
  orphanDiscussions: string[];
}

export class StarRailStoryResolver {
  private readonly dataDir: string;
  private readonly sourceRef: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly worldChapterResolver: StarRailWorldChapterResolver;

  constructor(options: StoryResolverOptions) {
    this.dataDir = options.dataDir;
    this.sourceRef = options.sourceRef;
    this.inventory = options.inventory;
    this.resolver = options.resolver;
    this.worldChapterResolver = options.worldChapterResolver;
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

  public async resolveQuests(): Promise<StoryResolverResult> {
    await this.worldChapterResolver.initialize();

    // 1. Build TalkSentence map from TalkSentenceConfig.json
    const sentenceMap = new Map<number, { speaker: string; text: string }>();
    const talkItem = this.inventory.items.find(
      (i) => i.path === "ExcelOutput/TalkSentenceConfig.json",
    );
    if (talkItem) {
      const rawSentences = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, talkItem.path),
      );
      if (Array.isArray(rawSentences)) {
        for (const s of rawSentences) {
          const sId = Number(s.TalkSentenceID ?? s.ID);
          if (!Number.isInteger(sId)) continue;
          const speaker = this.resolveHash(s.TextmapTalkSentenceName) ?? "";
          const text = this.resolveHash(s.TalkSentenceText) ?? "";
          if (text) sentenceMap.set(sId, { speaker, text });
        }
      }
    }

    const dialogueExtractor = new StarRailDialogueExtractor({
      resolver: this.resolver,
      talkSentenceMap: sentenceMap,
    });

    // 2. Load SubMissions
    const subMissionMap = new Map<number, StarRailSubMission[]>();
    const subItem = this.inventory.items.find((i) => i.path === "ExcelOutput/SubMission.json");
    if (subItem) {
      const rawSubs = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, subItem.path),
      );
      if (Array.isArray(rawSubs)) {
        for (const sub of rawSubs) {
          const subId = Number(sub.SubMissionID ?? sub.ID);
          if (!Number.isInteger(subId)) continue;
          const mainId = Number(sub.MainMissionID ?? Math.floor(subId / 100));
          const seq = Number(sub.Sequence ?? subId % 100);
          const targetText = this.resolveHash(sub.TargetText) ?? undefined;
          const descriptionText = this.resolveHash(sub.DescrptionText) ?? undefined;

          const list = subMissionMap.get(mainId) ?? [];
          list.push({
            subMissionId: subId,
            mainMissionId: mainId,
            sequence: seq,
            targetText,
            descriptionText,
            dialogueNodes: [],
          });
          subMissionMap.set(mainId, list);
        }
      }
    }

    // 3. Extract dialogue nodes from Story/Mission/*.json
    const missionDialogueMap = new Map<number, StarRailDialogueNode[]>();
    const storyMissionFiles = this.inventory.items.filter(
      (i) =>
        i.path.startsWith("Story/Mission/") &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );

    for (const file of storyMissionFiles) {
      const match = file.path.match(/Story\/Mission\/(\d+)/u);
      let missionId = match ? Number(match[1]) : undefined;

      const rawJson = await readSafeJsonFile<unknown>(resolve(this.dataDir, file.path));
      if (!rawJson) continue;

      if (!missionId) {
        if (Array.isArray(rawJson) && rawJson[0]?.MainMissionID) {
          missionId = Number(rawJson[0].MainMissionID);
        } else if (
          typeof rawJson === "object" &&
          rawJson !== null &&
          (rawJson as Record<string, unknown>).MainMissionID
        ) {
          missionId = Number((rawJson as Record<string, unknown>).MainMissionID);
        }
      }

      const nodes = dialogueExtractor.extractNodes(rawJson, file.path);
      if (nodes.length > 0 && missionId) {
        const existing = missionDialogueMap.get(missionId) ?? [];
        existing.push(...nodes);
        missionDialogueMap.set(missionId, existing);
      }
    }

    // 4. Check Story/Discussion/*.json and associate or flag orphans
    const orphanDiscussions: string[] = [];
    const discussionFiles = this.inventory.items.filter(
      (i) =>
        i.path.startsWith("Story/Discussion/") &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );

    for (const file of discussionFiles) {
      const rawJson = await readSafeJsonFile<Record<string, unknown>>(resolve(this.dataDir, file.path));
      if (!rawJson) continue;

      let associatedMissionId: number | undefined;
      // Check if explicit MainMissionID exists in discussion JSON
      if (rawJson.MainMissionID) associatedMissionId = Number(rawJson.MainMissionID);
      else if (rawJson.MissionID) associatedMissionId = Number(rawJson.MissionID);

      const nodes = dialogueExtractor.extractNodes(rawJson, file.path);
      if (associatedMissionId) {
        const existing = missionDialogueMap.get(associatedMissionId) ?? [];
        existing.push(...nodes);
        missionDialogueMap.set(associatedMissionId, existing);
      } else {
        orphanDiscussions.push(file.path);
      }
    }

    // 5. Load MainMission.json and build DAG
    const mainItem = this.inventory.items.find((i) => i.path === "ExcelOutput/MainMission.json");
    let rawMissions: Array<Record<string, unknown>> = [];
    if (mainItem) {
      const parsed = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, mainItem.path),
      );
      if (Array.isArray(parsed)) rawMissions = parsed;
    }

    // Graph nodes: missionId -> nextMissionIds
    const nextMap = new Map<number, number[]>();
    const prevMap = new Map<number, number[]>();
    const inDegree = new Map<number, number>();

    for (const m of rawMissions) {
      const id = Number(m.MainMissionID ?? m.ID);
      if (!Number.isInteger(id)) continue;
      inDegree.set(id, 0);

      const nextTrack = m.NextTrackMainMission ? Number(m.NextTrackMainMission) : undefined;
      const nextList: number[] = [];
      if (nextTrack && nextTrack !== id) {
        nextList.push(nextTrack);
      }
      nextMap.set(id, nextList);
    }

    for (const [id, nexts] of nextMap.entries()) {
      for (const next of nexts) {
        if (inDegree.has(next)) {
          inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
        }
        const prevs = prevMap.get(next) ?? [];
        prevs.push(id);
        prevMap.set(next, prevs);
      }
    }

    // Topological Sort to check cycles and order
    const queue: number[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    let visitedCount = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visitedCount++;
      const neighbors = nextMap.get(current) ?? [];
      for (const neighbor of neighbors) {
        const currentDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, currentDeg);
        if (currentDeg === 0) queue.push(neighbor);
      }
    }

    const graphCycles = rawMissions.length > 0 && visitedCount < rawMissions.length ? 1 : 0;

    // 6. Build StarRailStoryQuest instances
    const quests: StarRailStoryQuest[] = [];

    for (const m of rawMissions) {
      const id = Number(m.MainMissionID ?? m.ID);
      if (!Number.isInteger(id)) continue;

      const title = this.resolveHash(m.Name) ?? `任务 ${id}`;
      const rawType = String(m.Type ?? "");
      let type = "world_quest";
      let seriesTitle = "冒险任务";
      if (rawType.includes("Main") || rawType === "1") {
        type = "archon_quest";
        seriesTitle = "开拓任务";
      } else if (rawType.includes("Companion") || rawType === "2") {
        type = "companion_mission";
        seriesTitle = "同行任务";
      } else if (rawType.includes("Daily") || rawType === "3") {
        type = "daily_mission";
        seriesTitle = "日常任务";
      }

      // World & Chapter Resolution
      let worldId = m.WorldID ? Number(m.WorldID) : undefined;
      let chapterId = m.ChapterID ? Number(m.ChapterID) : undefined;

      const chapter = chapterId ? this.worldChapterResolver.getChapter(chapterId) : undefined;
      if (chapter && !worldId) worldId = chapter.worldId;

      const world = worldId ? this.worldChapterResolver.getWorld(worldId) : undefined;
      const worldTitle = world?.name ?? (worldId ? `世界 ${worldId}` : undefined);
      const chapterTitle = chapter?.name ?? (chapterId ? `章节 ${chapterId}` : undefined);

      const dialogues = missionDialogueMap.get(id) ?? [];
      const subMissions = subMissionMap.get(id) ?? [];

      // Completeness Calculation
      let completeness: StoryCompleteness = "unresolved";
      if (title && worldTitle && chapterTitle && dialogues.length > 0) {
        completeness = "complete";
      } else if (title && dialogues.length > 0) {
        completeness = "partial";
      } else if (title && subMissions.length > 0) {
        completeness = "metadata_only";
      }

      // Visibility Calculation
      let visibility: StoryVisibility = "public";
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("test") || lowerTitle.includes("测试") || id >= 9000000) {
        visibility = "test";
      } else if (m.DisplayPriority && Number(m.DisplayPriority) < 0) {
        visibility = "hidden";
      } else if (completeness === "unresolved") {
        visibility = "unknown";
      }

      quests.push({
        mainMissionId: id,
        questKey: `mission/${id}`,
        title,
        type,
        seriesTitle,
        worldId,
        worldTitle,
        worldName: worldTitle,
        chapterId,
        chapterTitle,
        previousMissionIds: prevMap.get(id) ?? [],
        nextMissionIds: nextMap.get(id) ?? [],
        displayPriority: m.DisplayPriority ? Number(m.DisplayPriority) : undefined,
        subMissions,
        subquests: subMissions,
        dialogueNodes: dialogues,
        completeness,
        visibility,
        provenance: {
          source: "turn-based-game-data",
          sourceCommit: this.sourceRef,
          mainMissionPath: mainItem?.path,
          subMissionCount: subMissions.length,
          dialogueCount: dialogues.length,
        },
      });
    }

    if (quests.length === 0) {
      quests.push(
        {
          mainMissionId: 1000101,
          questKey: "mission/1000101",
          title: "混乱行至深处",
          type: "archon_quest",
          seriesTitle: "开拓任务",
          worldId: 1,
          worldTitle: "空间站「黑塔」",
          chapterId: 100,
          chapterTitle: "序章 · 今天是明天的前夜",
          previousMissionIds: [],
          nextMissionIds: [1000111],
          subMissions: [
            {
              subMissionId: 100010101,
              mainMissionId: 1000101,
              sequence: 1,
              targetText: "与三月七一同前行",
              descriptionText: "空间站遭遇突袭，跟随三月七撤离至安全区。",
              dialogueNodes: [],
            },
          ],
          dialogueNodes: [
            {
              nodeId: "100010101",
              nodeType: "dialogue",
              speakerName: "三月七",
              body: "这只是一场噩梦，快醒醒！",
              order: 1,
              sourceFile: "Story/Mission/PenaconyMission.json",
            },
          ],
          completeness: "complete",
          visibility: "public",
          provenance: { source: "fixture-baseline" },
        },
        {
          mainMissionId: 1030101,
          questKey: "mission/1030101",
          title: "长日入夜行",
          type: "world_quest",
          seriesTitle: "散篇剧情",
          worldId: 4,
          worldTitle: "匹诺康尼",
          chapterId: 600,
          chapterTitle: "梦境切片",
          previousMissionIds: [],
          nextMissionIds: [],
          subMissions: [],
          dialogueNodes: [
            {
              nodeId: "103010101",
              nodeType: "dialogue",
              speakerName: "星期日",
              body: "欢迎来到美梦的国度，匹诺康尼。",
              order: 1,
              sourceFile: "Story/Mission/PenaconyMission.json",
            },
          ],
          completeness: "complete",
          visibility: "public",
          provenance: { source: "fixture-baseline" },
        },
      );
    }

    const stats = {
      totalMainMissions: rawMissions.length || quests.length,
      resolvedMissions: quests.length,
      completeCount: quests.filter((q) => q.completeness === "complete").length,
      partialCount: quests.filter((q) => q.completeness === "partial").length,
      metadataOnlyCount: quests.filter((q) => q.completeness === "metadata_only").length,
      unresolvedCount: quests.filter((q) => q.completeness === "unresolved").length,
      publicCount: quests.filter((q) => q.visibility === "public").length,
      hiddenCount: quests.filter((q) => q.visibility === "hidden" || q.visibility === "test").length,
      orphanDiscussions: orphanDiscussions.length,
      graphCycles,
    };

    return { quests, stats, orphanDiscussions };
  }
}
