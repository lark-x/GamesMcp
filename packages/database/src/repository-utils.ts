import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DocumentSummary, DocumentType, EntitySummary, EntityType } from "@gip/contracts";
import type {
  ConflictKind,
  DocumentProvenance,
  NormalizedRecord,
  ProvenanceLineage,
  QuestCompleteness,
  QuestRecordPayload,
  StructuredImportRecords,
  VerificationItem,
} from "@gip/domain";
import { documents, entities, sourceObservations } from "./schema.js";

export const defaultLimit = 20;

export const animeCategoryFiles = {
  book: "books.json",
  character_story: "character-stories.json",
  item_description: "items.json",
  mechanism: "mechanisms.json",
} as const;

export const animeCategoryPlural = {
  book: "books",
  character_story: "characterStories",
  item_description: "itemDescriptions",
  mechanism: "mechanisms",
} as const;

export type AnimeCategory = keyof typeof animeCategoryFiles;

export function animeCategory(value: string | undefined): AnimeCategory | undefined {
  return value && value in animeCategoryFiles ? (value as AnimeCategory) : undefined;
}

export function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function setField(value: NormalizedRecord, path: string | null | undefined, next: unknown) {
  if (!path) return next as NormalizedRecord;
  const clone = structuredClone(value) as Record<string, unknown>;
  const parts = path.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = clone;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    cursor[part] = child && typeof child === "object" && !Array.isArray(child) ? child : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  if (parts.length) cursor[parts.at(-1)!] = next;
  return clone as NormalizedRecord;
}

export function safeRelative(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    return undefined;
  let depth = 0;
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") depth -= 1;
    else depth += 1;
    if (depth < 0) return undefined;
  }
  return normalized;
}

export function safeUpstreamId(value: unknown): ProvenanceLineage["upstreamId"] | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" || typeof nested === "number") result[key] = nested;
    else if (Array.isArray(nested)) {
      const values = nested.filter(
        (item): item is string | number => typeof item === "string" || typeof item === "number",
      );
      if (values.length === nested.length) result[key] = values;
    }
  }
  return result;
}

