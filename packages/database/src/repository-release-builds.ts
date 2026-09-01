import { createHash } from "node:crypto";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DomainError,
  type NormalizedRecord,
  type ReleaseCandidateBuild,
  type StructuredImportRecords,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  candidatePatches,
  datasetRevisions,
  importBatches,
  releaseCandidateBuilds,
  releaseCandidates,
  reviewIssues,
} from "./schema.js";
import { mapReleaseCandidateBuild } from "./repository-mappers.js";
import {
  asRecord,
  canonicalRecordBytes,
  mergeReleaseCandidateRecords,
  recordCanonicalKey,
  releaseCandidateChecksum,
  setField,
} from "./repository-utils.js";

type CandidateDetail = {
  id: string;
  gameId: string;
  importBatchIds: string[];
  baseRevisionId?: string | null;
  status: string;
};

type RevisionRow = typeof datasetRevisions.$inferSelect;

interface ReleaseBuildContext {
  db: Database;
  getReleaseCandidate(candidateId: string): Promise<CandidateDetail | null>;
  getRevision(revisionId: string, gameId?: string): Promise<RevisionRow | undefined>;
  getRevisionRecords(revision: RevisionRow): Promise<NormalizedRecord[]>;
  createPreviewManifest(
    gameId: string,
    records: NormalizedRecord[],
    baseRevisionId?: string | null,
  ): Promise<string>;
}

export async function buildReleaseCandidate(
  ctx: ReleaseBuildContext,
  candidateId: string,
): Promise<ReleaseCandidateBuild> {
  const candidate = await ctx.getReleaseCandidate(candidateId);
  if (!candidate)
    throw new DomainError("candidate_not_found", "Release candidate was not found", undefined, 404);
  if (["promoted", "withdrawn"].includes(candidate.status))
    throw new DomainError(
      "invalid_candidate_state",
      `Release candidate cannot be built from state ${candidate.status}`,
    );
  const batches = await ctx.db
    .select()
    .from(importBatches)
    .where(inArray(importBatches.id, candidate.importBatchIds));
  if (batches.length !== candidate.importBatchIds.length)
    throw new DomainError("candidate_batch_not_found", "A candidate import batch is missing");
  for (const batch of batches) {
    if (batch.gameId !== candidate.gameId)
      throw new DomainError("candidate_game_mismatch", "Candidate batch game mismatch");
    if (!batch.stagedRecords && !hasStructuredRecords(batch.structuredRecords))
      throw new DomainError(
        "staged_data_missing",
        "Candidate batch has no staged or structured records",
      );
  }
  const baseRevision = candidate.baseRevisionId
    ? await ctx.getRevision(candidate.baseRevisionId, candidate.gameId)
    : undefined;
  if (candidate.baseRevisionId && !baseRevision)
    throw new DomainError("candidate_base_missing", "Candidate base revision was not found");
  const baseRecords = baseRevision ? await ctx.getRevisionRecords(baseRevision) : [];
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
  const structuredRecords = mergeStructuredImportRecords(
    baseRevision?.structuredRecords ?? undefined,
    batches.map((batch) => batch.structuredRecords ?? undefined),
  );
  // Patches always produce a new immutable build. Hash preconditions prevent
  // silently applying a decision to a changed base/incoming record.
  const priorPatches = await ctx.db
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
    const incomingHash = incoming
      ? createHash("sha256").update(canonicalRecordBytes(incoming)).digest("hex")
      : null;
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
      if (incoming)
        patched.set(patch.canonicalKey, setField(incoming, patch.fieldPath, patch.manualValue));
  }
  normalizedRecords = [...patched.values()];
  const contentChecksum = releaseCandidateChecksum(normalizedRecords, structuredRecords);
  const manifestId = await ctx.createPreviewManifest(
    candidate.gameId,
    normalizedRecords,
    candidate.baseRevisionId,
  );
  return ctx.db.transaction(async (tx) => {
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
        structuredRecords,
        manifestId,
        baseRevisionId: candidate.baseRevisionId,
        importBatchId: candidate.importBatchIds.at(-1),
        buildKind: "import",
        // Candidate builds contain a complete immutable manifest; the
        // searchable index is materialized from this payload during
        // activation, so the build itself is ready for promotion.
        indexStatus: "ready",
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
    const incomingByKey = new Map<string, Array<{ record: NormalizedRecord; sourceId: string }>>();
    for (const batch of batches)
      for (const record of batch.stagedRecords ?? [])
        incomingByKey.set(record.sourceKey, [
          ...(incomingByKey.get(record.sourceKey) ?? []),
          { record, sourceId: batch.sourceId },
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
        addIssue("import_error", String(error.code ?? "import"), error.message ?? "Import error", {
          batchId: batch.id,
          error,
        });
    }
    for (const [key, incomingRecords] of incomingByKey) {
      const records = incomingRecords.map((item) => item.record);
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
      if (
        new Set(incomingRecords.map((item) => item.sourceId)).size > 1 &&
        new Set(records.map(canonicalRecordBytes)).size > 1
      )
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
    return mapReleaseCandidateBuild(build);
  });
}

function hasStructuredRecords(records: StructuredImportRecords | null | undefined): boolean {
  if (!records) return false;
  return Object.values(records).some((items) => Boolean(items?.length));
}

function mergeStructuredImportRecords(
  base: StructuredImportRecords | undefined,
  incoming: Array<StructuredImportRecords | undefined>,
): StructuredImportRecords | undefined {
  const merged: StructuredImportRecords = {
    characters: mergeByStableId(
      base?.characters,
      incoming.flatMap((records) => records?.characters ?? []),
    ),
    weapons: mergeByStableId(
      base?.weapons,
      incoming.flatMap((records) => records?.weapons ?? []),
    ),
    artifactSets: mergeByStableId(
      base?.artifactSets,
      incoming.flatMap((records) => records?.artifactSets ?? []),
    ),
    artifacts: mergeByStableId(
      base?.artifacts,
      incoming.flatMap((records) => records?.artifacts ?? []),
    ),
    materials: mergeByStableId(
      base?.materials,
      incoming.flatMap((records) => records?.materials ?? []),
    ),
    achievements: mergeByStableId(
      base?.achievements,
      incoming.flatMap((records) => records?.achievements ?? []),
    ),
    enemies: mergeByStableId(
      base?.enemies,
      incoming.flatMap((records) => records?.enemies ?? []),
    ),
    voices: mergeByStableId(
      base?.voices,
      incoming.flatMap((records) => records?.voices ?? []),
    ),
  };
  return hasStructuredRecords(merged) ? merged : undefined;
}

function mergeByStableId<T extends { stableId: string }>(base: T[] = [], incoming: T[] = []): T[] {
  const merged = new Map<string, T>();
  for (const record of base) merged.set(record.stableId, record);
  for (const record of incoming) merged.set(record.stableId, record);
  return [...merged.values()].sort((left, right) => left.stableId.localeCompare(right.stableId));
}
