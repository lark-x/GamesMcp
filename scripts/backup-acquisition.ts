import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "../packages/config/src/index.ts";
import { isPathInside, runStoragePreflight } from "./check-data-storage.js";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCALE = "zh-CN";
const MAX_DUMP_BYTES = 1024 * 1024 * 1024;

type BackupManifest = {
  createdAt: string;
  databaseUrl: string;
  dumpPath: string;
  dumpSha256: string;
  dumpBytes: number;
  sourceManifestPath: string;
  sourceManifestSha256: string;
  sourceManifestBytes: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
};

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readFileWithHash(path: string): Promise<{ bytes: Buffer; sha256: string }> {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(
      process.platform === "win32" ? "where.exe" : "command",
      [...(process.platform === "win32" ? [command] : ["-v", command])],
      { encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

async function writeHostDump(databaseUrl: string): Promise<Buffer> {
  const result = await execFileAsync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--dbname", databaseUrl],
    { encoding: "buffer", maxBuffer: MAX_DUMP_BYTES },
  );
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
}

async function writeComposeDump(): Promise<Buffer> {
  const result = await execFileAsync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "gip",
      "-d",
      "gip",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ],
    { encoding: "buffer", maxBuffer: MAX_DUMP_BYTES },
  );
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
}

async function checkoutCommit(upstreamDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: upstreamDir,
      encoding: "utf8",
    });
    const commit = stdout.trim();
    return commit || undefined;
  } catch {
    return undefined;
  }
}

async function resolveOutputRoot(dataDir: string): Promise<string> {
  const explicit = process.env.ANIME_GAME_OUTPUT_DIR?.trim();
  if (explicit) return resolve(explicit);

  const locale = process.env.ANIME_GAME_LOCALE?.trim() || DEFAULT_LOCALE;
  const upstreamDir = resolve(
    process.env.ANIME_GAME_DATA_DIR ?? join(dataDir, "upstream", "AnimeGameData"),
  );
  const commit = process.env.ANIME_GAME_COMMIT?.trim() || (await checkoutCommit(upstreamDir));
  const parent = resolve(dataDir, "imports", "normalized", "anime-game-data");
  if (commit) return resolve(parent, commit, locale);

  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = (await readdir(parent, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
  } catch {
    throw new Error(
      `Could not determine AnimeGameData snapshot under ${parent}; set ANIME_GAME_OUTPUT_DIR explicitly`,
    );
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    const candidate = resolve(parent, entry.name, locale);
    try {
      await access(resolve(candidate, "manifest.json"));
      candidates.push(candidate);
    } catch {
      // Ignore incomplete snapshot directories.
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  throw new Error(
    `Could not uniquely determine AnimeGameData snapshot under ${parent}; set ANIME_GAME_OUTPUT_DIR or ANIME_GAME_COMMIT explicitly`,
  );
}

async function createBackup(): Promise<BackupManifest> {
  const config = loadConfig();
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));

  const outputRoot = await resolveOutputRoot(config.dataDir);
  if (!isPathInside(outputRoot, preflight.config.dataRoot))
    throw new Error(`AnimeGameData Manifest must stay under the external data root: ${outputRoot}`);
  const sourceManifestAbsolute = resolve(outputRoot, "manifest.json");
  const sourceManifest = await readFileWithHash(sourceManifestAbsolute);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const backupDirectory = resolve(config.dataDir, "backups", timestamp);
  await mkdir(backupDirectory, { recursive: true });

  const dumpPath = join(backupDirectory, "gip.dump");
  const dump = (await commandExists("pg_dump"))
    ? await writeHostDump(config.databaseUrl)
    : await writeComposeDump();
  if (!dump.length) throw new Error("pg_dump produced an empty backup");
  await writeFile(dumpPath, dump, { flag: "wx" });

  const manifestCopyPath = join(backupDirectory, "manifest.json");
  await copyFile(sourceManifestAbsolute, manifestCopyPath);
  const relativeDumpPath = relative(config.dataDir, dumpPath);
  const relativeManifestPath = relative(config.dataDir, manifestCopyPath);
  const backupManifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    databaseUrl: config.databaseUrl.replace(/:\/\/([^:@/]+):[^@/]+@/, "://$1:[redacted]@"),
    dumpPath: relativeDumpPath,
    dumpSha256: sha256(dump),
    dumpBytes: dump.length,
    sourceManifestPath: relative(process.cwd(), sourceManifestAbsolute),
    sourceManifestSha256: sourceManifest.sha256,
    sourceManifestBytes: sourceManifest.bytes.length,
    files: [
      { path: relativeDumpPath, sha256: sha256(dump), bytes: dump.length },
      {
        path: relativeManifestPath,
        sha256: sourceManifest.sha256,
        bytes: sourceManifest.bytes.length,
      },
    ],
  };
  await writeFile(
    join(backupDirectory, "backup-manifest.json"),
    `${JSON.stringify(backupManifest, null, 2)}\n`,
    "utf8",
  );
  return backupManifest;
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedScript === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await createBackup();
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(
      `Acquisition backup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

export { createBackup, resolveOutputRoot };
