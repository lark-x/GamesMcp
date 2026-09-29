import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const DIST_DIR = join(ROOT_DIR, "dist-runtime");
const RUNTIME_PACKAGE_DIR = join(DIST_DIR, "gip-macos-runtime");

interface TableDef {
  schema: string;
  name: string;
  condition: string;
}

const activeRevsList = execSync(
  `docker exec gamesmcp-postgres-1 psql -U gip -d gip -t -A -c "SELECT id FROM knowledge.dataset_revisions WHERE is_current = true;"`,
  { encoding: "utf8" }
).trim().split("\n").map((s) => s.trim()).filter(Boolean);
const ACTIVE_REV = activeRevsList.map((id) => `'${id}'`).join(", ");

const activeManifestList = execSync(
  `docker exec gamesmcp-postgres-1 psql -U gip -d gip -t -A -c "SELECT manifest_id FROM knowledge.dataset_revisions WHERE is_current = true;"`,
  { encoding: "utf8" }
).trim().split("\n").map((s) => s.trim()).filter(Boolean);
const ACTIVE_MANIFEST = activeManifestList.map((id) => `'${id}'`).join(", ");

const ACTIVE_HASH = `SELECT content_hash FROM knowledge.revision_quest_content_bindings WHERE revision_id IN (${ACTIVE_REV})`;
const ACTIVE_SEG = `SELECT id FROM knowledge.quest_content_segments WHERE content_hash IN (${ACTIVE_HASH})`;

