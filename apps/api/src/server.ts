import { loadConfig } from "@gip/config";
import { createDatabase, createPool, SqlKnowledgeRepository } from "@gip/database";
import { startApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);

const app = await startApp({ repository, config });
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await pool.end();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
