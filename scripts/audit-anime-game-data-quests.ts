import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildRecord,
  convertQuestSnapshot,
  DEFAULT_QUEST_UPSTREAM_DIR,
} from "./anime-game-data-quest-converter.ts";
import { auditPublicStory } from "../packages/ingestion/src/anime-game-data/quest/index.ts";
import { runStoragePreflight } from "./check-data-storage.ts";

const execFileAsync = promisify(execFile);
const locales = ["zh-CN", "en"] as const;
type Locale = (typeof locales)[number];
type ReportObject = Record<string, unknown>;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nodeSourceFiles(record: ReturnType<typeof buildRecord>): string[] {
  return unique(
    (record.quest?.dialogueNodes ?? []).map((node) => {
      const value = node.metadata?.sourceFile;
      return typeof value === "string" ? value : undefined;
    }),
  );
}

function recordSourceFiles(record: ReturnType<typeof buildRecord>): string[] {
  const provenance = record.metadata.provenance as { sourceFiles?: unknown } | undefined;
  const sourceFiles = Array.isArray(provenance?.sourceFiles)
    ? provenance.sourceFiles.filter((value): value is string => typeof value === "string")
    : [];
  return unique([...sourceFiles, ...nodeSourceFiles(record)]);
}

async function upstreamMetadata(upstreamDir: string) {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H%n%cI%n%s"], {
      cwd: upstreamDir,
    });
    const [commit = "unknown", commitDate = "unknown", subject = "unknown"] = stdout
      .trim()
      .split("\n");
    return { commit, commitDate, subject };
  } catch {
    return { commit: "unknown", commitDate: "unknown", subject: "unknown" };
  }
}

function sourcePathReason(record: ReturnType<typeof buildRecord>): string[] {
  const reasons: string[] = [];
  const quest = record.quest;
  const status = quest?.dialogueResolutionStatus;
  const nonNarrative = ["control", "trigger", "reward", "aggregate"].includes(
    quest?.contentRole ?? "",
  );
  if (!quest?.dialogueNodes.length && !nonNarrative) reasons.push("missing_dialogue_nodes");
  if (!quest?.dialogueNodes.length && !quest?.subquests.length && !nonNarrative)
    reasons.push("missing_subquests");
  if (status && status !== "resolved" && status !== "not_applicable")
    reasons.push(`dialogue_${status}`);
  if (quest?.contentRole && !["story", "story_and_control"].includes(quest.contentRole))
    reasons.push(`content_role_${quest.contentRole}`);
  if (quest?.qualityCode === "speaker_unresolved") reasons.push("speaker_name_unresolved");
  if (record.metadata.titleResolutionMethod === "unresolved") reasons.push("title_unresolved");
  if (quest?.visibility !== "public") reasons.push(`visibility_${quest?.visibility ?? "unknown"}`);
  return reasons;
}

function taskLocaleReport(
  record: ReturnType<typeof buildRecord> | undefined,
  mainId: string,
  locale: Locale,
  publicKeys: Set<string>,
  excludedByKey: Map<string, string>,
  failureByKey: Map<string, string>,
  resolution:
    | {
        talkIds: string[];
        resolvedTalkIds: string[];
        unresolvedTalkIds: string[];
        ambiguousTalkIds: string[];
        ambiguityDiagnostics?: unknown[];
        candidates: Array<Record<string, unknown>>;
      }
    | undefined,
): ReportObject {
  if (!record?.quest) {
    const sourceKey = `quest/${mainId}/locale/${locale}`;
    return {
      status: "parser_failed",
      qualityCode: "parser_failed",
      reasons: [failureByKey.get(sourceKey) ?? "record_not_built"],
    };
  }
  const quest = record.quest;
  const sourceFiles = recordSourceFiles(record);
  return {
    status: publicKeys.has(`${mainId}/${locale}`)
      ? "public"
      : excludedByKey.has(record.sourceKey)
        ? "excluded"
        : "built",
    title: record.title,
    displayTitle: quest.displayTitle,
    questType: quest.questType,
    regionId: quest.regionId,
    region: quest.regionName,
    chapterId: quest.chapterId,
    chapter: quest.chapterTitle,
    chapterOrder: quest.chapterOrder,
    seriesId: quest.seriesId,
    series: quest.seriesTitle,
    familyId: quest.storyFamilyId,
    family: quest.storyFamilyTitle,
    familyProvenance: quest.storyFamilyProvenance,
    familyOrder: quest.storyFamilyOrder,
    storyPosition: quest.storyPosition,
    contentRole: quest.contentRole,
    dialogueResolutionStatus: quest.dialogueResolutionStatus,
    talkIds: quest.talkIds ?? [],
    resolvedTalkIds: quest.resolvedTalkIds ?? [],
    unresolvedTalkIds: quest.unresolvedTalkIds ?? [],
    talkSourceKinds: quest.talkSourceKinds ?? [],
    relationEdgeCount: quest.questRelationEdges?.length ?? 0,
    relationEdges: quest.questRelationEdges,
    topology: quest.topology,
    dialogueDiagnostics: quest.dialogueDiagnostics,
    storyProjection: quest.storyProjection,
    talkResolution: resolution
      ? {
          talkIds: resolution.talkIds,
          resolvedTalkIds: resolution.resolvedTalkIds,
          unresolvedTalkIds: resolution.unresolvedTalkIds,
          ambiguousTalkIds: resolution.ambiguousTalkIds,
          ambiguityDiagnostics: resolution.ambiguityDiagnostics,
          candidates: resolution.candidates,
        }
      : undefined,
    subquestCount: quest.subquests.length,
    dialogueNodeCount: quest.dialogueNodes.length,
    dialogueEdgeCount: quest.dialogueEdges.length,
    speakerUnresolvedCount: quest.dialogueNodes.filter(
      (node) => Boolean(node.speakerKey) && !node.speakerName,
    ).length,
    qualityCode: quest.qualityCode,
    completeness: quest.completeness,
    completenessReasons: quest.completenessReasons,
    bodyAvailability:
      quest.dialogueNodes.length > 0
        ? "dialogue"
        : quest.subquests.some((subquest) => Boolean(subquest.objective))
          ? "objective_only"
          : "none",
    sourceFiles,
    dialogueLineage: record.metadata.provenance?.lineage?.dialogue,
    reasons: [
      ...sourcePathReason(record),
      ...(excludedByKey.has(record.sourceKey)
        ? [`excluded:${excludedByKey.get(record.sourceKey)}`]
        : []),
    ],
  };
}

