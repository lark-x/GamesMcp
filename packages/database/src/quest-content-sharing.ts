import { createHash } from "node:crypto";
import type { NormalizedRecord } from "@gip/domain";
import { recordSegments, stableStringify, stableUuid } from "./repository-utils.js";

export const SHARED_QUEST_CONTENT_SEMANTICS_VERSION = 1;

export type SharedQuestContentPack = {
  contentHash: string;
  questKey: string;
  segments: Array<{
    id: string;
    segmentKey: string;
    ordinal: number;
    headingPath: string[];
    headingKey: string | null;
    metadata: Record<string, unknown>;
    body: string;
    startOffset: number;
    endOffset: number;
    tokenEstimate: number;
    bodyContentHash: string;
    searchText: string;
  }>;
  subquests: Array<{
    subquestKey: string;
    subquestId: string;
    ordinal: number;
    title: string;
    objective: string | null;
    completeness: string;
    metadata: Record<string, unknown>;
  }>;
  dialogueNodes: Array<{
    questKey: string;
    subquestKey: string | null;
    nodeKey: string;
    nodeId: string;
    nodeType: string;
    speakerKey: string | null;
    speakerName: string | null;
    body: string;
    segmentId: string | null;
    ordinal: number;
    variants: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
  dialogueEdges: Array<{
    edgeKey: string;
    fromNodeKey: string;
    toNodeKey: string;
    edgeType: string;
    optionText: string | null;
    metadata: Record<string, unknown>;
  }>;
  mentions: Array<{
    segmentId: string;
    entitySourceKey: string;
    rawText: string;
    startOffset: number;
    endOffset: number;
    matchMethod: string;
    confidence: number;
  }>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function headingKey(headingPath: string[]): string | null {
  const value = headingPath.join(" / ").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  return value || null;
}

/**
 * Content identity deliberately excludes catalog placement and document
 * metadata. It includes every normalized field returned by the dialogue and
 * segment readers, plus an explicit storage-semantics version.
 */
export function buildSharedQuestContentPack(
  record: NormalizedRecord,
  gameId: string,
): SharedQuestContentPack | null {
  const quest = record.quest;
  if (!quest) return null;

  const body = record.body ?? record.title ?? "";
  const sourceSegments = recordSegments(record, body);
  const segmentKeyBySourceKey = new Map<string, string>();
  const segmentsForHash = sourceSegments.map((segment, ordinal) => {
    const segmentKey = segment.segmentKey ?? `ordinal:${ordinal}`;
    if (segment.segmentKey) segmentKeyBySourceKey.set(segment.segmentKey, segmentKey);
    return {
      segmentKey,
      ordinal,
      headingPath: segment.headingPath,
      headingKey: headingKey(segment.headingPath),
      metadata: segment.metadata,
      body: segment.body,
      startOffset: segment.start,
      endOffset: segment.end,
      tokenEstimate: Math.ceil(segment.body.length / 4),
      bodyContentHash: sha256(segment.body),
      searchText: segment.body,
    };
  });

  const subquests = quest.subquests.map((subquest) => ({
    subquestKey: subquest.subquestKey,
    subquestId: String(subquest.subquestId),
    ordinal: subquest.order,
    title: subquest.title,
    objective: subquest.objective ?? null,
    completeness: subquest.completeness,
    metadata: subquest.metadata ?? {},
  }));
  const dialogueNodes = quest.dialogueNodes.map((node, index) => ({
    questKey: quest.questKey,
    subquestKey: node.subquestKey ?? null,
    nodeKey: node.nodeKey,
    nodeId: String(node.nodeId),
    nodeType: node.type,
    speakerKey: node.speakerKey ?? null,
    speakerName: node.speakerName ?? null,
    body: node.body,
    sourceSegmentKey: node.segmentKey ? (segmentKeyBySourceKey.get(node.segmentKey) ?? null) : null,
    ordinal: node.order ?? index,
    variants: node.variants ?? {},
    metadata: node.metadata ?? {},
  }));
  const dialogueEdges = [
    ...new Map(
      quest.dialogueEdges.map((edge) => [
        [edge.fromNodeKey, edge.toNodeKey, edge.type, edge.optionText ?? ""].join("\u0000"),
        edge,
      ]),
    ).values(),
  ].map((edge) => ({
    edgeKey: sha256(
      stableStringify({
        fromNodeKey: edge.fromNodeKey,
        toNodeKey: edge.toNodeKey,
        edgeType: edge.type,
        optionText: edge.optionText ?? null,
      }),
    ),
    fromNodeKey: edge.fromNodeKey,
    toNodeKey: edge.toNodeKey,
    edgeType: edge.type,
    optionText: edge.optionText ?? null,
    metadata: edge.metadata ?? {},
  }));
  const mentionsForHash = sourceSegments.flatMap((segment, ordinal) => {
    const segmentId = `segment:${segment.segmentKey ?? `ordinal:${ordinal}`}`;
    return (record.entities ?? []).flatMap((entity) => {
      const names = [entity.name, ...(entity.aliases ?? []).map((alias) => alias.value)];
      const match = names
        .map((name) => ({ name, offset: segment.body.indexOf(name) }))
        .find((candidate) => candidate.offset >= 0);
      if (!match) return [];
      return [
        {
          segmentId,
          entitySourceKey: entity.sourceKey,
          rawText: match.name,
          startOffset: match.offset,
          endOffset: match.offset + match.name.length,
          matchMethod: match.name === entity.name ? "canonical_name" : "alias",
          confidence: 1,
        },
      ];
    });
  });
  const canonicalContent = {
    semanticsVersion: SHARED_QUEST_CONTENT_SEMANTICS_VERSION,
    gameId,
    questKey: quest.questKey,
    locale: record.locale ?? "und",
    segments: segmentsForHash,
    subquests,
    dialogueNodes,
    dialogueEdges,
    mentions: mentionsForHash,
  };
  const contentHash = sha256(stableStringify(canonicalContent));
  const segmentIdByKey = new Map(
    segmentsForHash.map((segment) => [
      segment.segmentKey,
      stableUuid(`quest-content-segment:${contentHash}:${segment.segmentKey}`),
    ]),
  );
  const segments = segmentsForHash.map((segment) => ({
    ...segment,
    id: segmentIdByKey.get(segment.segmentKey)!,
  }));

  return {
    contentHash,
    questKey: quest.questKey,
    segments,
    subquests,
    dialogueNodes: dialogueNodes.map((node) => ({
      questKey: node.questKey,
      subquestKey: node.subquestKey,
      nodeKey: node.nodeKey,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      speakerKey: node.speakerKey,
      speakerName: node.speakerName,
      body: node.body,
      segmentId: node.sourceSegmentKey ? (segmentIdByKey.get(node.sourceSegmentKey) ?? null) : null,
      ordinal: node.ordinal,
      variants: node.variants,
      metadata: node.metadata,
    })),
    dialogueEdges,
    mentions: mentionsForHash.map((mention) => ({
      ...mention,
      segmentId: segmentIdByKey.get(mention.segmentId.replace(/^segment:/, ""))!,
    })),
  };
}
