import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@gip/config";
import { createPool } from "./client.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const currentFile = fileURLToPath(import.meta.url);
const migrations = [
  resolve(dirname(currentFile), "migrations/0000_initial.sql"),
  resolve(dirname(currentFile), "migrations/0001_acquisition_verification.sql"),
  resolve(dirname(currentFile), "migrations/0002_conflict_selection.sql"),
];

try {
  for (const migration of migrations) await pool.query(await readFile(migration, "utf8"));
  console.log("Database migration complete.");
} finally {
  await pool.end();
}
