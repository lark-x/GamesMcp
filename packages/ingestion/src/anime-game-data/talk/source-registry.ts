import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { parseNpcGroupRelations } from "./npc-group-parser.js";
import { parseTalkAsset, scanTalkAssetMetadata } from "./asset-parser.js";
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
    else if (extname(entry.name).toLowerCase() === ".json")
      result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result;
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => run()),
  );
  return output;
}

export type TalkRegistryOptions = {
  /** Full-parse these kinds during phase two. Metadata is scanned for all files. */
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
    metadataByTalkId: new Map(),
    filesByStem: new Map(),
    duplicateTalkIds: [],
    npcGroupRelations: [],
    coverage: {
      totalFiles: 0,
      parsedFiles: 0,
      metadataScannedFiles: 0,
      eagerParsedByKind: {},
      lazyLoadedByKind: {},
      parsedByKind: {},
      fileCountsByKind: {},
      unknownDirectories: [],
    },
    loadAsset: async () => undefined,
    findAssets: async () => [],
    findAssetsByDialogueId: async () => [],
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return emptyRegistry();
    throw error;
  }
  const parseKinds = new Set(options.parseKinds ?? ["quest", "npc_group"]);
  // NpcGroup is a relation source and must always be available for resolution,
  // even when a caller asks for a different eager parse set.
  parseKinds.add("npc_group");
  const files: TalkSourceFile[] = relativePaths.map((relativePath) => {
    const sourceKind = sourceKindFor(relativePath);
    return {
      relativePath,
      sourceKind,
      fileStem: basename(relativePath, extname(relativePath)),
      parsed: false,
      metadataScanned: false,
    };
  });

  // Phase A: identity scan. This is intentionally independent of source kind;
  // hashed Npc filenames can still expose an embedded talk id.
  await mapLimit(files, options.concurrency ?? 32, async (file) => {
    try {
      const raw = await readFile(join(root, file.relativePath), "utf8");
      const metadata = scanTalkAssetMetadata(raw, file.relativePath, file.sourceKind);
      file.fileHash = metadata.fileHash;
      file.embeddedTalkId = metadata.talkId;
      file.schemaSignature = metadata.schemaSignature;
      file.metadataScanned = true;
    } catch {
      file.metadataScanned = true;
    }
  });

  const metadataByTalkId = new Map<string, TalkSourceFile[]>();
  for (const file of files) {
    if (!file.embeddedTalkId) continue;
    const list = metadataByTalkId.get(file.embeddedTalkId) ?? [];
    list.push(file);
    metadataByTalkId.set(file.embeddedTalkId, list);
  }

  // Phase B: full parse only for relation-bearing families. Other sources are
  // loaded on demand after an exact identity match.
  const assets = (
    await mapLimit(
      files.filter((file) => parseKinds.has(file.sourceKind)),
      options.concurrency ?? 24,
      async (file) => {
        try {
          const raw = await readFile(join(root, file.relativePath), "utf8");
          const asset = parseTalkAsset(raw, file.relativePath, file.sourceKind);
          file.fileHash = asset.fileHash;
          file.embeddedTalkId = asset.talkId ?? file.embeddedTalkId;
          file.schemaSignature = asset.schemaSignature;
          file.parsed = true;
          file.dialogueRowCount = asset.dialogueRows.length;
          return asset;
        } catch {
          return undefined;
        }
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
  const coverage: TalkSourceRegistry["coverage"] = {
    totalFiles: files.length,
    parsedFiles: 0,
    metadataScannedFiles: 0,
    eagerParsedByKind: {},
    lazyLoadedByKind: {},
    parsedByKind: {},
    fileCountsByKind: {},
    unknownDirectories: [],
  };
  for (const file of files.filter((item) => item.parsed))
    coverage.eagerParsedByKind![file.sourceKind] =
      (coverage.eagerParsedByKind![file.sourceKind] ?? 0) + 1;
  const refreshCoverage = (): void => {
    coverage.totalFiles = files.length;
    coverage.parsedFiles = files.filter((file) => file.parsed).length;
    coverage.metadataScannedFiles = files.filter((file) => file.metadataScanned).length;
    coverage.parsedByKind = {};
    coverage.lazyLoadedByKind = {};
    coverage.fileCountsByKind = {};
    for (const file of files) {
      coverage.fileCountsByKind[file.sourceKind] =
        (coverage.fileCountsByKind[file.sourceKind] ?? 0) + 1;
      if (file.parsed)
        coverage.parsedByKind[file.sourceKind] = (coverage.parsedByKind[file.sourceKind] ?? 0) + 1;
    }
    coverage.unknownDirectories = [
      ...new Set(
        files
          .filter((file) => file.sourceKind === "unknown")
          .map((file) => file.relativePath.split("/")[2] ?? ""),
      ),
    ].sort();
    for (const [kind, count] of Object.entries(coverage.parsedByKind)) {
      const eager = coverage.eagerParsedByKind?.[kind] ?? 0;
      coverage.lazyLoadedByKind![kind] = Math.max(0, count - eager);
    }
  };
  refreshCoverage();
  const npcGroupRelations: TalkSourceRegistry["npcGroupRelations"] = [];
  for (const asset of assets.filter((item) => item.sourceKind === "npc_group")) {
    try {
      const raw = await readFile(join(root, asset.relativePath), "utf8");
      const value = JSON.parse(raw) as Record<string, unknown>;
      npcGroupRelations.push(...parseNpcGroupRelations(value, asset.relativePath, asset.fileHash));
    } catch {
      // The source file remains represented in the audit registry; an unreadable
      // relation file simply contributes no inferred edge.
    }
  }
  const duplicateTalkIds = [...metadataByTalkId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([talkId, list]) => ({
      talkId,
      sourceFiles: list.map((file) => file.relativePath).sort(),
    }));
  const lazyAssets = new Map<string, Promise<TalkAssetRecord | undefined>>();
  const loadAsset = async (relativePath: string): Promise<TalkAssetRecord | undefined> => {
    const existing = lazyAssets.get(relativePath);
    if (existing) return existing;
    const promise = (async () => {
      const file = files.find((item) => item.relativePath === relativePath);
      if (!file) return undefined;
      try {
        const raw = await readFile(join(root, relativePath), "utf8");
        const asset = parseTalkAsset(raw, relativePath, file.sourceKind);
        file.fileHash = asset.fileHash;
        file.embeddedTalkId = asset.talkId ?? file.embeddedTalkId;
        file.schemaSignature = asset.schemaSignature;
        file.parsed = true;
        file.dialogueRowCount = asset.dialogueRows.length;
        refreshCoverage();
        assets.push(asset);
        if (asset.talkId) {
          const list = assetsByTalkId.get(asset.talkId) ?? [];
          if (!list.some((candidate) => candidate.relativePath === asset.relativePath))
            list.push(asset);
          assetsByTalkId.set(asset.talkId, list);
        }
        return asset;
      } catch {
        return undefined;
      }
    })();
    lazyAssets.set(relativePath, promise);
    return promise;
  };
  const findAssets = async (
    talkId: string,
    sourceKind?: TalkSourceKind,
  ): Promise<TalkAssetRecord[]> => {
    const fileMatches = [
      ...(metadataByTalkId.get(talkId) ?? []),
      ...(filesByStem.get(talkId) ?? []),
    ].filter((file) => !sourceKind || file.sourceKind === sourceKind);
    const loaded = await Promise.all(
      [...new Map(fileMatches.map((file) => [file.relativePath, file])).values()].map((file) =>
        loadAsset(file.relativePath),
      ),
    );
    return [
      ...new Map(
        loaded
          .filter((asset): asset is TalkAssetRecord => Boolean(asset))
          .map((asset) => [asset.relativePath, asset]),
      ).values(),
    ];
  };
  const findAssetsByDialogueId = async (
    dialogueId: string,
    sourceKind?: TalkSourceKind,
  ): Promise<TalkAssetRecord[]> => {
    const matches = assets.filter(
      (asset) =>
        (!sourceKind || asset.sourceKind === sourceKind) &&
        (asset.rootDialogueIds.includes(dialogueId) ||
          asset.dialogueRows.some((row) => row.dialogId === dialogueId)),
    );
    return [...new Map(matches.map((asset) => [asset.relativePath, asset])).values()];
  };
  return {
    files,
    assets,
    assetsByTalkId,
    metadataByTalkId,
    filesByStem,
    duplicateTalkIds,
    npcGroupRelations,
    coverage,
    loadAsset,
    findAssets,
    findAssetsByDialogueId,
  };
}

export async function loadTalkSourceRegistry(
  root: string,
  options: TalkRegistryOptions = {},
): Promise<TalkSourceRegistry> {
  return buildTalkSourceRegistry(root, options);
}
