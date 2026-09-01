import { Buffer } from "node:buffer";
import {
  DomainError,
  type NormalizedRecord,
  type QuestDialoguePage,
  type QuestRecordPayload,
  type QuestSearchHit,
} from "@gip/domain";

export type PreviewBuild = {
  id: string;
  candidateId: string;
  buildNumber: number;
  normalizedRecords: NormalizedRecord[];
};

type PreviewQuestCursor = {
  buildId: string;
  questKey: string;
  locale: string;
  offset: number;
};

function questKeyFromInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError("invalid_quest_key", "Quest key is required", undefined, 400);
  return trimmed.startsWith("quest/") ? trimmed : `quest/${trimmed}`;
}

function encodePreviewQuestCursor(cursor: PreviewQuestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePreviewQuestCursor(value: string | undefined): PreviewQuestCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PreviewQuestCursor>;
    if (
      typeof parsed.buildId === "string" &&
      typeof parsed.questKey === "string" &&
      typeof parsed.locale === "string" &&
      typeof parsed.offset === "number" &&
      Number.isSafeInteger(parsed.offset) &&
      parsed.offset >= 0
    )
      return {
        buildId: parsed.buildId,
        questKey: parsed.questKey,
        locale: parsed.locale,
        offset: parsed.offset,
      };
  } catch {
    // Fall through to the domain error below.
  }
  throw new DomainError(
    "preview_quest_cursor_invalid",
    "Preview quest cursor is invalid",
    undefined,
    400,
  );
}

function previewQuestRecords(
  build: PreviewBuild,
  locale: string,
  gameVersion?: string,
): Array<NormalizedRecord & { quest: QuestRecordPayload }> {
  return build.normalizedRecords.filter(
    (record): record is NormalizedRecord & { quest: QuestRecordPayload } => {
      if (!record.quest) return false;
      if (record.quest.locale !== locale && record.locale !== locale) return false;
      if (gameVersion && record.gameVersion !== gameVersion) return false;
      return true;
    },
  );
}

function previewQuestRevision(build: PreviewBuild): string {
  return `preview:${build.buildNumber}`;
}

function previewQuestHit(
  record: NormalizedRecord & { quest: QuestRecordPayload },
  build: PreviewBuild,
): QuestSearchHit {
  return {
    questKey: record.quest.questKey,
    mainQuestId: String(record.quest.mainQuestId),
    title: record.title ?? record.sourceKey,
    type: record.quest.questType,
    chapter: record.quest.chapter ?? null,
    series: record.quest.series ?? null,
    completeness: record.quest.completeness,
    locale: record.quest.locale,
    documentId: record.sourceKey,
    revision: previewQuestRevision(build),
    match: "preview_build",
  };
}

export function searchPreviewQuests(
  build: PreviewBuild,
  input: {
    query: string;
    locale: string;
    questType?: QuestRecordPayload["questType"];
    gameVersion?: string;
    limit: number;
  },
): QuestSearchHit[] {
  const needle = input.query.trim().toLocaleLowerCase();
  return previewQuestRecords(build, input.locale, input.gameVersion)
    .filter((record) => {
      if (input.questType && record.quest.questType !== input.questType) return false;
      if (!needle || needle === "quest/") return true;
      const haystack = [
        record.sourceKey,
        record.title,
        record.body,
        record.quest.questKey,
        record.quest.mainQuestId,
        record.quest.chapter,
        record.quest.series,
        record.quest.completeness,
      ]
        .filter((value) => value !== undefined && value !== null)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, input.limit)
    .map((record) => previewQuestHit(record, build));
}

export function getPreviewQuest(
  build: PreviewBuild,
  input: {
    questId: string;
    locale: string;
    nodeLimit: number;
    cursor?: string;
  },
): QuestDialoguePage | null {
  const cursor = decodePreviewQuestCursor(input.cursor);
  const questKey = questKeyFromInput(cursor?.questKey ?? input.questId);
  const requestedLocale = cursor?.locale ?? input.locale;
  if (
    cursor &&
    (cursor.buildId !== build.id ||
      cursor.questKey !== questKey ||
      cursor.locale !== requestedLocale)
  )
    throw new DomainError(
      "preview_quest_cursor_invalid",
      "Preview quest cursor does not match this request",
      undefined,
      400,
    );

  let record = previewQuestRecords(build, requestedLocale).find(
    (candidate) => candidate.quest.questKey === questKey,
  );
  const warnings: string[] = [];
  let locale = requestedLocale;
  if (!record) {
    const fallback = requestedLocale === "zh-CN" ? "en" : "zh-CN";
    record = previewQuestRecords(build, fallback).find(
      (candidate) => candidate.quest.questKey === questKey,
    );
    if (record) {
      locale = fallback;
      warnings.push(`locale_fallback:${requestedLocale}->${fallback}`);
    }
  }
  if (!record) return null;

  const limit = Math.min(Math.max(input.nodeLimit, 1), 300);
  const offset = cursor?.offset ?? 0;
  const dialogueNodes = record.quest.dialogueNodes.slice(offset, offset + limit);
  const pageNodeKeys = new Set(dialogueNodes.map((node) => node.nodeKey));
  const nextOffset = offset + dialogueNodes.length;
  return {
    questKey: record.quest.questKey,
    title: record.title ?? record.sourceKey,
    type: record.quest.questType,
    locale,
    gameVersion: record.gameVersion ?? null,
    documentId: record.sourceKey,
    revision: previewQuestRevision(build),
    completeness: record.quest.completeness,
    subquests: record.quest.subquests,
    dialogueNodes,
    dialogueEdges: record.quest.dialogueEdges.filter((edge) => pageNodeKeys.has(edge.fromNodeKey)),
    participants: (record.entities ?? []).map((entity) => ({
      id: entity.sourceKey,
      sourceKey: entity.sourceKey,
      name: entity.name,
      type: entity.type,
      summary: entity.summary ?? null,
      aliases: (entity.aliases ?? []).map((alias) => alias.value),
      revision: previewQuestRevision(build),
    })),
    prerequisites: record.quest.prerequisites ?? [],
    citations: dialogueNodes.map((node) => ({
      documentId: record.sourceKey,
      locale,
      questKey: record.quest.questKey,
      subquestKey: node.subquestKey,
      dialogueNodeKey: node.nodeKey,
      revision: previewQuestRevision(build),
    })),
    warnings,
    nextCursor:
      nextOffset < record.quest.dialogueNodes.length
        ? encodePreviewQuestCursor({
            buildId: build.id,
            questKey: record.quest.questKey,
            locale,
            offset: nextOffset,
          })
        : null,
  };
}
