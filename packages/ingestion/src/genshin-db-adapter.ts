import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

export const UPSTREAM_URL = "https://github.com/theBowja/genshin-db";
export const LOCKED_COMMIT = "8b15995fa220c88a4d0d7ffe1e21b041d0b32588";
export const ADAPTER_VERSION = "genshin-db-short-facts-v1";
const exec = promisify(execFile);
const categories = ["characters", "weapons", "artifacts", "materials", "enemies"] as const;
type Category = (typeof categories)[number];
type Json = Record<string, unknown>;
export type NormalizedRecord = {
  sourceKey: string;
  recordType: "entity";
  title: string;
  entityType: string;
  metadata: Json;
  contentHash: string;
  parserVersion: string;
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const first = (o: Json, keys: string[]) => keys.map((k) => text(o[k])).find(Boolean);
export async function verifyCommit(root: string, expected = LOCKED_COMMIT): Promise<void> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  const actual = stdout.trim();
  if (actual !== expected)
    throw new Error(`upstream_commit_mismatch: expected ${expected}, got ${actual}`);
}

async function rows(
  root: string,
  category: Category,
): Promise<Array<{ file: string; row: Json; fileHash: string }>> {
  const languageDir = join(root, "src", "data", "English");
  const dir = join(languageDir, category);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    throw new Error(`missing_category_directory: ${category}`);
  }
  const out: Array<{ file: string; row: Json; fileHash: string }> = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`unknown_row_shape: ${category}/${file}`);
      out.push({ file: `${category}/${file}`, row: value as Json, fileHash: hash(raw) });
    }
  }
  return out;
}

function convert(
  category: Category,
  item: { file: string; row: Json; fileHash: string },
  locale: string,
): NormalizedRecord {
  const id = first(item.row, ["id", "key", "name"]) ?? "missing";
  const name = first(item.row, ["name", "title", "key"]);
  if (!name || id === "missing") throw new Error(`required_key_missing: ${item.file}`);
  const props: Json = {};
  for (const key of [
    "rarity",
    "element",
    "weaponType",
    "type",
    "category",
    "drop",
    "drops",
    "materials",
    "ascensionMaterials",
  ]) {
    const value = item.row[key];
    if (typeof value === "string" || typeof value === "number" || Array.isArray(value))
      props[key] = value;
  }
  const payload = {
    // Filenames carry variant suffixes (for example -01) that are meaningful in
    // the upstream snapshot; names alone are not unique across those files.
    sourceKey: `genshin-db/${category}/${basename(item.file, ".json")}`,
    title: name,
    entityType:
      category === "characters"
        ? "character"
        : category === "enemies"
          ? "concept"
          : category === "materials" || category === "weapons" || category === "artifacts"
            ? "item"
            : "concept",
    props,
  };
  return {
    ...payload,
    recordType: "entity",
    metadata: {
      upstreamSource: UPSTREAM_URL,
      upstreamCommit: LOCKED_COMMIT,
      upstreamUrl: `${UPSTREAM_URL}/tree/${LOCKED_COMMIT}`,
      sourceKind: "community_derived",
      codeLicense: "MIT",
      contentRights: "HoYoverse/third-party",
      locale,
      sourceFile: item.file,
      sourceFileHash: item.fileHash,
      recordHash: hash(payload),
    },
    contentHash: hash(payload),
    parserVersion: ADAPTER_VERSION,
  };
}

export async function convertSnapshot(
  root: string,
  opts: { locale?: string; samplePerCategory?: number } = {},
) {
  await verifyCommit(root);
  const locale = opts.locale ?? "en";
  const records: NormalizedRecord[] = [];
  const failures: Array<{ category: string; reason: string }> = [];
  const counts: Json = {};
  for (const category of categories) {
    const source = await rows(root, category);
    const selected = opts.samplePerCategory ? source.slice(0, opts.samplePerCategory) : source;
    counts[category] = selected.length;
    for (const item of selected) {
      try {
        records.push(convert(category, item, locale));
      } catch (e) {
        failures.push({ category, reason: String(e) });
      }
    }
  }
  return {
    records,
    manifest: {
      schemaVersion: 1,
      adapterVersion: ADAPTER_VERSION,
      upstream: { url: UPSTREAM_URL, commit: LOCKED_COMMIT, retrievedAt: new Date().toISOString() },
      locale,
      sourceKind: "community_derived",
      codeLicense: "MIT",
      contentRights: "HoYoverse/third-party",
      counts,
      converted: records.length,
      failures,
    },
  };
}

export async function writeSnapshot(
  result: Awaited<ReturnType<typeof convertSnapshot>>,
  output: string,
) {
  await mkdir(resolve(output), { recursive: true });
  await writeFile(join(output, "records.json"), JSON.stringify(result.records, null, 2) + "\n");
  await writeFile(join(output, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");
}
