import { createPool } from "../packages/database/src/client.ts";
import { loadConfig } from "../packages/config/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.ts";

const CONFIRMATION = "DELETE_ALL_HISTORY";
const AUDIT_CONFIRMATION = "DELETE_AUDIT_LOG";

// Business data and audit data are intentionally listed explicitly. Platform
// games/capabilities and schema_migrations survive so the instance can be
// rebuilt in place and the configured game remains selectable.
const RESET_TABLES = [
  "platform.jobs",
  "platform.worker_heartbeats",
  "platform.audit_log",
  "knowledge.embeddings",
  "knowledge.claim_entities",
  "knowledge.evidence",
  "knowledge.claims",
  "knowledge.relationships",
  "knowledge.entity_mentions",
  "knowledge.quest_dialogue_edges",
  "knowledge.quest_dialogue_nodes",
  "knowledge.quest_subquests",
  "knowledge.document_segments",
  "knowledge.documents",
  "knowledge.entities",
  "knowledge.entity_aliases",
  "knowledge.review_evidence",
  "knowledge.review_issues",
  "knowledge.candidate_patches",
  "knowledge.release_candidate_checks",
  "knowledge.release_candidate_builds",
  "knowledge.release_candidates",
  "knowledge.dataset_manifest_entries",
  "knowledge.dataset_manifests",
  "knowledge.content_objects",
  "knowledge.dataset_revisions",
  "knowledge.verification_screenshots",
  "knowledge.verification_items",
  "knowledge.verification_runs",
  "knowledge.conflict_cases",
  "knowledge.source_observations",
  "knowledge.import_batches",
  "knowledge.source_snapshots",
  "knowledge.sources",
] as const;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function printPlan() {
  console.log("历史数据重建计划（不会自动执行）");
  console.log(`将清空 ${RESET_TABLES.length} 张业务/审计表：`);
  for (const table of RESET_TABLES) console.log(`  - ${table}`);
  console.log("保留 platform.games、platform.game_capabilities 和 platform.schema_migrations。");
  console.log(
    "建议先运行 pnpm data:backup；清理审计记录还需要显式追加 --audit-confirm=DELETE_AUDIT_LOG。",
  );
}

const config = loadConfig();
if (config.nodeEnv === "production") throw new Error("Refusing to reset a production database");
if (
  arg("dry-run") !== undefined ||
  arg("confirm") !== CONFIRMATION ||
  arg("audit-confirm") !== AUDIT_CONFIRMATION
) {
  printPlan();
  if (arg("dry-run") !== undefined) process.exit(0);
  throw new Error(
    `Destructive reset requires --confirm=${CONFIRMATION} --audit-confirm=${AUDIT_CONFIRMATION}`,
  );
}

const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));

const pool = createPool(config.databaseUrl);
try {
  await pool.query("BEGIN");
  await pool.query(`TRUNCATE TABLE ${RESET_TABLES.join(", ")} CASCADE`);
  await pool.query("COMMIT");
  console.log("历史业务数据和审计记录已清空；游戏配置和数据库结构已保留。");
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
