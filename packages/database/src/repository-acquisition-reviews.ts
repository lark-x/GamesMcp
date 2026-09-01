import { and, eq } from "drizzle-orm";
import {
  type ConflictKind,
  type ImportBatch,
  type NormalizedRecord,
  type VerificationItem,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  conflictCases,
  sourceObservations,
  sourceSnapshots,
  verificationItems,
  verificationRuns,
} from "./schema.js";
import {
  asRecord,
  recordCanonicalKey,
  safeProvenance,
  selectVerificationSample,
  VERIFICATION_SAMPLE_SIZE,
  verificationCategoryFromKey,
  observationConflictKind,
  conflictIsResolved,
  type SourceObservationRow,
} from "./repository-utils.js";

export interface AcquisitionReviewContext {
  db: Database;
}

export async function upsertObservationConflict(
  ctx: Pick<AcquisitionReviewContext, "db">,
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
  const [existing] = await ctx.db
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
  await ctx.db
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
        selectedObservationId: resolved ? (retainedSelection ?? automaticSelection ?? null) : null,
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
export async function reconcileSourceObservationConflicts(
  ctx: Pick<AcquisitionReviewContext, "db">,
  gameId?: string,
): Promise<{
  checked: number;
  repairedRaw: number;
  repairedNormalized: number;
  scopes: number;
  upserted: number;
  open: number;
}> {
  const observations = await ctx.db
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
    await ctx.db
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
    const kind = await upsertObservationConflict(ctx, group);
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
      await ctx.db
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
  const openRows = await ctx.db
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

export async function registerAcquisitionReview(
  ctx: AcquisitionReviewContext,
  batch: ImportBatch,
): Promise<void> {
  if (!batch.sourceSnapshotId) return;
  const acquisitionRecords = (batch.stagedRecords ?? []).filter((record) => {
    const source = asRecord(record.metadata.provenance);
    return typeof (source.upstreamCommit ?? record.metadata.upstreamCommit) === "string";
  });
  const [snapshot] = await ctx.db
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
    await ctx.db
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
    const comparisons = await ctx.db
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
    const kind = await upsertObservationConflict(ctx, comparisons);
    if (kind === "content_conflict" || kind === "missing_field")
      extraVerificationKeys.add(canonicalKey);

    // A version change is informational, not a same-version conflict. Keep it
    // resolved so it remains auditable without blocking publication. If this
    // version later receives multiple observations, the same-version case
    // above takes precedence and can be opened for a real content conflict.
    const localeComparisons = await ctx.db
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
      await ctx.db
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
  // Every acquisition snapshot gets a deterministic manual-verification run.
  // Clean imports receive a capped per-category sample; failures and source
  // conflicts are appended below and never consume that sample quota.
  const [insertedRun] = await ctx.db
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
      await ctx.db
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
    const selected = selectVerificationSample(
      records,
      upstreamCommit,
      category,
      VERIFICATION_SAMPLE_SIZE,
      extraVerificationKeys,
    );
    const selectedKeys = new Set(selected.map((record) => recordCanonicalKey(record)));
    const recordsByCanonicalKey = new Map(
      records.map((record) => [recordCanonicalKey(record), record]),
    );
    const extra = [...extraVerificationKeys]
      .map((key) => recordsByCanonicalKey.get(key))
      .filter((record): record is NormalizedRecord => Boolean(record))
      .filter((record) => !selectedKeys.has(recordCanonicalKey(record)));
    const verificationRecords = [...selected, ...extra];
    if (verificationRecords.length)
      await ctx.db
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
    await ctx.db.insert(verificationItems).values(extraItems).onConflictDoNothing();
}
