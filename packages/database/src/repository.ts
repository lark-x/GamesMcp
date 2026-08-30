import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  Capability,
  DocumentSummary,
  DocumentType,
  EntitySummary,
  EntityType,
  RelationshipPredicate,
  SearchRequest,
  SearchResult,
} from "@gip/contracts";
import {
  assertPublishable,
  DomainError,
  type ClaimView,
  type ConflictCase,
  type ConflictDetail,
  type ConflictKind,
  type DatasetRevision,
  type DocumentDetail,
  type DocumentProvenance,
  type ProvenanceLineage,
  type EmbeddingInput,
  type EntityDetail,
  type ImportBatch,
  type ImportDiff,
  type KnowledgeRepository,
  type NormalizedRecord,
  type RelationshipView,
  type Source,
  type SourceSnapshot,
  type StoredEmbedding,
  type ValidationIssue,
  type VectorSearchHit,
  type VectorEntityHit,
  type VerificationChannel,
  type VerificationItem,
  type VerificationRun,
  type VerificationScreenshot,
  type VerificationStatus,
  type PublishReadiness,
  type ReleaseCandidate,
  type ReleaseCandidateBuild,
  type ReleaseCandidateDetail,
  type ReleaseCandidateReadiness,
  type ReviewIssue,
  type CandidatePatch,
  type ReviewEvidence,
  type ReleaseCandidateCheck,
} from "@gip/domain";
import type { GameSummary } from "@gip/contracts";
import type { Database } from "./client.js";
import {
  auditLog,
  claimEntities,
  claims,
  conflictCases,
  contentObjects,
  datasetManifestEntries,
  datasetManifests,
  datasetRevisions,
  documentSegments,
  documents,
  embeddings,
  entities,
  entityAliases,
  entityMentions,
  evidence,
  gameCapabilities,
  games,
  importBatches,
  jobs,
  relationships,
  releaseCandidateBuilds,
  releaseCandidates,
  reviewIssues,
  candidatePatches,
  reviewEvidence,
  releaseCandidateChecks,
  sourceSnapshots,
  sourceObservations,
  sources,
  verificationItems,
  verificationRuns,
  verificationScreenshots,
  workerHeartbeats,
} from "./schema.js";

const defaultLimit = 20;

const animeCategoryFiles = {
  book: "books.json",
  character_story: "character-stories.json",
  item_description: "items.json",
} as const;

const animeCategoryPlural = {
  book: "books",
  character_story: "characterStories",
  item_description: "itemDescriptions",
} as const;

type AnimeCategory = keyof typeof animeCategoryFiles;

