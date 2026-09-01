import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPool } from "../packages/database/src/client.ts";

const allowedScripts = new Set([
  "scripts/test-database.ts",
  "scripts/test-search-core.ts",
  "scripts/test-performance.ts",
  "scripts/test-acquisition-review.ts",
  "scripts/test-backup-gate.ts",
  "scripts/test-release-candidate-flow.ts",
]);
const script = process.argv[2]?.replaceAll("\\", "/");
if (!script || !allowedScripts.has(script))
  throw new Error(`Expected one disposable test script: ${[...allowedScripts].join(", ")}`);

if (!process.env.DATABASE_URL && existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required to create a disposable test database");

const databaseName = `gip_test_${randomBytes(8).toString("hex")}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const admin = createPool(sourceUrl);

function runTest() {
  return new Promise<number>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(),
      env: { ...process.env, GIP_DB_TEST_URL: testUrl.toString() },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolveResult(code ?? 1));
  });
}

let exitCode = 1;
try {
  await admin.query(`create database "${databaseName}"`);
  exitCode = await runTest();
} finally {
  await admin
    .query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName],
    )
    .catch(() => undefined);
  await admin.query(`drop database if exists "${databaseName}"`).catch(() => undefined);
  await admin.end();
}
process.exitCode = exitCode;
