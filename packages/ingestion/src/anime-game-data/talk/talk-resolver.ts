import type { QuestRelationEdge } from "../quest/types.js";
import type { TalkCandidate, TalkRelationEvidence, TalkSourceRegistry } from "./types.js";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

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
  return `${candidate.talkId}|${candidate.sourceKind}|${candidate.sourceFile}|${candidate.evidence}`;
}

function assetStem(asset: NonNullable<TalkCandidate["asset"]>): string {
  const fileName = asset.relativePath.split(/[\\/]/u).pop() ?? asset.relativePath;
  return fileName.replace(/\.json$/iu, "");
}

/**
 * A talk can be emitted twice by AnimeGameData: once under its numeric asset
 * id and once under a content-addressed/hashed filename.  The numeric path is
 * an explicit source relation, not a fuzzy prefix match, so it is safe to use
 * when it is the only exact-id asset.  Keep the registry duplicate report
 * intact; this only prevents an equivalent alias from making a quest appear
 * ambiguous during resolution.
 */
function selectAssetsForTalk(
  talkId: string,
  assets: NonNullable<TalkCandidate["asset"]>[],
): NonNullable<TalkCandidate["asset"]>[] {
  const dialogueAssets = assets.filter((asset) => asset.dialogueRows.length > 0);
  const exact = dialogueAssets.filter((asset) => assetStem(asset) === talkId);
  return exact.length === 1 ? exact : assets;
}

function sourceKindPriority(
  evidence: TalkRelationEvidence,
  sourceKind: NonNullable<TalkCandidate["asset"]>["sourceKind"],
): number {
  const preferred =
    evidence === "npc_group_trigger"
      ? ["npc", "npc_other", "free_group", "quest"]
      : evidence === "quest_complete_talk" || evidence === "talk_excel_quest_id"
        ? ["quest", "npc", "npc_other", "free_group"]
        : ["quest", "npc", "npc_other", "free_group"];
  const index = preferred.indexOf(sourceKind);
  return index >= 0 ? index : preferred.length;
}

function selectRelatedDialogueAssets(
  evidence: TalkRelationEvidence,
  assets: NonNullable<TalkCandidate["asset"]>[],
): NonNullable<TalkCandidate["asset"]>[] {
  const dialogueAssets = assets.filter((asset) => asset.dialogueRows.length > 0);
  if (dialogueAssets.length <= 1) return dialogueAssets;
  const bestPriority = Math.min(
    ...dialogueAssets.map((asset) => sourceKindPriority(evidence, asset.sourceKind)),
  );
  return dialogueAssets.filter(
    (asset) => sourceKindPriority(evidence, asset.sourceKind) === bestPriority,
  );
}

/** Resolve talks only through explicit quest, TalkExcel, NpcGroup, or asset relations. */
export async function resolveQuestTalks(input: ResolveQuestTalkInput): Promise<ResolvedQuestTalks> {
  const relatedQuestIds = new Set([input.mainQuestId, ...(input.relatedQuestIds ?? [])]);
  const relationEdges = input.registry.npcGroupRelations.filter(
    (edge) => edge.fromQuestId && relatedQuestIds.has(edge.fromQuestId),
  );
  const refs = new Map<string, { evidence: TalkRelationEvidence; relationEdgeId?: string }>();
  const addRef = (
    talkId: string | undefined,
    evidence: TalkRelationEvidence,
    edge?: QuestRelationEdge,
  ): void => {
    if (!talkId) return;
    const existing = refs.get(talkId);
    if (!existing || existing.evidence === "perform_cfg_exact") {
      refs.set(talkId, { evidence, relationEdgeId: edge ? JSON.stringify(edge) : undefined });
    }
  };
  for (const talkId of input.completeTalkIds ?? []) addRef(talkId, "quest_complete_talk");
  for (const edge of relationEdges) addRef(edge.talkId, "npc_group_trigger", edge);
  for (const row of input.talkRows) {
    const questId = idText(row.questId ?? row.mainQuestId ?? row.mainId);
    const talkId = idText(row.id ?? row.talkId);
    if (questId === input.mainQuestId) addRef(talkId, "talk_excel_quest_id");
    else if (
      !questId &&
      exactPerformCfgMatch(row.performCfg ?? row.performConfig, input.mainQuestId)
    )
      addRef(talkId, "perform_cfg_exact");
  }
  const talkIds = [...refs.keys()].sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right),
  );
  const candidates: TalkCandidate[] = [];
  for (const talkId of talkIds) {
    const relation = refs.get(talkId)!;
    const relatedAssets = selectRelatedDialogueAssets(
      relation.evidence,
      await input.registry.findAssets(talkId),
    );
    const assets = selectAssetsForTalk(talkId, relatedAssets);
    for (const asset of assets) {
      candidates.push({
        talkId,
        sourceKind: asset.sourceKind,
        sourceFile: asset.relativePath,
        confidence:
          relation.evidence === "quest_complete_talk" || relation.evidence === "talk_excel_quest_id"
            ? 1
            : 0.8,
        evidence: relation.evidence,
        asset,
        relationEdgeId: relation.relationEdgeId,
      });
    }
  }
  const byTalkId = new Map<string, TalkCandidate[]>();
  for (const candidate of candidates) {
    const list = byTalkId.get(candidate.talkId) ?? [];
    list.push(candidate);
    byTalkId.set(candidate.talkId, list);
  }
  const uniqueCandidates = new Map<string, TalkCandidate>();
  for (const candidate of candidates) uniqueCandidates.set(candidateKey(candidate), candidate);
  const ambiguousTalkIds = [...byTalkId.entries()]
    .filter(
      ([, list]) =>
        new Set(list.map((candidate) => candidate.asset?.fileHash ?? candidate.sourceFile)).size >
        1,
    )
    .map(([talkId]) => talkId);
  const resolvedTalkIds = talkIds.filter((talkId) => (byTalkId.get(talkId)?.length ?? 0) > 0);
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