function animeCategory(value: string | undefined): AnimeCategory | undefined {
  return value && value in animeCategoryFiles ? (value as AnimeCategory) : undefined;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function setField(value: NormalizedRecord, path: string | null | undefined, next: unknown) {
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

function safeRelative(value: unknown): string | undefined {
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

function safeUpstreamId(value: unknown): ProvenanceLineage["upstreamId"] | undefined {
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

function safeLineage(value: unknown): ProvenanceLineage | undefined {
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

function safeProvenance(metadata: Record<string, unknown>, sourceKey: string): DocumentProvenance {
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
  };
}

type SourceObservationRow = typeof sourceObservations.$inferSelect;

type AcquisitionManifestInfo = {
  path: string;
  value: Record<string, unknown>;
  hash: string;
};

function observationConflictKind(observations: SourceObservationRow[]): ConflictKind {
  const missingField = observations.some((observation) => {
    const metadata = asRecord(observation.provenance);
    const nested = asRecord(metadata.provenance);
    const provenance = Object.keys(nested).length ? nested : metadata;
    const lineage = asRecord(provenance.lineage);
    return !lineage.title || !lineage.body;
  });
  if (missingField) return "missing_field";
  const normalizedHashes = new Set(
    observations.map((observation) => observation.normalizedContentHash),
  );
  if (normalizedHashes.size > 1) return "content_conflict";
  const rawHashes = new Set(observations.map((observation) => observation.rawContentHash));
  return rawHashes.size === 1 ? "exact_match" : "formatting_only";
}

function conflictIsResolved(kind: ConflictKind): boolean {
  return kind === "exact_match" || kind === "formatting_only" || kind === "version_difference";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function stableUuid(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

export function stableEntityId(gameId: string, sourceKey: string): string {
  return stableUuid(`${gameId}:entity:${sourceKey}`);
}

function revisionLabel(revisionNumber: number): string {
  return `r${revisionNumber}`;
}

export function releaseCandidateChecksum(records: NormalizedRecord[]): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function canonicalRecordBytes(record: NormalizedRecord): string {
  return JSON.stringify(record);
}

function manifestRootHash(records: NormalizedRecord[]): string {
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

function deterministicRecordOrder(
  seed: string,
  category: string,
  record: NormalizedRecord,
): string {
  return createHash("sha256").update(`${seed}:${category}:${record.sourceKey}`).digest("hex");
}

function recordCanonicalKey(record: NormalizedRecord): string {
  return safeProvenance(record.metadata, record.sourceKey).canonicalKey ?? record.sourceKey;
}

function verificationCategoryFromKey(
  sourceKey: string | undefined,
): VerificationItem["category"] | undefined {
  if (!sourceKey) return undefined;
  if (sourceKey.startsWith("book/")) return "book";
  if (sourceKey.startsWith("character/") && sourceKey.includes("/story/")) return "character_story";
  if (sourceKey.startsWith("item-codex/")) return "item_description";
  return undefined;
}

function nextVerificationReplacement(
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

function lexicalScore(query: string, value: string): { score: number; match: string } {
  const q = normalize(query);
  const v = normalize(value);
  if (v === q) return { score: 1, match: "exact" };
  if (v.startsWith(q)) return { score: 0.9, match: "prefix" };
  if (v.includes(q)) return { score: 0.7, match: "contains" };
  const qChars = [...q];
  const overlap = qChars.filter((char) => v.includes(char)).length / Math.max(qChars.length, 1);
  return { score: overlap * 0.45, match: "trigram" };
}

function asEntitySummary(row: typeof entities.$inferSelect, aliases: string[] = []): EntitySummary {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    name: row.canonicalName,
    type: row.type as EntityType,
    summary: row.summary,
    aliases,
  };
}

function asDocumentSummary(
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
    revision: undefined,
  };
}

function splitIntoSegments(
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

export class SqlKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly db: Database,
    private readonly dataDir?: string,
  ) {}

  async health() {
    try {
      await this.db.execute(sql`select 1`);
      const current = await this.db
        .select({ id: datasetRevisions.id, indexStatus: datasetRevisions.indexStatus })
        .from(datasetRevisions)
        .where(
          and(
            eq(datasetRevisions.isCurrent, true),
            eq(datasetRevisions.lifecycleStatus, "published"),
          ),
        )
        .limit(1);
      return {
        database: "up" as const,
        currentRevision: current.length ? ("available" as const) : ("missing" as const),
        searchIndex:
          current[0]?.indexStatus === "ready" ? ("ready" as const) : ("not_ready" as const),
      };
    } catch {
      return {
        database: "down" as const,
        currentRevision: "missing" as const,
        searchIndex: "not_ready" as const,
      };
    }
  }

  async listGames(): Promise<GameSummary[]> {
    const rows = await this.db.select().from(games).orderBy(asc(games.name));
    const revisions = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.isCurrent, true),
          eq(datasetRevisions.lifecycleStatus, "published"),
        ),
      );
    const revisionMap = new Map(
      revisions.map((revision) => [revision.gameId, revisionNumberLabel(revision.revisionNumber)]),
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      currentRevision: revisionMap.get(row.id),
    }));
  }

  async getGame(gameId: string): Promise<GameSummary | null> {
    const rows = await this.db.select().from(games).where(eq(games.id, gameId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const revision = await this.getCurrentRevision(gameId);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      currentRevision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    };
  }

  async getGameBySlug(slug: string): Promise<GameSummary | null> {
    const rows = await this.db.select().from(games).where(eq(games.slug, slug)).limit(1);
    const row = rows[0];
    return row ? this.getGame(row.id) : null;
  }

  async getCapabilities(gameId: string) {
    const rows = await this.db
      .select()
      .from(gameCapabilities)
      .where(eq(gameCapabilities.gameId, gameId));
    return rows.map((row) => ({ capability: row.capability as Capability, enabled: row.enabled }));
  }

  async listEntities(
    gameId: string,
    options: {
      query?: string;
      type?: EntityType;
      limit: number;
      offset: number;
      revisionId?: string;
    },
  ): Promise<EntitySummary[]> {
    if (options.revisionId) {
      const revision = await this.getRevision(options.revisionId, gameId);
      if (!revision) return [];
      const records = await this.getRevisionRecords(revision);
      const candidates = new Map(
        records.flatMap((record) =>
          (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
        ),
      );
      const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
      const query = options.query ? normalize(options.query) : undefined;
      return rows
        .flatMap((row) => {
          const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
          if (!candidate || (options.type && candidate.type !== options.type)) return [];
          const values = [candidate.name, ...(candidate.aliases ?? []).map((alias) => alias.value)];
          if (query && !values.some((value) => normalize(value).includes(query))) return [];
          return [
            {
              id: row.id,
              sourceKey: row.sourceKey,
              name: candidate.name,
              type: candidate.type,
              summary: candidate.summary ?? null,
              aliases: (candidate.aliases ?? []).map((alias) => alias.value),
              revision: revisionLabel(revision.revisionNumber),
            },
          ];
        })
        .slice(options.offset, options.offset + options.limit);
    }
    const current = await this.getCurrentRevision(gameId);
    if (current) {
      const enforceSnapshotMembership =
        current.lifecycleStatus === "preview" || current.normalizedRecords !== null;
      const candidates = new Map(
        (await this.getRevisionRecords(current)).flatMap((record) =>
          (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
        ),
      );
      const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
      const aliases = await this.getAliases(rows.map((row) => row.id));
      const query = options.query ? normalize(options.query) : undefined;
      return rows
        .flatMap((row) => {
          const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
          if (!candidate && (enforceSnapshotMembership || row.deleted)) return [];
          const type = candidate?.type ?? (row.type as EntityType);
          const name = candidate?.name ?? row.canonicalName;
          const summary = candidate?.summary ?? row.summary;
          const rowAliases = candidate
            ? (candidate.aliases ?? []).map((alias) => alias.value)
            : (aliases.get(row.id) ?? []);
          if (options.type && type !== options.type) return [];
          if (query && ![name, ...rowAliases].some((value) => normalize(value).includes(query)))
            return [];
          return [
            {
              id: row.id,
              sourceKey: row.sourceKey,
              name,
              type,
              summary,
              aliases: rowAliases,
              revision: revisionLabel(current.revisionNumber),
            },
          ];
        })
        .slice(options.offset, options.offset + options.limit);
    }
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.gameId, gameId), eq(entities.deleted, false)))
      .limit(options.limit)
      .offset(options.offset);
    return this.addAliases(rows.map((row) => asEntitySummary(row)));
  }

  async getEntity(
    gameId: string,
    entityId: string,
    revisionId?: string,
  ): Promise<EntityDetail | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.gameId, gameId), eq(entities.id, entityId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return null;
    const revisionCandidate = (await this.getRevisionRecords(revision))
      .flatMap((record) => record.entities ?? [])
      .find((candidate) => candidate.sourceKey === row.sourceKey);
    const enforceSnapshotMembership =
      revision.lifecycleStatus === "preview" || revision.normalizedRecords !== null;
    if (!revisionCandidate && (enforceSnapshotMembership || row.deleted)) return null;
    const aliases = await this.getAliases([row.id]);
    const entitySummary = revisionCandidate
      ? {
          id: row.id,
          sourceKey: row.sourceKey,
          name: revisionCandidate.name,
          type: revisionCandidate.type,
          summary: revisionCandidate.summary ?? null,
          aliases: (revisionCandidate.aliases ?? []).map((alias) => alias.value),
        }
      : asEntitySummary(row, aliases.get(row.id) ?? []);
    const relationRows = await this.db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.gameId, gameId),
          revision ? eq(relationships.revisionId, revision.id) : sql`false`,
          or(eq(relationships.subjectId, entityId), eq(relationships.objectId, entityId)),
        ),
      );
    const relatedIds = [
      ...new Set(relationRows.flatMap((item) => [item.subjectId, item.objectId])),
    ];
    const relatedRows = relatedIds.length
      ? await this.db.select().from(entities).where(inArray(entities.id, relatedIds))
      : [];
    const revisionCandidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
      ),
    );
    const names = new Map(
      relatedRows.map((item) => [
        item.id,
        (item.sourceKey && revisionCandidates.get(item.sourceKey)) || item.canonicalName,
      ]),
    );
    const relationViews = relationRows.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectName: names.get(item.subjectId) ?? item.subjectId,
      predicate: item.predicate as RelationshipPredicate,
      objectId: item.objectId,
      objectName: names.get(item.objectId) ?? item.objectId,
      confidence: item.confidence,
      revision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    }));
    const docs = await this.getEntityDocuments(gameId, entityId, 20, revision?.id);
    const linkedClaims = await this.db
      .select({ claimId: claimEntities.claimId })
      .from(claimEntities)
      .where(eq(claimEntities.entityId, entityId));
    const claimRows = linkedClaims.length
      ? await this.db
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.gameId, gameId),
              revision ? eq(claims.revisionId, revision.id) : sql`false`,
              inArray(
                claims.id,
                linkedClaims.map((item) => item.claimId),
              ),
            ),
          )
      : [];
    const claimViews: ClaimView[] = [];
    for (const claim of claimRows) {
      const claimEvidence = await this.db
        .select()
        .from(evidence)
        .where(eq(evidence.claimId, claim.id));
      const evidenceViews = await this.evidenceViews(claimEvidence);
      if (evidenceViews.some((item) => item.documentTitle))
        claimViews.push({
          id: claim.id,
          statement: claim.normalizedStatement,
          status: claim.status as ClaimView["status"],
          confidence: claim.confidence,
          evidence: evidenceViews,
        });
    }
    return {
      ...entitySummary,
      gameId: row.gameId,
      properties: revisionCandidate?.properties ?? row.properties,
      deleted: revisionCandidate ? false : row.deleted,
      sourceKey: row.sourceKey,
      relationships: relationViews,
      documents: docs,
      claims: claimViews,
      revision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    };
  }

  async getRelationships(
    gameId: string,
    entityId: string,
    options: { predicate?: RelationshipPredicate; limit: number; revisionId?: string },
  ): Promise<RelationshipView[]> {
    const revision = options.revisionId
      ? await this.getRevision(options.revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const conditions = [
      eq(relationships.gameId, gameId),
      eq(relationships.revisionId, revision.id),
      or(eq(relationships.subjectId, entityId), eq(relationships.objectId, entityId)),
    ];
    if (options.predicate) conditions.push(eq(relationships.predicate, options.predicate));
    const rows = await this.db
      .select()
      .from(relationships)
      .where(and(...conditions))
      .limit(options.limit);
    const ids = [...new Set(rows.flatMap((item) => [item.subjectId, item.objectId]))];
    const related = ids.length
      ? await this.db.select().from(entities).where(inArray(entities.id, ids))
      : [];
    const revisionCandidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
      ),
    );
    const names = new Map(
      related.map((item) => [
        item.id,
        (item.sourceKey && revisionCandidates.get(item.sourceKey)) || item.canonicalName,
      ]),
    );
    return rows.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectName: names.get(item.subjectId) ?? item.subjectId,
      predicate: item.predicate as RelationshipPredicate,
      objectId: item.objectId,
      objectName: names.get(item.objectId) ?? item.objectId,
      confidence: item.confidence,
      revision: revisionLabel(revision.revisionNumber),
    }));
  }

  async getEntityDocuments(
    gameId: string,
    entityId: string,
    limit: number,
    revisionId?: string,
  ): Promise<DocumentSummary[]> {
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const rows = await this.db
      .select({ document: documents, sourceSnapshot: sourceSnapshots })
      .from(entityMentions)
      .innerJoin(documentSegments, eq(entityMentions.segmentId, documentSegments.id))
      .innerJoin(documents, eq(documentSegments.documentId, documents.id))
      .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
      .where(
        and(
          eq(entityMentions.entityId, entityId),
          eq(documents.gameId, gameId),
          eq(documents.revisionId, revision.id),
          eq(documents.deleted, false),
        ),
      )
      .limit(limit);
    const seen = new Set<string>();
    return rows
      .filter((row) => !seen.has(row.document.id) && seen.add(row.document.id))
      .map((row) => ({
        ...asDocumentSummary(row.document, row.sourceSnapshot.contentHash),
        revision: revisionLabel(revision.revisionNumber),
      }));
  }

  async listDocuments(
    gameId: string,
    options: {
      query?: string;
      type?: DocumentType;
      limit: number;
      offset: number;
      revisionId?: string;
    },
  ): Promise<DocumentSummary[]> {
    const revision = options.revisionId
      ? await this.getRevision(options.revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const conditions = [
      eq(documents.gameId, gameId),
      eq(documents.revisionId, revision.id),
      eq(documents.deleted, false),
    ];
    if (options.type) conditions.push(eq(documents.type, options.type));
    if (options.query)
      conditions.push(
        or(
          ilike(documents.normalizedTitle, `%${normalize(options.query)}%`),
          ilike(documents.title, `%${options.query}%`),
        ) ?? sql`false`,
      );
    const rows = await this.db
      .select({ document: documents, sourceSnapshot: sourceSnapshots })
      .from(documents)
      .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
      .where(and(...conditions))
      .orderBy(asc(documents.title))
      .limit(options.limit)
      .offset(options.offset);
    return rows.map((row) => ({
      ...asDocumentSummary(row.document, row.sourceSnapshot.contentHash),
      revision: revisionLabel(revision.revisionNumber),
    }));
  }

  async getDocument(
    gameId: string,
    documentId: string,
    revisionId?: string,
  ): Promise<DocumentDetail | null> {
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return null;
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.gameId, gameId),
          eq(documents.id, documentId),
          eq(documents.revisionId, revision.id),
          eq(documents.deleted, false),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const sourceRows = await this.db
      .select()
      .from(sources)
      .innerJoin(sourceSnapshots, eq(sourceSnapshots.sourceId, sources.id))
      .where(eq(sourceSnapshots.id, row.sourceSnapshotId))
      .limit(1);
    const source = sourceRows[0]?.sources;
    const sourceSnapshot = sourceRows[0]?.source_snapshots;
    const segmentRows = await this.db
      .select()
      .from(documentSegments)
      .where(
        and(eq(documentSegments.documentId, row.id), eq(documentSegments.revisionId, revision.id)),
      )
      .orderBy(asc(documentSegments.ordinal));
    const revisionEntityNames = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
      ),
    );
    const segments = [];
    for (const segment of segmentRows) {
      const mentionRows = await this.db
        .select({ mention: entityMentions, entity: entities })
        .from(entityMentions)
        .innerJoin(entities, eq(entityMentions.entityId, entities.id))
        .where(eq(entityMentions.segmentId, segment.id));
      segments.push({
        id: segment.id,
        ordinal: segment.ordinal,
        headingPath: segment.headingPath,
        body: segment.body,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        mentions: mentionRows.map((item) => ({
          entityId: item.mention.entityId,
          name:
            (item.entity.sourceKey && revisionEntityNames.get(item.entity.sourceKey)) ||
            item.entity.canonicalName,
          startOffset: item.mention.startOffset,
          endOffset: item.mention.endOffset,
        })),
      });
    }
    return {
      ...asDocumentSummary(row, sourceSnapshot?.contentHash),
      revision: revisionLabel(revision.revisionNumber),
      body: row.body,
      sourceName: source?.name ?? "unknown",
      sourceId: source?.id ?? "",
      provenance: {
        ...safeProvenance(row.metadata, row.sourceKey),
        datasetRevision: revisionLabel(revision.revisionNumber),
        sourceSnapshotId: sourceSnapshot?.id ?? row.sourceSnapshotId,
      },
      segments,
    };
  }

  async search(gameId: string, request: SearchRequest): Promise<SearchResult> {
    const current = await this.getCurrentRevision(gameId);
    if (!current)
      return {
        entities: [],
        documents: [],
        segments: [],
        revision: "",
        indexStatus: "not_ready",
        debug: request.debug ? { reason: "no_revision" } : undefined,
      };
    const searchable = request.revisionId
      ? await this.getRevision(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!searchable)
      return {
        entities: [],
        documents: [],
        segments: [],
        revision: "",
        indexStatus: current.indexStatus,
        debug: request.debug ? { reason: "index_not_ready" } : undefined,
      };
    const result: SearchResult = {
      entities: [],
      documents: [],
      segments: [],
      revision: revisionLabel(searchable.revisionNumber),
      revisionId: searchable.id,
      indexStatus: current.indexStatus,
    };
    const limit = request.limit ?? defaultLimit;
    const types = request.types ?? ["entity", "document", "segment"];
    const query = normalize(request.query);
    const likeQuery = escapeLike(request.query);
    const normalizedLikeQuery = escapeLike(query);

    if (types.includes("entity")) {
      result.entities = await this.searchEntitiesAtRevision(gameId, request, searchable);
    }

    if (types.includes("document") || types.includes("segment")) {
      const documentConditions = [
        eq(documents.gameId, gameId),
        eq(documents.revisionId, searchable.id),
        eq(documents.deleted, false),
        or(
          ilike(documents.normalizedTitle, `%${normalizedLikeQuery}%`),
          ilike(documents.title, `%${likeQuery}%`),
          ilike(documents.body, `%${likeQuery}%`),
          sql`similarity(${documents.normalizedTitle}, ${query}) >= 0.15`,
          sql`similarity(${documents.body}, ${request.query}) >= 0.05`,
        ),
      ];
      if (request.documentTypes?.length)
        documentConditions.push(inArray(documents.type, request.documentTypes));
      if (request.gameVersions?.length)
        documentConditions.push(inArray(documents.gameVersion, request.gameVersions));
      if (request.sourceId)
        documentConditions.push(
          sql`${documents.sourceSnapshotId} in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`,
        );
      const docRows = await this.db
        .select({ document: documents, sourceSnapshot: sourceSnapshots })
        .from(documents)
        .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
        .where(and(...documentConditions))
        .limit(Math.max(limit * 4, 40));
      result.documents = docRows
        .map(({ document: row, sourceSnapshot }) => {
          const match = lexicalScore(request.query, `${row.title} ${row.body}`);
          return {
            ...asDocumentSummary(row, sourceSnapshot.contentHash),
            score: match.score,
            match: `document_${match.match}`,
            revision: revisionLabel(searchable.revisionNumber),
          };
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);
      if (types.includes("segment")) {
        const segmentConditions = [
          eq(documentSegments.revisionId, searchable.id),
          eq(documents.gameId, gameId),
          eq(documents.deleted, false),
          or(
            ilike(documentSegments.searchText, `%${likeQuery}%`),
            sql`similarity(${documentSegments.searchText}, ${request.query}) >= 0.05`,
          ),
        ];
        if (request.documentTypes?.length)
          segmentConditions.push(inArray(documents.type, request.documentTypes));
        if (request.gameVersions?.length)
          segmentConditions.push(inArray(documents.gameVersion, request.gameVersions));
        if (request.sourceId)
          segmentConditions.push(
            sql`${documents.sourceSnapshotId} in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`,
          );
        const segmentRows = await this.db
          .select({
            segment: documentSegments,
            document: documents,
            sourceSnapshot: sourceSnapshots,
          })
          .from(documentSegments)
          .innerJoin(documents, eq(documentSegments.documentId, documents.id))
          .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
          .where(and(...segmentConditions))
          .limit(limit);
        result.segments = segmentRows
          .map((item) => {
            const match = lexicalScore(request.query, item.segment.body);
            return {
              ...asDocumentSummary(item.document, item.sourceSnapshot.contentHash),
              segmentId: item.segment.id,
              snippet: item.segment.body.slice(0, 300),
              score: match.score,
              match: `segment_${match.match}`,
              revision: revisionLabel(searchable.revisionNumber),
            };
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
    }
    if (request.debug)
      result.debug = {
        lexical: true,
        vector: false,
        currentRevision: revisionLabel(current.revisionNumber),
        searchedRevision: revisionLabel(searchable.revisionNumber),
      };
    return result;
  }

  async vectorSearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorSearchHit[]> {
    if (vectorValue.length !== 1536) return [];
    const current = await this.getCurrentRevision(gameId);
    if (!current) return [];
    const revision = request.revisionId
      ? await this.getRevision(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!revision) return [];
    const vectorLiteral = `[${vectorValue.join(",")}]`;
    const documentTypeFilter = request.documentTypes?.length
      ? sql`and d.type in (${sql.join(
          request.documentTypes.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const gameVersionFilter = request.gameVersions?.length
      ? sql`and d.game_version in (${sql.join(
          request.gameVersions.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const sourceFilter = request.sourceId
      ? sql`and d.source_snapshot_id in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`
      : sql``;
    const rows = await this.db.execute(sql`
      select ds.id as segment_id, d.id as document_id, d.source_key, d.title, d.type, d.game_version,
             ss.content_hash as source_version, ds.body,
             1 - (e.vector <=> ${vectorLiteral}::vector) as score
      from knowledge.embeddings e
      inner join knowledge.document_segments ds on ds.id = e.target_id
      inner join knowledge.documents d on d.id = ds.document_id
      inner join knowledge.source_snapshots ss on ss.id = d.source_snapshot_id
      where e.target_type = 'segment'
        and e.space_id = ${spaceId}
        and e.revision_id = ${revision.id}
        and ds.revision_id = ${revision.id}
        and d.game_id = ${gameId}
        and d.deleted = false
        ${documentTypeFilter}
        ${gameVersionFilter}
        ${sourceFilter}
      order by e.vector <=> ${vectorLiteral}::vector
      limit ${limit}
    `);
    return (
      rows as unknown as Array<{
        segment_id: string;
        document_id: string;
        source_key: string;
        title: string;
        type: string;
        game_version: string | null;
        source_version: string;
        body: string;
        score: number;
      }>
    ).map((row) => ({
      document: {
        id: row.document_id,
        sourceKey: row.source_key,
        sourceVersion: row.source_version,
        title: row.title,
        type: row.type as DocumentType,
        gameVersion: row.game_version,
        revision: revisionLabel(revision.revisionNumber),
      },
      segmentId: row.segment_id,
      snippet: row.body.slice(0, 300),
      score: Number(row.score),
    }));
  }

  async vectorEntitySearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorEntityHit[]> {
    if (vectorValue.length !== 1536) return [];
    const current = await this.getCurrentRevision(gameId);
    if (!current) return [];
    const revision = request.revisionId
      ? await this.getRevision(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!revision) return [];
    const vectorLiteral = `[${vectorValue.join(",")}]`;
    const rows = await this.db.execute(sql`
      select e.target_id as entity_id,
             1 - (e.vector <=> ${vectorLiteral}::vector) as score
      from knowledge.embeddings e
      inner join knowledge.entities entity on entity.id = e.target_id
      where e.target_type = 'entity'
        and e.space_id = ${spaceId}
        and e.revision_id = ${revision.id}
        and entity.game_id = ${gameId}
      order by e.vector <=> ${vectorLiteral}::vector
      limit ${Math.max(limit * 4, 40)}
    `);
    const typedRows = rows as unknown as Array<{ entity_id: string; score: number }>;
    if (!typedRows.length) return [];
    const entityRows = await this.db
      .select()
      .from(entities)
      .where(
        inArray(
          entities.id,
          typedRows.map((row) => row.entity_id),
        ),
      );
    const aliases = await this.getAliases(entityRows.map((row) => row.id));
    const candidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const entityMap = new Map(entityRows.map((row) => [row.id, row]));
    return typedRows
      .flatMap((hit) => {
        const row = entityMap.get(hit.entity_id);
        if (!row) return [];
        const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
        if (
          !candidate &&
          (revision.lifecycleStatus === "preview" ||
            revision.normalizedRecords !== null ||
            row.deleted)
        )
          return [];
        const type = candidate?.type ?? (row.type as EntityType);
        if (request.entityTypes?.length && !request.entityTypes.includes(type)) return [];
        return [
          {
            entity: {
              id: row.id,
              sourceKey: row.sourceKey,
              name: candidate?.name ?? row.canonicalName,
              type,
              summary: candidate?.summary ?? row.summary,
              aliases: candidate
                ? (candidate.aliases ?? []).map((alias) => alias.value)
                : (aliases.get(row.id) ?? []),
              score: Number(hit.score),
              match: "vector",
              revision: revisionLabel(revision.revisionNumber),
            },
            score: Number(hit.score),
          },
        ];
      })
      .slice(0, limit);
  }

  async createSource(input: Omit<Source, "id">): Promise<Source> {
    const [row] = await this.db
      .insert(sources)
      .values({ ...input })
      .returning();
    if (!row)
      throw new DomainError("source_create_failed", "Source could not be created", undefined, 500);
    return {
      id: row.id,
      gameId: row.gameId,
      name: row.name,
      type: row.type as Source["type"],
      pathLabel: row.pathLabel,
      licenseNote: row.licenseNote,
      enabled: row.enabled,
      parserType: row.parserType,
    };
  }

  async listSources(gameId?: string): Promise<Source[]> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(gameId ? eq(sources.gameId, gameId) : undefined)
      .orderBy(asc(sources.name));
    return rows.map((row) => ({
      id: row.id,
      gameId: row.gameId,
      name: row.name,
      type: row.type as Source["type"],
      pathLabel: row.pathLabel,
      licenseNote: row.licenseNote,
      enabled: row.enabled,
      parserType: row.parserType,
    }));
  }

  async getSource(sourceId: string): Promise<Source | null> {
    const rows = await this.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          gameId: row.gameId,
          name: row.name,
          type: row.type as Source["type"],
          pathLabel: row.pathLabel,
          licenseNote: row.licenseNote,
          enabled: row.enabled,
          parserType: row.parserType,
        }
      : null;
  }

  async createSnapshot(input: Omit<SourceSnapshot, "id" | "capturedAt">): Promise<SourceSnapshot> {
    const [row] = await this.db
      .insert(sourceSnapshots)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (row)
      return {
        id: row.id,
        sourceId: row.sourceId,
        contentHash: row.contentHash,
        storagePath: row.storagePath,
        capturedAt: row.capturedAt,
        metadata: row.metadata,
      };
    const existing = await this.db
      .select()
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.sourceId, input.sourceId),
          eq(sourceSnapshots.contentHash, input.contentHash),
        ),
      )
      .limit(1);
    const found = existing[0];
    if (!found)
      throw new DomainError(
        "snapshot_create_failed",
        "Source snapshot could not be created",
        undefined,
        500,
      );
    return {
      id: found.id,
      sourceId: found.sourceId,
      contentHash: found.contentHash,
      storagePath: found.storagePath,
      capturedAt: found.capturedAt,
      metadata: found.metadata,
    };
  }

  async getSourceRecordHashes(sourceId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.sourceId, sourceId), eq(importBatches.status, "published")))
      .orderBy(desc(importBatches.completedAt))
      .limit(1);
    const records = rows[0]?.stagedRecords ?? [];
    return new Map(records.map((record) => [record.sourceKey, record.contentHash]));
  }

  async listEntitySourceKeys(gameId: string, revisionId?: string): Promise<string[]> {
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    return [
      ...new Set(
        (await this.getRevisionRecords(revision)).flatMap((record) =>
          (record.entities ?? []).map((entity) => entity.sourceKey),
        ),
      ),
    ];
  }

  async listEmbeddingInputs(gameId: string, revisionId: string): Promise<EmbeddingInput[]> {
    const revision = await this.getRevision(revisionId, gameId);
    if (!revision) return [];
    const revisionCandidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const entityRows = await this.db
      .select()
      .from(entities)
      .where(eq(entities.gameId, gameId))
      .limit(100_000);
    const segmentRows = await this.db
      .select()
      .from(documentSegments)
      .where(eq(documentSegments.revisionId, revisionId))
      .limit(100_000);
    return [
      ...entityRows.flatMap((row) => {
        const candidate = row.sourceKey ? revisionCandidates.get(row.sourceKey) : undefined;
        if (
          !candidate &&
          (revision.lifecycleStatus === "preview" ||
            revision.normalizedRecords !== null ||
            row.deleted)
        )
          return [];
        const name = candidate?.name ?? row.canonicalName;
        const summary = candidate?.summary ?? row.summary ?? "";
        const text = `${name}\n${summary}`;
        return [
          {
            revisionId,
            targetType: "entity" as const,
            targetId: row.id,
            text,
            contentHash: createHash("sha256").update(text).digest("hex"),
          },
        ];
      }),
      ...segmentRows.map((row) => ({
        revisionId,
        targetType: "segment" as const,
        targetId: row.id,
        text: row.body,
        contentHash: row.contentHash,
      })),
    ];
  }

  async storeEmbeddings(values: StoredEmbedding[]): Promise<void> {
    if (!values.length) return;
    if (values.some((value) => value.dimension !== 1536 || value.vector.length !== 1536))
      throw new DomainError(
        "embedding_dimension_mismatch",
        "This deployment is configured for 1536-dimensional pgvector embeddings",
      );
    await this.db
      .insert(embeddings)
      .values(
        values.map((value) => ({
          revisionId: value.revisionId,
          targetType: value.targetType,
          targetId: value.targetId,
          spaceId: value.spaceId,
          model: value.model,
          modelVersion: value.modelVersion,
          dimension: value.dimension,
          contentHash: value.contentHash,
          vector: value.vector,
        })),
      )
      .onConflictDoUpdate({
        target: [
          embeddings.revisionId,
          embeddings.targetType,
          embeddings.targetId,
          embeddings.spaceId,
        ],
        set: {
          model: sql`excluded.model`,
          modelVersion: sql`excluded.model_version`,
          dimension: sql`excluded.dimension`,
          contentHash: sql`excluded.content_hash`,
          vector: sql`excluded.vector`,
          createdAt: new Date(),
        },
      });
  }

  async createPendingImport(input: {
    gameId: string;
    sourceId: string;
    parserVersion: string;
  }): Promise<ImportBatch> {
    const [row] = await this.db
      .insert(importBatches)
      .values({
        gameId: input.gameId,
        sourceId: input.sourceId,
        sourceSnapshotId: null,
        status: "pending",
        parserVersion: input.parserVersion,
      })
      .returning();
    if (!row)
      throw new DomainError(
        "import_create_failed",
        "Import batch could not be created",
        undefined,
        500,
      );
    return this.mapImport(row);
  }

  async updateImportStaged(input: {
    batchId: string;
    sourceSnapshotId: string;
    stagedRecords: NormalizedRecord[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch> {
    const [row] = await this.db
      .update(importBatches)
      .set({
        sourceSnapshotId: input.sourceSnapshotId,
        status: input.errors.length ? "failed" : "review_required",
        successCount: input.stagedRecords.length,
        failureCount: input.errors.length,
        errors: input.errors,
        warnings: input.warnings,
        diff: input.diff,
        stagedRecords: input.stagedRecords,
        completedAt: new Date(),
      })
      .where(eq(importBatches.id, input.batchId))
      .returning();
    if (!row)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    const batch = this.mapImport(row);
    // Keep successful staged records in the immutable observation/audit layer
    // even when the batch also contains validation failures. The failed rows
    // remain explicit errors, while the records that were parsed correctly
    // must not disappear from provenance or conflict comparisons.
    await this.registerAcquisitionReview(batch);
    // Every completed import now gets an immediately inspectable preview.  The
    // legacy review/publish gate remains available for historical API callers,
    // but it is no longer the step that creates a preview for the operator.
    await this.ensurePreviewForImport(batch);
    return batch;
  }

  private async ensurePreviewForImport(batch: ImportBatch): Promise<void> {
    if (!batch.stagedRecords?.length) return;
    const first = batch.stagedRecords[0];
    const provenance = first ? safeProvenance(first.metadata, first.sourceKey) : undefined;
    const targetGameVersion = first?.gameVersion ?? provenance?.upstreamVersionLabel ?? "unknown";
    const existing = await this.db
      .select()
      .from(releaseCandidates)
      .where(
        and(
          eq(releaseCandidates.gameId, batch.gameId),
          eq(releaseCandidates.sourceId, batch.sourceId),
          eq(releaseCandidates.targetGameVersion, targetGameVersion),
        ),
      )
      .orderBy(desc(releaseCandidates.createdAt))
      .limit(1);
    let candidateId = existing[0]?.id;
    if (
      !candidateId ||
      ["merged", "abandoned", "promoted", "withdrawn"].includes(existing[0]!.status)
    ) {
      const current = await this.getCurrentRevision(batch.gameId);
      const slug = `${targetGameVersion}-${batch.id.slice(0, 8)}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const [created] = await this.db
        .insert(releaseCandidates)
        .values({
          gameId: batch.gameId,
          sourceId: batch.sourceId,
          targetGameVersion,
          name: `预发布 · ${slug}`,
          baseRevisionId: current?.id,
          importBatchIds: [batch.id],
          status: "draft",
        })
        .returning({ id: releaseCandidates.id });
      candidateId = created?.id;
    } else if (!existing[0]!.importBatchIds.includes(batch.id)) {
      await this.db
        .update(releaseCandidates)
        .set({
          importBatchIds: [...existing[0]!.importBatchIds, batch.id],
          updatedAt: new Date(),
        })
        .where(eq(releaseCandidates.id, candidateId));
    }
    if (!candidateId) return;
    try {
      await this.buildReleaseCandidate(candidateId);
    } catch (error) {
      await this.db
        .update(releaseCandidates)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(releaseCandidates.id, candidateId));
      await this.db.insert(auditLog).values({
        action: "preview_build_failed",
        targetType: "release_candidate",
        targetId: candidateId,
        reason: error instanceof Error ? error.message : "Preview build failed",
        metadata: { batchId: batch.id },
      });
    }
  }

  async markImportRunning(batchId: string): Promise<ImportBatch> {
    const [row] = await this.db
      .update(importBatches)
      .set({ status: "running", completedAt: null })
      .where(eq(importBatches.id, batchId))
      .returning();
    if (!row)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    return this.mapImport(row);
  }

  async markImportFailed(batchId: string, issue: ValidationIssue): Promise<ImportBatch> {
    const [row] = await this.db
      .update(importBatches)
      .set({ status: "failed", failureCount: 1, errors: [issue], completedAt: new Date() })
      .where(eq(importBatches.id, batchId))
      .returning();
    if (!row)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    return this.mapImport(row);
  }

  async enqueueJob(input: {
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(jobs).values(input).onConflictDoNothing();
  }

  async createImport(input: {
    gameId: string;
    sourceId: string;
    sourceSnapshotId: string;
    parserVersion: string;
    stagedRecords: NormalizedRecord[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch> {
    const status = input.errors.length ? "failed" : "review_required";
    const [row] = await this.db
      .insert(importBatches)
      .values({
        gameId: input.gameId,
        sourceId: input.sourceId,
        sourceSnapshotId: input.sourceSnapshotId,
        status,
        parserVersion: input.parserVersion,
        successCount: input.stagedRecords.length,
        failureCount: input.errors.length,
        errors: input.errors,
        warnings: input.warnings,
        diff: input.diff,
        stagedRecords: input.stagedRecords,
      })
      .returning();
    if (!row)
      throw new DomainError(
        "import_create_failed",
        "Import batch could not be created",
        undefined,
        500,
      );
    const batch = this.mapImport(row);
    // A partially failed acquisition still has useful, auditable observations
    // for its successful rows; only the failed rows stay in the error list.
    await this.registerAcquisitionReview(batch);
    return batch;
  }

  private async upsertObservationConflict(
    observations: SourceObservationRow[],
  ): Promise<ConflictKind | undefined> {
    if (observations.length < 2) return undefined;
    const orderedObservations = [...observations].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const first = orderedObservations[0];
    if (!first) return undefined;
    const kind = observationConflictKind(observations);
    const resolved = conflictIsResolved(kind);
    const observationIds = orderedObservations.map((observation) => observation.id);
    const [existing] = await this.db
      .select({
        status: conflictCases.status,
        observationIds: conflictCases.observationIds,
        selectedObservationId: conflictCases.selectedObservationId,
      })
      .from(conflictCases)
      .where(
        and(
          eq(conflictCases.gameId, first.gameId),
          eq(conflictCases.canonicalKey, first.canonicalKey),
          eq(conflictCases.gameVersion, first.gameVersion),
          eq(conflictCases.locale, first.locale),
        ),
      )
      .limit(1);
    const existingIds = [...(existing?.observationIds ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    if (
      existing?.status === "resolved" &&
      !resolved &&
      existingIds.length === observationIds.length &&
      existingIds.every((id, index) => id === observationIds[index])
    ) {
      // A reconciliation pass must not erase a prior human resolution when
      // the observation set has not changed. A newly observed source does
      // change the ID set and will reopen the case through the upsert below.
      return kind;
    }
    const retainedSelection =
      existing?.selectedObservationId && observationIds.includes(existing.selectedObservationId)
        ? existing.selectedObservationId
        : undefined;
    const automaticSelection =
      kind === "exact_match" || kind === "formatting_only" ? first.id : undefined;
    await this.db
      .insert(conflictCases)
      .values({
        gameId: first.gameId,
        canonicalKey: first.canonicalKey,
        gameVersion: first.gameVersion,
        locale: first.locale,
        kind,
        status: resolved ? "resolved" : "open",
        observationIds,
        selectedObservationId: resolved ? (retainedSelection ?? automaticSelection ?? null) : null,
        resolution: resolved ? "Source observations are equivalent after normalization" : null,
        resolvedAt: resolved ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [
          conflictCases.gameId,
          conflictCases.canonicalKey,
          conflictCases.gameVersion,
          conflictCases.locale,
        ],
        set: {
          kind,
          status: resolved ? "resolved" : "open",
          observationIds,
          selectedObservationId: resolved
            ? (retainedSelection ?? automaticSelection ?? null)
            : null,
          resolution: resolved ? "Source observations are equivalent after normalization" : null,
          resolvedAt: resolved ? new Date() : null,
        },
      });
    return kind;
  }

  /**
   * Rebuild conflict cases from the immutable observation layer. Imports
   * created before conflict tracking was enabled can therefore be audited in
   * exactly the same way as new imports, without rewriting source records.
   */
  async reconcileSourceObservationConflicts(gameId?: string): Promise<{
    checked: number;
    repairedRaw: number;
    repairedNormalized: number;
    scopes: number;
    upserted: number;
    open: number;
  }> {
    const observations = await this.db
      .select()
      .from(sourceObservations)
      .where(gameId ? eq(sourceObservations.gameId, gameId) : undefined);
    let repairedRaw = 0;
    let repairedNormalized = 0;
    for (const observation of observations) {
      const provenance = safeProvenance(observation.provenance, observation.canonicalKey);
      const next: {
        rawContentHash?: string;
        normalizedContentHash?: string;
      } = {};
      if (
        provenance.rawContentHash &&
        /^[0-9a-f]{64}$/.test(provenance.rawContentHash) &&
        provenance.rawContentHash !== observation.rawContentHash
      ) {
        next.rawContentHash = provenance.rawContentHash;
      }
      if (
        provenance.normalizedContentHash &&
        /^[0-9a-f]{64}$/.test(provenance.normalizedContentHash) &&
        provenance.normalizedContentHash !== observation.normalizedContentHash
      ) {
        next.normalizedContentHash = provenance.normalizedContentHash;
      }
      if (!Object.keys(next).length) continue;
      await this.db
        .update(sourceObservations)
        .set(next)
        .where(eq(sourceObservations.id, observation.id));
      if (next.rawContentHash) {
        observation.rawContentHash = next.rawContentHash;
        repairedRaw += 1;
      }
      if (next.normalizedContentHash) {
        observation.normalizedContentHash = next.normalizedContentHash;
        repairedNormalized += 1;
      }
    }
    const sameVersion = new Map<string, SourceObservationRow[]>();
    const sameLocale = new Map<string, SourceObservationRow[]>();
    for (const observation of observations) {
      const versionKey = JSON.stringify([
        observation.gameId,
        observation.canonicalKey,
        observation.gameVersion,
        observation.locale,
      ]);
      sameVersion.set(versionKey, [...(sameVersion.get(versionKey) ?? []), observation]);
      const localeKey = JSON.stringify([
        observation.gameId,
        observation.canonicalKey,
        observation.locale,
      ]);
      sameLocale.set(localeKey, [...(sameLocale.get(localeKey) ?? []), observation]);
    }

    let scopes = 0;
    let upserted = 0;
    for (const group of sameVersion.values()) {
      if (group.length < 2) continue;
      const kind = await this.upsertObservationConflict(group);
      if (!kind) continue;
      scopes += 1;
      upserted += 1;
    }

    for (const localeGroup of sameLocale.values()) {
      const byVersion = new Map<string, SourceObservationRow[]>();
      for (const observation of localeGroup)
        byVersion.set(observation.gameVersion, [
          ...(byVersion.get(observation.gameVersion) ?? []),
          observation,
        ]);
      if (byVersion.size < 2) continue;
      for (const [gameVersion, versionGroup] of byVersion) {
        if (versionGroup.length !== 1) continue;
        const first = versionGroup[0];
        if (!first) continue;
        const observationIds = localeGroup
          .map((observation) => observation.id)
          .sort((left, right) => left.localeCompare(right));
        await this.db
          .insert(conflictCases)
          .values({
            gameId: first.gameId,
            canonicalKey: first.canonicalKey,
            gameVersion,
            locale: first.locale,
            kind: "version_difference",
            status: "resolved",
            observationIds,
            selectedObservationId: null,
            resolution:
              "Different game versions are isolated and are not compared as a text conflict",
            resolvedAt: new Date(),
          })
          .onConflictDoNothing();
        scopes += 1;
        upserted += 1;
      }
    }
    const openRows = await this.db
      .select({ id: conflictCases.id })
      .from(conflictCases)
      .where(
        gameId
          ? and(eq(conflictCases.gameId, gameId), eq(conflictCases.status, "open"))
          : eq(conflictCases.status, "open"),
      );
    return {
      checked: observations.length,
      repairedRaw,
      repairedNormalized,
      scopes,
      upserted,
      open: openRows.length,
    };
  }

  private async registerAcquisitionReview(batch: ImportBatch): Promise<void> {
    if (!batch.sourceSnapshotId) return;
    const acquisitionRecords = (batch.stagedRecords ?? []).filter((record) => {
      const source = asRecord(record.metadata.provenance);
      return typeof (source.upstreamCommit ?? record.metadata.upstreamCommit) === "string";
    });
    const [snapshot] = await this.db
      .select({ metadata: sourceSnapshots.metadata })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, batch.sourceSnapshotId))
      .limit(1);
    const snapshotMetadata = asRecord(snapshot?.metadata);
    const snapshotUpstream = asRecord(snapshotMetadata.upstream);
    const snapshotCommit =
      typeof snapshotUpstream.commit === "string" ? snapshotUpstream.commit : undefined;
    const snapshotGameVersion =
      typeof snapshotMetadata.gameVersion === "string" ? snapshotMetadata.gameVersion : undefined;
    const snapshotLocale =
      typeof snapshotMetadata.locale === "string" ? snapshotMetadata.locale : undefined;
    if (!acquisitionRecords.length && !snapshotCommit) return;
    const extraVerificationKeys = new Set<string>([
      ...(batch.diff?.conflicts ?? []),
      ...(batch.errors ?? [])
        .map((issue) => issue.sourceKey)
        .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
    ]);
    for (const record of acquisitionRecords) {
      const provenance = safeProvenance(record.metadata, record.sourceKey);
      const canonicalKey = provenance.canonicalKey ?? record.sourceKey;
      const locale = provenance.locale ?? "unknown";
      const rawContentHash = provenance.rawContentHash ?? record.contentHash;
      const normalizedContentHash = provenance.normalizedContentHash ?? record.contentHash;
      const category = record.documentType ?? record.recordType;
      await this.db
        .insert(sourceObservations)
        .values({
          gameId: batch.gameId,
          sourceId: batch.sourceId,
          sourceSnapshotId: batch.sourceSnapshotId,
          canonicalKey,
          category,
          gameVersion: record.gameVersion ?? "unknown",
          locale,
          title: record.title ?? canonicalKey,
          body: record.body ?? "",
          rawContentHash,
          normalizedContentHash,
          provenance: record.metadata,
        })
        .onConflictDoNothing();
      const comparisons = await this.db
        .select()
        .from(sourceObservations)
        .where(
          and(
            eq(sourceObservations.gameId, batch.gameId),
            eq(sourceObservations.canonicalKey, canonicalKey),
            eq(sourceObservations.gameVersion, record.gameVersion ?? "unknown"),
            eq(sourceObservations.locale, locale),
          ),
        );
      const kind = await this.upsertObservationConflict(comparisons);
      if (kind === "content_conflict" || kind === "missing_field")
        extraVerificationKeys.add(canonicalKey);

      // A version change is informational, not a same-version conflict. Keep it
      // resolved so it remains auditable without blocking publication. If this
      // version later receives multiple observations, the same-version case
      // above takes precedence and can be opened for a real content conflict.
      const localeComparisons = await this.db
        .select()
        .from(sourceObservations)
        .where(
          and(
            eq(sourceObservations.gameId, batch.gameId),
            eq(sourceObservations.canonicalKey, canonicalKey),
            eq(sourceObservations.locale, locale),
          ),
        );
      const versions = new Set(localeComparisons.map((item) => item.gameVersion));
      if (versions.size > 1 && comparisons.length < 2) {
        await this.db
          .insert(conflictCases)
          .values({
            gameId: batch.gameId,
            canonicalKey,
            gameVersion: record.gameVersion ?? "unknown",
            locale,
            kind: "version_difference",
            status: "resolved",
            observationIds: localeComparisons.map((item) => item.id),
            resolution:
              "Different game versions are isolated and are not compared as a text conflict",
            resolvedAt: new Date(),
          })
          .onConflictDoNothing();
      }
    }
    const first = acquisitionRecords[0];
    const provenance = first ? safeProvenance(first.metadata, first.sourceKey) : undefined;
    const upstreamCommit = provenance?.upstreamCommit ?? snapshotCommit;
    if (!upstreamCommit) return;
    // Verification is issue-driven: clean acquisition imports do not create a
    // legacy run or a fixed-size sample.  Runs are retained for historical
    // reads and for explicitly surfaced conflicts/errors only.
    if (extraVerificationKeys.size === 0) return;
    const [insertedRun] = await this.db
      .insert(verificationRuns)
      .values({
        batchId: batch.id,
        upstreamCommit,
        expectedGameVersion: first?.gameVersion ?? snapshotGameVersion ?? "unknown",
        expectedLocale: provenance?.locale ?? snapshotLocale ?? "unknown",
        seed: upstreamCommit,
      })
      .onConflictDoNothing()
      .returning();
    const run =
      insertedRun ??
      (
        await this.db
          .select()
          .from(verificationRuns)
          .where(eq(verificationRuns.batchId, batch.id))
          .limit(1)
      )[0];
    if (!run) return;
    const categories = new Map<string, NormalizedRecord[]>();
    for (const record of acquisitionRecords) {
      const category = record.documentType ?? record.recordType;
      if (!["book", "character_story", "item_description"].includes(category)) continue;
      categories.set(category, [...(categories.get(category) ?? []), record]);
    }
    const stagedCanonicalKeys = new Set(
      acquisitionRecords.map((record) => recordCanonicalKey(record)),
    );
    for (const [category, records] of categories) {
      const selected: NormalizedRecord[] = [];
      const selectedKeys = new Set<string>();
      const recordsByCanonicalKey = new Map(
        records.map((record) => [recordCanonicalKey(record), record]),
      );
      const extra = [...extraVerificationKeys]
        .map((key) => recordsByCanonicalKey.get(key))
        .filter((record): record is NormalizedRecord => Boolean(record))
        .filter((record) => !selectedKeys.has(recordCanonicalKey(record)));
      const verificationRecords = [...selected, ...extra];
      if (verificationRecords.length)
        await this.db
          .insert(verificationItems)
          .values(
            verificationRecords.map((record) => ({
              runId: run.id,
              category,
              canonicalKey: recordCanonicalKey(record),
              title: record.title ?? recordCanonicalKey(record),
            })),
          )
          .onConflictDoNothing();
    }

    const extraItems = [
      ...(batch.errors ?? []).map((issue) => ({
        canonicalKey: issue.sourceKey?.trim(),
        titlePrefix: "转换失败",
        note: `${issue.code}: ${issue.message}`,
      })),
      ...(batch.diff?.conflicts ?? []).map((canonicalKey) => ({
        canonicalKey: canonicalKey.trim(),
        titlePrefix: "冲突待裁决",
        note: "该 canonical key 出现在导入冲突清单中",
      })),
    ]
      .map((item) => {
        const category = verificationCategoryFromKey(item.canonicalKey);
        if (!item.canonicalKey || !category || stagedCanonicalKeys.has(item.canonicalKey))
          return undefined;
        return {
          runId: run.id,
          category,
          canonicalKey: item.canonicalKey,
          title: `${item.titlePrefix} · ${item.canonicalKey}`,
          note: item.note,
        };
      })
      .filter((item, index, items) => {
        if (!item) return false;
        return (
          items.findIndex((candidate) => candidate?.canonicalKey === item.canonicalKey) === index
        );
      })
      .filter(
        (
          item,
        ): item is {
          runId: string;
          category: VerificationItem["category"];
          canonicalKey: string;
          title: string;
          note: string;
        } => Boolean(item),
      );
    if (extraItems.length)
      await this.db.insert(verificationItems).values(extraItems).onConflictDoNothing();
  }

  private async addVerificationReplacement(runId: string, category: string): Promise<void> {
    const [run] = await this.db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.id, runId))
      .limit(1);
    if (!run) return;
    const [batch] = await this.db
      .select({ stagedRecords: importBatches.stagedRecords })
      .from(importBatches)
      .where(eq(importBatches.id, run.batchId))
      .limit(1);
    if (!batch?.stagedRecords?.length) return;
    const existingItems = await this.db
      .select({ canonicalKey: verificationItems.canonicalKey })
      .from(verificationItems)
      .where(eq(verificationItems.runId, run.id));
    const existingKeys = new Set(existingItems.map((item) => item.canonicalKey));
    const candidate = nextVerificationReplacement(
      batch.stagedRecords,
      run.seed,
      category,
      existingKeys,
    );
    if (!candidate) return;
    await this.db
      .insert(verificationItems)
      .values({
        runId: run.id,
        category,
        canonicalKey: recordCanonicalKey(candidate),
        title: candidate.title ?? recordCanonicalKey(candidate),
      })
      .onConflictDoNothing();
  }

  async getImport(batchId: string): Promise<ImportBatch | null> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, batchId))
      .limit(1);
    return rows[0] ? this.mapImport(rows[0]) : null;
  }

  async listImports(gameId?: string): Promise<ImportBatch[]> {
    const rows = await this.db
      .select()
      .from(importBatches)
      .where(gameId ? eq(importBatches.gameId, gameId) : undefined)
      .orderBy(desc(importBatches.createdAt))
      .limit(100);
    return rows.map((row) => this.mapImport(row));
  }

  async reviewImport(
    batchId: string,
    approved: boolean,
    note: string | undefined,
    confirmedDeletionKeys: string[],
  ): Promise<ImportBatch> {
    const existing = await this.getImport(batchId);
    if (!existing)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    if (existing.status !== "review_required" && existing.status !== "staged")
      throw new DomainError(
        "invalid_import_state",
        `Import cannot be reviewed from state ${existing.status}`,
      );
    if (!approved) {
      const [row] = await this.db
        .update(importBatches)
        .set({
          status: "cancelled",
          reviewNote: note ?? "Rejected during review",
          confirmedDeletionKeys,
          completedAt: new Date(),
        })
        .where(eq(importBatches.id, batchId))
        .returning();
      if (!row)
        throw new DomainError("import_review_failed", "Import review failed", undefined, 500);
      return this.mapImport(row);
    }
    const deletionCandidates = new Set(existing.diff?.deletionCandidates ?? []);
    const invalidDeletionKeys = confirmedDeletionKeys.filter(
      (sourceKey) => !deletionCandidates.has(sourceKey),
    );
    if (invalidDeletionKeys.length)
      throw new DomainError(
        "invalid_deletion_confirmation",
        "Only deletion candidates from this import can be confirmed",
        invalidDeletionKeys,
      );
    if (existing.errors.length)
      throw new DomainError(
        "import_has_errors",
        "Import contains blocking validation errors",
        existing.errors,
      );
    const [row] = await this.db
      .update(importBatches)
      .set({ status: "review_required", reviewNote: note ?? "Reviewed", confirmedDeletionKeys })
      .where(eq(importBatches.id, batchId))
      .returning();
    if (!row) throw new DomainError("import_review_failed", "Import review failed", undefined, 500);
    return this.mapImport(row);
  }

  async createReleaseCandidate(input: {
    gameId: string;
    name: string;
    importBatchIds: string[];
  }): Promise<ReleaseCandidate> {
    const batchIds = [...new Set(input.importBatchIds)];
    if (!batchIds.length)
      throw new DomainError("candidate_batches_required", "At least one import batch is required");
    const batches = await this.db
      .select()
      .from(importBatches)
      .where(inArray(importBatches.id, batchIds));
    if (batches.length !== batchIds.length)
      throw new DomainError(
        "candidate_batch_not_found",
        "One or more import batches were not found",
        undefined,
        404,
      );
    if (batches.some((batch) => batch.gameId !== input.gameId))
      throw new DomainError(
        "candidate_game_mismatch",
        "Every import batch must belong to the candidate game",
      );
    const current = await this.getCurrentRevision(input.gameId);
    const [row] = await this.db
      .insert(releaseCandidates)
      .values({
        gameId: input.gameId,
        name: input.name.trim(),
        baseRevisionId: current?.id,
        importBatchIds: batchIds,
        status: "draft",
      })
      .returning();
    if (!row)
      throw new DomainError(
        "candidate_create_failed",
        "Release candidate could not be created",
        undefined,
        500,
      );
    return this.mapReleaseCandidate(row);
  }

  async listReleaseCandidates(gameId?: string): Promise<ReleaseCandidate[]> {
    const rows = await this.db
      .select()
      .from(releaseCandidates)
      .where(gameId ? eq(releaseCandidates.gameId, gameId) : undefined)
      .orderBy(desc(releaseCandidates.createdAt));
    return rows.map((row) => this.mapReleaseCandidate(row));
  }

  async getReleaseCandidate(candidateId: string): Promise<ReleaseCandidateDetail | null> {
    const rows = await this.db
      .select()
      .from(releaseCandidates)
      .where(eq(releaseCandidates.id, candidateId))
      .limit(1);
    const candidate = rows[0];
    if (!candidate) return null;
    const builds = await this.db
      .select()
      .from(releaseCandidateBuilds)
      .where(eq(releaseCandidateBuilds.candidateId, candidateId))
      .orderBy(desc(releaseCandidateBuilds.buildNumber));
    return {
      ...this.mapReleaseCandidate(candidate),
      builds: builds.map((build) => this.mapReleaseCandidateBuild(build)),
    };
  }

  private async createPreviewManifest(
    gameId: string,
    records: NormalizedRecord[],
    baseRevisionId?: string | null,
  ): Promise<string> {
    const entries = records.map((record) => ({
      canonicalKey: record.sourceKey,
      contentHash: createHash("sha256").update(canonicalRecordBytes(record)).digest("hex"),
      record,
    }));
    await this.db
      .insert(contentObjects)
      .values(
        entries.map((entry) => ({
          contentHash: entry.contentHash,
          recordType: entry.record.recordType,
          schemaVersion: "normalized-record-v1",
          payload: entry.record as unknown as Record<string, unknown>,
          byteLength: Buffer.byteLength(canonicalRecordBytes(entry.record)),
        })),
      )
      .onConflictDoNothing();
    const [manifest] = await this.db
      .insert(datasetManifests)
      .values({
        gameId,
        kind: "preview",
        baseRevisionId: baseRevisionId ?? null,
        rootHash: manifestRootHash(records),
        recordCount: records.length,
      })
      .returning({ id: datasetManifests.id });
    if (!manifest)
      throw new DomainError(
        "manifest_create_failed",
        "Preview manifest could not be created",
        undefined,
        500,
      );
    if (entries.length) {
      await this.db.insert(datasetManifestEntries).values(
        entries.map((entry) => ({
          manifestId: manifest.id,
          canonicalKey: entry.canonicalKey,
          contentHash: entry.contentHash,
        })),
      );
    }
    return manifest.id;
  }

  async listReviewIssues(candidateId: string): Promise<ReviewIssue[]> {
    const rows = await this.db
      .select()
      .from(reviewIssues)
      .where(eq(reviewIssues.candidateId, candidateId))
      .orderBy(desc(reviewIssues.createdAt));
    return rows as ReviewIssue[];
  }
  async reportReviewIssue(input: {
    candidateId: string;
    buildId: string;
    canonicalKey: string;
    fieldPath?: string;
    summary: string;
    details?: Record<string, unknown>;
  }): Promise<ReviewIssue> {
    const build = await this.getReleaseCandidateBuild(input.buildId);
    if (!build || build.candidateId !== input.candidateId)
      throw new DomainError(
        "candidate_build_mismatch",
        "Reported issue must belong to the candidate build",
        undefined,
        400,
      );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          "reported",
          input.canonicalKey,
          input.fieldPath ?? "",
          input.summary,
          input.details ?? {},
        ]),
      )
      .digest("hex");
    const [row] = await this.db
      .insert(reviewIssues)
      .values({
        gameId: build.gameId,
        candidateId: input.candidateId,
        detectedBuildId: input.buildId,
        canonicalKey: input.canonicalKey,
        fieldPath: input.fieldPath,
        kind: "reported",
        status: "open",
        blocking: true,
        fingerprint,
        summary: input.summary,
        details: input.details ?? {},
      })
      .onConflictDoNothing({ target: [reviewIssues.candidateId, reviewIssues.fingerprint] })
      .returning();
    if (row) return row as ReviewIssue;
    const [existing] = await this.db
      .select()
      .from(reviewIssues)
      .where(
        and(
          eq(reviewIssues.candidateId, input.candidateId),
          eq(reviewIssues.fingerprint, fingerprint),
        ),
      )
      .limit(1);
    if (!existing)
      throw new DomainError(
        "issue_create_failed",
        "Review issue could not be created",
        undefined,
        500,
      );
    return existing as ReviewIssue;
  }
  async getReviewIssue(id: string): Promise<ReviewIssue | null> {
    const [row] = await this.db.select().from(reviewIssues).where(eq(reviewIssues.id, id)).limit(1);
    return (row as ReviewIssue | undefined) ?? null;
  }
  async resolveReviewIssue(id: string, action?: string, note?: string): Promise<ReviewIssue> {
    const [row] = await this.db
      .update(reviewIssues)
      .set({
        status: "resolved",
        resolutionAction: action,
        resolutionNote: note,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewIssues.id, id))
      .returning();
    if (!row)
      throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
    return row as ReviewIssue;
  }
  async reopenReviewIssue(id: string): Promise<ReviewIssue> {
    const [row] = await this.db
      .update(reviewIssues)
      .set({ status: "reopened", resolvedAt: null, updatedAt: new Date() })
      .where(eq(reviewIssues.id, id))
      .returning();
    if (!row)
      throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
    return row as ReviewIssue;
  }
  async listCandidatePatches(candidateId: string): Promise<CandidatePatch[]> {
    return (await this.db
      .select()
      .from(candidatePatches)
      .where(eq(candidatePatches.candidateId, candidateId))
      .orderBy(desc(candidatePatches.createdAt))) as CandidatePatch[];
  }
  async createCandidatePatch(input: {
    candidateId: string;
    issueId?: string;
    canonicalKey: string;
    fieldPath?: string;
    action: string;
    manualValue?: unknown;
    expectedBaseHash?: string;
    expectedIncomingHash?: string;
  }): Promise<CandidatePatch> {
    if (input.expectedBaseHash && !/^[a-f0-9]{64}$/.test(input.expectedBaseHash))
      throw new DomainError("invalid_patch_hash", "expectedBaseHash must be sha256");
    if (input.expectedIncomingHash && !/^[a-f0-9]{64}$/.test(input.expectedIncomingHash))
      throw new DomainError("invalid_patch_hash", "expectedIncomingHash must be sha256");
    const [row] = await this.db
      .insert(candidatePatches)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(input as any)
      .returning();
    return row as CandidatePatch;
  }
  async listReviewEvidence(issueId: string): Promise<ReviewEvidence[]> {
    return (await this.db
      .select()
      .from(reviewEvidence)
      .where(eq(reviewEvidence.issueId, issueId))
      .orderBy(desc(reviewEvidence.createdAt))) as ReviewEvidence[];
  }
  async addReviewEvidence(
    input: Omit<ReviewEvidence, "id" | "createdAt">,
  ): Promise<ReviewEvidence> {
    const [row] = await this.db
      .insert(reviewEvidence)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(input as any)
      .returning();
    return row as ReviewEvidence;
  }
  async listReleaseCandidateChecks(candidateId: string): Promise<ReleaseCandidateCheck[]> {
    return (await this.db
      .select()
      .from(releaseCandidateChecks)
      .where(eq(releaseCandidateChecks.candidateId, candidateId))
      .orderBy(desc(releaseCandidateChecks.checkedAt))) as ReleaseCandidateCheck[];
  }

  async buildReleaseCandidate(candidateId: string): Promise<ReleaseCandidateBuild> {
    const candidate = await this.getReleaseCandidate(candidateId);
    if (!candidate)
      throw new DomainError(
        "candidate_not_found",
        "Release candidate was not found",
        undefined,
        404,
      );
    if (["promoted", "withdrawn"].includes(candidate.status))
      throw new DomainError(
        "invalid_candidate_state",
        `Release candidate cannot be built from state ${candidate.status}`,
      );
    const batches = await this.db
      .select()
      .from(importBatches)
      .where(inArray(importBatches.id, candidate.importBatchIds));
    if (batches.length !== candidate.importBatchIds.length)
      throw new DomainError("candidate_batch_not_found", "A candidate import batch is missing");
    for (const batch of batches) {
      if (batch.gameId !== candidate.gameId)
        throw new DomainError("candidate_game_mismatch", "Candidate batch game mismatch");
      if (!batch.stagedRecords)
        throw new DomainError("staged_data_missing", "Candidate batch has no staged records");
    }
    const baseRevision = candidate.baseRevisionId
      ? await this.getRevision(candidate.baseRevisionId, candidate.gameId)
      : undefined;
    if (candidate.baseRevisionId && !baseRevision)
      throw new DomainError("candidate_base_missing", "Candidate base revision was not found");
    const baseRecords = baseRevision ? await this.getRevisionRecords(baseRevision) : [];
    let normalizedRecords = mergeReleaseCandidateRecords(
      baseRecords,
      candidate.importBatchIds.map((batchId) => {
        const batch = batches.find((item) => item.id === batchId)!;
        return {
          records: batch.stagedRecords ?? [],
          confirmedDeletionKeys: batch.confirmedDeletionKeys,
        };
      }),
    );
    // Patches always produce a new immutable build.  Hash preconditions prevent
    // silently applying a decision to a changed base/incoming record.
    const priorPatches = await this.db
      .select()
      .from(candidatePatches)
      .where(eq(candidatePatches.candidateId, candidateId))
      .orderBy(asc(candidatePatches.createdAt));
    const baseByKeyForPatch = new Map(baseRecords.map((record) => [record.sourceKey, record]));
    const patched = new Map(normalizedRecords.map((record) => [record.sourceKey, record]));
    for (const patch of priorPatches) {
      const incoming = patched.get(patch.canonicalKey);
      // A recorded decision must always apply to the build it was created for.
      // Silently ignoring a missing key makes review decisions disappear and
      // can produce an apparently valid but materially different build.
      if (!incoming && !["confirm_delete", "exclude_record"].includes(patch.action))
        throw new DomainError(
          "patch_target_missing",
          `Patch target is missing from the candidate build: ${patch.canonicalKey}`,
          { patchId: patch.id, canonicalKey: patch.canonicalKey },
          409,
        );
      const base = baseByKeyForPatch.get(patch.canonicalKey);
      const baseHash = base
        ? createHash("sha256").update(canonicalRecordBytes(base)).digest("hex")
        : null;
      const incomingHash = createHash("sha256")
        .update(canonicalRecordBytes(incoming))
        .digest("hex");
      if (
        (patch.expectedBaseHash && patch.expectedBaseHash !== baseHash) ||
        (patch.expectedIncomingHash && patch.expectedIncomingHash !== incomingHash)
      )
        throw new DomainError(
          "patch_precondition_failed",
          `Patch precondition failed for ${patch.canonicalKey}`,
          { patchId: patch.id },
          409,
        );
      if (["confirm_delete", "exclude_record"].includes(patch.action))
        patched.delete(patch.canonicalKey);
      else if (patch.action === "keep_main" && base) patched.set(patch.canonicalKey, base);
      else if (patch.action === "manual")
        patched.set(patch.canonicalKey, setField(incoming, patch.fieldPath, patch.manualValue));
    }
    normalizedRecords = [...patched.values()];
    const contentChecksum = releaseCandidateChecksum(normalizedRecords);
    const manifestId = await this.createPreviewManifest(
      candidate.gameId,
      normalizedRecords,
      candidate.baseRevisionId,
    );
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from knowledge.release_candidates where id = ${candidateId}::uuid for update`,
      );
      const prior = await tx
        .select({ buildNumber: releaseCandidateBuilds.buildNumber })
        .from(releaseCandidateBuilds)
        .where(eq(releaseCandidateBuilds.candidateId, candidateId))
        .orderBy(desc(releaseCandidateBuilds.buildNumber))
        .limit(1);
      const [build] = await tx
        .insert(releaseCandidateBuilds)
        .values({
          candidateId,
          buildNumber: (prior[0]?.buildNumber ?? 0) + 1,
          status: "ready",
          contentChecksum,
          normalizedRecords,
          manifestId,
          baseRevisionId: candidate.baseRevisionId,
          importBatchId: candidate.importBatchIds.at(-1),
          buildKind: "import",
          indexStatus: "pending",
        })
        .returning();
      if (!build)
        throw new DomainError(
          "candidate_build_failed",
          "Release candidate build could not be created",
          undefined,
          500,
        );
      if (priorPatches.length)
        await tx
          .update(candidatePatches)
          .set({ appliedBuildId: build.id })
          .where(
            inArray(
              candidatePatches.id,
              priorPatches.map((patch) => patch.id),
            ),
          );
      const issueIds = priorPatches.flatMap((patch) => (patch.issueId ? [patch.issueId] : []));
      if (issueIds.length)
        await tx
          .update(reviewIssues)
          .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
          .where(inArray(reviewIssues.id, issueIds));
      const baseByKey = new Map(baseRecords.map((record) => [record.sourceKey, record]));
      const incomingByKey = new Map<string, NormalizedRecord[]>();
      for (const batch of batches)
        for (const record of batch.stagedRecords ?? [])
          incomingByKey.set(record.sourceKey, [
            ...(incomingByKey.get(record.sourceKey) ?? []),
            record,
          ]);
      const issueValues: Array<Record<string, unknown>> = [];
      const addIssue = (
        kind: string,
        key: string,
        summary: string,
        details: Record<string, unknown>,
        hashes: Record<string, unknown> = {},
      ) => {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([kind, key, details.fieldPath ?? "", hashes]))
          .digest("hex");
        issueValues.push({
          gameId: candidate.gameId,
          candidateId,
          detectedBuildId: build.id,
          canonicalKey: key,
          kind,
          status: "open",
          blocking: true,
          fingerprint,
          summary,
          details,
          ...hashes,
        });
      };
      for (const batch of batches) {
        for (const key of batch.diff?.deletionCandidates ?? [])
          if (!(batch.confirmedDeletionKeys ?? []).includes(key))
            addIssue("deletion", key, `Unconfirmed deletion: ${key}`, { batchId: batch.id });
        for (const error of batch.errors ?? [])
          addIssue(
            "import_error",
            String(error.code ?? "import"),
            error.message ?? "Import error",
            { batchId: batch.id, error },
          );
      }
      for (const [key, records] of incomingByKey) {
        const base = baseByKey.get(key);
        const hashes = {
          baseContentHash: base
            ? createHash("sha256").update(canonicalRecordBytes(base)).digest("hex")
            : null,
          incomingContentHash: createHash("sha256")
            .update(canonicalRecordBytes(records.at(-1)!))
            .digest("hex"),
        };
        // A normal version/content change is a Diff, not an overwrite Issue.
        // Overwrite is reserved for an explicit competing write in the same
        // import aggregation; comparing against the published base alone
        // would turn every routine refresh into a blocking issue.
        if (records.length > 1 && new Set(records.map(canonicalRecordBytes)).size > 1)
          addIssue(
            "field_conflict",
            key,
            `Conflicting incoming values for ${key}`,
            { fieldPath: "record" },
            hashes,
          );
        const metadata = asRecord(records.at(-1)!.metadata);
        const baseMetadata = asRecord(base?.metadata);
        if (
          base &&
          metadata.version !== undefined &&
          baseMetadata.version !== undefined &&
          metadata.version !== baseMetadata.version
        )
          addIssue("version_mismatch", key, `Version mismatch for ${key}`, {
            base: baseMetadata.version,
            incoming: metadata.version,
          });
        if (
          base &&
          metadata.locale !== undefined &&
          baseMetadata.locale !== undefined &&
          metadata.locale !== baseMetadata.locale
        )
          addIssue("locale_mismatch", key, `Locale mismatch for ${key}`, {
            base: baseMetadata.locale,
            incoming: metadata.locale,
          });
      }
      const canonical = new Map<string, string[]>();
      for (const record of normalizedRecords) {
        const key = recordCanonicalKey(record);
        canonical.set(key, [...(canonical.get(key) ?? []), record.sourceKey]);
      }
      for (const [key, sourceKeys] of canonical)
        if (sourceKeys.length > 1)
          addIssue("suspected_duplicate", key, `Multiple records share canonical key ${key}`, {
            sourceKeys,
          });
      if (issueValues.length)
        await tx
          .insert(reviewIssues)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(issueValues as any)
          .onConflictDoNothing({ target: [reviewIssues.candidateId, reviewIssues.fingerprint] });
      await tx
        .update(releaseCandidates)
        .set({ currentBuildId: build.id, status: "preview_ready", updatedAt: new Date() })
        .where(eq(releaseCandidates.id, candidateId));
      return this.mapReleaseCandidateBuild(build);
    });
  }

  async getReleaseCandidateBuild(buildId: string) {
    const rows = await this.db
      .select({ build: releaseCandidateBuilds, gameId: releaseCandidates.gameId })
      .from(releaseCandidateBuilds)
      .innerJoin(releaseCandidates, eq(releaseCandidates.id, releaseCandidateBuilds.candidateId))
      .where(eq(releaseCandidateBuilds.id, buildId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...this.mapReleaseCandidateBuild(row.build),
      gameId: row.gameId,
      normalizedRecords: row.build.normalizedRecords,
    };
  }

  async getReleaseCandidateReadiness(candidateId: string): Promise<ReleaseCandidateReadiness> {
    const candidate = await this.getReleaseCandidate(candidateId);
    if (!candidate)
      throw new DomainError(
        "candidate_not_found",
        "Release candidate was not found",
        undefined,
        404,
      );
    const blockingReasons: ReleaseCandidateReadiness["blockingReasons"] = [];
    const build = candidate.currentBuildId
      ? await this.getReleaseCandidateBuild(candidate.currentBuildId)
      : null;
    if (!build)
      blockingReasons.push({
        code: "candidate_build_missing",
        message: "Build the candidate first",
      });
    else if (build.contentChecksum !== releaseCandidateChecksum(build.normalizedRecords))
      blockingReasons.push({
        code: "candidate_checksum_invalid",
        message: "The preview build checksum is invalid",
      });
    if (build?.manifestId) {
      const [manifest] = await this.db
        .select()
        .from(datasetManifests)
        .where(eq(datasetManifests.id, build.manifestId))
        .limit(1);
      if (
        !manifest ||
        manifest.rootHash !== manifestRootHash(build.normalizedRecords) ||
        manifest.recordCount !== build.normalizedRecords.length
      )
        blockingReasons.push({
          code: "manifest_invalid",
          message: "Preview manifest does not match build contents",
        });
    } else if (build)
      blockingReasons.push({ code: "manifest_missing", message: "Preview manifest is missing" });
    const current = await this.getCurrentRevision(candidate.gameId);
    if ((current?.id ?? null) !== (candidate.baseRevisionId ?? null))
      blockingReasons.push({
        code: "candidate_base_stale",
        message: "The formal revision changed after this candidate was created",
        details: { expected: candidate.baseRevisionId ?? null, actual: current?.id ?? null },
      });
    const batches = candidate.importBatchIds.length
      ? await this.db
          .select()
          .from(importBatches)
          .where(inArray(importBatches.id, candidate.importBatchIds))
      : [];
    for (const batch of batches) {
      if (batch.errors.length)
        blockingReasons.push({
          code: "candidate_batch_has_errors",
          message: `Import batch ${batch.id} has errors`,
        });
      if (!batch.sourceSnapshotId)
        blockingReasons.push({
          code: "source_snapshot_missing",
          message: `Import batch ${batch.id} has no source snapshot`,
        });
      const deletions = batch.diff?.deletionCandidates ?? [];
      if (deletions.some((key) => !batch.confirmedDeletionKeys.includes(key)))
        blockingReasons.push({
          code: "deletions_unconfirmed",
          message: `Import batch ${batch.id} has unconfirmed deletions`,
        });
    }
    // Candidate readiness is driven by the canonical issue/check queues.  A
    // historical import status or verification sample is not a gate for new
    // candidates.
    const issues = await this.db
      .select({ id: reviewIssues.id, summary: reviewIssues.summary })
      .from(reviewIssues)
      .where(
        and(
          eq(reviewIssues.candidateId, candidateId),
          eq(reviewIssues.blocking, true),
          inArray(reviewIssues.status, ["open", "reopened"]),
        ),
      );
    for (const issue of issues)
      blockingReasons.push({
        code: "review_issue_open",
        message: issue.summary,
        details: { issueId: issue.id },
      });
    const checks = await this.db
      .select()
      .from(releaseCandidateChecks)
      .where(eq(releaseCandidateChecks.candidateId, candidateId));
    for (const check of checks.filter((item) => item.status !== "passed"))
      blockingReasons.push({
        code: "candidate_check_failed",
        message: check.message ?? `Candidate check ${check.checkType} is not complete`,
        details: { checkType: check.checkType, status: check.status },
      });
    const conflicts = await this.db
      .select({ id: conflictCases.id })
      .from(conflictCases)
      .where(and(eq(conflictCases.gameId, candidate.gameId), eq(conflictCases.status, "open")))
      .limit(1);
    if (conflicts.length)
      blockingReasons.push({
        code: "open_conflicts",
        message: "Open source conflicts must be resolved",
      });
    return {
      candidateId,
      buildId: build?.id,
      contentChecksum: build?.contentChecksum,
      ready: blockingReasons.length === 0,
      blockingReasons,
    };
  }

  async promoteReleaseCandidate(input: {
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
    releaseNote?: string;
    idempotencyKey: string;
  }): Promise<DatasetRevision> {
    const candidate = await this.getReleaseCandidate(input.candidateId);
    if (!candidate)
      throw new DomainError(
        "candidate_not_found",
        "Release candidate was not found",
        undefined,
        404,
      );
    if (candidate.status === "promoted" && candidate.promotedRevisionId) {
      const revision = await this.getRevision(candidate.promotedRevisionId, candidate.gameId);
      if (revision) return this.mapDatasetRevision(revision);
    }
    const build = await this.getReleaseCandidateBuild(input.buildId);
    if (!build || build.candidateId !== candidate.id || candidate.currentBuildId !== build.id)
      throw new DomainError("candidate_build_mismatch", "Promote the current build only");
    if (build.contentChecksum !== input.contentChecksum)
      throw new DomainError("candidate_checksum_mismatch", "Preview build checksum does not match");
    const current = await this.getCurrentRevision(candidate.gameId);
    if (
      input.expectedCurrentRevisionId !== undefined &&
      (current?.id ?? null) !== input.expectedCurrentRevisionId
    )
      throw new DomainError(
        "current_revision_changed",
        "The formal revision changed before promotion",
        undefined,
        409,
      );
    const readiness = await this.getReleaseCandidateReadiness(candidate.id);
    if (!readiness.ready)
      throw new DomainError(
        "candidate_not_ready",
        "Release candidate is not ready to promote",
        readiness.blockingReasons,
      );
    const existingKey = await this.db
      .select({ id: releaseCandidates.id })
      .from(releaseCandidates)
      .where(eq(releaseCandidates.promotionIdempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existingKey[0] && existingKey[0].id !== candidate.id)
      throw new DomainError(
        "idempotency_key_conflict",
        "Promotion idempotency key was already used",
        undefined,
        409,
      );
    await this.db
      .update(releaseCandidates)
      .set({
        promotionIdempotencyKey: input.idempotencyKey,
        status: "ready_to_promote",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(releaseCandidates.id, candidate.id),
          inArray(releaseCandidates.status, ["preview_ready", "ready_to_promote"]),
        ),
      );
    const revision = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from platform.games where id = ${candidate.gameId}::uuid for update`,
      );
      const latest = await tx
        .select()
        .from(datasetRevisions)
        .where(eq(datasetRevisions.gameId, candidate.gameId))
        .orderBy(desc(datasetRevisions.revisionNumber))
        .limit(1);
      const [preparing] = await tx
        .insert(datasetRevisions)
        .values({
          gameId: candidate.gameId,
          revisionNumber: (latest[0]?.revisionNumber ?? 0) + 1,
          sourceBatchId: candidate.importBatchIds[0]!,
          releaseNote: input.releaseNote,
          lifecycleStatus: "preparing",
          isCurrent: false,
          indexStatus: "pending",
          normalizedRecords: build.normalizedRecords,
          manifestId: build.manifestId,
          activationBuildId: build.id,
          activationCandidateId: candidate.id,
          provenance: {
            candidateId: candidate.id,
            buildId: build.id,
            batchIds: candidate.importBatchIds,
          },
        })
        .returning();
      if (!preparing)
        throw new DomainError(
          "revision_create_failed",
          "Preparing revision could not be created",
          undefined,
          500,
        );
      await tx.insert(auditLog).values({
        action: "revision_preparing",
        targetType: "dataset_revision",
        targetId: preparing.id,
        reason: input.releaseNote ?? "Candidate promotion",
        metadata: { candidateId: candidate.id, buildId: build.id },
      });
      await tx.insert(jobs).values({
        type: "activate_revision",
        idempotencyKey: `activate_revision:${preparing.id}`,
        payload: {
          revisionId: preparing.id,
          candidateId: candidate.id,
          buildId: build.id,
          contentChecksum: build.contentChecksum,
          expectedCurrentRevisionId: input.expectedCurrentRevisionId ?? null,
        },
      });
      return preparing;
    });
    return this.mapDatasetRevision(revision);
  }

  async finalizeActivation(input: {
    revisionId: string;
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
  }): Promise<DatasetRevision> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from platform.games where id = (select game_id from knowledge.dataset_revisions where id = ${input.revisionId}::uuid) for update`,
      );
      const [revision] = await tx
        .select()
        .from(datasetRevisions)
        .where(eq(datasetRevisions.id, input.revisionId))
        .limit(1);
      const [candidate] = await tx
        .select()
        .from(releaseCandidates)
        .where(eq(releaseCandidates.id, input.candidateId))
        .limit(1);
      const [build] = await tx
        .select()
        .from(releaseCandidateBuilds)
        .where(eq(releaseCandidateBuilds.id, input.buildId))
        .limit(1);
      if (
        !revision ||
        !candidate ||
        !build ||
        revision.lifecycleStatus !== "preparing" ||
        build.contentChecksum !== input.contentChecksum ||
        build.manifestId !== revision.manifestId ||
        build.indexStatus !== "ready"
      )
        throw new DomainError(
          "activation_not_ready",
          "Preparing revision failed activation checks",
          undefined,
          409,
        );
      const [current] = await tx
        .select()
        .from(datasetRevisions)
        .where(
          and(eq(datasetRevisions.gameId, revision.gameId), eq(datasetRevisions.isCurrent, true)),
        )
        .limit(1);
      if (
        input.expectedCurrentRevisionId !== undefined &&
        (current?.id ?? null) !== input.expectedCurrentRevisionId
      )
        throw new DomainError(
          "current_revision_changed",
          "The formal revision changed before activation",
          undefined,
          409,
        );
      if (current)
        await tx
          .update(datasetRevisions)
          .set({ isCurrent: false })
          .where(eq(datasetRevisions.id, current.id));
      const [active] = await tx
        .update(datasetRevisions)
        .set({ lifecycleStatus: "published", isCurrent: true, activatedAt: new Date() })
        .where(eq(datasetRevisions.id, revision.id))
        .returning();
      await tx
        .update(releaseCandidates)
        .set({ status: "promoted", promotedRevisionId: revision.id, updatedAt: new Date() })
        .where(eq(releaseCandidates.id, candidate.id));
      await tx.insert(auditLog).values({
        action: "revision_activated",
        targetType: "dataset_revision",
        targetId: revision.id,
        reason: "Candidate Build activation",
        metadata: { candidateId: candidate.id, buildId: build.id },
      });
      return this.mapDatasetRevision(active!);
    });
  }

  async setRevisionIndexStatus(
    revisionId: string,
    status: "ready" | "failed",
    error?: string,
  ): Promise<void> {
    await this.db
      .update(datasetRevisions)
      .set({ indexStatus: status, activationError: error ? { error } : null })
      .where(eq(datasetRevisions.id, revisionId));
  }

  async publishImport(
    batchId: string,
    releaseNote?: string,
    options: {
      skipManualVerification?: boolean;
      recordsOverride?: NormalizedRecord[];
    } = {},
  ): Promise<DatasetRevision> {
    const existing = await this.getImport(batchId);
    if (!existing)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    assertPublishable(existing);
    if (!existing.stagedRecords)
      throw new DomainError("staged_data_missing", "Staged records are missing");
    if (!existing.sourceSnapshotId)
      throw new DomainError("source_snapshot_missing", "Source snapshot is missing");
    if (!options.skipManualVerification) await this.ensureAcquisitionReview(batchId);
    await this.ensureAnimeAcquisitionIntegrity(existing);
    await this.ensureReleaseBackup(existing);
    const sourceSnapshotId = existing.sourceSnapshotId;
    const stagedRecords = options.recordsOverride ?? existing.stagedRecords;
    const diff = existing.diff;
    if (
      diff &&
      diff.added.length === 0 &&
      diff.modified.length === 0 &&
      diff.deletionCandidates.length === 0
    ) {
      const current = await this.getCurrentRevision(existing.gameId);
      if (current) {
        await this.db
          .update(importBatches)
          .set({ status: "published", completedAt: new Date() })
          .where(eq(importBatches.id, batchId));
        await this.db.insert(auditLog).values({
          action: "publish_noop",
          targetType: "import_batch",
          targetId: batchId,
          reason: releaseNote ?? "No data changes",
          metadata: { gameId: existing.gameId, revisionId: current.id },
        });
        return {
          id: current.id,
          gameId: current.gameId,
          revisionNumber: current.revisionNumber,
          sourceBatchId: current.sourceBatchId,
          releaseNote: current.releaseNote,
          lifecycleStatus: current.lifecycleStatus as DatasetRevision["lifecycleStatus"],
          publishedAt: current.publishedAt,
          isCurrent: current.isCurrent,
          indexStatus: current.indexStatus as DatasetRevision["indexStatus"],
        };
      }
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from platform.games where id = ${existing.gameId}::uuid for update`,
      );
      const currentRows = await tx
        .select()
        .from(datasetRevisions)
        .where(eq(datasetRevisions.gameId, existing.gameId))
        .orderBy(desc(datasetRevisions.revisionNumber))
        .limit(1);
      const activeRows = await tx
        .select()
        .from(datasetRevisions)
        .where(
          and(
            eq(datasetRevisions.gameId, existing.gameId),
            eq(datasetRevisions.isCurrent, true),
            eq(datasetRevisions.lifecycleStatus, "published"),
          ),
        )
        .limit(1);
      const previousRevision = activeRows[0];
      const stagedKeys = new Set(stagedRecords.map((record) => record.sourceKey));
      const confirmedDeletionKeys = new Set(existing.confirmedDeletionKeys);
      let previousRecords: NormalizedRecord[] = [];
      if (previousRevision) {
        if (previousRevision.normalizedRecords) {
          previousRecords = previousRevision.normalizedRecords;
        } else {
          const previousBatchRows = await tx
            .select({ stagedRecords: importBatches.stagedRecords })
            .from(importBatches)
            .where(eq(importBatches.id, previousRevision.sourceBatchId))
            .limit(1);
          previousRecords = previousBatchRows[0]?.stagedRecords ?? [];
        }
      }
      const normalizedRecords = [
        ...previousRecords.filter(
          (record) =>
            !stagedKeys.has(record.sourceKey) && !confirmedDeletionKeys.has(record.sourceKey),
        ),
        ...stagedRecords,
      ];
      const nextNumber = (currentRows[0]?.revisionNumber ?? 0) + 1;
      await tx
        .update(datasetRevisions)
        .set({ isCurrent: false })
        .where(eq(datasetRevisions.gameId, existing.gameId));
      const [revision] = await tx
        .insert(datasetRevisions)
        .values({
          gameId: existing.gameId,
          revisionNumber: nextNumber,
          sourceBatchId: batchId,
          releaseNote,
          lifecycleStatus: "published",
          isCurrent: true,
          indexStatus: "pending",
          normalizedRecords,
        })
        .returning();
      if (!revision)
        throw new DomainError(
          "revision_create_failed",
          "Dataset revision could not be created",
          undefined,
          500,
        );
      const source = await tx
        .select()
        .from(sources)
        .where(eq(sources.id, existing.sourceId))
        .limit(1);
      const sourceRow = source[0];
      const entityIdBySourceKey = new Map<string, string>();
      const allCandidates = normalizedRecords.flatMap((record) => record.entities ?? []);
      const stagedCandidates = stagedRecords.flatMap((record) => record.entities ?? []);
      for (const candidate of allCandidates) {
        const id = stableEntityId(existing.gameId, candidate.sourceKey);
        entityIdBySourceKey.set(candidate.sourceKey, id);
      }
      for (const candidate of stagedCandidates) {
        const id = entityIdBySourceKey.get(candidate.sourceKey);
        if (!id) continue;
        await tx
          .insert(entities)
          .values({
            id,
            gameId: existing.gameId,
            sourceKey: candidate.sourceKey,
            type: candidate.type,
            canonicalName: candidate.name,
            normalizedName: normalize(candidate.name),
            summary: candidate.summary,
            properties: candidate.properties ?? {},
            firstRevisionId: revision.id,
            lastRevisionId: revision.id,
            deleted: false,
          })
          .onConflictDoUpdate({
            target: [entities.gameId, entities.sourceKey],
            set: {
              type: candidate.type,
              canonicalName: candidate.name,
              normalizedName: normalize(candidate.name),
              summary: candidate.summary,
              properties: candidate.properties ?? {},
              lastRevisionId: revision.id,
              deleted: false,
              updatedAt: new Date(),
            },
          });
        if (candidate.aliases?.length && sourceRow) {
          await tx.delete(entityAliases).where(eq(entityAliases.entityId, id));
          await tx.insert(entityAliases).values(
            candidate.aliases.map((alias) => ({
              entityId: id,
              value: alias.value,
              normalizedValue: normalize(alias.value),
              language: alias.language ?? "und",
              sourceId: sourceRow.id,
              isPrimary: alias.primary ?? false,
            })),
          );
        }
      }
      const documentBySourceKey = new Map<
        string,
        { id: string; segments: Array<{ id: string; body: string }> }
      >();
      const previousDocumentSourceById = new Map<string, string>();
      const previousSegmentOrdinalById = new Map<string, number>();
      const stagedRelationKeys = new Set(
        stagedRecords.flatMap((record) =>
          (record.relationships ?? []).flatMap((relation) => {
            const subjectId = entityIdBySourceKey.get(relation.subjectSourceKey);
            const objectId = entityIdBySourceKey.get(relation.objectSourceKey);
            return subjectId && objectId ? [`${subjectId}|${relation.predicate}|${objectId}`] : [];
          }),
        ),
      );
      if (previousRevision) {
        const previousRelations = await tx
          .select()
          .from(relationships)
          .where(
            and(
              eq(relationships.gameId, existing.gameId),
              eq(relationships.revisionId, previousRevision.id),
            ),
          );
        for (const previousRelation of previousRelations) {
          const relationKey = `${previousRelation.subjectId}|${previousRelation.predicate}|${previousRelation.objectId}`;
          if (
            (previousRelation.sourceKey &&
              (stagedKeys.has(previousRelation.sourceKey) ||
                confirmedDeletionKeys.has(previousRelation.sourceKey))) ||
            (!previousRelation.sourceKey && stagedRelationKeys.has(relationKey))
          )
            continue;
          await tx.insert(relationships).values({
            gameId: previousRelation.gameId,
            subjectId: previousRelation.subjectId,
            predicate: previousRelation.predicate,
            objectId: previousRelation.objectId,
            sourceKey: previousRelation.sourceKey,
            sourceId: previousRelation.sourceId,
            revisionId: revision.id,
            status: previousRelation.status,
            validFrom: previousRelation.validFrom,
            validTo: previousRelation.validTo,
            confidence: previousRelation.confidence,
          });
        }
        const previousDocuments = await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.gameId, existing.gameId),
              eq(documents.revisionId, previousRevision.id),
              eq(documents.deleted, false),
            ),
          );
        for (const previousDocument of previousDocuments) {
          previousDocumentSourceById.set(previousDocument.id, previousDocument.sourceKey);
          const previousSegments = await tx
            .select()
            .from(documentSegments)
            .where(eq(documentSegments.documentId, previousDocument.id))
            .orderBy(asc(documentSegments.ordinal));
          for (const previousSegment of previousSegments)
            previousSegmentOrdinalById.set(previousSegment.id, previousSegment.ordinal);
          if (
            stagedKeys.has(previousDocument.sourceKey) ||
            confirmedDeletionKeys.has(previousDocument.sourceKey)
          )
            continue;
          const documentId = stableUuid(
            `${existing.gameId}:document:${previousDocument.sourceKey}:${revision.id}`,
          );
          await tx.insert(documents).values({
            id: documentId,
            gameId: existing.gameId,
            sourceKey: previousDocument.sourceKey,
            type: previousDocument.type,
            title: previousDocument.title,
            normalizedTitle: previousDocument.normalizedTitle,
            gameVersion: previousDocument.gameVersion,
            sourceSnapshotId: previousDocument.sourceSnapshotId,
            body: previousDocument.body,
            metadata: previousDocument.metadata,
            revisionId: revision.id,
            deleted: false,
          });
          const segmentRefs: Array<{ id: string; body: string }> = [];
          for (const previousSegment of previousSegments) {
            const segmentId = stableUuid(
              `${documentId}:segment:${previousSegment.ordinal}:${previousSegment.contentHash}`,
            );
            await tx.insert(documentSegments).values({
              id: segmentId,
              documentId,
              revisionId: revision.id,
              ordinal: previousSegment.ordinal,
              headingPath: previousSegment.headingPath,
              body: previousSegment.body,
              startOffset: previousSegment.startOffset,
              endOffset: previousSegment.endOffset,
              tokenEstimate: previousSegment.tokenEstimate,
              contentHash: previousSegment.contentHash,
              searchText: previousSegment.searchText,
            });
            segmentRefs.push({ id: segmentId, body: previousSegment.body });
            const previousMentions = await tx
              .select()
              .from(entityMentions)
              .where(eq(entityMentions.segmentId, previousSegment.id));
            if (previousMentions.length)
              await tx.insert(entityMentions).values(
                previousMentions.map((mention) => ({
                  entityId: mention.entityId,
                  segmentId,
                  rawText: mention.rawText,
                  startOffset: mention.startOffset,
                  endOffset: mention.endOffset,
                  matchMethod: mention.matchMethod,
                  confidence: mention.confidence,
                })),
              );
          }
          documentBySourceKey.set(previousDocument.sourceKey, {
            id: documentId,
            segments: segmentRefs,
          });
        }
      }
      for (const record of stagedRecords) {
        if (record.recordType === "entity" || record.entityType) continue;
        if (!record.title && !record.body) continue;
        const body = record.body ?? record.title ?? "";
        const documentId = stableUuid(
          `${existing.gameId}:document:${record.sourceKey}:${revision.id}`,
        );
        await tx.insert(documents).values({
          id: documentId,
          gameId: existing.gameId,
          sourceKey: record.sourceKey,
          type: record.documentType ?? "lore",
          title: record.title ?? record.sourceKey,
          normalizedTitle: normalize(record.title ?? record.sourceKey),
          gameVersion: record.gameVersion,
          sourceSnapshotId,
          body,
          metadata: record.metadata,
          revisionId: revision.id,
          deleted: false,
        });
        const segments = splitIntoSegments(body);
        const segmentRefs: Array<{ id: string; body: string }> = [];
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          if (!segment) continue;
          const segmentId = stableUuid(`${documentId}:segment:${index}:${record.contentHash}`);
          await tx.insert(documentSegments).values({
            id: segmentId,
            documentId,
            revisionId: revision.id,
            ordinal: index,
            headingPath: segment.headingPath,
            body: segment.body,
            startOffset: segment.start,
            endOffset: segment.end,
            tokenEstimate: Math.ceil(segment.body.length / 4),
            contentHash: createHash("sha256").update(segment.body).digest("hex"),
            searchText: segment.body,
          });
          segmentRefs.push({ id: segmentId, body: segment.body });
          for (const [sourceKey, entityId] of entityIdBySourceKey) {
            const candidate = allCandidates.find((item) => item.sourceKey === sourceKey);
            if (!candidate) continue;
            const names = [candidate.name, ...(candidate.aliases ?? []).map((item) => item.value)];
            for (const name of names) {
              const position = segment.body.indexOf(name);
              if (position >= 0) {
                await tx.insert(entityMentions).values({
                  entityId,
                  segmentId,
                  rawText: name,
                  startOffset: position,
                  endOffset: position + name.length,
                  matchMethod: name === candidate.name ? "canonical_name" : "alias",
                  confidence: 1,
                });
                break;
              }
            }
          }
        }
        documentBySourceKey.set(record.sourceKey, { id: documentId, segments: segmentRefs });
      }
      const stagedClaimKeys = new Set(
        stagedRecords.flatMap((record) => (record.claims ?? []).map((claim) => claim.sourceKey)),
      );
      if (previousRevision) {
        const previousClaims = await tx
          .select()
          .from(claims)
          .where(
            and(eq(claims.gameId, existing.gameId), eq(claims.revisionId, previousRevision.id)),
          );
        for (const previousClaim of previousClaims) {
          const preserve = previousClaim.recordSourceKey
            ? !stagedKeys.has(previousClaim.recordSourceKey) &&
              !confirmedDeletionKeys.has(previousClaim.recordSourceKey)
            : !stagedClaimKeys.has(previousClaim.sourceKey ?? "");
          if (!preserve) continue;

          const claimId = stableUuid(
            `${existing.gameId}:claim:${previousClaim.sourceKey ?? previousClaim.id}:${revision.id}`,
          );
          await tx.insert(claims).values({
            id: claimId,
            gameId: previousClaim.gameId,
            sourceKey: previousClaim.sourceKey,
            recordSourceKey: previousClaim.recordSourceKey,
            normalizedStatement: previousClaim.normalizedStatement,
            status: previousClaim.status,
            confidence: previousClaim.confidence,
            createdBy: previousClaim.createdBy,
            revisionId: revision.id,
          });

          const previousClaimEntities = await tx
            .select()
            .from(claimEntities)
            .where(eq(claimEntities.claimId, previousClaim.id));
          if (previousClaimEntities.length)
            await tx
              .insert(claimEntities)
              .values(
                previousClaimEntities.map((item) => ({
                  claimId,
                  entityId: item.entityId,
                })),
              )
              .onConflictDoNothing();

          const previousEvidence = await tx
            .select()
            .from(evidence)
            .where(eq(evidence.claimId, previousClaim.id));
          for (const previousItem of previousEvidence) {
            const documentSourceKey = previousDocumentSourceById.get(previousItem.documentId);
            const targetDocument = documentSourceKey
              ? documentBySourceKey.get(documentSourceKey)
              : undefined;
            const ordinal = previousSegmentOrdinalById.get(previousItem.segmentId);
            const targetSegment = targetDocument?.segments[ordinal ?? 0];
            if (!targetDocument || !targetSegment) continue;
            await tx.insert(evidence).values({
              claimId,
              documentId: targetDocument.id,
              segmentId: targetSegment.id,
              quoteStart: previousItem.quoteStart,
              quoteEnd: previousItem.quoteEnd,
              quote: previousItem.quote,
              strength: previousItem.strength,
              note: previousItem.note,
              valid: previousItem.valid,
            });
          }
        }
      }
      for (const record of stagedRecords) {
        for (const relation of record.relationships ?? []) {
          const subjectId = entityIdBySourceKey.get(relation.subjectSourceKey);
          const objectId = entityIdBySourceKey.get(relation.objectSourceKey);
          if (!subjectId || !objectId)
            throw new DomainError(
              "invalid_entity_reference",
              `Relationship references an unknown entity in ${record.sourceKey}`,
            );
          await tx.insert(relationships).values({
            gameId: existing.gameId,
            subjectId,
            predicate: relation.predicate,
            objectId,
            sourceKey: record.sourceKey,
            sourceId: sourceRow?.id,
            revisionId: revision.id,
            status: "active",
            validFrom: relation.validFrom,
            validTo: relation.validTo,
            confidence: relation.confidence,
          });
        }
        for (const claim of record.claims ?? []) {
          if (
            (claim.status === "confirmed" || claim.status === "implied") &&
            !claim.evidence?.length
          )
            throw new DomainError(
              "claim_evidence_required",
              `Claim has no evidence: ${claim.statement}`,
            );
          const [claimRow] = await tx
            .insert(claims)
            .values({
              gameId: existing.gameId,
              sourceKey: claim.sourceKey,
              recordSourceKey: record.sourceKey,
              normalizedStatement: claim.statement,
              status: claim.status,
              confidence: claim.confidence,
              createdBy: claim.createdBy ?? "import",
              revisionId: revision.id,
            })
            .returning();
          if (!claimRow) continue;
          for (const sourceKey of claim.entitySourceKeys ?? []) {
            const entityId = entityIdBySourceKey.get(sourceKey);
            if (entityId)
              await tx
                .insert(claimEntities)
                .values({ claimId: claimRow.id, entityId })
                .onConflictDoNothing();
          }
          for (const claimEvidence of claim.evidence ?? []) {
            const target =
              documentBySourceKey.get(claimEvidence.documentSourceKey) ??
              documentBySourceKey.get(record.sourceKey);
            if (!target || !target.segments[0])
              throw new DomainError(
                "evidence_document_missing",
                `Evidence document is missing: ${claimEvidence.documentSourceKey}`,
              );
            const located = claimEvidence.quote
              ? target.segments
                  .map((segment) => ({
                    segment,
                    start: segment.body.indexOf(claimEvidence.quote!),
                  }))
                  .find((candidate) => candidate.start >= 0)
              : { segment: target.segments[0], start: 0 };
            if (!located)
              throw new DomainError(
                "evidence_quote_missing",
                `Evidence quote was not found in document: ${claimEvidence.documentSourceKey}`,
              );
            const segment = located.segment;
            const quote = claimEvidence.quote ?? segment.body.slice(0, 500);
            const start = located.start;
            await tx.insert(evidence).values({
              claimId: claimRow.id,
              documentId: target.id,
              segmentId: segment.id,
              quoteStart: start,
              quoteEnd: start + quote.length,
              quote,
              strength: claimEvidence.strength,
              note: claimEvidence.note,
              valid: true,
            });
          }
        }
      }
      if (existing.confirmedDeletionKeys.length) {
        await tx
          .update(entities)
          .set({ deleted: true, lastRevisionId: revision.id, updatedAt: new Date() })
          .where(
            and(
              eq(entities.gameId, existing.gameId),
              inArray(entities.sourceKey, existing.confirmedDeletionKeys),
            ),
          );
      }
      await tx
        .update(importBatches)
        .set({ status: "published", completedAt: new Date() })
        .where(eq(importBatches.id, batchId));
      await tx
        .insert(jobs)
        .values({
          type: "rebuild_search",
          idempotencyKey: `rebuild_search:${revision.id}`,
          payload: { gameId: existing.gameId, revisionId: revision.id },
        })
        .onConflictDoNothing();
      await tx
        .insert(jobs)
        .values({
          type: "generate_embeddings",
          idempotencyKey: `generate_embeddings:${revision.id}`,
          payload: { gameId: existing.gameId, revisionId: revision.id },
        })
        .onConflictDoNothing();
      await tx.insert(auditLog).values({
        action: "publish_revision",
        targetType: "dataset_revision",
        targetId: revision.id,
        reason: releaseNote,
        metadata: { gameId: existing.gameId, sourceBatchId: batchId },
      });
      return {
        id: revision.id,
        gameId: revision.gameId,
        revisionNumber: revision.revisionNumber,
        sourceBatchId: revision.sourceBatchId,
        releaseNote: revision.releaseNote,
        lifecycleStatus: revision.lifecycleStatus as DatasetRevision["lifecycleStatus"],
        publishedAt: revision.publishedAt,
        isCurrent: revision.isCurrent,
        indexStatus: revision.indexStatus as DatasetRevision["indexStatus"],
      };
    });
  }

  async getPublishReadiness(batchId: string): Promise<PublishReadiness> {
    const batch = await this.getImport(batchId);
    if (!batch)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    const blockingReasons: PublishReadiness["blockingReasons"] = [];
    const checks: Array<() => Promise<void> | void> = [
      () => assertPublishable(batch),
      () => {
        if (!batch.stagedRecords)
          throw new DomainError("staged_data_missing", "Staged records are missing");
      },
      () => {
        if (!batch.sourceSnapshotId)
          throw new DomainError("source_snapshot_missing", "Source snapshot is missing");
      },
      () => this.ensureAcquisitionReview(batchId),
      () => this.ensureAnimeAcquisitionIntegrity(batch),
      () => this.ensureReleaseBackup(batch),
    ];
    for (const check of checks) {
      try {
        await check();
      } catch (error) {
        if (error instanceof DomainError)
          blockingReasons.push({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        else
          blockingReasons.push({
            code: "publish_gate_error",
            message: "A publish gate could not be evaluated",
          });
      }
    }
    return { ready: blockingReasons.length === 0, blockingReasons };
  }

  private async readAcquisitionManifest(
    batch: ImportBatch,
  ): Promise<AcquisitionManifestInfo | undefined> {
    if (!this.dataDir || !batch.sourceSnapshotId) return undefined;
    const [snapshot] = await this.db
      .select({ metadata: sourceSnapshots.metadata })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, batch.sourceSnapshotId))
      .limit(1);
    const manifestPath = safeRelative(asRecord(snapshot?.metadata).manifestPath);
    if (!manifestPath) return undefined;
    const absolutePath = resolve(process.cwd(), manifestPath);
    const relativeToData = relative(this.dataDir, absolutePath);
    if (!relativeToData || relativeToData.startsWith("..") || isAbsolute(relativeToData))
      return undefined;
    try {
      const bytes = await readFile(absolutePath);
      const value = JSON.parse(bytes.toString("utf8")) as unknown;
      return {
        path: absolutePath,
        value: asRecord(value),
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Enforce the deterministic AnimeGameData completeness contract at the
   * actual publication boundary. The status report is useful for operators,
   * but it must not be possible to publish a batch when the report would say
   * that its Manifest or source coverage is incomplete.
   */
  private async ensureAnimeAcquisitionIntegrity(batch: ImportBatch): Promise<void> {
    if (!this.dataDir || !batch.sourceSnapshotId) return;
    const [source] = await this.db
      .select({ parserType: sources.parserType })
      .from(sources)
      .where(eq(sources.id, batch.sourceId))
      .limit(1);
    if (!source?.parserType.startsWith("anime-game-data:")) return;
    if (!batch.stagedRecords?.length)
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData batch has no staged records",
        { batchId: batch.id },
      );
    const manifestInfo = await this.readAcquisitionManifest(batch);
    if (!manifestInfo)
      throw new DomainError(
        "acquisition_manifest_required",
        "The AnimeGameData Manifest for this batch could not be located or read",
        { batchId: batch.id },
      );

    const manifest = manifestInfo.value;
    const upstream = asRecord(manifest.upstream);
    const upstreamCommit = typeof upstream.commit === "string" ? upstream.commit : undefined;
    const gameVersion = typeof manifest.gameVersion === "string" ? manifest.gameVersion : undefined;
    const locale = typeof manifest.locale === "string" ? manifest.locale : undefined;
    const accounting = asRecord(manifest.accounting);
    const invalidAccounting = Object.entries(animeCategoryPlural)
      .filter(([category, plural]) => {
        const entry = asRecord(accounting[plural]);
        const discovered = typeof entry.discovered === "number" ? entry.discovered : undefined;
        const converted = typeof entry.converted === "number" ? entry.converted : undefined;
        const excluded = typeof entry.excluded === "number" ? entry.excluded : undefined;
        const failures = typeof entry.failures === "number" ? entry.failures : undefined;
        const accounted = typeof entry.accounted === "number" ? entry.accounted : undefined;
        const validCounts = [discovered, converted, excluded, failures, accounted].every(
          (value): value is number => Number.isSafeInteger(value),
        );
        const countsConsistent =
          validCounts &&
          accounted === (converted ?? 0) + (excluded ?? 0) + (failures ?? 0) &&
          accounted === (discovered ?? 0);
        return (
          !animeCategory(category) || entry.coverage !== 1 || !validCounts || !countsConsistent
        );
      })
      .map(([category]) => category);
    const accountedCoverage = asRecord(manifest.accountedCoverage);
    const invalidAccountedCoverage = Object.entries(animeCategoryPlural)
      .filter(([, plural]) => accountedCoverage[plural] !== 1)
      .map(([category]) => category);
    const unexplainedMissing = Array.isArray(manifest.unexplainedMissing)
      ? manifest.unexplainedMissing
      : undefined;
    if (
      !upstreamCommit ||
      !gameVersion ||
      !locale ||
      !unexplainedMissing ||
      unexplainedMissing.length > 0 ||
      invalidAccounting.length > 0 ||
      invalidAccountedCoverage.length > 0
    )
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData Manifest is incomplete or has unexplained missing records",
        {
          batchId: batch.id,
          invalidAccounting,
          invalidAccountedCoverage,
          unexplainedMissing: unexplainedMissing ?? "missing",
        },
      );

    const declaredRecordsRoot = safeRelative(manifest.outputRecordsPath);
    const recordsRoot = declaredRecordsRoot
      ? resolve(process.cwd(), declaredRecordsRoot)
      : resolve(dirname(manifestInfo.path), "records");
    const recordsRelative = relative(this.dataDir, recordsRoot);
    if (!recordsRelative || recordsRelative.startsWith("..") || isAbsolute(recordsRelative))
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData Manifest records path is outside the external data directory",
        { batchId: batch.id },
      );

    const expectedKeys = new Map<AnimeCategory, Set<string>>();
    const recordFileErrors: string[] = [];
    for (const [category, filename] of Object.entries(animeCategoryFiles) as Array<
      [AnimeCategory, string]
    >) {
      try {
        const rows = JSON.parse(await readFile(join(recordsRoot, filename), "utf8")) as unknown;
        if (!Array.isArray(rows)) {
          recordFileErrors.push(`${category}: not an array`);
          continue;
        }
        const keys = new Set(
          rows
            .map((row) => asRecord(row).sourceKey)
            .filter((key): key is string => typeof key === "string" && Boolean(key.trim())),
        );
        if (keys.size !== rows.length) recordFileErrors.push(`${category}: duplicate or empty key`);
        expectedKeys.set(category, keys);
        const entry = asRecord(accounting[animeCategoryPlural[category]]);
        if (entry.converted !== keys.size)
          recordFileErrors.push(
            `${category}: Manifest converted=${String(entry.converted)} but records=${keys.size}`,
          );
      } catch {
        recordFileErrors.push(`${category}: records file is missing or invalid`);
      }
    }
    if (recordFileErrors.length)
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData records do not match the Manifest",
        { batchId: batch.id, recordFileErrors: recordFileErrors.slice(0, 20) },
      );

    const sourceCategory = animeCategory(source.parserType.replace(/^anime-game-data:/, ""));
    const stagedCategories = [
      ...new Set(
        batch.stagedRecords
          .map((record) => animeCategory(record.documentType ?? record.recordType))
          .filter((category): category is AnimeCategory => Boolean(category)),
      ),
    ];
    if (
      !sourceCategory ||
      stagedCategories.length === 0 ||
      !stagedCategories.includes(sourceCategory)
    )
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData batch category does not match its source parser",
        { batchId: batch.id, sourceCategory, stagedCategories },
      );

    const stagedKeyErrors: string[] = [];
    for (const category of stagedCategories) {
      const expected = expectedKeys.get(category) ?? new Set<string>();
      const staged = new Set(
        batch.stagedRecords
          .filter((record) => animeCategory(record.documentType ?? record.recordType) === category)
          .map(
            (record) =>
              safeProvenance(record.metadata, record.sourceKey).canonicalKey ?? record.sourceKey,
          ),
      );
      const missing = [...expected].filter((key) => !staged.has(key));
      const unexpected = [...staged].filter((key) => !expected.has(key));
      if (missing.length || unexpected.length)
        stagedKeyErrors.push(
          `${category}: missing=${missing.slice(0, 10).join(",")} unexpected=${unexpected.slice(0, 10).join(",")}`,
        );
      for (const record of batch.stagedRecords.filter(
        (candidate) => animeCategory(candidate.documentType ?? candidate.recordType) === category,
      )) {
        const provenance = safeProvenance(record.metadata, record.sourceKey);
        if (
          record.gameVersion !== gameVersion ||
          provenance.locale !== locale ||
          provenance.upstreamCommit !== upstreamCommit
        )
          stagedKeyErrors.push(`${category}: scope mismatch for ${record.sourceKey}`);
      }
    }
    if (stagedKeyErrors.length)
      throw new DomainError(
        "acquisition_manifest_incomplete",
        "AnimeGameData staged records do not match the Manifest scope",
        { batchId: batch.id, errors: stagedKeyErrors.slice(0, 20) },
      );

    const sourceRows = await this.db
      .select({ id: sources.id, parserType: sources.parserType, enabled: sources.enabled })
      .from(sources)
      .where(eq(sources.gameId, batch.gameId));
    const animeSources = sourceRows.filter((candidate) =>
      candidate.parserType.startsWith("anime-game-data:"),
    );
    const coverageErrors: string[] = [];
    for (const category of stagedCategories) {
      const expected = expectedKeys.get(category) ?? new Set<string>();
      const categorySources = animeSources.filter(
        (candidate) => candidate.enabled && candidate.parserType === `anime-game-data:${category}`,
      );
      if (!categorySources.length) {
        coverageErrors.push(`${category}: no enabled source`);
        continue;
      }
      for (const candidate of categorySources) {
        const [latest] = await this.db
          .select({ id: sourceSnapshots.id })
          .from(sourceSnapshots)
          .where(eq(sourceSnapshots.sourceId, candidate.id))
          .orderBy(desc(sourceSnapshots.capturedAt))
          .limit(1);
        if (!latest) {
          coverageErrors.push(`${category}/${candidate.id}: no snapshot`);
          continue;
        }
        const observations = await this.db
          .select()
          .from(sourceObservations)
          .where(eq(sourceObservations.sourceSnapshotId, latest.id));
        const observed = observations.filter((observation) => observation.category === category);
        const observedKeys = new Set(observed.map((observation) => observation.canonicalKey));
        const missing = [...expected].filter((key) => !observedKeys.has(key));
        const unexpected = [...observedKeys].filter((key) => !expected.has(key));
        const versions = new Set(observed.map((observation) => observation.gameVersion));
        const locales = new Set(observed.map((observation) => observation.locale));
        const commits = new Set(
          observed.map(
            (observation) =>
              safeProvenance(observation.provenance, observation.canonicalKey).upstreamCommit,
          ),
        );
        if (
          observations.length !== observed.length ||
          observed.length !== observedKeys.size ||
          missing.length ||
          unexpected.length ||
          observed.length !== expected.size ||
          versions.size !== 1 ||
          !versions.has(gameVersion) ||
          locales.size !== 1 ||
          !locales.has(locale) ||
          commits.size !== 1 ||
          !commits.has(upstreamCommit)
        )
          coverageErrors.push(
            `${category}/${candidate.id}: observed=${observedKeys.size} expected=${expected.size} missing=${missing.slice(0, 10).join(",")} unexpected=${unexpected.slice(0, 10).join(",")}`,
          );
      }
    }
    if (coverageErrors.length)
      throw new DomainError(
        "source_coverage_incomplete",
        "Enabled AnimeGameData source coverage is incomplete",
        { batchId: batch.id, errors: coverageErrors.slice(0, 20) },
      );

    const animeSourceIds = animeSources.map((candidate) => candidate.id);
    const observations = animeSourceIds.length
      ? await this.db
          .select()
          .from(sourceObservations)
          .where(
            and(
              eq(sourceObservations.gameId, batch.gameId),
              inArray(sourceObservations.sourceId, animeSourceIds),
            ),
          )
      : [];
    const observationErrors: string[] = [];
    for (const observation of observations) {
      const provenance = safeProvenance(observation.provenance, observation.canonicalKey);
      if (
        !observation.canonicalKey.trim() ||
        !observation.category.trim() ||
        !observation.gameVersion.trim() ||
        !observation.locale.trim() ||
        !observation.title.trim() ||
        !observation.body.trim() ||
        !/^[0-9a-f]{64}$/i.test(observation.rawContentHash) ||
        !/^[0-9a-f]{64}$/i.test(observation.normalizedContentHash) ||
        provenance.rawContentHash !== observation.rawContentHash ||
        provenance.normalizedContentHash !== observation.normalizedContentHash ||
        !provenance.lineage?.title ||
        !provenance.lineage.body
      )
        observationErrors.push(observation.id);
    }
    if (observationErrors.length)
      throw new DomainError(
        "acquisition_observation_integrity_failed",
        "AnimeGameData source observations failed the integrity audit",
        { batchId: batch.id, observationIds: observationErrors.slice(0, 20) },
      );
  }

  /**
   * A release backup is an operational prerequisite for acquired upstream
   * data.  The API/worker passes the external data directory to this
   * repository; fixture repositories leave it undefined and retain the
   * existing non-acquisition publish behavior.
   */
  private async ensureReleaseBackup(batch: ImportBatch): Promise<void> {
    if (!this.dataDir) return;
    const requiresBackup = Boolean(
      batch.stagedRecords?.some((record) => {
        const provenance = asRecord(record.metadata.provenance);
        return typeof (provenance.upstreamCommit ?? record.metadata.upstreamCommit) === "string";
      }),
    );
    if (!requiresBackup) return;

    const expectedManifestHash = await this.acquisitionManifestHash(batch);
    if (!expectedManifestHash)
      throw new DomainError(
        "release_manifest_required",
        "The acquisition Manifest for this batch could not be located or read",
        { batchId: batch.id },
      );

    const backupRoot = resolve(this.dataDir, "backups");
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = (await readdir(backupRoot, { withFileTypes: true })).filter((entry) =>
        entry.isDirectory(),
      );
    } catch {
      throw new DomainError(
        "release_backup_required",
        "Run the acquisition backup before publishing this batch",
      );
    }

    const batchCreatedAt = batch.createdAt.getTime();
    for (const entry of entries) {
      const directory = join(backupRoot, entry.name);
      const backupManifestPath = join(directory, "backup-manifest.json");
      try {
        const parsed = JSON.parse(await readFile(backupManifestPath, "utf8")) as Record<
          string,
          unknown
        >;
        const createdAt = typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : NaN;
        if (!Number.isFinite(createdAt) || createdAt < batchCreatedAt) continue;
        const dumpRelative = safeRelative(parsed.dumpPath);
        const manifestRelative = safeRelative(
          Array.isArray(parsed.files)
            ? (
                parsed.files.find((file) =>
                  asRecord(file).path?.toString().endsWith("gip.dump"),
                ) as Record<string, unknown> | undefined
              )?.path
            : undefined,
        );
        if (!dumpRelative || !manifestRelative) continue;
        const dumpPath = resolve(this.dataDir, dumpRelative);
        const copiedManifestPath = resolve(
          this.dataDir,
          manifestRelative.replace(/gip\.dump$/, "manifest.json"),
        );
        const dumpRelativeToRoot = relative(this.dataDir, dumpPath);
        const copiedRelativeToRoot = relative(this.dataDir, copiedManifestPath);
        if (
          !dumpRelativeToRoot ||
          dumpRelativeToRoot.startsWith("..") ||
          isAbsolute(dumpRelativeToRoot) ||
          !copiedRelativeToRoot ||
          copiedRelativeToRoot.startsWith("..") ||
          isAbsolute(copiedRelativeToRoot)
        )
          continue;
        const [dump, copiedManifest] = await Promise.all([
          readFile(dumpPath),
          readFile(copiedManifestPath),
        ]);
        const copiedManifestObject = JSON.parse(copiedManifest.toString("utf8")) as Record<
          string,
          unknown
        >;
        const copiedUpstream = asRecord(copiedManifestObject.upstream);
        const expectedCommits = new Set(
          (batch.stagedRecords ?? []).flatMap((record) => {
            const metadata = asRecord(record.metadata.provenance);
            const provenance = Object.keys(metadata).length ? metadata : record.metadata;
            return typeof provenance.upstreamCommit === "string" ? [provenance.upstreamCommit] : [];
          }),
        );
        if (expectedCommits.size && !expectedCommits.has(String(copiedUpstream.commit ?? "")))
          continue;
        const dumpHash = createHash("sha256").update(dump).digest("hex");
        const manifestHash = createHash("sha256").update(copiedManifest).digest("hex");
        if (
          dumpHash === parsed.dumpSha256 &&
          dump.length === parsed.dumpBytes &&
          manifestHash === parsed.sourceManifestSha256 &&
          copiedManifest.length === parsed.sourceManifestBytes &&
          manifestHash === expectedManifestHash
        )
          return;
      } catch {
        // Ignore incomplete or corrupt candidate directories and continue
        // looking for a newer valid backup.
      }
    }
    throw new DomainError(
      "release_backup_required",
      "Run the acquisition backup after staging this batch and before publishing",
      { batchId: batch.id },
    );
  }

  /**
   * Resolve the immutable normalized Manifest recorded on the acquisition
   * snapshot and hash it.  The path is stored relative to the repository
   * working directory; reject anything outside the configured external data
   * directory so a provenance record cannot redirect the release check.
   */
  private async acquisitionManifestHash(batch: ImportBatch): Promise<string | undefined> {
    return (await this.readAcquisitionManifest(batch))?.hash;
  }

  async ensureAcquisitionReview(batchId: string): Promise<void> {
    const batch = await this.getImport(batchId);
    if (!batch)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    const runs = await this.db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.batchId, batchId))
      .limit(1);
    const run = runs[0];
    if (!run) {
      return;
    }
    const items = await this.db
      .select()
      .from(verificationItems)
      .where(eq(verificationItems.runId, run.id));
    const screenshots = items.length
      ? await this.db
          .select()
          .from(verificationScreenshots)
          .where(
            inArray(
              verificationScreenshots.itemId,
              items.map((item) => item.id),
            ),
          )
      : [];
    const screenshotItems = new Set(screenshots.map((item) => item.itemId));
    const screenshotRequired = new Set(["mismatch", "version_mismatch", "unavailable_due_unlock"]);
    const missingScreenshots = items.filter(
      (item) => screenshotRequired.has(item.status) && !screenshotItems.has(item.id),
    );
    const unresolvedItems = items.filter((item) => item.required && item.status === "not_checked");
    const mismatches = items.filter((item) => item.status === "mismatch");
    // Conflict cases are game-scoped review decisions.  Do not narrow this
    // check to the current source snapshot: an older open case can still
    // describe a canonical key that would be published into the same game,
    // and the status report/release UI treats any open case as blocking.
    const conflicts = await this.db
      .select()
      .from(conflictCases)
      .where(and(eq(conflictCases.gameId, batch.gameId), eq(conflictCases.status, "open")));
    const resolvedConflicts = await this.db
      .select()
      .from(conflictCases)
      .where(and(eq(conflictCases.gameId, batch.gameId), eq(conflictCases.status, "resolved")));
    const invalidConflictSelections = resolvedConflicts.filter(
      (conflict) =>
        (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
        (!conflict.selectedObservationId ||
          !conflict.observationIds.includes(conflict.selectedObservationId)),
    );
    const stagedByCanonicalKey = new Map(
      (batch.stagedRecords ?? []).map((record) => [recordCanonicalKey(record), record]),
    );
    const selectedObservationIds = resolvedConflicts
      .filter(
        (conflict) =>
          (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
          Boolean(conflict.selectedObservationId),
      )
      .map((conflict) => conflict.selectedObservationId!)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    const selectedObservationRows = selectedObservationIds.length
      ? await this.db
          .select()
          .from(sourceObservations)
          .where(inArray(sourceObservations.id, selectedObservationIds))
      : [];
    const selectedObservationById = new Map(
      selectedObservationRows.map((observation) => [observation.id, observation]),
    );
    const conflictSelectionMismatches = resolvedConflicts.flatMap((conflict) => {
      if (conflict.kind !== "content_conflict" && conflict.kind !== "missing_field") return [];
      const staged = stagedByCanonicalKey.get(conflict.canonicalKey);
      if (!staged || !conflict.selectedObservationId) return [];
      const selected = selectedObservationById.get(conflict.selectedObservationId);
      if (!selected) return [];
      const stagedTitle = staged.title ?? conflict.canonicalKey;
      const stagedBody = staged.body ?? "";
      return selected.title === stagedTitle && selected.body === stagedBody
        ? []
        : [
            {
              canonicalKey: conflict.canonicalKey,
              selectedObservationId: conflict.selectedObservationId,
            },
          ];
    });
    if (
      unresolvedItems.length ||
      mismatches.length ||
      missingScreenshots.length ||
      conflicts.length ||
      invalidConflictSelections.length ||
      conflictSelectionMismatches.length
    ) {
      await this.db
        .update(verificationRuns)
        .set({ status: "blocked" })
        .where(eq(verificationRuns.id, run.id));
      throw new DomainError("verification_gate_failed", "Acquisition verification is incomplete", {
        unchecked: unresolvedItems.length,
        mismatches: mismatches.length,
        missingScreenshots: missingScreenshots.length,
        openConflicts: conflicts.length,
        invalidConflictSelections: invalidConflictSelections.length,
        conflictSelectionMismatches,
      });
    }
    await this.db
      .update(verificationRuns)
      .set({ status: "ready" })
      .where(eq(verificationRuns.id, run.id));
  }

  async getVerificationRun(batchId: string): Promise<VerificationRun | null> {
    const rows = await this.db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.batchId, batchId))
      .limit(1);
    const run = rows[0];
    if (!run) return null;
    const itemRows = await this.db
      .select()
      .from(verificationItems)
      .where(eq(verificationItems.runId, run.id))
      .orderBy(asc(verificationItems.category), asc(verificationItems.title));
    const screenshotRows = itemRows.length
      ? await this.db
          .select()
          .from(verificationScreenshots)
          .where(
            inArray(
              verificationScreenshots.itemId,
              itemRows.map((item) => item.id),
            ),
          )
      : [];
    const counts = new Map<string, number>();
    for (const screenshot of screenshotRows)
      counts.set(screenshot.itemId, (counts.get(screenshot.itemId) ?? 0) + 1);
    const [batch] = await this.db
      .select({ sourceSnapshotId: importBatches.sourceSnapshotId })
      .from(importBatches)
      .where(eq(importBatches.id, run.batchId))
      .limit(1);
    const observationRows =
      batch?.sourceSnapshotId && itemRows.length
        ? await this.db
            .select()
            .from(sourceObservations)
            .where(
              and(
                eq(sourceObservations.sourceSnapshotId, batch.sourceSnapshotId),
                inArray(
                  sourceObservations.canonicalKey,
                  itemRows.map((item) => item.canonicalKey),
                ),
              ),
            )
        : [];
    const observations = new Map(
      observationRows.map((observation) => [observation.canonicalKey, observation]),
    );
    const [revision] = await this.db
      .select({ revisionNumber: datasetRevisions.revisionNumber })
      .from(datasetRevisions)
      .where(eq(datasetRevisions.sourceBatchId, run.batchId))
      .limit(1);
    return {
      id: run.id,
      batchId: run.batchId,
      datasetRevision: revision ? revisionLabel(revision.revisionNumber) : null,
      upstreamCommit: run.upstreamCommit,
      expectedGameVersion: run.expectedGameVersion,
      expectedLocale: run.expectedLocale,
      seed: run.seed,
      status: run.status as VerificationRun["status"],
      createdAt: run.createdAt,
      items: itemRows.map((item) =>
        this.mapVerificationItem(
          item,
          counts.get(item.id) ?? 0,
          observations.get(item.canonicalKey),
        ),
      ),
    };
  }

  async updateVerificationItem(input: {
    itemId: string;
    status: VerificationStatus;
    channel: VerificationChannel;
    checkedGameVersion: string;
    checkedLocale: string;
    note?: string;
  }): Promise<VerificationItem> {
    const scopeRows = await this.db
      .select({
        runId: verificationItems.runId,
        category: verificationItems.category,
        currentStatus: verificationItems.status,
        expectedGameVersion: verificationRuns.expectedGameVersion,
        expectedLocale: verificationRuns.expectedLocale,
      })
      .from(verificationItems)
      .innerJoin(verificationRuns, eq(verificationItems.runId, verificationRuns.id))
      .where(eq(verificationItems.id, input.itemId))
      .limit(1);
    const scope = scopeRows[0];
    if (!scope)
      throw new DomainError(
        "verification_item_not_found",
        "Verification item was not found",
        undefined,
        404,
      );
    if (
      input.status === "exact_match" &&
      input.channel === "game_client" &&
      (input.checkedGameVersion !== scope.expectedGameVersion ||
        input.checkedLocale !== scope.expectedLocale)
    )
      throw new DomainError(
        "verification_scope_mismatch",
        `Exact game-client verification requires version ${scope.expectedGameVersion} and locale ${scope.expectedLocale}`,
      );
    const [row] = await this.db
      .update(verificationItems)
      .set({
        status: input.status,
        channel: input.channel,
        checkedGameVersion: input.checkedGameVersion,
        checkedLocale: input.checkedLocale,
        note: input.note,
        updatedAt: new Date(),
      })
      .where(eq(verificationItems.id, input.itemId))
      .returning();
    if (!row)
      throw new DomainError(
        "verification_item_not_found",
        "Verification item was not found",
        undefined,
        404,
      );
    if (
      input.status === "unavailable_due_unlock" &&
      scope.currentStatus !== "unavailable_due_unlock"
    ) {
      await this.addVerificationReplacement(scope.runId, scope.category);
    }
    const screenshotCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(verificationScreenshots)
      .where(eq(verificationScreenshots.itemId, row.id));
    return this.mapVerificationItem(row, Number(screenshotCount[0]?.count ?? 0));
  }

  async addVerificationScreenshot(input: {
    itemId: string;
    relativePath: string;
    sha256: string;
    bytes: number;
    mimeType: string;
  }): Promise<void> {
    if (!safeRelative(input.relativePath))
      throw new DomainError("invalid_screenshot_path", "Screenshot path must be relative");
    const exists = await this.db
      .select({ id: verificationItems.id })
      .from(verificationItems)
      .where(eq(verificationItems.id, input.itemId))
      .limit(1);
    if (!exists[0])
      throw new DomainError(
        "verification_item_not_found",
        "Verification item was not found",
        undefined,
        404,
      );
    await this.db.insert(verificationScreenshots).values(input).onConflictDoNothing();
  }

  async listVerificationScreenshots(itemId: string): Promise<VerificationScreenshot[]> {
    const rows = await this.db
      .select()
      .from(verificationScreenshots)
      .where(eq(verificationScreenshots.itemId, itemId))
      .orderBy(asc(verificationScreenshots.createdAt));
    return rows.map((row) => ({ ...row }));
  }

  async getVerificationScreenshot(screenshotId: string): Promise<VerificationScreenshot | null> {
    const rows = await this.db
      .select()
      .from(verificationScreenshots)
      .where(eq(verificationScreenshots.id, screenshotId))
      .limit(1);
    return rows[0] ? { ...rows[0] } : null;
  }

  async deleteVerificationScreenshot(screenshotId: string): Promise<VerificationScreenshot> {
    const rows = await this.db
      .delete(verificationScreenshots)
      .where(eq(verificationScreenshots.id, screenshotId))
      .returning();
    if (!rows[0])
      throw new DomainError("screenshot_not_found", "Screenshot was not found", undefined, 404);
    return { ...rows[0] };
  }

  async listConflicts(gameId: string, status?: "open" | "resolved"): Promise<ConflictCase[]> {
    const rows = await this.db
      .select()
      .from(conflictCases)
      .where(
        status
          ? and(eq(conflictCases.gameId, gameId), eq(conflictCases.status, status))
          : eq(conflictCases.gameId, gameId),
      )
      .orderBy(desc(conflictCases.createdAt));
    return rows.map((row) => ({
      ...row,
      kind: row.kind as ConflictCase["kind"],
      status: row.status as ConflictCase["status"],
      selectedObservationId: row.selectedObservationId,
    }));
  }

  async getConflict(conflictId: string): Promise<ConflictDetail | null> {
    const [row] = await this.db
      .select()
      .from(conflictCases)
      .where(eq(conflictCases.id, conflictId))
      .limit(1);
    if (!row) return null;
    const observationIds = row.observationIds;
    const observations = observationIds.length
      ? await this.db
          .select()
          .from(sourceObservations)
          .where(inArray(sourceObservations.id, observationIds))
      : [];
    const byId = new Map(observations.map((observation) => [observation.id, observation]));
    return {
      id: row.id,
      gameId: row.gameId,
      canonicalKey: row.canonicalKey,
      gameVersion: row.gameVersion,
      locale: row.locale,
      kind: row.kind as ConflictCase["kind"],
      status: row.status as ConflictCase["status"],
      selectedObservationId: row.selectedObservationId,
      observationIds,
      resolution: row.resolution,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      observations: observationIds.flatMap((id) => {
        const observation = byId.get(id);
        if (!observation) return [];
        return [
          {
            id: observation.id,
            sourceId: observation.sourceId,
            sourceSnapshotId: observation.sourceSnapshotId,
            canonicalKey: observation.canonicalKey,
            category: observation.category,
            gameVersion: observation.gameVersion,
            locale: observation.locale,
            title: observation.title,
            body: observation.body,
            rawContentHash: observation.rawContentHash,
            normalizedContentHash: observation.normalizedContentHash,
            provenance: safeProvenance(observation.provenance, observation.canonicalKey),
          },
        ];
      }),
    };
  }

  async resolveConflict(
    conflictId: string,
    resolution: string,
    selectedObservationId?: string,
  ): Promise<ConflictCase> {
    const [existing] = await this.db
      .select()
      .from(conflictCases)
      .where(eq(conflictCases.id, conflictId))
      .limit(1);
    if (!existing)
      throw new DomainError("conflict_not_found", "Conflict case was not found", undefined, 404);
    if (selectedObservationId && !existing.observationIds.includes(selectedObservationId))
      throw new DomainError(
        "conflict_observation_invalid",
        "Selected observation does not belong to this conflict case",
      );
    if (
      (existing.kind === "content_conflict" || existing.kind === "missing_field") &&
      !selectedObservationId
    )
      throw new DomainError(
        "conflict_observation_required",
        "A real content conflict requires selecting the adopted source observation",
      );
    const [row] = await this.db
      .update(conflictCases)
      .set({
        status: "resolved",
        resolution,
        selectedObservationId: selectedObservationId ?? existing.selectedObservationId,
        resolvedAt: new Date(),
      })
      .where(eq(conflictCases.id, conflictId))
      .returning();
    if (!row)
      throw new DomainError("conflict_not_found", "Conflict case was not found", undefined, 404);
    return {
      ...row,
      kind: row.kind as ConflictCase["kind"],
      status: row.status as ConflictCase["status"],
      selectedObservationId: row.selectedObservationId,
    };
  }

  async listRevisions(gameId?: string): Promise<DatasetRevision[]> {
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(gameId ? eq(datasetRevisions.gameId, gameId) : undefined)
      .orderBy(desc(datasetRevisions.revisionNumber));
    return rows.map((row) => ({
      id: row.id,
      gameId: row.gameId,
      revisionNumber: row.revisionNumber,
      sourceBatchId: row.sourceBatchId,
      releaseNote: row.releaseNote,
      lifecycleStatus: row.lifecycleStatus as DatasetRevision["lifecycleStatus"],
      publishedAt: row.publishedAt,
      isCurrent: row.isCurrent,
      indexStatus: row.indexStatus as DatasetRevision["indexStatus"],
    }));
  }

  async rollbackRevision(revisionId: string, reason: string): Promise<DatasetRevision> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(datasetRevisions)
        .where(eq(datasetRevisions.id, revisionId))
        .limit(1);
      const target = rows[0];
      if (!target)
        throw new DomainError(
          "revision_not_found",
          "Dataset revision was not found",
          undefined,
          404,
        );
      if (
        target.lifecycleStatus !== "published" ||
        target.indexStatus !== "ready" ||
        !target.manifestId
      )
        throw new DomainError(
          "revision_not_ready",
          "Only a published, indexed revision with a manifest can be activated by rollback",
          undefined,
          409,
        );
      await tx.execute(
        sql`select id from platform.games where id = ${target.gameId}::uuid for update`,
      );
      await tx
        .update(datasetRevisions)
        .set({ isCurrent: false })
        .where(eq(datasetRevisions.gameId, target.gameId));
      const [updated] = await tx
        .update(datasetRevisions)
        .set({ isCurrent: true })
        .where(eq(datasetRevisions.id, target.id))
        .returning();
      if (!updated)
        throw new DomainError(
          "rollback_failed",
          "Dataset revision could not be activated",
          undefined,
          500,
        );
      await tx.insert(auditLog).values({
        action: "rollback_revision",
        targetType: "dataset_revision",
        targetId: target.id,
        reason,
        metadata: { gameId: target.gameId },
      });
      return {
        id: updated.id,
        gameId: updated.gameId,
        revisionNumber: updated.revisionNumber,
        sourceBatchId: updated.sourceBatchId,
        releaseNote: updated.releaseNote,
        lifecycleStatus: updated.lifecycleStatus as DatasetRevision["lifecycleStatus"],
        publishedAt: updated.publishedAt,
        isCurrent: updated.isCurrent,
        indexStatus: updated.indexStatus as DatasetRevision["indexStatus"],
      };
    });
  }

  async listJobs(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.error,
      cancelRequested: row.cancelRequested,
    }));
  }

  async recordWorkerHeartbeat(workerId: string): Promise<void> {
    await this.db
      .insert(workerHeartbeats)
      .values({ workerId, heartbeatAt: new Date() })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { heartbeatAt: new Date() },
      });
  }

  async workerHealth(): Promise<"up" | "not_ready"> {
    try {
      const rows = await this.db
        .select({ workerId: workerHeartbeats.workerId })
        .from(workerHeartbeats)
        .where(gt(workerHeartbeats.heartbeatAt, new Date(Date.now() - 30_000)))
        .limit(1);
      return rows.length ? "up" : "not_ready";
    } catch {
      return "not_ready";
    }
  }

  async claimNextJob(workerId: string): Promise<Record<string, unknown> | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select()
        .from(jobs)
        .where(
          and(
            or(
              eq(jobs.status, "pending"),
              and(
                eq(jobs.status, "running"),
                or(isNull(jobs.leasedUntil), lt(jobs.leasedUntil, now)),
              ),
            ),
            eq(jobs.cancelRequested, false),
            lt(jobs.attempts, jobs.maxAttempts),
          ),
        )
        .orderBy(asc(jobs.createdAt))
        .for("update", { skipLocked: true })
        .limit(1);
      const job = rows[0];
      if (!job) return null;
      const [claimed] = await tx
        .update(jobs)
        .set({
          status: "running",
          leaseOwner: workerId,
          leasedUntil: new Date(Date.now() + 60_000),
          heartbeatAt: now,
          startedAt: job.startedAt ?? now,
          attempts: job.attempts + 1,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      return claimed
        ? {
            id: claimed.id,
            type: claimed.type,
            status: claimed.status,
            payload: claimed.payload,
            attempts: claimed.attempts,
            maxAttempts: claimed.maxAttempts,
          }
        : null;
    });
  }

  async heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
    const rows = await this.db
      .update(jobs)
      .set({
        leasedUntil: new Date(Date.now() + 60_000),
        heartbeatAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)))
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async completeJob(jobId: string, status: "completed" | "failed", error?: string): Promise<void> {
    const existingRows = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const existing = existingRows[0];
    const retry = status === "failed" && existing && existing.attempts < existing.maxAttempts;
    await this.db
      .update(jobs)
      .set({
        status: retry ? "pending" : status,
        error,
        completedAt: retry ? null : new Date(),
        leasedUntil: null,
        heartbeatAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    const rows = await this.db
      .select({ type: jobs.type, payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    const job = rows[0];
    const payload = job?.payload;
    if (status === "completed" && payload && typeof payload.revisionId === "string") {
      await this.db
        .update(datasetRevisions)
        .set({ indexStatus: "ready" })
        .where(eq(datasetRevisions.id, payload.revisionId));
    }
    if (!retry && status === "failed" && payload && typeof payload.revisionId === "string") {
      // Full-text indexes remain usable when only the optional semantic job fails.
      await this.db
        .update(datasetRevisions)
        .set({ indexStatus: job?.type === "generate_embeddings" ? "ready" : "failed" })
        .where(eq(datasetRevisions.id, payload.revisionId));
    }
  }

  private async getCurrentRevision(gameId: string) {
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.gameId, gameId),
          eq(datasetRevisions.isCurrent, true),
          eq(datasetRevisions.lifecycleStatus, "published"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async getRevision(revisionId: string, gameId?: string) {
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        gameId
          ? and(eq(datasetRevisions.id, revisionId), eq(datasetRevisions.gameId, gameId))
          : eq(datasetRevisions.id, revisionId),
      )
      .limit(1);
    return rows[0];
  }

  private async getSearchableRevision(
    gameId: string,
    current: typeof datasetRevisions.$inferSelect,
  ) {
    if (current.indexStatus === "ready") return current;
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.gameId, gameId),
          eq(datasetRevisions.lifecycleStatus, "published"),
          eq(datasetRevisions.indexStatus, "ready"),
        ),
      )
      .orderBy(desc(datasetRevisions.revisionNumber))
      .limit(1);
    return rows[0];
  }

  private async getRevisionRecords(
    revision: typeof datasetRevisions.$inferSelect,
  ): Promise<NormalizedRecord[]> {
    if (revision.normalizedRecords) return revision.normalizedRecords;
    const rows = await this.db
      .select({ stagedRecords: importBatches.stagedRecords })
      .from(importBatches)
      .where(eq(importBatches.id, revision.sourceBatchId))
      .limit(1);
    return rows[0]?.stagedRecords ?? [];
  }

  private async searchEntitiesAtRevision(
    gameId: string,
    request: SearchRequest,
    revision: typeof datasetRevisions.$inferSelect,
  ): Promise<EntitySummary[]> {
    const records = await this.getRevisionRecords(revision);
    const candidates = new Map(
      records.flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
    const query = normalize(request.query);
    return rows
      .flatMap((row) => {
        const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
        if (
          !candidate ||
          (request.entityTypes?.length && !request.entityTypes.includes(candidate.type))
        )
          return [];
        const nameMatch = lexicalScore(request.query, candidate.name);
        const aliasMatch = (candidate.aliases ?? [])
          .map((alias) => lexicalScore(request.query, alias.value))
          .sort((left, right) => right.score - left.score)[0];
        const weightedNameMatch = { ...nameMatch, score: nameMatch.score };
        const weightedAliasMatch = aliasMatch
          ? { ...aliasMatch, score: aliasMatch.score * 0.95 }
          : undefined;
        const best =
          weightedAliasMatch && weightedAliasMatch.score > weightedNameMatch.score
            ? weightedAliasMatch
            : weightedNameMatch;
        const bestValue =
          weightedAliasMatch && weightedAliasMatch.score > weightedNameMatch.score
            ? "alias"
            : "name";
        const values = [candidate.name, ...(candidate.aliases ?? []).map((alias) => alias.value)];
        if (!values.some((value) => normalize(value).includes(query)) && best.score < 0.15)
          return [];
        return [
          {
            id: row.id,
            sourceKey: row.sourceKey,
            name: candidate.name,
            type: candidate.type,
            summary: candidate.summary ?? null,
            aliases: (candidate.aliases ?? []).map((alias) => alias.value),
            score: best.score,
            match: `${bestValue}_${best.match}`,
            revision: revisionLabel(revision.revisionNumber),
          },
        ];
      })
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, request.limit ?? defaultLimit);
  }

  private async addAliases(rows: EntitySummary[]): Promise<EntitySummary[]> {
    if (!rows.length) return rows;
    const aliasRows = await this.db
      .select()
      .from(entityAliases)
      .where(
        inArray(
          entityAliases.entityId,
          rows.map((row) => row.id),
        ),
      );
    const map = new Map<string, string[]>();
    for (const alias of aliasRows)
      map.set(alias.entityId, [...(map.get(alias.entityId) ?? []), alias.value]);
    return rows.map((row) => ({ ...row, aliases: map.get(row.id) ?? [] }));
  }

  private async getAliases(entityIds: string[]): Promise<Map<string, string[]>> {
    if (!entityIds.length) return new Map();
    const rows = await this.db
      .select()
      .from(entityAliases)
      .where(inArray(entityAliases.entityId, entityIds));
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.entityId, [...(map.get(row.entityId) ?? []), row.value]);
    return map;
  }

  private async evidenceViews(rows: Array<typeof evidence.$inferSelect>) {
    if (!rows.length) return [];
    const docIds = [...new Set(rows.map((row) => row.documentId))];
    const docs = await this.db.select().from(documents).where(inArray(documents.id, docIds));
    const names = new Map(docs.map((row) => [row.id, row.title]));
    return rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      documentTitle: names.get(row.documentId) ?? "",
      segmentId: row.segmentId,
      quote: row.quote,
      strength: row.strength,
      note: row.note,
    }));
  }

  private mapImport(row: typeof importBatches.$inferSelect): ImportBatch {
    return {
      id: row.id,
      gameId: row.gameId,
      sourceId: row.sourceId,
      sourceSnapshotId: row.sourceSnapshotId,
      status: row.status as ImportBatch["status"],
      parserVersion: row.parserVersion,
      successCount: row.successCount,
      failureCount: row.failureCount,
      errors: row.errors,
      warnings: row.warnings,
      diff: row.diff ?? undefined,
      stagedRecords: row.stagedRecords ?? undefined,
      reviewNote: row.reviewNote,
      confirmedDeletionKeys: row.confirmedDeletionKeys,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }

  private mapDatasetRevision(row: typeof datasetRevisions.$inferSelect): DatasetRevision {
    return {
      id: row.id,
      gameId: row.gameId,
      revisionNumber: row.revisionNumber,
      sourceBatchId: row.sourceBatchId,
      releaseNote: row.releaseNote,
      publishedAt: row.publishedAt,
      isCurrent: row.isCurrent,
      indexStatus: row.indexStatus as DatasetRevision["indexStatus"],
      lifecycleStatus: row.lifecycleStatus as DatasetRevision["lifecycleStatus"],
    };
  }

  private mapReleaseCandidate(row: typeof releaseCandidates.$inferSelect): ReleaseCandidate {
    return {
      id: row.id,
      gameId: row.gameId,
      name: row.name,
      baseRevisionId: row.baseRevisionId,
      importBatchIds: row.importBatchIds,
      status: row.status as ReleaseCandidate["status"],
      currentBuildId: row.currentBuildId,
      promotedRevisionId: row.promotedRevisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapReleaseCandidateBuild(
    row: typeof releaseCandidateBuilds.$inferSelect,
  ): ReleaseCandidateBuild {
    return {
      id: row.id,
      candidateId: row.candidateId,
      buildNumber: row.buildNumber,
      status: row.status as ReleaseCandidateBuild["status"],
      contentChecksum: row.contentChecksum,
      recordCount: row.normalizedRecords.length,
      createdAt: row.createdAt,
    };
  }

  private mapVerificationItem(
    row: typeof verificationItems.$inferSelect,
    screenshotCount: number,
    observation?: typeof sourceObservations.$inferSelect,
  ): VerificationItem {
    return {
      id: row.id,
      runId: row.runId,
      category: row.category as VerificationItem["category"],
      canonicalKey: row.canonicalKey,
      title: row.title,
      body: observation?.body ?? null,
      sourceId: observation?.sourceId ?? null,
      sourceSnapshotId: observation?.sourceSnapshotId ?? null,
      gameVersion: observation?.gameVersion ?? null,
      locale: observation?.locale ?? null,
      provenance: observation
        ? safeProvenance(observation.provenance, observation.canonicalKey)
        : undefined,
      status: row.status as VerificationStatus,
      channel: row.channel as VerificationChannel | null,
      checkedGameVersion: row.checkedGameVersion,
      checkedLocale: row.checkedLocale,
      note: row.note,
      required: row.required,
      screenshotCount,
    };
  }
}

function revisionNumberLabel(value: number): string {
  return revisionLabel(value);
}
