import { createHash } from "node:crypto";
import type { QuestRelationEdge } from "../quest/types.js";
import type {
  TalkCandidate,
  TalkEvidence,
  TalkRelationEvidence,
  TalkSourceRegistry,
} from "./types.js";

type Json = Record<string, unknown>;

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function exactPerformCfgMatch(value: unknown, mainQuestId: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const escaped = mainQuestId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[/_])(?:MQ|WQ|LQ|EQ|Q)${escaped}(?:[/_]|$)`, "iu").test(value);
}

export type ResolveQuestTalkInput = {
  mainQuestId: string;
  relatedQuestIds?: string[];
  completeTalkIds?: string[];
  talkRows: Json[];
  registry: TalkSourceRegistry;
  relationEdges?: QuestRelationEdge[];
};

export type ResolvedQuestTalks = {
  candidates: TalkCandidate[];
  talkIds: string[];
  resolvedTalkIds: string[];
  unresolvedTalkIds: string[];
  ambiguousTalkIds: string[];
  relationEdges: QuestRelationEdge[];
};

function candidateKey(candidate: TalkCandidate): string {
  return `${candidate.talkId}|${candidate.sourceFile}`;
}

function assetSignature(asset: NonNullable<TalkCandidate["asset"]>): string {
  const content = asset.dialogueRows.map((row) => [
    row.dialogId,
    row.nextDialogIds,
    row.bodyHash,
    row.speakerNameHash,
    row.roleType,
    row.roleId,
  ]);
  return createHash("sha1").update(JSON.stringify(content)).digest("hex");
}

function relationEvidenceForEdge(edge: QuestRelationEdge): TalkEvidence | undefined {
  const kind: TalkRelationEvidence =
    edge.relationType === "npc_group_condition"
      ? "npc_group_condition"
      : edge.relationType === "npc_group_trigger"
        ? "npc_group_trigger"
        : undefined!;
  if (!kind) return undefined;
  return {
    kind,
    confidence: edge.confidence,
    relationEdgeId: edge.edgeId,
    sourceFile: edge.sourceFile,
    details: edge.metadata,
  };
}

/** Resolve exact talk identities using all available evidence, never a source-kind preference. */
export async function resolveQuestTalks(input: ResolveQuestTalkInput): Promise<ResolvedQuestTalks> {
  const relatedQuestIds = new Set([input.mainQuestId, ...(input.relatedQuestIds ?? [])]);
  const relationEdges = [
    ...(input.relationEdges ?? []),
    ...input.registry.npcGroupRelations.filter(
      (edge) => edge.fromQuestId && relatedQuestIds.has(edge.fromQuestId),
    ),
  ];
  const refs = new Map<string, TalkEvidence[]>();
  const subQuestByTalkId = new Map<string, string>();
  const initDialogsByTalkId = new Map<string, string[]>();
  const addRef = (
    talkId: string | undefined,
    kind: TalkRelationEvidence,
    details?: Partial<TalkEvidence>,
  ): void => {
    if (!talkId) return;
    const list = refs.get(talkId) ?? [];
    const evidence: TalkEvidence = {
      kind,
      confidence: details?.confidence ?? (kind === "quest_complete_talk" ? 1 : 0.8),
      relationEdgeId: details?.relationEdgeId,
      sourceFile: details?.sourceFile,
      details: details?.details,
    };
    if (!list.some((item) => JSON.stringify(item) === JSON.stringify(evidence)))
      list.push(evidence);
    refs.set(talkId, list);
  };
  for (const talkId of input.completeTalkIds ?? []) addRef(talkId, "quest_complete_talk");
  for (const edge of relationEdges) {
    if (!edge.talkId || !edge.fromQuestId || !relatedQuestIds.has(edge.fromQuestId)) continue;
    if (edge.relationType === "complete_talk" && edge.fromQuestId !== input.mainQuestId) {
      const subQuestId = edge.fromSubQuestId ?? edge.fromQuestId;
      subQuestByTalkId.set(edge.talkId, subQuestId);
    }
    const evidence = relationEvidenceForEdge(edge);
    if (evidence) addRef(edge.talkId, evidence.kind, evidence);
  }
  for (const row of input.talkRows) {
    const questId = idText(row.questId ?? row.mainQuestId ?? row.mainId);
    const talkId = idText(row.id ?? row.talkId);
    const initDialog = idText(row.initDialog ?? row.initDialogId);
    if (questId && relatedQuestIds.has(questId)) {
      addRef(talkId, "talk_excel_quest_id", { confidence: 1 });
      if (talkId && initDialog) {
        const initDialogs = initDialogsByTalkId.get(talkId) ?? [];
        if (!initDialogs.includes(initDialog)) initDialogs.push(initDialog);
        initDialogsByTalkId.set(talkId, initDialogs);
      }
    } else if (
      !questId &&
      exactPerformCfgMatch(row.performCfg ?? row.performConfig, input.mainQuestId)
    ) {
      addRef(talkId, "perform_cfg_exact", { confidence: 0.85 });
      if (talkId && initDialog) {
        const initDialogs = initDialogsByTalkId.get(talkId) ?? [];
        if (!initDialogs.includes(initDialog)) initDialogs.push(initDialog);
        initDialogsByTalkId.set(talkId, initDialogs);
      }
    }
  }
  const talkIds = [...refs.keys()].sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right),
  );
  const candidates: TalkCandidate[] = [];
  const resolvedTalkIds: string[] = [];
  const ambiguousTalkIds: string[] = [];
  for (const talkId of talkIds) {
    const evidences = refs.get(talkId) ?? [];
    let assets = await input.registry.findAssets(talkId);
    let assetFallbackEvidence: TalkEvidence | undefined;
    if (assets.length === 0) {
      // Some legacy Talk/Quest files have an opaque or hashed filename and no
      // embedded talk id.  TalkExcel still gives us an exact identity bridge:
      // talk id -> initDialog -> the asset's dialogue graph.  This is not a
      // numeric prefix guess; the initDialog value is an explicit source
      // relation and the asset must contain that exact dialogue id.
      const fallbackAssets = new Map<string, NonNullable<TalkCandidate["asset"]>>();
      const initDialogs = initDialogsByTalkId.get(talkId) ?? [];
      for (const initDialog of initDialogs) {
        for (const asset of await input.registry.findAssetsByDialogueId(initDialog, "quest")) {
          fallbackAssets.set(asset.relativePath, asset);
        }
      }
      assets = [...fallbackAssets.values()];
      if (assets.length > 0) {
        assetFallbackEvidence = {
          kind: "legacy_path_match",
          confidence: 0.9,
          details: {
            initDialogIds: initDialogs,
            match: "talk_excel_init_dialog",
          },
        };
      }
    }
    const bySignature = new Map<string, NonNullable<TalkCandidate["asset"]>>();
    for (const asset of assets.filter((item) => item.dialogueRows.length > 0)) {
      const signature = assetSignature(asset);
      if (!bySignature.has(signature)) bySignature.set(signature, asset);
    }
    if (bySignature.size > 0) resolvedTalkIds.push(talkId);
    if (bySignature.size > 1) ambiguousTalkIds.push(talkId);
    for (const asset of bySignature.values()) {
      const candidateEvidences = assetFallbackEvidence
        ? [...evidences, assetFallbackEvidence]
        : evidences;
      const bestEvidence = [...candidateEvidences].sort((a, b) => b.confidence - a.confidence)[0];
      const candidate: TalkCandidate = {
        talkId,
        subQuestId: subQuestByTalkId.get(talkId),
        sourceKind: asset.sourceKind,
        sourceFile: asset.relativePath,
        confidence: bestEvidence?.confidence ?? 0,
        score: bestEvidence?.confidence ?? 0,
        status: bySignature.size > 1 ? "ambiguous" : "resolved",
        evidence: bestEvidence?.kind ?? "asset_id_exact",
        evidences: candidateEvidences,
        asset,
        relationEdgeId: bestEvidence?.relationEdgeId,
      };
      candidates.push(candidate);
    }
  }
  const uniqueCandidates = new Map<string, TalkCandidate>();
  for (const candidate of candidates) uniqueCandidates.set(candidateKey(candidate), candidate);
  const unresolvedTalkIds = talkIds.filter((talkId) => !resolvedTalkIds.includes(talkId));
  return {
    candidates: [...uniqueCandidates.values()].sort(
      (left, right) =>
        Number(left.talkId) - Number(right.talkId) ||
        left.sourceFile.localeCompare(right.sourceFile),
    ),
    talkIds,
    resolvedTalkIds,
    unresolvedTalkIds,
    ambiguousTalkIds,
    relationEdges,
  };
}
