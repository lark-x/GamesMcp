import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";

async function main() {
  const revisionId = process.argv
    .slice(2)
    .find((value) => value.startsWith("--revision="))
    ?.slice("--revision=".length);
  if (!revisionId) throw new Error("Missing --revision=<revision-id>");

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
  try {
    console.log(`Repairing published revision ${revisionId} from its immutable manifest...`);
    await repository.repairRevisionMaterialization(revisionId);
    console.log(`[SUCCESS] Revision ${revisionId} read models were rebuilt atomically.`);
  } finally {
    await pool.end();
  }
}

void main();
