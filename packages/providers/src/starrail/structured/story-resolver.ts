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
  fixture?: boolean;
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
    orphanMissionSources: number;
    graphCycles: number;
  };
  orphanDiscussions: string[];
  orphanMissionSources: string[];
}

export class StarRailStoryResolver {
  private readonly dataDir: string;
  private readonly sourceRef: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly worldChapterResolver: StarRailWorldChapterResolver;
  private readonly fixture: boolean;

  constructor(options: StoryResolverOptions) {
    this.dataDir = options.dataDir;
    this.sourceRef = options.sourceRef;
    this.inventory = options.inventory;
    this.resolver = options.resolver;
    this.worldChapterResolver = options.worldChapterResolver;
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

    // 2. Load the exact MainMission/SubMission relation before reading story
    // files.  Live data uses both MainMissionID directories and SubMissionID
    // directories, so path arithmetic alone is not a safe association rule.
    const mainItem = this.inventory.items.find((i) => i.path === "ExcelOutput/MainMission.json");
    let rawMissions: Array<Record<string, unknown>> = [];
    if (mainItem) {
      const parsed = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, mainItem.path),
      );
      if (Array.isArray(parsed)) rawMissions = parsed;
    }
    const missionIds = new Set(
      rawMissions
        .map((mission) => Number(mission.MainMissionID ?? mission.ID))
        .filter((id): id is number => Number.isInteger(id)),
    );

    // 3. Load SubMissions
    const subMissionMap = new Map<number, StarRailSubMission[]>();
    const subMissionToMain = new Map<number, number>();
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
          if (!missionIds.has(mainId)) continue;
          subMissionToMain.set(subId, mainId);
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

    const missionIdFromPath = (filePath: string): number | undefined => {
      const match = filePath.match(/Story\/(?:Discussion\/)?Mission\/(\d+)/u);
      if (!match) return undefined;
      const directoryId = Number(match[1]);
      if (missionIds.has(directoryId)) return directoryId;
      const mapped = subMissionToMain.get(directoryId);
      return mapped !== undefined && missionIds.has(mapped) ? mapped : undefined;
    };

    const subMissionIdFromPath = (filePath: string): number | undefined => {
      const match = filePath.match(/(?:Story|DS)(\d+)\.json$/u);
      if (!match) return undefined;
      const subMissionId = Number(match[1]);
      return subMissionToMain.has(subMissionId) ? subMissionId : undefined;
    };

    const explicitMissionId = (value: unknown): number | undefined => {
      if (!value || typeof value !== "object") return undefined;
      if (Array.isArray(value)) {
        for (const item of value) {
          const nested = explicitMissionId(item);
          if (nested !== undefined) return nested;
        }
        return undefined;
      }
      const record = value as Record<string, unknown>;
      for (const key of ["MainMissionID", "MainMissionId", "MissionID", "MissionId"]) {
        const id = Number(record[key]);
        if (Number.isInteger(id) && missionIds.has(id)) return id;
      }
      return undefined;
    };

    const orphanMissionSources: string[] = [];

    // 4. Extract dialogue nodes from Story/Mission/*.json
    const missionDialogueMap = new Map<number, StarRailDialogueNode[]>();
    const subMissionDialogueMap = new Map<number, Map<number, StarRailDialogueNode[]>>();
    const seenNodesByMission = new Map<number, Set<string>>();
    const storyMissionFiles = this.inventory.items.filter(
      (i) =>
        i.path.startsWith("Story/Mission/") &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );

    const appendNodes = (
      missionId: number,
      nodes: StarRailDialogueNode[],
      subMissionId?: number,
    ): void => {
      const missionNodes = missionDialogueMap.get(missionId) ?? [];
      const seen = seenNodesByMission.get(missionId) ?? new Set<string>();
      const subMap = subMissionDialogueMap.get(missionId) ?? new Map<number, StarRailDialogueNode[]>();
      const subNodes = subMissionId !== undefined ? subMap.get(subMissionId) ?? [] : undefined;

      for (const node of nodes) {
        const identity = `${node.nodeId}\u0000${node.speakerName ?? ""}\u0000${node.body}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const normalized = { ...node, order: missionNodes.length + 1 };
        missionNodes.push(normalized);
        if (subNodes) subNodes.push({ ...normalized, order: subNodes.length + 1 });
      }
      if (missionNodes.length > 0) missionDialogueMap.set(missionId, missionNodes);
      seenNodesByMission.set(missionId, seen);
      if (subNodes && subNodes.length > 0) {
        subMap.set(subMissionId!, subNodes);
        subMissionDialogueMap.set(missionId, subMap);
      }
    };

    for (const file of storyMissionFiles) {
      const rawJson = await readSafeJsonFile<unknown>(resolve(this.dataDir, file.path));
      if (!rawJson) continue;

      const missionId = missionIdFromPath(file.path) ?? explicitMissionId(rawJson);
      if (missionId === undefined) {
        orphanMissionSources.push(file.path);
        continue;
      }

      const nodes = dialogueExtractor.extractNodes(rawJson, file.path);
      appendNodes(missionId, nodes, subMissionIdFromPath(file.path));
    }

    // 5. Check Story/Discussion/*.json and associate or flag orphans
    const orphanDiscussions: string[] = [];
    const discussionFiles = this.inventory.items.filter(
      (i) =>
        i.path.startsWith("Story/Discussion/") &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );

    for (const file of discussionFiles) {
      const rawJson = await readSafeJsonFile<unknown>(
        resolve(this.dataDir, file.path),
      );
      if (!rawJson) continue;

      // A large part of the live archive stores the relationship only in
      // Story/Discussion/Mission/<mainMissionId-or-subMissionId>/..., so the
      // exact MainMission/SubMission index is authoritative here.
      const associatedMissionId = missionIdFromPath(file.path) ?? explicitMissionId(rawJson);

      const nodes = dialogueExtractor.extractNodes(rawJson, file.path);
      if (associatedMissionId !== undefined) {
        appendNodes(associatedMissionId, nodes, subMissionIdFromPath(file.path));
      } else {
        orphanDiscussions.push(file.path);
        orphanMissionSources.push(file.path);
      }
    }

    // 6. Build the MainMission graph
    const nextMap = new Map<number, number[]>();
    const prevMap = new Map<number, number[]>();
    const inDegree = new Map<number, number>();

    for (const m of rawMissions) {
      const id = Number(m.MainMissionID ?? m.ID);
      if (!Number.isInteger(id)) continue;
      inDegree.set(id, 0);

      const nextList = new Set<number>();
      const nextTrack = Number(m.NextTrackMainMission);
      if (Number.isInteger(nextTrack) && nextTrack !== id && missionIds.has(nextTrack)) {
        nextList.add(nextTrack);
      }
      const declaredNext = m.NextMainMissionList;
      if (Array.isArray(declaredNext)) {
        for (const value of declaredNext) {
          const next =
            typeof value === "object" && value !== null
              ? Number((value as Record<string, unknown>).MainMissionID ?? (value as Record<string, unknown>).ID)
              : Number(value);
          if (Number.isInteger(next) && next !== id && missionIds.has(next)) nextList.add(next);
        }
      }
      nextMap.set(id, [...nextList].sort((a, b) => a - b));
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

    const graphCycles = missionIds.size > 0 && visitedCount < missionIds.size ? 1 : 0;

    // Build connected mission-chain components. MainMission's chapter labels
    // are reused for many unrelated companion missions, so the chain root is
    // part of the family identity instead of treating the label as a family.
    const componentByMission = new Map<number, number>();
    const componentFor = (id: number): number => {
      const cached = componentByMission.get(id);
      if (cached !== undefined) return cached;
      const members = new Set<number>([id]);
      const queue = [id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of [
          ...(nextMap.get(current) ?? []),
          ...(prevMap.get(current) ?? []),
        ]) {
          if (!missionIds.has(neighbor) || members.has(neighbor)) continue;
          members.add(neighbor);
          queue.push(neighbor);
        }
      }
      const root = [...members].sort((a, b) => a - b)[0] ?? id;
      for (const member of members) componentByMission.set(member, root);
      return root;
    };

    const familyTitleIsGeneric = (value: string | undefined): boolean =>
      !value ||
      ["同行篇章", "开拓篇章", "开拓任务", "冒险任务", "日常任务", "活动任务"].includes(
        value.trim(),
      );

    // 7. Build StarRailStoryQuest instances
    const quests: StarRailStoryQuest[] = [];

    for (const m of rawMissions) {
      const id = Number(m.MainMissionID ?? m.ID);
      if (!Number.isInteger(id)) continue;

      const title = this.resolveHash(m.Name) ?? `任务 ${id}`;
      const rawType = String(m.Type ?? "");
      let type = "adventure_quest";
      let seriesTitle = "冒险任务";
      if (rawType.includes("Main") || rawType === "1") {
        type = "trailblaze_mission";
        seriesTitle = "开拓任务";
      } else if (rawType.includes("Companion") || rawType === "2") {
        type = "companion_mission";
        seriesTitle = "同行任务";
      } else if (rawType.includes("Daily") || rawType === "3") {
        type = "daily_mission";
        seriesTitle = "日常任务";
      } else if (rawType.includes("Gap") || rawType === "4") {
        type = "trailblaze_continuation";
        seriesTitle = "开拓续闻";
      }

      // World & Chapter Resolution
      let worldId = m.WorldID ? Number(m.WorldID) : undefined;
      let chapterId = m.ChapterID ? Number(m.ChapterID) : undefined;

      const chapter = chapterId ? this.worldChapterResolver.getChapter(chapterId) : undefined;
      if (chapter && !worldId) worldId = chapter.worldId;

      const world = worldId ? this.worldChapterResolver.getWorld(worldId) : undefined;
      const worldTitle = world?.name ?? (worldId ? `世界 ${worldId}` : undefined);
      const chapterTitle = chapter?.name ?? (chapterId ? `章节 ${chapterId}` : undefined);
      const sequence = Number(m.Sequence ?? m.MissionSequence ?? m.Order ?? 0) || undefined;
      const componentRoot = componentFor(id);
      const rootMission = rawMissions.find(
        (candidate) => Number(candidate.MainMissionID ?? candidate.ID) === componentRoot,
      );
      const rootTitle = this.resolveHash(rootMission?.Name) ?? title;
      // Keep the chapter as the child node in the public tree.  Prefixing it
      // with the real mission type avoids the old duplicate
      // "chapter = family = 第三幕•第一节" rendering while retaining a
      // deterministic family identity for separate mission-chain components.
      const familyTitle = familyTitleIsGeneric(chapterTitle)
        ? `${seriesTitle} · ${rootTitle}`
        : `${seriesTitle} · ${chapterTitle!}`;
      const familyId = `starrail:family:${worldId ?? 0}:${chapterId ?? 0}:${componentRoot}`;
      const familyOrder = Math.min(
        ...[...componentByMission.entries()]
          .filter(([, root]) => root === componentRoot)
          .map(([missionId]) => {
            const row = rawMissions.find((candidate) => Number(candidate.MainMissionID ?? candidate.ID) === missionId);
            return Number(row?.DisplayPriority ?? row?.Sequence ?? missionId);
          }),
        Number(m.DisplayPriority ?? sequence ?? id),
      );

      const dialogues = missionDialogueMap.get(id) ?? [];
      const subDialogueMap = subMissionDialogueMap.get(id) ?? new Map();
      const subMissions = (subMissionMap.get(id) ?? []).map((subMission) => ({
        ...subMission,
        dialogueNodes: subDialogueMap.get(subMission.subMissionId) ?? [],
      }));

      // Completeness Calculation
      let completeness: StoryCompleteness = "unresolved";
      if (title && worldTitle && chapterTitle && dialogues.length > 0) {
        completeness = "complete";
      } else if (title && dialogues.length > 0) {
        completeness = "partial";
      } else if (title && subMissions.length > 0) {
        completeness = "metadata_only";
      }
      const speakerUnresolved = dialogues.some(
        (node) => node.nodeType === "dialogue" && !node.speakerName,
      );
      const qualityCode =
        completeness === "complete"
          ? speakerUnresolved
            ? "speaker_unresolved"
            : "complete"
          : completeness === "partial"
            ? "partial_dialogue"
            : completeness === "metadata_only"
              ? "metadata_only"
              : "source_missing";

      // Visibility Calculation
      let visibility: StoryVisibility = "public";
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("test") || lowerTitle.includes("测试") || id >= 9000000) {
        visibility = "test";
      } else if (m.DisplayPriority && Number(m.DisplayPriority) < 0) {
        visibility = "hidden";
      } else if (rawType === "Branch" && dialogues.length === 0) {
        // Branch rows are internal objective/state records, not public quest
        // documents. Keeping them in the audit output is useful, but putting
        // them in the public tree creates thousands of empty duplicate tasks.
        visibility = "internal";
      } else if (completeness === "unresolved") {
        visibility = "unknown";
      }

      quests.push({
        mainMissionId: id,
        questKey: `mission/${id}`,
        title,
        type,
        seriesTitle,
        storyFamilyId: familyId,
        storyFamilyTitle: familyTitle,
        storyFamilyProvenance: chapterTitle && !familyTitleIsGeneric(chapterTitle) ? "upstream" : "derived",
        storyFamilyOrder: Number.isFinite(familyOrder) ? familyOrder : undefined,
        worldId,
        worldTitle,
        worldName: worldTitle,
        chapterId,
        chapterTitle,
        chapterOrder: chapter?.order ?? sequence,
        previousMissionIds: prevMap.get(id) ?? [],
        nextMissionIds: nextMap.get(id) ?? [],
        sequence,
        displayPriority: m.DisplayPriority ? Number(m.DisplayPriority) : undefined,
        subMissions,
        subquests: subMissions,
        dialogueNodes: dialogues,
        completeness,
        qualityCode,
        visibility,
        provenance: {
          source: "turn-based-game-data",
          sourceCommit: this.sourceRef,
          mainMissionPath: mainItem?.path,
          subMissionCount: subMissions.length,
          dialogueCount: dialogues.length,
          dialogueSourceFiles: [...new Set(dialogues.map((node) => node.sourceFile))],
          sourceAssociation: "exact_main_or_sub_mission_path",
        },
      });
    }

    if (quests.length === 0 && this.fixture) {
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
      hiddenCount: quests.filter((q) => q.visibility === "hidden" || q.visibility === "test")
        .length,
      orphanDiscussions: orphanDiscussions.length,
      orphanMissionSources: orphanMissionSources.length,
      graphCycles,
    };

    return { quests, stats, orphanDiscussions, orphanMissionSources };
  }
}
