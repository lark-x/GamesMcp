import { randomUUID } from "node:crypto";
import { loadConfig } from "@gip/config";
import { createDatabase, createPool, SqlKnowledgeRepository } from "@gip/database";
import {
  adapterFor,
  computeDiff,
  normalizeSnapshot,
  validateImport,
  type SourceType,
} from "@gip/ingestion";
import { OpenAICompatibleEmbeddingProvider } from "@gip/retrieval";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
const workerId = `worker-${randomUUID()}`;
let stopping = false;
let lastWorkerHeartbeat = 0;

async function touchWorkerHeartbeat(): Promise<void> {
  if (!repository.recordWorkerHeartbeat || Date.now() - lastWorkerHeartbeat < 10_000) return;
  await repository.recordWorkerHeartbeat(workerId);
  lastWorkerHeartbeat = Date.now();
}

async function processOne(): Promise<boolean> {
  const job = await repository.claimNextJob(workerId);
  if (!job) return false;
  try {
    if (job.type === "parse_import") {
      const payload = job.payload as {
        batchId?: unknown;
        gameId?: unknown;
        sourceId?: unknown;
        path?: unknown;
      };
      if (
        typeof payload.batchId !== "string" ||
        typeof payload.gameId !== "string" ||
        typeof payload.sourceId !== "string" ||
        typeof payload.path !== "string"
      )
        throw new Error("Import job payload is invalid");
      if (!repository.updateImportStaged)
        throw new Error("Import staging is not supported by this repository");
      await repository.markImportRunning?.(payload.batchId);
      const source = await repository.getSource(payload.sourceId);
      if (!source || source.gameId !== payload.gameId)
        throw new Error("Import source was not found");
      const adapter = adapterFor(source.type as SourceType);
      const input = {
        sourceId: source.id,
        type: source.type as SourceType,
        path: payload.path,
        storageDir: config.dataDir,
      };
      const inspection = await adapter.inspect(input);
      if (!inspection.supported) throw new Error("Import source is not supported");
      const snapshot = await adapter.snapshot(input);
      const savedSnapshot = await repository.createSnapshot({
        sourceId: source.id,
        contentHash: snapshot.contentHash,
        storagePath: snapshot.storagePath,
        metadata: snapshot.metadata,
      });
      const normalized = await normalizeSnapshot(snapshot, adapter);
      const previousKeys = await repository.getSourceRecordHashes(source.id);
      const knownEntityKeys = new Set(
        (await repository.listEntitySourceKeys?.(payload.gameId)) ?? [],
      );
      const validation = validateImport(
        normalized.records,
        normalized.parseIssues,
        previousKeys,
        knownEntityKeys,
      );
      const diff = computeDiff(normalized.records, previousKeys, [
        ...normalized.parseIssues,
        ...validation.errors,
        ...validation.warnings,
      ]);
      await repository.updateImportStaged({
        batchId: payload.batchId,
        sourceSnapshotId: savedSnapshot.id,
        stagedRecords: normalized.records,
        errors: validation.errors,
        warnings: [
          ...validation.warnings,
          ...inspection.warnings.map((message) => ({
            severity: "warning" as const,
            code: "inspection_warning",
            message,
          })),
        ],
        diff,
      });
      await repository.completeJob(String(job.id), "completed");
    } else if (job.type === "rebuild_search" || job.type === "validate_import") {
      // PostgreSQL indexes are maintained transactionally in the MVP. This job
      // is still persisted so readiness, retries and auditability are explicit.
      await repository.completeJob(String(job.id), "completed");
    } else if (job.type === "generate_embeddings") {
      const payload = job.payload as { gameId?: unknown; revisionId?: unknown };
      if (typeof payload.gameId !== "string" || typeof payload.revisionId !== "string")
        throw new Error("Embedding job payload is invalid");
      if (!config.embedding.modelId || !config.embedding.modelVersion || !config.llm.baseUrl) {
        console.log("Embedding model is not configured; retaining lexical search.");
        await repository.completeJob(String(job.id), "completed");
      } else {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          model: config.embedding.modelId,
          modelVersion: config.embedding.modelVersion,
          dimension: config.embedding.dimension,
          timeoutMs: config.llm.timeoutMs,
        });
        const inputs = await repository.listEmbeddingInputs(payload.gameId, payload.revisionId);
        for (let start = 0; start < inputs.length; start += 32) {
          const chunk = inputs.slice(start, start + 32);
          const vectors = await provider.embed(chunk.map((input) => input.text));
          await repository.storeEmbeddings(
            chunk.map((input, index) => ({
              ...input,
              spaceId: provider.space.id,
              model: provider.space.model,
              modelVersion: provider.space.modelVersion,
              dimension: provider.space.dimension,
              vector: vectors[index] ?? [],
            })),
          );
          if (!(await repository.heartbeatJob(String(job.id), workerId)))
            throw new Error("Embedding job lease was lost");
        }
        await repository.completeJob(String(job.id), "completed");
      }
    } else {
      await repository.completeJob(String(job.id), "failed", `Unsupported job type: ${job.type}`);
    }
  } catch (error) {
    await repository.completeJob(
      String(job.id),
      "failed",
      job.type === "parse_import"
        ? "Import worker job failed"
        : error instanceof Error
          ? error.message
          : "Job failed",
    );
    const payload = job.payload as { batchId?: unknown };
    if (
      job.type === "parse_import" &&
      typeof payload.batchId === "string" &&
      repository.markImportFailed &&
      Number(job.attempts) >= Number(job.maxAttempts ?? 3)
    ) {
      await repository.markImportFailed(payload.batchId, {
        severity: "error",
        code: "import_job_failed",
        message: "Import worker could not complete the import",
      });
    }
  }
  return true;
}

async function run(): Promise<void> {
  console.log(`Worker ${workerId} started.`);
  while (!stopping) {
    await touchWorkerHeartbeat();
    const handled = await processOne();
    await touchWorkerHeartbeat();
    if (!handled) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await pool.end();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await run();