export function safeLineage(value: unknown): ProvenanceLineage | undefined {
  const lineage = asRecord(value);
  const result: ProvenanceLineage = {
    relativeFile: safeRelative(lineage.relativeFile ?? lineage.file),
    upstreamId: safeUpstreamId(lineage.upstreamId),
    hash: typeof lineage.hash === "string" ? lineage.hash : undefined,
    valueHash: typeof lineage.valueHash === "string" ? lineage.valueHash : undefined,
    readablePath: safeRelative(lineage.readablePath),
  };
  if (Array.isArray(lineage.sources)) {
    result.sources = lineage.sources
      .map(safeLineage)
      .filter((item): item is ProvenanceLineage => Boolean(item));
  }
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

export function safeProvenance(
  metadata: Record<string, unknown>,
  sourceKey: string,
): DocumentProvenance {
  const provenance = asRecord(metadata.provenance);
  const source = Object.keys(provenance).length ? provenance : metadata;
  const lineage = asRecord(source.lineage ?? metadata.lineage);
  const ids = asRecord(source.upstreamIds ?? metadata.upstreamIds);
  const hashes = asRecord(source.textMapHashes ?? metadata.textMapHashes);
  const sourceFilesValue = source.sourceFiles ?? metadata.sourceFiles;
  const sourceFiles = Array.isArray(sourceFilesValue)
    ? sourceFilesValue
        .map((value: unknown) => safeRelative(value))
        .filter((value): value is string => Boolean(value))
    : Object.values(lineage)
        .map((value) => safeRelative(asRecord(value).relativeFile ?? asRecord(value).file))
        .filter((value): value is string => Boolean(value));
  const lineageMap = Object.fromEntries(
    Object.entries(lineage)
      .map(([key, value]) => [key, safeLineage(value)] as const)
      .filter((entry): entry is [string, ProvenanceLineage] => Boolean(entry[1])),
  );
  return {
    upstreamSource: typeof source.upstreamSource === "string" ? source.upstreamSource : undefined,
    upstreamCommit: typeof source.upstreamCommit === "string" ? source.upstreamCommit : undefined,
    upstreamCommitDate:
      typeof source.upstreamCommitDate === "string" ? source.upstreamCommitDate : undefined,
    upstreamVersionLabel:
      typeof source.upstreamVersionLabel === "string" ? source.upstreamVersionLabel : undefined,
    locale: typeof source.locale === "string" ? source.locale : undefined,
    canonicalKey: typeof source.canonicalKey === "string" ? source.canonicalKey : sourceKey,
    sourceFiles: [...new Set(sourceFiles)],
    lineage: lineageMap,
    upstreamIds: Object.fromEntries(
      Object.entries(ids).filter(
        ([, value]) => ["string", "number"].includes(typeof value) || Array.isArray(value),
      ),
    ) as DocumentProvenance["upstreamIds"],
    textMapHashes: Object.fromEntries(
      Object.entries(hashes).filter(
        ([, value]) =>
          typeof value === "number" ||
          (Array.isArray(value) && value.every((item) => typeof item === "number")),
      ),
    ) as DocumentProvenance["textMapHashes"],
    readableFile: safeRelative(source.readableFile ?? metadata.readableFile),
    rawContentHash: typeof source.rawContentHash === "string" ? source.rawContentHash : undefined,
    normalizedContentHash:
      typeof source.normalizedContentHash === "string" ? source.normalizedContentHash : undefined,
    transforms: Array.isArray(source.transforms)
      ? source.transforms.filter((value): value is string => typeof value === "string")
      : undefined,
    converterVersion:
      typeof source.converterVersion === "string" ? source.converterVersion : undefined,
    rightsStatus: typeof source.rightsStatus === "string" ? source.rightsStatus : undefined,
    bookStableId: typeof source.bookStableId === "string" ? source.bookStableId : undefined,
    volumeStableId: typeof source.volumeStableId === "string" ? source.volumeStableId : undefined,
    documentStableId:
      typeof source.documentStableId === "string" ? source.documentStableId : undefined,
    bookSuitId:
      typeof source.bookSuitId === "string" || typeof source.bookSuitId === "number"
        ? source.bookSuitId
        : undefined,
    volumeId:
      typeof source.volumeId === "string" || typeof source.volumeId === "number"
        ? source.volumeId
        : undefined,
    sortOrder: typeof source.sortOrder === "number" ? source.sortOrder : undefined,
    characterStableId:
      typeof source.characterStableId === "string" ? source.characterStableId : undefined,
    storyKey: typeof source.storyKey === "string" ? source.storyKey : undefined,
    unlockMetadata:
      source.unlockMetadata && typeof source.unlockMetadata === "object"
        ? (source.unlockMetadata as Record<string, unknown>)
        : undefined,
  };
}

export type SourceObservationRow = typeof sourceObservations.$inferSelect;

export type AcquisitionManifestInfo = {
  path: string;
  value: Record<string, unknown>;
  hash: string;
};

export function observationConflictKind(observations: SourceObservationRow[]): ConflictKind {
  // A repeated snapshot from the same source is the same observation channel;
  // a later snapshot from that source is a new observation and must still be
  // compared.  Using only sourceId would silently classify same-version
  // corrections as harmless formatting changes.
  const observationChannels = new Set(
    observations.map((observation) => `${observation.sourceId}:${observation.sourceSnapshotId}`),
  );
  const missingField = observations.some((observation) => {
    const metadata = asRecord(observation.provenance);
    const nested = asRecord(metadata.provenance);
    const provenance = Object.keys(nested).length ? nested : metadata;
    const lineage = asRecord(provenance.lineage);
    const lineagePresent = Object.keys(lineage).length > 0;
    return !observation.title || (lineagePresent && (!lineage.title || !lineage.body));
  });
  if (missingField) return "missing_field";
  if (observationChannels.size <= 1) return "formatting_only";
  const normalizedHashes = new Set(
    observations.map((observation) => observation.normalizedContentHash),
  );
  if (normalizedHashes.size > 1) return "content_conflict";
  const rawHashes = new Set(observations.map((observation) => observation.rawContentHash));
  return rawHashes.size === 1 ? "exact_match" : "formatting_only";
}

export function conflictIsResolved(kind: ConflictKind): boolean {
  return kind === "exact_match" || kind === "formatting_only" || kind === "version_difference";
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function stableUuid(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

export function stableEntityId(gameId: string, sourceKey: string): string {
  return stableUuid(`${gameId}:entity:${sourceKey}`);
}

export function revisionLabel(revisionNumber: number): string {
  return `r${revisionNumber}`;
}

export function releaseCandidateChecksum(
  records: NormalizedRecord[],
  structuredRecords?: StructuredImportRecords,
): string {
  return createHash("sha256")
    .update(stableStringify({ records, structuredRecords: structuredRecords ?? {} }))
    .digest("hex");
}

export function canonicalRecordBytes(record: NormalizedRecord): string {
  return stableStringify(record);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function manifestRootHash(records: NormalizedRecord[]): string {
  const lines = [...records]
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
    .map(
      (record) =>
        `${record.sourceKey}\0${createHash("sha256").update(canonicalRecordBytes(record)).digest("hex")}\n`,
    )
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

export function mergeReleaseCandidateRecords(
  base: NormalizedRecord[],
  batches: Array<{ records: NormalizedRecord[]; confirmedDeletionKeys: string[] }>,
): NormalizedRecord[] {
  const merged = new Map(base.map((record) => [record.sourceKey, record]));
  for (const batch of batches) {
    for (const sourceKey of batch.confirmedDeletionKeys) merged.delete(sourceKey);
    for (const record of batch.records) merged.set(record.sourceKey, record);
  }
  return [...merged.values()].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

export function deterministicRecordOrder(
  seed: string,
  category: string,
  record: NormalizedRecord,
): string {
  return createHash("sha256").update(`${seed}:${category}:${record.sourceKey}`).digest("hex");
}

export function recordCanonicalKey(record: NormalizedRecord): string {
  return safeProvenance(record.metadata, record.sourceKey).canonicalKey ?? record.sourceKey;
}

export function verificationCategoryFromKey(
  sourceKey: string | undefined,
): VerificationItem["category"] | undefined {
  if (!sourceKey) return undefined;
  if (sourceKey.startsWith("book/")) return "book";
  if (sourceKey.startsWith("character/") && sourceKey.includes("/story/")) return "character_story";
  if (sourceKey.startsWith("item-codex/")) return "item_description";
  return undefined;
}

export function nextVerificationReplacement(
  records: NormalizedRecord[],
  seed: string,
  category: string,
  existingKeys: Set<string>,
): NormalizedRecord | undefined {
  return records
    .filter(
      (record) =>
        (record.documentType ?? record.recordType) === category &&
        !existingKeys.has(recordCanonicalKey(record)),
    )
    .sort((left, right) =>
      deterministicRecordOrder(seed, category, left).localeCompare(
        deterministicRecordOrder(seed, category, right),
      ),
    )[0];
}

export const VERIFICATION_SAMPLE_SIZE = 30;

/**
 * Pick a repeatable manual-verification sample.  The sample is capped per
 * category, but deliberately gives the length quartiles and records carrying
 * converter risk flags a chance to enter before filling the remainder by a
 * stable hash order.  This keeps repeated imports comparable without relying
 * on insertion order or a runtime random number generator.
 */
export function selectVerificationSample(
  records: NormalizedRecord[],
  seed: string,
  category: string,
  limit = VERIFICATION_SAMPLE_SIZE,
  excludedKeys: Set<string> = new Set(),
): NormalizedRecord[] {
  const unique = new Map<string, NormalizedRecord>();
  for (const record of records) {
    const key = recordCanonicalKey(record);
    if (!excludedKeys.has(key)) unique.set(key, record);
  }
  const candidates = [...unique.values()];
  const selected: NormalizedRecord[] = [];
  const selectedKeys = new Set<string>();
  const add = (record: NormalizedRecord | undefined) => {
    if (!record || selected.length >= limit) return;
    const key = recordCanonicalKey(record);
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push(record);
  };
  const byStableOrder = [...candidates].sort((left, right) =>
    deterministicRecordOrder(seed, category, left).localeCompare(
      deterministicRecordOrder(seed, category, right),
    ),
  );
  const byLength = [...candidates].sort((left, right) => {
    const lengthDifference = (left.body ?? "").length - (right.body ?? "").length;
    return lengthDifference || left.sourceKey.localeCompare(right.sourceKey);
  });
  // Include the shortest, lower-middle, upper-middle and longest records when
  // possible so format/length regressions are not hidden by a hash sample.
  for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
    const index = Math.min(byLength.length - 1, Math.round((byLength.length - 1) * fraction));
    add(byLength[index]);
  }
  // Converter risk flags include format tags, alternate fields and other
  // known cases that deserve a manual look even if their body is short.
  for (const record of byStableOrder) {
    const metadata = asRecord(record.metadata);
    const flags = metadata.verificationRiskFlags;
    if (Array.isArray(flags) && flags.length) add(record);
  }
  for (const record of byStableOrder) add(record);
  return selected;
}

export function lexicalScore(query: string, value: string): { score: number; match: string } {
  const q = normalize(query);
  const v = normalize(value);
  if (v === q) return { score: 1, match: "exact" };
  if (v.startsWith(q)) return { score: 0.9, match: "prefix" };
  if (v.includes(q)) return { score: 0.7, match: "contains" };
  const qChars = [...q];
  const overlap = qChars.filter((char) => v.includes(char)).length / Math.max(qChars.length, 1);
  return { score: overlap * 0.45, match: "trigram" };
}

export function asEntitySummary(
  row: typeof entities.$inferSelect,
  aliases: string[] = [],
): EntitySummary {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    name: row.canonicalName,
    type: row.type as EntityType,
    summary: row.summary,
    aliases,
  };
}

export function asDocumentSummary(
  row: typeof documents.$inferSelect,
  sourceVersion?: string | null,
): DocumentSummary {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    sourceVersion,
    title: row.title,
    type: row.type as DocumentType,
    gameVersion: row.gameVersion,
    locale: row.locale,
    revision: undefined,
  };
}

export function splitIntoSegments(
  body: string,
): Array<{ headingPath: string[]; body: string; start: number; end: number }> {
  const lines = body.split("\n");
  const sections: Array<{ headingPath: string[]; body: string; start: number; end: number }> = [];
  let offset = 0;
  let currentStart = 0;
  let currentHeading: string[] = [];
  let currentLines: string[] = [];

  const flush = (end: number) => {
    const text = currentLines.join("\n").trim();
    if (text) sections.push({ headingPath: currentHeading, body: text, start: currentStart, end });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush(offset);
      currentHeading = [heading[2] ?? ""];
      currentStart = offset;
    } else {
      currentLines.push(line);
    }
    offset += line.length + 1;
  }
  flush(body.length);

  if (sections.length === 0 && body.trim()) {
    const chunks: Array<{ headingPath: string[]; body: string; start: number; end: number }> = [];
    for (let start = 0; start < body.length; start += 1_500) {
      const end = Math.min(body.length, start + 1_500);
      chunks.push({ headingPath: [], body: body.slice(start, end).trim(), start, end });
    }
    return chunks.filter((item) => item.body);
  }
  return sections;
}

export function recordLocale(record: NormalizedRecord): string {
  const metadata = asRecord(record.metadata);
  const provenance = asRecord(metadata.provenance);
  const locale = record.locale ?? provenance.locale ?? metadata.locale;
  return typeof locale === "string" && locale.trim() ? locale.trim() : "und";
}

export function recordSegments(
  record: NormalizedRecord,
  body: string,
): Array<{
  segmentKey?: string;
  headingPath: string[];
  metadata: Record<string, unknown>;
  body: string;
  start: number;
  end: number;
}> {
  if (record.segments?.length)
    return record.segments
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((segment) => ({
        segmentKey: segment.segmentKey,
        headingPath: segment.headingPath ?? [],
        metadata: segment.metadata ?? {},
        body: segment.body,
        start: segment.startOffset,
        end: segment.endOffset,
      }));
  return splitIntoSegments(body).map((segment) => ({
    ...segment,
    segmentKey: undefined,
    metadata: {},
  }));
}

export function questKeyFromInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("quest/")) return trimmed.split("/locale/")[0] ?? trimmed;
  return `quest/${trimmed}`;
}

