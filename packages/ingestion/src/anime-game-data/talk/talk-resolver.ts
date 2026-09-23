import { createHash } from "node:crypto";
import type { QuestRelationEdge } from "../quest/types.js";
import type {
  TalkCandidate,
  TalkEvidence,
  TalkEvidenceClass,
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
  /** Talk identities backed by narrative evidence and therefore expected in the quest body. */
  talkIds: string[];
  /** Availability-only Talk identities retained for provenance, never treated as missing body text. */
  auxiliaryTalkIds: string[];
  resolvedTalkIds: string[];
  unresolvedTalkIds: string[];
  ambiguousTalkIds: string[];
  ambiguityDiagnostics: Array<{
    talkId: string;
    sourcePairs: string[][];
    evidenceKinds: TalkRelationEvidence[];
    evidenceClasses: TalkEvidenceClass[];
  }>;
  relationEdges: QuestRelationEdge[];
};

function evidenceClass(kind: TalkRelationEvidence): TalkEvidenceClass {
  if (kind === "npc_group_condition" || kind === "npc_group_trigger") return "availability";
  if (kind === "talk_excel_relation") return "compatibility";
  if (kind === "asset_id_exact" || kind === "legacy_path_match") return "identity";
  return "narrative";
}

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
    evidenceClass: evidenceClass(kind),
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
    ...new Map(
      [...(input.relationEdges ?? []), ...input.registry.npcGroupRelations]
        .filter(
          (edge) =>
            (edge.fromQuestId && relatedQuestIds.has(edge.fromQuestId)) ||
            (edge.fromSubQuestId && relatedQuestIds.has(edge.fromSubQuestId)),
        )
        .map((edge) => [edge.edgeId, edge]),
    ).values(),
  ];
  const refs = new Map<string, TalkEvidence[]>();
  const subQuestsByTalkId = new Map<string, Set<string>>();
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
      evidenceClass: evidenceClass(kind),
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
    if (edge.relationType === "complete_talk") {
      addRef(edge.talkId, "quest_complete_talk", {
        confidence: edge.confidence,
        relationEdgeId: edge.edgeId,
        sourceFile: edge.sourceFile,
        details: edge.metadata,
      });
      if (edge.fromQuestId !== input.mainQuestId || edge.fromSubQuestId) {
        const subQuestId = edge.fromSubQuestId ?? edge.fromQuestId;
        const subquests = subQuestsByTalkId.get(edge.talkId) ?? new Set<string>();
        subquests.add(subQuestId);
        subQuestsByTalkId.set(edge.talkId, subquests);
      }
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
  const allReferencedTalkIds = [...refs.keys()].sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right),
  );
  const talkIds = allReferencedTalkIds.filter((talkId) =>
    (refs.get(talkId) ?? []).some((item) => item.evidenceClass === "narrative"),
  );
  const auxiliaryTalkIds = allReferencedTalkIds.filter((talkId) => !talkIds.includes(talkId));
  const candidates: TalkCandidate[] = [];
  const resolvedTalkIds: string[] = [];
  const ambiguousTalkIds: string[] = [];
  const ambiguityDiagnostics: ResolvedQuestTalks["ambiguityDiagnostics"] = [];
  for (const talkId of allReferencedTalkIds) {
    const evidences = refs.get(talkId) ?? [];
    const hasNarrativeEvidence = evidences.some((item) => item.evidenceClass === "narrative");
    if (!hasNarrativeEvidence) {
      const availabilityEvidence = [...evidences].sort(
        (left, right) => right.confidence - left.confidence,
      )[0];
      if (availabilityEvidence) {
        candidates.push({
          talkId,
          sourceKind: "npc_group",
          sourceFile: availabilityEvidence.sourceFile ?? `availability:${talkId}`,
          confidence: availabilityEvidence.confidence,
          score: availabilityEvidence.confidence,
          status: "rejected",
          evidence: availabilityEvidence.kind,
          evidences,
          relationEdgeId: availabilityEvidence.relationEdgeId,
          resolutionReason: "availability_evidence_only",
        });
      }
      continue;
    }
    let assets = (await input.registry.findAssets(talkId)).filter(
      (asset) => asset.sourceKind !== "npc_group",
    );
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
        for (const asset of await input.registry.findAssetsByDialogueId(initDialog)) {
          if (asset.sourceKind === "npc_group") continue;
          fallbackAssets.set(asset.relativePath, asset);
        }
      }
      assets = [...fallbackAssets.values()];
      if (assets.length > 0) {
        assetFallbackEvidence = {
          kind: "legacy_path_match",
          evidenceClass: "identity",
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
    const candidateEvidences = assetFallbackEvidence
      ? [...evidences, assetFallbackEvidence]
      : evidences;
    const initDialogs = initDialogsByTalkId.get(talkId) ?? [];
    const initDialogMatches = [...bySignature.entries()].filter(([, asset]) =>
      initDialogs.some((dialogueId) =>
        asset.dialogueRows.some((row) => row.dialogId === dialogueId),
      ),
    );
    const exactPathMatches = [...bySignature.entries()].filter(([, asset]) => {
      const fileName = asset.relativePath.split("/").at(-1) ?? "";
      return fileName.replace(/\.json$/iu, "") === talkId;
    });
    const exactInitDialogMatches = initDialogMatches.filter(([signature]) =>
      exactPathMatches.some(([exactSignature]) => exactSignature === signature),
    );
    const selectedSignature =
      bySignature.size === 1
        ? [...bySignature.keys()][0]
        : exactInitDialogMatches.length === 1
          ? exactInitDialogMatches[0]?.[0]
          : initDialogMatches.length === 1
            ? initDialogMatches[0]?.[0]
            : exactPathMatches.length === 1
              ? exactPathMatches[0]?.[0]
              : undefined;
    const isResolved = hasNarrativeEvidence && Boolean(selectedSignature);
    if (isResolved) resolvedTalkIds.push(talkId);
    if (hasNarrativeEvidence && bySignature.size > 1 && !selectedSignature) {
      ambiguousTalkIds.push(talkId);
      const files = [...bySignature.values()].map((asset) => asset.relativePath).sort();
      ambiguityDiagnostics.push({
        talkId,
        sourcePairs: files.flatMap((left, index) =>
          files.slice(index + 1).map((right) => [left, right]),
        ),
        evidenceKinds: [...new Set(candidateEvidences.map((item) => item.kind))],
        evidenceClasses: [...new Set(candidateEvidences.map((item) => item.evidenceClass))],
      });
    }
    for (const [signature, asset] of bySignature.entries()) {
      const bestEvidence = [...candidateEvidences].sort((a, b) => b.confidence - a.confidence)[0];
      const subQuestIds = [...(subQuestsByTalkId.get(talkId) ?? [])].sort(
        (left, right) => Number(left) - Number(right) || left.localeCompare(right),
      );
      const status: TalkCandidate["status"] = !selectedSignature
        ? "ambiguous"
        : selectedSignature === signature
          ? "resolved"
          : "rejected";
      const candidate: TalkCandidate = {
        talkId,
        subQuestId: subQuestIds[0],
        subQuestIds,
        sourceKind: asset.sourceKind,
        sourceFile: asset.relativePath,
        confidence: bestEvidence?.confidence ?? 0,
        score: bestEvidence?.confidence ?? 0,
        status,
        evidence: bestEvidence?.kind ?? "asset_id_exact",
        evidences: candidateEvidences,
        asset,
        relationEdgeId: bestEvidence?.relationEdgeId,
        resolutionReason:
          exactInitDialogMatches.length === 1 && bySignature.size > 1
            ? "talk_excel_init_dialog_exact_path"
            : initDialogMatches.length === 1 && bySignature.size > 1
              ? "talk_excel_init_dialog_exact"
              : exactPathMatches.length === 1 && bySignature.size > 1
                ? "exact_numeric_asset_path"
                : bySignature.size === 1
                  ? "unique_content_signature"
                  : "multiple_content_signatures",
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
    auxiliaryTalkIds,
    resolvedTalkIds,
    unresolvedTalkIds,
    ambiguousTalkIds,
    ambiguityDiagnostics,
    relationEdges,
  };
}
