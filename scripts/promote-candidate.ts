import { loadConfig } from "../packages/config/src/index.ts";
import { createDatabase, createPool, SqlKnowledgeRepository } from "../packages/database/src/index.ts";

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);

  try {
    const candidateId = "9114ed40-d185-4863-97b0-707160141586";
    const buildId = "03ff75ba-d99a-4b68-9330-8a6a52750d68";

    console.log(`Fetching candidate ${candidateId}...`);
    const candidate = await repository.getReleaseCandidate(candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} not found`);
    }
    console.log(`Candidate status: ${candidate.status}, currentBuildId: ${candidate.currentBuildId}`);

    const build = await repository.getReleaseCandidateBuild(buildId);
    if (!build) {
      throw new Error(`Build ${buildId} not found`);
    }
    console.log(`Build status: indexStatus=${build.indexStatus}, checksum=${build.contentChecksum}, records=${build.normalizedRecords.length}`);

    const readiness = await repository.getReleaseCandidateReadiness(candidateId);
    console.log(`Candidate readiness:`, readiness);

    const res = await pool.query(
      `SELECT id FROM knowledge.dataset_revisions WHERE activation_candidate_id = $1 AND activation_build_id = $2 AND lifecycle_status = 'preparing' LIMIT 1`,
      [candidateId, buildId],
    );

    let preparingRevisionId: string;
    if (res.rows.length > 0) {
      console.log(`Found existing preparing revision: ${res.rows[0].id}`);
      preparingRevisionId = res.rows[0].id;
    } else {
      await pool.query(
        `UPDATE knowledge.release_candidates SET promotion_idempotency_key = NULL, status = 'preview_ready' WHERE id = $1`,
        [candidateId],
      );

      console.log("Calling promoteReleaseCandidate...");
      const preparingRevision = await repository.promoteReleaseCandidate({
        candidateId,
        buildId,
        contentChecksum: build.contentChecksum,
        releaseNote: "P0 Archive Correctness Rebuild - AnimeGameData 7.0.0",
        idempotencyKey: `promote-p0-${Date.now()}`,
      });
      console.log(`Preparing revision created: ${preparingRevision.id}, status: ${preparingRevision.lifecycleStatus}`);
      preparingRevisionId = preparingRevision.id;
    }

    console.log("Materializing revision read models...");
    await repository.materializeRevision(preparingRevisionId);
    console.log("Setting revision index status to ready...");
    await repository.setRevisionIndexStatus(preparingRevisionId, "ready");

    console.log("Finalizing activation...");
    const activeRevision = await repository.finalizeActivation({
      revisionId: preparingRevisionId,
      candidateId,
      buildId,
      contentChecksum: build.contentChecksum,
    });

    console.log(`[SUCCESS] Revision ${activeRevision.id} is now published and current!`);
    console.log(`Lifecycle status: ${activeRevision.lifecycleStatus}, isCurrent: ${activeRevision.isCurrent}`);
  } finally {
    await pool.end();
  }
}

void main();
