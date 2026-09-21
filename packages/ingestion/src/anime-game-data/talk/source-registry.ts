import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { parseNpcGroupRelations } from "./npc-group-parser.js";
import { parseTalkAsset, parseTalkAssetValue } from "./asset-parser.js";
import type {
  TalkAssetRecord,
  TalkSourceFile,
  TalkSourceKind,
  TalkSourceRegistry,
} from "./types.js";

const directoryKinds: Record<string, TalkSourceKind> = {
  Activity: "activity",
  ActivityGroup: "activity",
  Blossom: "activity",
  BlossomGroup: "activity",
  Coop: "coop",
  Cutscene: "storyboard",
  FreeGroup: "free_group",
  Gadget: "gadget",
  GadgetGroup: "gadget",
  Npc: "npc",
  NpcGroup: "npc_group",
  NpcOther: "npc_other",
  Quest: "quest",
  Storyboard: "storyboard",
  StoryboardGroup: "storyboard",
};

function sourceKindFor(relativePath: string): TalkSourceKind {
  const directory = relativePath.split(/[\\/]/u)[2] ?? "";
  return directoryKinds[directory] ?? "unknown";
}

async function walk(directory: string, root: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path, root)));
    else if (extname(entry.name).toLowerCase() === ".json") result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result;
}

async function mapLimit<T, U>(items: T[], limit: number, worker: (item: T) => Promise<U>): Promise<U[]> {
  const output = new Array<U>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => run()));
  return output;
}

export type TalkRegistryOptions = {
  parseKinds?: TalkSourceKind[];
  concurrency?: number;
};

function emptyRegistry(): TalkSourceRegistry {
  const files: TalkSourceFile[] = [];
  const assets: TalkAssetRecord[] = [];
  return {
    files,
    assets,
    assetsByTalkId: new Map(),
    filesByStem: new Map(),
    duplicateTalkIds: [],
    npcGroupRelations: [],
    coverage: {
      totalFiles: 0,
      parsedFiles: 0,
      parsedByKind: {},
      fileCountsByKind: {},
      unknownDirectories: [],
    },
    loadAsset: async () => undefined,
    findAssets: async () => [],
  };
}

export async function buildTalkSourceRegistry(
  root: string,
  options: TalkRegistryOptions = {},
): Promise<TalkSourceRegistry> {
  const talkRoot = join(root, "BinOutput", "Talk");
  let relativePaths: string[];
  try {
    relativePaths = await walk(talkRoot, root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyRegistry();
    throw error;
  }
  const parseKinds = new Set(options.parseKinds ?? ["quest", "npc_group"]);
  const files: TalkSourceFile[] = relativePaths.map((relativePath) => {
    const sourceKind = sourceKindFor(relativePath);
    return {
      relativePath,
      sourceKind,
      fileStem: basename(relativePath, extname(relativePath)),
      parsed: parseKinds.has(sourceKind),
    };
  });
  const assets = (
    await mapLimit(
      files.filter((file) => file.parsed),
      options.concurrency ?? 24,
      async (file) => {
        const raw = await readFile(join(root, file.relativePath), "utf8");
        file.fileHash = createHash("sha256").update(raw).digest("hex");
        const asset = parseTalkAsset(raw, file.relativePath, file.sourceKind);
        file.dialogueRowCount = asset.dialogueRows.length;
        return asset;
      },
    )
  ).filter((asset): asset is TalkAssetRecord => Boolean(asset));
  const assetsByTalkId = new Map<string, TalkAssetRecord[]>();
  for (const asset of assets) {
    if (!asset.talkId) continue;
    const list = assetsByTalkId.get(asset.talkId) ?? [];
    list.push(asset);
    assetsByTalkId.set(asset.talkId, list);
  }
  const filesByStem = new Map<string, TalkSourceFile[]>();
  for (const file of files) {
    const list = filesByStem.get(file.fileStem) ?? [];
    list.push(file);
    filesByStem.set(file.fileStem, list);
  }
  const npcGroupRelations: TalkSourceRegistry["npcGroupRelations"] = [];
  for (const asset of assets.filter((item) => item.sourceKind === "npc_group")) {
    const raw = await readFile(join(root, asset.relativePath), "utf8");
    const value = JSON.parse(raw) as Record<string, unknown>;
    npcGroupRelations.push(...parseNpcGroupRelations(value, asset.relativePath, asset.fileHash));
  }
  const duplicateTalkIds = [...assetsByTalkId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([talkId, list]) => ({ talkId, sourceFiles: list.map((asset) => asset.relativePath).sort() }));
  const fileCountsByKind: Record<string, number> = {};
  const parsedByKind: Record<string, number> = {};
  for (const file of files) {
    fileCountsByKind[file.sourceKind] = (fileCountsByKind[file.sourceKind] ?? 0) + 1;
    if (file.parsed) parsedByKind[file.sourceKind] = (parsedByKind[file.sourceKind] ?? 0) + 1;
  }
  const unknownDirectories = [...new Set(
    files.filter((file) => file.sourceKind === "unknown").map((file) => file.relativePath.split("/")[1] ?? ""),
  )].sort();
  const lazyAssets = new Map<string, Promise<TalkAssetRecord | undefined>>();
  const loadAsset = async (relativePath: string): Promise<TalkAssetRecord | undefined> => {
    const existing = lazyAssets.get(relativePath);
    if (existing) return existing;
    const promise = (async () => {
      const file = files.find((item) => item.relativePath === relativePath);
      if (!file) return undefined;
      const raw = await readFile(join(root, relativePath), "utf8");
      const hash = createHash("sha256").update(raw).digest("hex");
      file.fileHash = hash;
      file.parsed = true;
      const asset = parseTalkAsset(raw, relativePath, file.sourceKind);
      file.dialogueRowCount = asset.dialogueRows.length;
      assets.push(asset);
      if (asset.talkId) {
        const list = assetsByTalkId.get(asset.talkId) ?? [];
        if (!list.some((candidate) => candidate.relativePath === asset.relativePath)) list.push(asset);
        assetsByTalkId.set(asset.talkId, list);
      }
      return asset;
    })();
    lazyAssets.set(relativePath, promise);
    return promise;
  };
  const findAssets = async (talkId: string, sourceKind?: TalkSourceKind): Promise<TalkAssetRecord[]> => {
    const direct = (assetsByTalkId.get(talkId) ?? []).filter(
      (asset) => !sourceKind || asset.sourceKind === sourceKind,
    );
    if (direct.length) return direct;
    const pathMatches = files.filter(
      (file) => file.fileStem === talkId && (!sourceKind || file.sourceKind === sourceKind),
    );
    const loaded = await Promise.all(pathMatches.map((file) => loadAsset(file.relativePath)));
    return loaded.filter((asset): asset is TalkAssetRecord => Boolean(asset));
  };
  return {
    files,
    assets,
    assetsByTalkId,
    filesByStem,
    duplicateTalkIds,
    npcGroupRelations,
    coverage: {
      totalFiles: files.length,
      parsedFiles: files.filter((file) => file.parsed).length,
      parsedByKind,
      fileCountsByKind,
      unknownDirectories,
    },
    loadAsset,
    findAssets,
  };
}

export async function loadTalkSourceRegistry(
  root: string,
  options: TalkRegistryOptions = {},
): Promise<TalkSourceRegistry> {
  return buildTalkSourceRegistry(root, options);
}
