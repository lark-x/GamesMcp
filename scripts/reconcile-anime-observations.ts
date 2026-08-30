import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.js";

/**
 * Backfill the conflict index from immutable source observations. This is
 * intentionally separate from import so it can audit snapshots created by an
 * older application version without changing any source or normalized files.
 */
const config = loadConfig();
const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));

const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
try {
  const game = (await repository.listGames()).find(
    (candidate) => candidate.slug === "genshin-impact",
  );
  if (!game) throw new Error("Seed the genshin-impact game before reconciling observations");
  if (!repository.reconcileSourceObservationConflicts)
    throw new Error("Observation conflict reconciliation is not supported");
  const result = await repository.reconcileSourceObservationConflicts(game.id);
  const conflicts = await repository.listConflicts?.(game.id);
  console.log(
    JSON.stringify(
      {
        gameId: game.id,
        ...result,
        totalConflictCases: conflicts?.length ?? 0,
        openConflictCases: conflicts?.filter((conflict) => conflict.status === "open").length ?? 0,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
