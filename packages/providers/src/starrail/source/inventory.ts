import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const TRACKED_FAMILIES = new Set(["Config", "ExcelOutput", "Story", "TextMap"]);

export interface StarRailInventoryItem {
  path: string;
  size: number;
  hash: string;
  family: string;
  locale?: string;
  json?: {
    topLevelType: "array" | "object" | "primitive";
    rowCount: number;
  };
}

export interface StarRailSourceInventory {
  schemaVersion: 1;
  source: "turn-based-game-data";
  root: string;
  sourceRef: string;
  generatedAt: string;
  totals: {
    files: number;
    bytes: number;
  };
  items: StarRailInventoryItem[];
}

export async function buildStarRailInventory(input: {
  dataDir: string;
  sourceRef: string;
  output?: string;
}): Promise<StarRailSourceInventory> {
  const root = resolve(input.dataDir);
  const files = await walk(root);
  const items: StarRailInventoryItem[] = [];
  for (const file of files) {
    const path = relative(root, file);
    const family = familyFromPath(path);
    if (!family) continue;
    const bytes = await readFile(file);
    const entry: StarRailInventoryItem = {
      path,
      size: bytes.byteLength,
      hash: createHash("sha256").update(bytes).digest("hex"),
      family,
      locale: localeFromPath(path),
    };
    if (file.endsWith(".json")) entry.json = jsonShape(bytes);
    items.push(entry);
  }
  const inventory: StarRailSourceInventory = {
    schemaVersion: 1,
    source: "turn-based-game-data",
    root,
    sourceRef: input.sourceRef,
    generatedAt: new Date().toISOString(),
    totals: {
      files: items.length,
      bytes: items.reduce((sum, item) => sum + item.size, 0),
    },
    items: items.sort((left, right) => left.path.localeCompare(right.path)),
  };
  if (input.output) {
    await mkdir(dirname(input.output), { recursive: true });
    await writeFile(input.output, JSON.stringify(inventory, null, 2), "utf8");
  }
  return inventory;
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

function familyFromPath(path: string): string | undefined {
  return path.split(sep).find((part) => TRACKED_FAMILIES.has(part));
}

function localeFromPath(path: string): string | undefined {
  return /(CHS|CHT|CN|EN|JP|KR|DE|ES|FR|ID|PT|RU|TH|VI)/iu.exec(path)?.[1]?.toUpperCase();
}

function jsonShape(bytes: Buffer): StarRailInventoryItem["json"] {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (Array.isArray(value)) return { topLevelType: "array", rowCount: value.length };
    if (value && typeof value === "object")
      return { topLevelType: "object", rowCount: Object.keys(value).length };
    return { topLevelType: "primitive", rowCount: 1 };
  } catch {
    return undefined;
  }
}
