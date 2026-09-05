import { loadConfig } from "../packages/config/src/index.ts";
import { createDatabase, createPool, SqlKnowledgeRepository } from "../packages/database/src/index.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repo = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);

async function profileQuest() {
  const games = await repo.listGames();
  const genshin = games.find(g => g.slug === "genshin-impact" || g.slug === "genshin")!;

  const rev = await pool.query("SELECT id, revision_number FROM knowledge.dataset_revisions WHERE is_current = true");
  const revisionId = rev.rows[0].id;

  console.log("--- Profiling steps for quest/16018 ---");
  let t = performance.now();
  const docRes = await pool.query(
    "SELECT d.id, d.title, d.type, d.locale, d.body, d.metadata, ss.id as snapshot_id, s.id as source_id " +
    "FROM knowledge.documents d " +
    "JOIN knowledge.source_snapshots ss ON ss.id = d.source_snapshot_id " +
    "JOIN knowledge.sources s ON s.id = ss.source_id " +
    "WHERE d.game_id = $1 AND d.revision_id = $2 AND d.source_key = 'quest/16018/locale/zh-CN' AND d.deleted = false " +
    "LIMIT 1",
    [genshin.id, revisionId]
  );
  console.log("findDocument took:", (performance.now() - t).toFixed(2) + "ms");
  const doc = docRes.rows[0];
  if (!doc) { console.log("Doc not found"); return; }

  t = performance.now();
  const subquests = await pool.query(
    "SELECT * FROM knowledge.quest_subquests " +
    "WHERE document_id = $1 AND revision_id = $2 " +
    "ORDER BY ordinal ASC",
    [doc.id, revisionId]
  );
  console.log("subquests took:", (performance.now() - t).toFixed(2) + "ms, rows:", subquests.rowCount);

  t = performance.now();
  const countRes = await pool.query(
    "SELECT count(*)::int as count " +
    "FROM knowledge.quest_dialogue_nodes " +
    "WHERE document_id = $1 AND revision_id = $2",
    [doc.id, revisionId]
  );
  console.log("dialogue count took:", (performance.now() - t).toFixed(2) + "ms, count:", countRes.rows[0].count);

  t = performance.now();
  const nodes = await pool.query(
    "SELECT * FROM knowledge.quest_dialogue_nodes " +
    "WHERE document_id = $1 AND revision_id = $2 " +
    "ORDER BY ordinal ASC " +
    "LIMIT 101",
    [doc.id, revisionId]
  );
  console.log("dialogue nodes took:", (performance.now() - t).toFixed(2) + "ms, rows:", nodes.rowCount);

  const nodeKeys = nodes.rows.slice(0, 100).map(r => r.node_key);
  t = performance.now();
  const edges = await pool.query(
    "SELECT * FROM knowledge.quest_dialogue_edges " +
    "WHERE document_id = $1 AND revision_id = $2 AND from_node_key = ANY($3)",
    [doc.id, revisionId, nodeKeys]
  );
  console.log("dialogue edges took:", (performance.now() - t).toFixed(2) + "ms, rows:", edges.rowCount);

  const speakerKeys = [...new Set(nodes.rows.map(r => r.speaker_key).filter(Boolean))];
  t = performance.now();
  const participants = await pool.query(
    "SELECT * FROM knowledge.entities " +
    "WHERE game_id = $1 AND source_key = ANY($2)",
    [genshin.id, speakerKeys]
  );
  console.log("participants took:", (performance.now() - t).toFixed(2) + "ms, rows:", participants.rowCount);

  console.log("\n--- Profiling getStoryCatalog ---");
  t = performance.now();
  const fullDocs = await pool.query(
    "SELECT * FROM knowledge.documents " +
    "WHERE revision_id = $1 AND locale = 'zh-CN' AND source_key LIKE 'quest/%'",
    [revisionId]
  );
  console.log("SELECT * docs took:", (performance.now() - t).toFixed(2) + "ms, rows:", fullDocs.rowCount);

  t = performance.now();
  const slimDocs = await pool.query(
    "SELECT id, title, source_key, metadata, (body <> '') as has_body FROM knowledge.documents " +
    "WHERE revision_id = $1 AND locale = 'zh-CN' AND source_key LIKE 'quest/%'",
    [revisionId]
  );
  console.log("SELECT slim docs took:", (performance.now() - t).toFixed(2) + "ms, rows:", slimDocs.rowCount);

  t = performance.now();
  await repo.getStoryCatalog(genshin.id);
  console.log("Total repo.getStoryCatalog took:", (performance.now() - t).toFixed(2) + "ms");

  t = performance.now();
  await repo.getQuest(genshin.id, { questKey: "quest/16018" });
  console.log("Total repo.getQuest took:", (performance.now() - t).toFixed(2) + "ms");

  await pool.end();
}

profileQuest().catch(console.error);