function groupedTitles(
  tasks: ReportObject[],
  field: string,
): Array<{ title: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const task of tasks) {
    const title = typeof task[field] === "string" ? String(task[field]) : undefined;
    const id = typeof task.mainQuestId === "string" ? task.mainQuestId : undefined;
    if (!title || !id) continue;
    const ids = groups.get(title) ?? [];
    ids.push(id);
    groups.set(title, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([title, ids]) => ({ title, ids: [...new Set(ids)].sort() }))
    .sort(
      (left, right) => right.ids.length - left.ids.length || left.title.localeCompare(right.title),
    );
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function auditMetricSummary(
  summary: ReportObject | undefined,
  manifest: ReportObject | undefined,
  tasksValue?: unknown,
) {
  const talk = (summary?.talkAudit as ReportObject | undefined) ?? {};
  const dialogue = (summary?.dialogueAudit as ReportObject | undefined) ?? {};
  const contentRole = (summary?.contentRoleZh as Record<string, unknown> | undefined) ?? {};
  const manifestCounts = (manifest?.counts as ReportObject | undefined) ?? {};
  const publicNarrative = (summary?.publicNarrative as ReportObject | undefined) ?? {};
  const allNarrative = (summary?.allNarrative as ReportObject | undefined) ?? {};
  const baselineNarrativeTasks = Array.isArray(tasksValue)
    ? tasksValue.flatMap((taskValue) => {
        const task = taskValue as ReportObject;
        const locales = task.locales as Record<string, ReportObject> | undefined;
        const zh = locales?.["zh-CN"];
        return zh && ["story", "story_and_control"].includes(String(zh.contentRole ?? ""))
          ? [zh]
          : [];
      })
    : [];
  const baselinePublicNarrativeTasks = baselineNarrativeTasks.filter(
    (item) => item.status === "public",
  );
  return {
    resolvedQuestCount:
      numberFrom(summary?.talkResolvedQuestCount) ??
      numberFrom(summary?.resolvedQuestCount) ??
      null,
    dialogueNodeCount:
      numberFrom(dialogue.dialogueNodes) ?? numberFrom(manifestCounts.dialogueNodes) ?? null,
    fallbackFamilyCount: numberFrom(summary?.fallbackFamilyCount) ?? null,
    standaloneQuestCount: numberFrom(summary?.standaloneQuestCount) ?? null,
    aggregateCount: numberFrom(contentRole.aggregate) ?? null,
    controlCount:
      (numberFrom(contentRole.control) ?? 0) +
      (numberFrom(contentRole.trigger) ?? 0) +
      (numberFrom(contentRole.reward) ?? 0),
    talkUnresolvedCount:
      numberFrom(talk.unresolvedTalkIds) ?? numberFrom(summary?.talkProblemQuestCount) ?? null,
    danglingEdgeCount: numberFrom(dialogue.danglingEdges) ?? null,
    publicNarrativeQuestCount:
      numberFrom(publicNarrative.questCount) ?? baselinePublicNarrativeTasks.length,
    publicNarrativeResolvedCount:
      numberFrom(publicNarrative.resolvedCount) ??
      baselinePublicNarrativeTasks.filter((item) => item.dialogueResolutionStatus === "resolved")
        .length,
    publicNarrativeDialogueNodes:
      numberFrom(publicNarrative.dialogueNodes) ??
      baselinePublicNarrativeTasks.reduce(
        (sum, item) => sum + (numberFrom(item.dialogueNodeCount) ?? 0),
        0,
      ),
    allNarrativeQuestCount: numberFrom(allNarrative.questCount) ?? baselineNarrativeTasks.length,
    allNarrativeResolvedCount:
      numberFrom(allNarrative.resolvedCount) ??
      baselineNarrativeTasks.filter((item) => item.dialogueResolutionStatus === "resolved").length,
    allNarrativeDialogueNodes:
      numberFrom(allNarrative.dialogueNodes) ??
      baselineNarrativeTasks.reduce(
        (sum, item) => sum + (numberFrom(item.dialogueNodeCount) ?? 0),
        0,
      ),
  };
}

async function main() {
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));

  const upstreamDir = resolve(argValue("upstream") ?? DEFAULT_QUEST_UPSTREAM_DIR);
  const outputBase = resolve(argValue("output") ?? "reports/genshin-quest-audit");
  const git = await upstreamMetadata(upstreamDir);
  const result = await convertQuestSnapshot({
    upstreamDir,
    profile: process.argv.includes("--profile"),
    context: {
      upstreamCommit: git.commit,
      upstreamCommitDate: git.commitDate,
      gameVersion: argValue("game-version") ?? "audit",
      upstreamVersionLabel: git.subject,
    },
  });
  const inputs = result.auditInputs;
  const auditByMainLocale = new Map(
    result.auditRecords.flatMap((record) => {
      const mainId = record.quest?.mainQuestId;
      return mainId ? [[`${mainId}/${record.locale}`, record] as const] : [];
    }),
  );
  const publicKeys = new Set(
    result.records.map((record) => `${record.quest?.mainQuestId}/${record.locale}`),
  );
  const excludedByKey = new Map(
    result.manifest.excluded.map((item) => [item.sourceKey, item.reason]),
  );
  const failureByKey = new Map(
    result.manifest.failures.map((item) => [item.sourceKey, item.reason]),
  );

  const tasks = inputs.mainQuest.map((main) => {
    const mainId = idText(main.id ?? main.mainQuestId) ?? "unknown";
    const relations = inputs.mainQuestRelations.get(mainId) ?? [];
    const binQuest = inputs.binQuestByMainId.get(mainId);
    const resolved = inputs.resolvedTalksByMainId.get(mainId);
    const localesReport = Object.fromEntries(
      locales.map((locale) => [
        locale,
        taskLocaleReport(
          auditByMainLocale.get(`${mainId}/${locale}`),
          mainId,
          locale,
          publicKeys,
          excludedByKey,
          failureByKey,
          resolved
            ? {
                talkIds: resolved.talkIds,
                resolvedTalkIds: resolved.resolvedTalkIds,
                unresolvedTalkIds: resolved.unresolvedTalkIds,
                ambiguousTalkIds: resolved.ambiguousTalkIds,
                ambiguityDiagnostics: resolved.ambiguityDiagnostics,
                candidates: resolved.candidates.map((candidate) => ({
                  talkId: candidate.talkId,
                  subQuestId: candidate.subQuestId,
                  subQuestIds: candidate.subQuestIds,
                  sourceKind: candidate.sourceKind,
                  sourceFile: candidate.sourceFile,
                  confidence: candidate.confidence,
                  score: candidate.score,
                  status: candidate.status,
                  evidence: candidate.evidence,
                  evidences: candidate.evidences,
                  resolutionReason: candidate.resolutionReason,
                })),
              }
            : undefined,
        ),
      ]),
    ) as Record<Locale, ReportObject>;
    const zh = localesReport["zh-CN"];
    return {
      mainQuestId: mainId,
      rawTitle: main.title,
      rawType: main.type ?? main.questType,
      directSeries: main.series,
      relationIds: relations,
      contentRole: zh.contentRole,
      dialogueResolutionStatus: zh.dialogueResolutionStatus,
      talkIds: zh.talkIds ?? [],
      resolvedTalkIds: zh.resolvedTalkIds ?? [],
      unresolvedTalkIds: zh.unresolvedTalkIds ?? [],
      relationEdgeCount: zh.relationEdgeCount ?? 0,
      codexSourceFile: inputs.codexQuestByMainId.get(mainId)?.relativePath,
      explicitQuestRows: (inputs.questByMainId.get(mainId) ?? []).length,
      locales: localesReport,
      qualityCode: zh.qualityCode,
      familyId: zh.familyId,
      family: zh.family,
      chapter: zh.chapter,
      dialogueNodeCount: zh.dialogueNodeCount ?? 0,
      sourceFiles: zh.sourceFiles ?? [],
      binQuest: binQuest
        ? {
            sourceFile: binQuest.sourceFile,
            subQuestIds: binQuest.subQuestIds,
            contentCounts: binQuest.contentCounts,
            execCounts: binQuest.execCounts,
            completeTalkIds: binQuest.completeTalkIds,
            relationEdges: binQuest.relationEdges,
          }
        : undefined,
    };
  });

  const zhTasks = tasks.map((task) => task.locales["zh-CN"]);
  const familyTasks = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const familyId = typeof task.familyId === "string" ? task.familyId : undefined;
    if (!familyId) continue;
    const list = familyTasks.get(familyId) ?? [];
    list.push(task);
    familyTasks.set(familyId, list);
  }
  const fallbackFamilies = [...familyTasks.keys()].filter((id) =>
    id.startsWith("genshin:standalone:"),
  );
  const standaloneTasks = tasks.filter(
    (task) => typeof task.familyId === "string" && task.familyId.startsWith("genshin:standalone:"),
  );
  const familiesWithOneQuest = [...familyTasks.entries()]
    .filter(([, members]) => members.length === 1)
    .map(([id]) => id)
    .sort();
  const familiesWithOnlyAggregate = [...familyTasks.entries()]
    .filter(
      ([, members]) =>
        members.length > 0 && members.every((task) => task.contentRole === "aggregate"),
    )
    .map(([id]) => id)
    .sort();
  const orphanAggregate = tasks
    .filter((task) => task.contentRole === "aggregate")
    .filter((task) => {
      const topology = task.locales["zh-CN"].topology as ReportObject | undefined;
      return (
        !Array.isArray(topology?.aggregateChildQuestIds) ||
        topology.aggregateChildQuestIds.length === 0
      );
    })
    .map((task) => task.mainQuestId)
    .sort();
  const crossRegionFamily = [...familyTasks.entries()]
    .filter(([, members]) => {
      const regions = new Set(
        members.map((task) => task.locales["zh-CN"].regionId as string | undefined).filter(Boolean),
      );
      return regions.size > 1;
    })
    .map(([id]) => id)
    .sort();
  const publicStoryAudit = auditPublicStory(
    tasks.flatMap((task) => {
      const zh = task.locales["zh-CN"];
      if (zh.status !== "public") return [];
      const projection = zh.storyProjection as ReportObject | undefined;
      return [
        {
          questId: task.mainQuestId,
          regionId: typeof zh.regionId === "string" ? zh.regionId : undefined,
          familyId: typeof zh.familyId === "string" ? zh.familyId : undefined,
          entryType:
            projection?.entryType === "collection" ||
            projection?.entryType === "aggregate" ||
            projection?.entryType === "quest"
              ? projection.entryType
              : undefined,
          aggregateChildQuestIds: stringArray(projection?.aggregateChildQuestIds),
          contentRole: typeof zh.contentRole === "string" ? zh.contentRole : undefined,
          dialogueNodeCount: numberFrom(zh.dialogueNodeCount),
          // A COMPLETE_TALK reference alone is not a body source: old builds
          // can retain the identity after the corresponding Talk/Dialog asset
          // has disappeared. Gate only tasks with an actually resolved source.
          hasNarrativeSource:
            stringArray(zh.resolvedTalkIds).length > 0 || Boolean(task.codexSourceFile),
        },
      ];
    }),
  );

  const topologyEdges = tasks.flatMap((task) => {
    const topology = task.locales["zh-CN"].topology as ReportObject | undefined;
    return Array.isArray(topology?.derivedRelationEdges) ? topology.derivedRelationEdges : [];
  }) as ReportObject[];
  const rawEdges = tasks.flatMap((task) => {
    const topology = task.locales["zh-CN"].topology as ReportObject | undefined;
    return Array.isArray(topology?.rawRelationEdges) ? topology.rawRelationEdges : [];
  }) as ReportObject[];
  const topologyAudit = {
    rawRelationEdges: rawEdges.length,
    derivedRelationEdges: topologyEdges.length,
    requiresEdges: topologyEdges.filter((edge) => edge.relationType === "requires").length,
    aggregateEdges: topologyEdges.filter((edge) => edge.relationType === "aggregate_of").length,
    startsAfterEdges: topologyEdges.filter((edge) => edge.relationType === "starts_after").length,
    cycles: tasks
      .filter((task) => (task.locales["zh-CN"].topology as ReportObject | undefined)?.cycle)
      .map((task) => task.mainQuestId),
    orphanNodes: tasks
      .filter((task) => (task.locales["zh-CN"].relationEdgeCount ?? 0) === 0)
      .map((task) => task.mainQuestId),
    connectedComponents: [
      ...new Map(
        [...inputs.questFamilyComponents.values()].map((component) => [
          [...component].sort().join(","),
          component,
        ]),
      ).values(),
    ],
    danglingEdges: tasks.reduce((sum, task) => {
      const topology = task.locales["zh-CN"].topology as ReportObject | undefined;
      return sum + (Array.isArray(topology?.danglingEdges) ? topology.danglingEdges.length : 0);
    }, 0),
  };

  const talkResolutionProblems = [...inputs.resolvedTalksByMainId.entries()].flatMap(
    ([mainQuestId, resolved]) => [
      ...(resolved.unresolvedTalkIds.length
        ? [{ mainQuestId, kind: "unresolved", talkIds: resolved.unresolvedTalkIds }]
        : []),
      ...(resolved.ambiguousTalkIds.length
        ? [
            {
              mainQuestId,
              kind: "ambiguous",
              talkIds: resolved.ambiguousTalkIds,
              diagnostics: resolved.ambiguityDiagnostics,
            },
          ]
        : []),
    ],
  );
  const referencedTalkIds = new Set(tasks.flatMap((task) => stringArray(task.talkIds)));
  const sourceFilesUsed = new Set(tasks.flatMap((task) => task.sourceFiles));
  const registeredTalkFilesNotReferenced = inputs.talkRegistry.files
    .filter((file) => !sourceFilesUsed.has(file.relativePath))
    .map((file) => ({
      relativePath: file.relativePath,
      sourceKind: file.sourceKind,
      embeddedTalkId: file.embeddedTalkId,
      parsed: file.parsed,
      metadataScanned: file.metadataScanned,
      dialogueRowCount: file.dialogueRowCount ?? 0,
    }));
  const orphanDialogueAssets = inputs.talkRegistry.files
    .filter(
      (file) =>
        file.sourceKind !== "npc_group" &&
        Boolean(file.embeddedTalkId) &&
        !referencedTalkIds.has(file.embeddedTalkId!),
    )
    .map((file) => ({
      talkId: file.embeddedTalkId,
      sourceKind: file.sourceKind,
      relativePath: file.relativePath,
      dialogueRows: file.dialogueRowCount ?? 0,
    }));
  const metadataScanFailures = inputs.talkRegistry.files
    .filter((file) => file.metadataScanned && !file.fileHash)
    .map((file) => file.relativePath);

  const zhRecords = result.auditRecords.filter((record) => record.locale === "zh-CN");
  const dialogueNodes = zhRecords.flatMap((record) => record.quest?.dialogueNodes ?? []);
  const dialogueEdges = zhRecords.flatMap((record) => record.quest?.dialogueEdges ?? []);
  const bodyGroups = new Map<string, string[]>();
  const speakerBodyGroups = new Map<string, string[]>();
  const dialogIdTalkGroups = new Map<string, Set<string>>();
  const exactIdentityGroups = new Map<string, string[]>();
  for (const node of dialogueNodes) {
    const body = node.body.trim();
    if (!body) continue;
    const nodeKey = node.nodeKey;
    const bodyList = bodyGroups.get(body) ?? [];
    bodyList.push(nodeKey);
    bodyGroups.set(body, bodyList);
    const speakerBody = `${node.speakerKey ?? ""}\u0000${body}`;
    const speakerList = speakerBodyGroups.get(speakerBody) ?? [];
    speakerList.push(nodeKey);
    speakerBodyGroups.set(speakerBody, speakerList);
    const talkId = typeof node.metadata?.talkId === "string" ? node.metadata.talkId : undefined;
    if (talkId) {
      const talkIds = dialogIdTalkGroups.get(String(node.nodeId)) ?? new Set<string>();
      talkIds.add(talkId);
      dialogIdTalkGroups.set(String(node.nodeId), talkIds);
    }
    const exactIdentity = [
      String(node.metadata?.sourceFile ?? ""),
      talkId ?? "",
      node.subquestKey ?? "",
      String(node.nodeId),
      node.speakerKey ?? "",
      body,
    ].join("\u0000");
    const exactList = exactIdentityGroups.get(exactIdentity) ?? [];
    exactList.push(nodeKey);
    exactIdentityGroups.set(exactIdentity, exactList);
  }
  const duplicateGroups = (groups: Map<string, string[]>) =>
    [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => ({ key, count: ids.length, nodeKeys: ids.slice(0, 20) }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  const dialogueAudit = {
    dialogueNodes: dialogueNodes.length,
    dialogueEdges: dialogueEdges.length,
    danglingEdges: zhRecords.reduce(
      (sum, record) => sum + (record.quest?.dialogueDiagnostics?.danglingEdges.length ?? 0),
      0,
    ),
    rootlessGraphs: zhRecords
      .filter((record) => record.quest?.dialogueDiagnostics?.graphHasNoRoot)
      .map((record) => record.quest?.mainQuestId),
    cyclicGraphs: zhRecords
      .filter((record) => record.quest?.dialogueDiagnostics?.cycle)
      .map((record) => record.quest?.mainQuestId),
    missingTextNodes: zhRecords.reduce(
      (sum, record) => sum + (record.quest?.dialogueDiagnostics?.missingTextNodes.length ?? 0),
      0,
    ),
    missingSpeakerNodes: zhRecords.reduce(
      (sum, record) => sum + (record.quest?.dialogueDiagnostics?.missingSpeakerNodes.length ?? 0),
      0,
    ),
    duplicateBodyNodes: duplicateGroups(bodyGroups).reduce(
      (sum, group) => sum + group.count - 1,
      0,
    ),
    duplicateSpeakerBodyNodes: duplicateGroups(speakerBodyGroups).reduce(
      (sum, group) => sum + group.count - 1,
      0,
    ),
    duplicateExactIdentityNodes: duplicateGroups(exactIdentityGroups).reduce(
      (sum, group) => sum + group.count - 1,
      0,
    ),
    duplicateDialogIdsAcrossTalks: [...dialogIdTalkGroups.entries()]
      .filter(([, talkIds]) => talkIds.size > 1)
      .map(([dialogId, talkIds]) => ({ dialogId, talkIds: [...talkIds].sort() })),
    duplicateBodyGroups: duplicateGroups(bodyGroups).slice(0, 200),
    duplicateSpeakerBodyGroups: duplicateGroups(speakerBodyGroups).slice(0, 200),
    duplicateExactIdentityGroups: duplicateGroups(exactIdentityGroups).slice(0, 200),
    disconnectedComponents: zhRecords.reduce(
      (sum, record) => sum + (record.quest?.dialogueDiagnostics?.disconnectedComponentCount ?? 0),
      0,
    ),
    rootlessComponents: zhRecords.reduce(
      (sum, record) => sum + (record.quest?.dialogueDiagnostics?.rootlessComponentCount ?? 0),
      0,
    ),
    stronglyConnectedComponents: zhRecords.reduce(
      (sum, record) =>
        sum + (record.quest?.dialogueDiagnostics?.stronglyConnectedComponents?.length ?? 0),
      0,
    ),
    unreachableDialogueIds: zhRecords.reduce(
      (sum, record) =>
        sum + (record.quest?.dialogueDiagnostics?.unreachableDialogueIds?.length ?? 0),
      0,
    ),
  };

  const duplicateFamilyTitles = groupedTitles(
    tasks.map((task) => ({ mainQuestId: task.mainQuestId, family: task.family })),
    "family",
  );
  const duplicateChapterTitles = groupedTitles(
    tasks.map((task) => ({ mainQuestId: task.mainQuestId, chapter: task.chapter })),
    "chapter",
  );
  const narrativeSummary = (items: ReportObject[]) => ({
    questCount: items.length,
    resolvedCount: items.filter((item) => item.dialogueResolutionStatus === "resolved").length,
    dialogueNodes: items.reduce((sum, item) => sum + (numberFrom(item.dialogueNodeCount) ?? 0), 0),
    emptyWithSource: items.filter((item) => {
      const talkIds = stringArray(item.talkIds);
      return talkIds.length > 0 && (numberFrom(item.dialogueNodeCount) ?? 0) === 0;
    }).length,
  });
  const allNarrativeTasks = zhTasks.filter((item) =>
    ["story", "story_and_control"].includes(String(item.contentRole ?? "")),
  );
  const publicNarrativeTasks = allNarrativeTasks.filter((item) => item.status === "public");
  const summary = {
    mainQuests: inputs.mainQuest.length,
    auditLocaleRecords: result.auditRecords.length,
    publicLocaleRecords: result.records.length,
    excludedLocaleRecords: result.manifest.excluded.length,
    parserFailures: result.manifest.failures.length,
    metadataOnlyZh: tasks.filter((task) => task.qualityCode === "metadata_only").length,
    partialZh: tasks.filter((task) => task.qualityCode === "partial_dialogue").length,
    completeZh: tasks.filter((task) => task.qualityCode === "complete").length,
    unresolvedSpeakerZh: tasks.filter((task) => task.qualityCode === "speaker_unresolved").length,
    resolvedQuestCount: zhTasks.filter((task) => task.dialogueResolutionStatus === "resolved")
      .length,
    familyCount: familyTasks.size,
    fallbackFamilyCount: fallbackFamilies.length,
    standaloneQuestCount: standaloneTasks.length,
    duplicateTitleGroups: duplicateChapterTitles.length,
    duplicateFamilyTitles,
    duplicateChapterTitles,
    familiesWithOneQuest,
    familiesWithOnlyAggregate,
    orphanAggregate,
    crossRegionFamily,
    contentRoleZh: countValues(
      zhTasks.flatMap((item) => (typeof item.contentRole === "string" ? [item.contentRole] : [])),
    ),
    dialogueResolutionStatusZh: countValues(
      zhTasks.flatMap((item) =>
        typeof item.dialogueResolutionStatus === "string" ? [item.dialogueResolutionStatus] : [],
      ),
    ),
    talkResolvedQuestCount: zhTasks.filter((item) => item.dialogueResolutionStatus === "resolved")
      .length,
    talkProblemQuestCount: talkResolutionProblems.length,
    topologyAudit,
    talkAudit: {
      expectedTalkIds: [...inputs.resolvedTalksByMainId.values()].reduce(
        (sum, item) => sum + item.talkIds.length,
        0,
      ),
      resolvedTalkIds: [...inputs.resolvedTalksByMainId.values()].reduce(
        (sum, item) => sum + item.resolvedTalkIds.length,
        0,
      ),
      unresolvedTalkIds: [...inputs.resolvedTalksByMainId.values()].reduce(
        (sum, item) => sum + item.unresolvedTalkIds.length,
        0,
      ),
      ambiguousTalkIds: [...inputs.resolvedTalksByMainId.values()].reduce(
        (sum, item) => sum + item.ambiguousTalkIds.length,
        0,
      ),
      duplicateTalkAssets: inputs.talkRegistry.duplicateTalkIds.length,
      talkAssetsByKind: inputs.talkRegistry.coverage.fileCountsByKind,
      lazyLoadedByKind: inputs.talkRegistry.coverage.lazyLoadedByKind ?? {},
      metadataScannedFiles: inputs.talkRegistry.coverage.metadataScannedFiles ?? 0,
    },
    dialogueAudit,
    publicStoryAudit,
    allNarrative: narrativeSummary(allNarrativeTasks),
    publicNarrative: narrativeSummary(publicNarrativeTasks),
  };

  const baselinePath = argValue("baseline");
  let baseline: ReportObject | undefined;
  if (baselinePath) {
    const requestedPath = resolve(baselinePath);
    const baselineFile = (await stat(requestedPath)).isDirectory()
      ? `${requestedPath}.json`
      : requestedPath;
    baseline = JSON.parse(await readFile(baselineFile, "utf8")) as ReportObject;
  }
  const currentMetric = auditMetricSummary(summary, result.manifest as unknown as ReportObject);
  const beforeMetric = baseline
    ? auditMetricSummary(
        baseline.summary as ReportObject | undefined,
        baseline.conversionManifest as ReportObject | undefined,
        baseline.tasks,
      )
    : undefined;
  const delta = Object.fromEntries(
    Object.entries(currentMetric).map(([key, current]) => {
      const before = beforeMetric?.[key as keyof typeof currentMetric];
      return [
        key,
        typeof current === "number" && typeof before === "number" ? current - before : null,
      ];
    }),
  );
  const beforeAfter = { before: beforeMetric ?? null, after: currentMetric, delta };

  const focusIds = [
    "21009",
    "72236",
    "73013",
    "73019",
    "73020",
    "73021",
    "73022",
    "73189",
    "74001",
    "74002",
    "74003",
    "74004",
    "74072",
    "74073",
    "74074",
    "74075",
    "74076",
    "74077",
    "74078",
    "74165",
    "74183",
    "74184",
    "74194",
    "74195",
    "74196",
    "76148",
    "76152",
  ];
  const report = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    upstream: { directory: upstreamDir, ...git },
    summary: { ...summary, beforeAfter },
    conversionManifest: result.manifest,
    sourceAudit: {
      binQuestFiles: inputs.binQuest.length,
      binQuestParsedMainQuests: inputs.binQuestByMainId.size,
      binQuestFailures: inputs.binQuestFailures,
      binQuestContentCounts: inputs.binQuest.reduce<Record<string, number>>((counts, record) => {
        for (const [key, value] of Object.entries(record.contentCounts))
          counts[key] = (counts[key] ?? 0) + value;
        return counts;
      }, {}),
      binQuestExecCounts: inputs.binQuest.reduce<Record<string, number>>((counts, record) => {
        for (const [key, value] of Object.entries(record.execCounts ?? {}))
          counts[key] = (counts[key] ?? 0) + value;
        return counts;
      }, {}),
      talkRegistry: {
        coverage: inputs.talkRegistry.coverage,
        duplicateTalkIds: inputs.talkRegistry.duplicateTalkIds,
        npcGroupRelationEdges: inputs.talkRegistry.npcGroupRelations.length,
      },
      talkResolutionProblems,
      registeredTalkFilesNotReferenced,
      orphanDialogueAssets,
      metadataScanFailures,
      codexFiles: inputs.codexQuest.length,
      codexFilesWithoutMainQuest: inputs.codexQuest
        .filter((item) => !inputs.mainQuestById.has(String(item.value.IMJHJGBNMMD ?? "")))
        .map((item) => item.relativePath),
      duplicateFamilyTitles,
      duplicateChapterTitles,
      publicStoryAudit,
      curatedOverrides: inputs.storyFamilyOverrides.map((override) => ({
        id: override.id,
        questIds: override.questIds,
        reason: override.reason,
        evidence: override.evidence,
        reviewedAt: override.reviewedAt,
        temporary: override.temporary,
        obsolete: override.obsolete === true,
      })),
    },
    focus: tasks.filter((task) => focusIds.includes(task.mainQuestId)),
    baselineComparison: baseline
      ? { baselinePath: resolve(baselinePath!), before: beforeMetric, after: currentMetric, delta }
      : undefined,
    tasks,
  };

  await mkdir(outputBase, { recursive: true });
  await writeFile(`${outputBase}.json`, JSON.stringify(report, null, 2) + "\n", "utf8");
  const problemTasks = tasks.filter((task) => {
    const zh = task.locales["zh-CN"];
    return (
      zh.qualityCode !== "complete" &&
      !["control", "aggregate"].includes(String(zh.contentRole ?? ""))
    );
  });
  const focusRows = report.focus.map((task) => {
    const zh = task.locales["zh-CN"];
    return `| ${task.mainQuestId} | ${String(zh.title ?? "")} | ${String(zh.family ?? "")} | ${String(zh.chapter ?? "")} | ${String(zh.dialogueNodeCount ?? 0)} | ${String(zh.contentRole ?? "unknown")} | ${String(zh.dialogueResolutionStatus ?? "unknown")} | ${String(zh.qualityCode ?? "parser_failed")} |`;
  });
  const markdown = [
    "# 原神任务解析审计",
    "",
    `- 上游：\`${upstreamDir}\``,
    `- Commit：\`${git.commit}\``,
    `- 主任务：${summary.mainQuests}`,
    `- 可发布双语记录：${summary.publicLocaleRecords}`,
    `- 完整/部分/仅元数据（中文）：${summary.completeZh}/${summary.partialZh}/${summary.metadataOnlyZh}`,
    `- 解析失败：${summary.parserFailures}`,
    `- Story Family：${summary.familyCount}；区域级其他独立任务：${summary.fallbackFamilyCount}；独立任务条目：${summary.standaloneQuestCount}`,
    `- Talk 已解析任务：${summary.talkResolvedQuestCount}；存在 Talk 问题的任务：${summary.talkProblemQuestCount}`,
    "",
    "## BEFORE / AFTER / DELTA",
    "",
    "```json",
    JSON.stringify(beforeAfter, null, 2),
    "```",
    "",
    "## 重点核对",
    "",
    "| 主任务 | 标题 | 系列 | 章节 | 对白 | 内容角色 | Talk 状态 | 质量 |",
    "| --- | --- | --- | --- | ---: | --- | --- | --- |",
    ...focusRows,
    "",
    "## 非完整任务",
    "",
    ...problemTasks.slice(0, 200).map((task) => {
      const zh = task.locales["zh-CN"];
      return `- ${task.mainQuestId} ${String(zh.title ?? task.rawTitle ?? "")}：${String(zh.qualityCode ?? "parser_failed")}；${(Array.isArray(zh.reasons) ? zh.reasons : []).join(", ")}`;
    }),
    problemTasks.length > 200 ? `- 其余 ${problemTasks.length - 200} 条见 JSON。` : "",
    "",
    "## Story Structure Audit",
    "",
    `- 系列：${summary.familyCount}；单任务系列：${summary.familiesWithOneQuest.length}；仅 aggregate 系列：${summary.familiesWithOnlyAggregate.length}`,
    `- 重复系列标题：${summary.duplicateFamilyTitles.length}；重复章节标题：${summary.duplicateChapterTitles.length}`,
    `- 孤立 aggregate：${summary.orphanAggregate.length}；跨地区系列：${summary.crossRegionFamily.length}`,
    "",
    "## Topology / Talk / Dialogue Audit",
    "",
    `- Raw edges：${topologyAudit.rawRelationEdges}；Derived edges：${topologyAudit.derivedRelationEdges}；requires：${topologyAudit.requiresEdges}；aggregate：${topologyAudit.aggregateEdges}`,
    `- 拓扑 cycle：${topologyAudit.cycles.length}；拓扑 dangling：${topologyAudit.danglingEdges}`,
    `- Talk expected/resolved/unresolved/ambiguous：${summary.talkAudit.expectedTalkIds}/${summary.talkAudit.resolvedTalkIds}/${summary.talkAudit.unresolvedTalkIds}/${summary.talkAudit.ambiguousTalkIds}`,
    `- Dialogue nodes/edges/dangling：${dialogueAudit.dialogueNodes}/${dialogueAudit.dialogueEdges}/${dialogueAudit.danglingEdges}`,
    `- rootless/cyclic graph：${dialogueAudit.rootlessGraphs.length}/${dialogueAudit.cyclicGraphs.length}；重复正文额外节点：${dialogueAudit.duplicateBodyNodes}`,
    `- Talk 全目录 metadata scan：${summary.talkAudit.metadataScannedFiles}；孤立对白资产：${orphanDialogueAssets.length}；metadata scan 失败：${metadataScanFailures.length}`,
    "",
    "本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。",
  ].join("\n");
  await writeFile(`${outputBase}.md`, markdown + "\n", "utf8");
  if (process.argv.includes("--gate")) {
    const failures = [
      ...(result.manifest.failures.length
        ? [`parser_failures:${result.manifest.failures.length}`]
        : []),
      ...(publicStoryAudit.duplicateQuestPlacements.length
        ? [`duplicate_quest_placements:${publicStoryAudit.duplicateQuestPlacements.length}`]
        : []),
      ...(publicStoryAudit.crossRegionFamilies.length
        ? [`cross_region_families:${publicStoryAudit.crossRegionFamilies.length}`]
        : []),
      ...(publicStoryAudit.emptyNarrativeTasks.length
        ? [`empty_narrative_tasks:${publicStoryAudit.emptyNarrativeTasks.length}`]
        : []),
    ];
    if (failures.length) throw new Error(`Quest audit gate failed: ${failures.join(", ")}`);
  }
  console.log(
    JSON.stringify(
      { json: `${outputBase}.json`, markdown: `${outputBase}.md`, summary: report.summary },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("audit-anime-game-data-quests.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