const EXPORT_TABLES: TableDef[] = [
  // 1. platform
  { schema: "platform", name: "games", condition: "true" },
  { schema: "platform", name: "game_capabilities", condition: "true" },
  { schema: "platform", name: "schema_migrations", condition: "true" },

  // 2. metadata
  { schema: "knowledge", name: "sources", condition: "true" },
  { schema: "knowledge", name: "source_snapshots", condition: "true" },
  { schema: "knowledge", name: "dataset_manifests", condition: "true" },
  { schema: "knowledge", name: "dataset_manifest_entries", condition: `manifest_id IN (${ACTIVE_MANIFEST})` },
  { schema: "knowledge", name: "dataset_revisions", condition: "true" },

  // 3. content-addressed quest content
  { schema: "knowledge", name: "revision_quest_content_bindings", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "quest_content_objects", condition: `content_hash IN (${ACTIVE_HASH})` },
  { schema: "knowledge", name: "quest_content_subquests", condition: `content_hash IN (${ACTIVE_HASH})` },
  { schema: "knowledge", name: "quest_content_segments", condition: `content_hash IN (${ACTIVE_HASH})` },
  { schema: "knowledge", name: "quest_content_dialogue_nodes", condition: `content_hash IN (${ACTIVE_HASH})` },
  { schema: "knowledge", name: "quest_content_dialogue_edges", condition: `content_hash IN (${ACTIVE_HASH})` },
  { schema: "knowledge", name: "quest_content_mentions", condition: `content_segment_id IN (${ACTIVE_SEG})` },

  // 4. revision-scoped documents and entities
  { schema: "knowledge", name: "documents", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "document_segments", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "quest_subquests", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "quest_dialogue_nodes", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "content_objects", condition: `content_hash IN (SELECT content_hash FROM knowledge.dataset_manifest_entries WHERE manifest_id IN (${ACTIVE_MANIFEST}))` },
  { schema: "knowledge", name: "entities", condition: "true" },
  { schema: "knowledge", name: "entity_aliases", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "entity_revision_materializations", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "relationships", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "text_bindings", condition: `revision_id IN (${ACTIVE_REV})` },

  // 5. Genshin specific entities
  { schema: "knowledge", name: "genshin_characters", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_weapons", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_materials", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_enemies", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_artifacts", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_artifact_sets", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_books", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_character_stories", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_voice_lines", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_achievements", condition: `revision_id IN (${ACTIVE_REV})` },
  { schema: "knowledge", name: "genshin_item_descriptions", condition: `revision_id IN (${ACTIVE_REV})` },
];

function getColumns(schema: string, table: string): string {
  const sql = `SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}' AND is_generated = 'NEVER';`;
  const result = execSync(`docker exec gamesmcp-postgres-1 psql -U gip -d gip -t -c "${sql}"`, {
    encoding: "utf8",
  });
  return result.trim();
}

async function streamCopyTable(schema: string, table: string, cols: string, condition: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fullTable = `${schema}.${table}`;
    const p1 = spawn("docker", [
      "exec",
      "gamesmcp-postgres-1",
      "psql",
      "-U",
      "gip",
      "-d",
      "gip",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `COPY (SELECT ${cols} FROM ${fullTable} WHERE ${condition}) TO STDOUT BINARY`,
    ]);

    const p2 = spawn("docker", [
      "exec",
      "-i",
      "gamesmcp-postgres-1",
      "psql",
      "-U",
      "gip",
      "-d",
      "gip_slim",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SET session_replication_role = 'replica'; COPY ${fullTable} (${cols}) FROM STDIN BINARY`,
    ]);

    p1.stdout.pipe(p2.stdin);

    p1.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`  [source ${fullTable}]: ${msg}`);
    });
    p2.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes("word is too long to be indexed")) {
        console.error(`  [target ${fullTable}]: ${msg}`);
      }
    });

    p2.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed copying ${fullTable}, p2 exit code: ${code}`));
    });
    p1.on("error", reject);
    p2.on("error", reject);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  console.log("==================================================================");
  console.log(" GamesMcp Standalone Runtime Archive Exporter");
  console.log("==================================================================");

  const dumpTarget = join(DIST_DIR, "database.dump");
  const skipDump = (process.argv.includes("--skip-dump") || process.env.SKIP_DUMP === "1") && existsSync(dumpTarget) && statSync(dumpTarget).size > 0;

  if (skipDump) {
    console.log(`\n[INFO] Skipping database dump recreation (--skip-dump requested).`);
    console.log(`Using existing dump: ${dumpTarget} (${formatBytes(statSync(dumpTarget).size)})`);
  } else {
    // 1. Database Creation
    console.log("\n==> Step 1: Initializing fresh slim database (gip_slim)...");
    execSync('docker exec gamesmcp-postgres-1 psql -U gip -d postgres -c "DROP DATABASE IF EXISTS gip_slim WITH (FORCE);"', { stdio: "inherit" });
    execSync('docker exec gamesmcp-postgres-1 psql -U gip -d postgres -c "CREATE DATABASE gip_slim;"', { stdio: "inherit" });

    console.log("==> Step 2: Applying schema DDL...");
    execSync('docker exec gamesmcp-postgres-1 sh -c "pg_dump -U gip -d gip -s | psql -U gip -d gip_slim -q"', { stdio: "inherit" });

    // 2. Stream Data
    console.log("\n==> Step 3: Fast-streaming active data across tables via binary COPY pipe...");
    console.time("Total binary stream copy time");

    for (const t of EXPORT_TABLES) {
      const cols = getColumns(t.schema, t.name);
      if (!cols) {
        console.warn(`  [SKIP] ${t.schema}.${t.name}: no columns found`);
        continue;
      }
      const tStart = Date.now();
      process.stdout.write(`  -> Copying ${t.schema}.${t.name}... `);
      await streamCopyTable(t.schema, t.name, cols, t.condition);
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);
      console.log(`done (${elapsed}s)`);
    }
    console.timeEnd("Total binary stream copy time");

    // 3. Verification
    console.log("\n==> Step 4: Verifying slim database row counts...");
    const statsSql = `
      SELECT count(*) as active_dialogue_nodes FROM knowledge.quest_content_dialogue_nodes;
      SELECT count(*) as active_characters FROM knowledge.genshin_characters;
      SELECT count(*) as active_documents FROM knowledge.documents;
      SELECT count(*) as active_segments FROM knowledge.document_segments;
    `;
    execSync(`docker exec gamesmcp-postgres-1 psql -U gip -d gip_slim -c "${statsSql}"`, { stdio: "inherit" });

    // 4. Dump database
    console.log("\n==> Step 5: Exporting slim database to compressed pg_dump archive...");
    console.time("Database dump time");
    execSync('docker exec gamesmcp-postgres-1 pg_dump -U gip -d gip_slim -Fc -f /tmp/database.dump', { stdio: "inherit" });
    console.timeEnd("Database dump time");

    console.log(`==> Copying /tmp/database.dump to ${dumpTarget}...`);
    execSync(`docker cp gamesmcp-postgres-1:/tmp/database.dump "${dumpTarget}"`, { stdio: "inherit" });

    const dumpSize = statSync(dumpTarget).size;
    console.log(`[SUCCESS] Database dump generated: ${formatBytes(dumpSize)}`);

    // 5. Cleanup gip_slim
    console.log("==> Step 6: Cleaning up temporary gip_slim database...");
    execSync('docker exec gamesmcp-postgres-1 psql -U gip -d postgres -c "DROP DATABASE IF EXISTS gip_slim WITH (FORCE);"', { stdio: "inherit" });
    execSync('docker exec gamesmcp-postgres-1 rm -f /tmp/database.dump', { stdio: "inherit" });
  }

  // 6. Assemble macOS Runtime Package
  console.log("\n==> Step 7: Assembling standalone macOS runtime bundle...");
  rmSync(RUNTIME_PACKAGE_DIR, { recursive: true, force: true });
  mkdirSync(RUNTIME_PACKAGE_DIR, { recursive: true });

  const dumpSize = statSync(dumpTarget).size;

  // Dump & configs
  cpSync(dumpTarget, join(RUNTIME_PACKAGE_DIR, "database.dump"));
  cpSync(join(ROOT_DIR, "docker/docker-compose.runtime.yml"), join(RUNTIME_PACKAGE_DIR, "docker-compose.runtime.yml"));
  cpSync(join(ROOT_DIR, "docker/Dockerfile"), join(RUNTIME_PACKAGE_DIR, "Dockerfile"));
  cpSync(join(ROOT_DIR, ".env.runtime"), join(RUNTIME_PACKAGE_DIR, ".env.runtime"));
  cpSync(join(ROOT_DIR, "scripts/macos-deploy-wrapper.sh"), join(RUNTIME_PACKAGE_DIR, "deploy.sh"));
  cpSync(join(ROOT_DIR, "scripts/macos-deploy-native.sh"), join(RUNTIME_PACKAGE_DIR, "deploy-native.sh"));
  cpSync(join(ROOT_DIR, "scripts/macos-deploy.sh"), join(RUNTIME_PACKAGE_DIR, "deploy-docker.sh"));
  cpSync(join(ROOT_DIR, "scripts/macos-stop-native.sh"), join(RUNTIME_PACKAGE_DIR, "stop.sh"));
  cpSync(join(ROOT_DIR, "scripts/macos-status.sh"), join(RUNTIME_PACKAGE_DIR, "status.sh"));
  cpSync(join(ROOT_DIR, "scripts/README-MACOS.md"), join(RUNTIME_PACKAGE_DIR, "README.md"));

  // Workspace manifest files
  cpSync(join(ROOT_DIR, "package.json"), join(RUNTIME_PACKAGE_DIR, "package.json"));
  cpSync(join(ROOT_DIR, "pnpm-lock.yaml"), join(RUNTIME_PACKAGE_DIR, "pnpm-lock.yaml"));
  cpSync(join(ROOT_DIR, "pnpm-workspace.yaml"), join(RUNTIME_PACKAGE_DIR, "pnpm-workspace.yaml"));
  cpSync(join(ROOT_DIR, "tsconfig.base.json"), join(RUNTIME_PACKAGE_DIR, "tsconfig.base.json"));

  const copyFilter = (src: string) => {
    const norm = src.replace(/\\/g, "/");
    return (
      !norm.includes("/node_modules") &&
      !norm.includes("/dist") &&
      !norm.includes("/.turbo") &&
      !norm.endsWith(".log") &&
      !norm.endsWith(".tsbuildinfo")
    );
  };

  // Placeholders for non-mcp apps to ensure pnpm install succeeds under frozen lockfile in Docker
  for (const app of ["api", "web", "worker"]) {
    mkdirSync(join(RUNTIME_PACKAGE_DIR, "apps", app), { recursive: true });
    cpSync(join(ROOT_DIR, "apps", app, "package.json"), join(RUNTIME_PACKAGE_DIR, "apps", app, "package.json"));
  }

  // All packages in packages/
  const packagesToCopy = [
    "config",
    "contracts",
    "database",
    "domain",
    "ingestion",
    "providers",
    "qa",
    "retrieval",
    "search",
  ];
  for (const pkg of packagesToCopy) {
    const pkgDir = join(ROOT_DIR, "packages", pkg);
    if (existsSync(pkgDir)) {
      cpSync(pkgDir, join(RUNTIME_PACKAGE_DIR, "packages", pkg), {
        recursive: true,
        filter: copyFilter,
      });
    }
  }

  // Apps needed for MCP
  cpSync(join(ROOT_DIR, "apps/mcp-server"), join(RUNTIME_PACKAGE_DIR, "apps/mcp-server"), {
    recursive: true,
    filter: copyFilter,
  });

  // 7. Compress into .tar.gz
  console.log("==> Step 8: Creating final gip-macos-runtime.tar.gz archive...");
  const tarballPath = join(DIST_DIR, "gip-macos-runtime.tar.gz");
  if (existsSync(tarballPath)) rmSync(tarballPath);

  execSync(`tar -czf "${tarballPath}" -C "${DIST_DIR}" gip-macos-runtime`, { stdio: "inherit" });
  const tarballSize = statSync(tarballPath).size;

  console.log("\n==================================================================");
  console.log(` [COMPLETE] macOS Runtime Bundle Ready!`);
  console.log(` Archive:  ${tarballPath}`);
  console.log(` Size:     ${formatBytes(tarballSize)} (Database dump: ${formatBytes(dumpSize)})`);
  console.log("==================================================================");
  console.log("To deploy on macOS:");
  console.log("  1. Copy dist-runtime/gip-macos-runtime.tar.gz to your Mac");
  console.log("  2. tar -xzf gip-macos-runtime.tar.gz && cd gip-macos-runtime");
  console.log("  3. ./deploy.sh");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]:", err);
  process.exit(1);
});
