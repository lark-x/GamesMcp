import { loadConfig } from "@gip/config";
import { createPool } from "./client.js";
import { applyMigrations } from "./migration-runner.js";

const pool = createPool(loadConfig().databaseUrl);
try {
  await applyMigrations(pool);
  console.log("Database migration complete.");
} finally {
  await pool.end();
}
