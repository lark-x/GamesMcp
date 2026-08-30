import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { listMigrationUrls } from "./migrations.js";

export async function applyMigrations(client: { query: (text: string, values?: unknown[]) => Promise<{ rows?: any[] }> }) {
  const migrations = await listMigrationUrls();
  await client.query("CREATE SCHEMA IF NOT EXISTS platform");
  await client.query(`CREATE TABLE IF NOT EXISTS platform.schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query("SELECT pg_advisory_lock(hashtext('gip.schema_migrations'))");
  try {
    for (const migration of migrations) {
      const id = migration.pathname.split("/").pop()!;
      const text = await readFile(migration, "utf8");
      const checksum = createHash("sha256").update(text).digest("hex");
      const existing = await client.query("SELECT checksum FROM platform.schema_migrations WHERE id = $1", [id]);
      if (existing.rows?.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration ${id} was modified after it was applied`);
        continue;
      }
      await client.query("BEGIN");
      try { await client.query(text); await client.query("INSERT INTO platform.schema_migrations (id, checksum) VALUES ($1, $2)", [id, checksum]); await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('gip.schema_migrations'))"); }
}
