import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
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
  metadataCachePath?: string;
  /** Exact dialogue ids required by TalkExcel fallback, indexed across every source family. */
  dialogueIdsToIndex?: Iterable<string>;
};

type MetadataCacheEntry = {
  size: number;
  mtimeMs: number;
  fileHash?: string;
  embeddedTalkId?: string;
  schemaSignature?: string;
  dialogueIds?: string[];
};

type MetadataCache = {
  version: 3;
  root: string;
  dialogueIndexFingerprint: string;
  files: Record<string, MetadataCacheEntry>;
};

function emptyRegistry(): TalkSourceRegistry {
  const files: TalkSourceFile[] = [];
  const assets: TalkAssetRecord[] = [];
  return {
    files,
    assets,
    assetsByTalkId: new Map(),
    assetsByDialogueId: new Map(),
    metadataByTalkId: new Map(),
    filesByStem: new Map(),
    duplicateTalkIds: [],
    npcGroupRelations: [],
    coverage: {
      totalFiles: 0,
      parsedFiles: 0,
      metadataScannedFiles: 0,
      metadataCacheHits: 0,
      eagerParsedByKind: {},
      lazyLoadedByKind: {},
      parsedByKind: {},
      fileCountsByKind: {},
      unknownDirectories: [],
    },
    loadAsset: async () => undefined,
    findAssets: async () => [],
    findAssetsByDialogueId: async () => [],
    releaseLoadedAssets: () => undefined,
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
  const parseKinds = new Set(options.parseKinds ?? []);
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

  const rootKey = createHash("sha1").update(root).digest("hex").slice(0, 12);
  const dialogueIdsToIndex = new Set(options.dialogueIdsToIndex ?? []);
  const dialogueIndexFingerprint = createHash("sha1")
    .update([...dialogueIdsToIndex].sort().join("\n"))
    .digest("hex");
  const metadataCachePath =
    options.metadataCachePath ??
    join(process.cwd(), "data", "generated", "cache", `talk-metadata-${rootKey}.json`);
  let metadataCache: MetadataCache = {
    version: 3,
    root,
    dialogueIndexFingerprint,
    files: {},
  };
  try {
    const value = JSON.parse(await readFile(metadataCachePath, "utf8")) as MetadataCache;
    if (
      value.version === 3 &&
      value.root === root &&
      value.dialogueIndexFingerprint === dialogueIndexFingerprint
    )
      metadataCache = value;
  } catch {
    // A missing or stale cache is rebuilt from the source snapshot.
  }
  let metadataCacheHits = 0;

  // Phase A: identity scan. This is intentionally independent of source kind;
  // hashed Npc filenames can still expose an embedded talk id.
  await mapLimit(files, options.concurrency ?? 32, async (file) => {
    try {
      const absolutePath = join(root, file.relativePath);
      const sourceStat = await stat(absolutePath);
      const cached = metadataCache.files[file.relativePath];
      if (
        cached &&
        cached.size === sourceStat.size &&
        Math.trunc(cached.mtimeMs) === Math.trunc(sourceStat.mtimeMs)
      ) {
        file.fileHash = cached.fileHash;
        file.embeddedTalkId = cached.embeddedTalkId;
        file.schemaSignature = cached.schemaSignature;
        file.dialogueIds = cached.dialogueIds ?? [];
        file.metadataScanned = true;
        metadataCacheHits += 1;
        return;
      }
      const raw = await readFile(absolutePath, "utf8");
      const metadata = scanTalkAssetMetadata(raw, file.relativePath, file.sourceKind);
      file.fileHash = metadata.fileHash;
      file.embeddedTalkId = metadata.talkId;
      file.schemaSignature = metadata.schemaSignature;
      file.dialogueIds = Array.isArray(metadata.metadata.dialogueIds)
        ? metadata.metadata.dialogueIds.filter(
            (id): id is string => typeof id === "string" && dialogueIdsToIndex.has(id),
          )
        : [];
      file.metadataScanned = true;
      metadataCache.files[file.relativePath] = {
        size: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
        fileHash: file.fileHash,
        embeddedTalkId: file.embeddedTalkId,
        schemaSignature: file.schemaSignature,
        dialogueIds: file.dialogueIds,
      };
    } catch {
      file.metadataScanned = true;
    }
  });
  try {
    await mkdir(dirname(metadataCachePath), { recursive: true });
    await writeFile(metadataCachePath, JSON.stringify(metadataCache), "utf8");
  } catch {
    // Cache persistence is an optimization and never blocks conversion.
  }

  const metadataByTalkId = new Map<string, TalkSourceFile[]>();
  const filesByDialogueId = new Map<string, TalkSourceFile[]>();
  for (const file of files) {
    if (!file.embeddedTalkId) continue;
    const list = metadataByTalkId.get(file.embeddedTalkId) ?? [];
    list.push(file);
    metadataByTalkId.set(file.embeddedTalkId, list);
  }
  for (const file of files) {
    for (const dialogueId of file.dialogueIds ?? []) {
      const list = filesByDialogueId.get(dialogueId) ?? [];
      list.push(file);
      filesByDialogueId.set(dialogueId, list);
    }
  }

  // Phase B: full parse only for explicitly requested families. NpcGroup is
  // parsed separately as lightweight relation provenance and is never kept as
  // a dialogue asset merely because it can mention a Talk id.
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
  const assetsByDialogueId = new Map<string, TalkAssetRecord[]>();
  const indexAssetDialogueIds = (asset: TalkAssetRecord): void => {
    for (const row of asset.dialogueRows) {
      if (!dialogueIdsToIndex.has(row.dialogId)) continue;
      const list = assetsByDialogueId.get(row.dialogId) ?? [];
      if (!list.some((candidate) => candidate.relativePath === asset.relativePath))
        list.push(asset);
      assetsByDialogueId.set(row.dialogId, list);
    }
  };
  for (const asset of assets) {
    indexAssetDialogueIds(asset);
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
    metadataCacheHits,
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
  for (const file of files.filter((item) => item.sourceKind === "npc_group")) {
    try {
      const raw = await readFile(join(root, file.relativePath), "utf8");
      const value = JSON.parse(raw) as Record<string, unknown>;
      npcGroupRelations.push(
        ...parseNpcGroupRelations(value, file.relativePath, file.fileHash ?? "metadata-scan"),
      );
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
        indexAssetDialogueIds(asset);
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
    const filesToLoad = (filesByDialogueId.get(dialogueId) ?? []).filter(
      (file) => !sourceKind || file.sourceKind === sourceKind,
    );
    await Promise.all(filesToLoad.map((file) => loadAsset(file.relativePath)));
    const matches = (assetsByDialogueId.get(dialogueId) ?? []).filter(
      (asset) => !sourceKind || asset.sourceKind === sourceKind,
    );
    return [...new Map(matches.map((asset) => [asset.relativePath, asset])).values()];
  };
  const releaseLoadedAssets = (): void => {
    for (const asset of assets) {
      asset.dialogueRows = [];
      asset.rootDialogueIds = [];
      asset.referencedDialogueIds = [];
    }
    assets.length = 0;
    assetsByTalkId.clear();
    assetsByDialogueId.clear();
    lazyAssets.clear();
  };
  return {
    files,
    assets,
    assetsByTalkId,
    assetsByDialogueId,
    metadataByTalkId,
    filesByStem,
    duplicateTalkIds,
    npcGroupRelations,
    coverage,
    loadAsset,
    findAssets,
    findAssetsByDialogueId,
    releaseLoadedAssets,
  };
}

export async function loadTalkSourceRegistry(
  root: string,
  options: TalkRegistryOptions = {},
): Promise<TalkSourceRegistry> {
  return buildTalkSourceRegistry(root, options);
}