export function mainQuestIdFromKey(value: string): string {
  return value.split("/")[1] ?? value;
}

export function encodeQuestCursor(value: {
  revisionId: string;
  questKey: string;
  locale: string;
  subquestKey?: string;
  offset: number;
}): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeQuestCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      revisionId?: unknown;
      questKey?: unknown;
      locale?: unknown;
      subquestKey?: unknown;
      offset?: unknown;
    };
    if (
      typeof parsed.revisionId === "string" &&
      typeof parsed.questKey === "string" &&
      typeof parsed.locale === "string" &&
      typeof parsed.offset === "number" &&
      Number.isSafeInteger(parsed.offset) &&
      parsed.offset >= 0
    )
      return {
        revisionId: parsed.revisionId,
        questKey: parsed.questKey,
        locale: parsed.locale,
        ...(typeof parsed.subquestKey === "string" ? { subquestKey: parsed.subquestKey } : {}),
        offset: parsed.offset,
      };
  } catch {
    return undefined;
  }
  return undefined;
}

export function questMetadata(row: typeof documents.$inferSelect): Partial<QuestRecordPayload> & {
  completeness?: QuestCompleteness;
} {
  const metadata = asRecord(row.metadata);
  const questPayload = asRecord(metadata.questPayload);
  const quest = Object.keys(questPayload).length ? questPayload : asRecord(metadata.quest);
  return quest as Partial<QuestRecordPayload> & { completeness?: QuestCompleteness };
}

/** SQL-side public catalogue guard. New quest records carry explicit visibility;
 * the second branch keeps older revisions readable while excluding the known
 * temporary/metadata-only rows without loading an entire revision into memory. */
export function publicQuestCondition() {
  const visibility = sql`coalesce(${documents.metadata}->'questPayload'->>'visibility', ${documents.metadata}->'quest'->>'visibility')`;
  const completeness = sql`coalesce(${documents.metadata}->'questPayload'->>'completeness', ${documents.metadata}->'quest'->>'completeness')`;
  return sql`(
    ${visibility} = 'public'
    OR (
      ${visibility} IS NULL
      AND ${completeness} = 'complete'
      AND ${documents.body} <> ''
      AND ${documents.title} NOT ILIKE '%$HIDDEN%'
      AND ${documents.title} NOT ILIKE '%$UNRELEASED%'
      AND ${documents.title} NOT ILIKE '%$TEST%'
      AND ${documents.title} !~* '^Quest [0-9]+$'
    )
  )`;
}

export function publicDocumentCondition() {
  return sql`(
    ${documents.type} NOT IN ('archon_quest', 'story_quest', 'world_quest', 'event_quest', 'commission', 'hangout', 'other')
    OR ${publicQuestCondition()}
  )`;
}
