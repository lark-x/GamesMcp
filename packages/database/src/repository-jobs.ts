import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Database } from "./client.js";
import { datasetRevisions, jobs, workerHeartbeats } from "./schema.js";

export async function enqueueJob(
  db: Database,
  input: {
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(jobs).values(input).onConflictDoNothing();
}

export async function listJobs(db: Database): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
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

export async function recordWorkerHeartbeat(db: Database, workerId: string): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ workerId, heartbeatAt: new Date() })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { heartbeatAt: new Date() },
    });
}

export async function workerHealth(db: Database): Promise<"up" | "not_ready"> {
  try {
    const rows = await db
      .select({ workerId: workerHeartbeats.workerId })
      .from(workerHeartbeats)
      .where(gt(workerHeartbeats.heartbeatAt, new Date(Date.now() - 30_000)))
      .limit(1);
    return rows.length ? "up" : "not_ready";
  } catch {
    return "not_ready";
  }
}

export async function claimNextJob(
  db: Database,
  workerId: string,
): Promise<Record<string, unknown> | null> {
  return db.transaction(async (tx) => {
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

export async function heartbeatJob(
  db: Database,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      leasedUntil: new Date(Date.now() + 60_000),
      heartbeatAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseOwner, workerId)))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function completeJob(
  db: Database,
  jobId: string,
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  const existingRows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const existing = existingRows[0];
  const retry = status === "failed" && existing && existing.attempts < existing.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: retry ? "pending" : status,
      error,
      completedAt: retry ? null : new Date(),
      leasedUntil: null,
      heartbeatAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
  const rows = await db
    .select({ type: jobs.type, payload: jobs.payload })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  const job = rows[0];
  const payload = job?.payload;
  if (status === "completed" && payload && typeof payload.revisionId === "string") {
    await db
      .update(datasetRevisions)
      .set({ indexStatus: "ready" })
      .where(eq(datasetRevisions.id, payload.revisionId));
  }
  if (!retry && status === "failed" && payload && typeof payload.revisionId === "string") {
    // Full-text indexes remain usable when only the optional semantic job fails.
    await db
      .update(datasetRevisions)
      .set({ indexStatus: job?.type === "generate_embeddings" ? "ready" : "failed" })
      .where(eq(datasetRevisions.id, payload.revisionId));
  }
}
