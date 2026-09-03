import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { IstarothManifestEntry } from "./manifest.js";

export const REQUIRED_CATEGORIES = [
  "sr_mission",
  "sr_story",
  "sr_message",
  "sr_train_visitor",
  "sr_book",
  "sr_character_story",
  "sr_voiceline",
  "sr_item_lore",
];

export interface StarRailCorpusValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestEntries: number;
  categories: Record<string, number>;
  metrics: {
    unresolvedTitles: number;
    unresolvedTitleRate: number;
    assetPollutedDocs: number;
    assetPollutionRate: number;
  };
}

export async function validateStarRailIstarothCorpus(input: {
  corpusDir: string;
  requiredCategories?: string[];
  maxDocumentBytes?: number;
  maxUnresolvedTitleRate?: number;
}): Promise<StarRailCorpusValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const corpusRoot = resolve(input.corpusDir);
  const manifestPath = resolve(corpusRoot, "manifest", "starrail.json");
  const manifest = await readJson<IstarothManifestEntry[]>(manifestPath).catch((error) => {
    errors.push(
      `manifest missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  });

  const categories: Record<string, number> = {};
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  let unresolvedTitles = 0;
  let assetPollutedDocs = 0;

  for (const entry of manifest) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    if (!entry.title?.trim()) {
      errors.push(`empty title: ${entry.relative_path}`);
    } else if (entry.title.includes("<Name unresolved>")) {
      unresolvedTitles += 1;
    }

    if (!Number.isInteger(entry.id) || entry.id < 0) {
      errors.push(`invalid id: ${entry.category}:${entry.id}`);
    }
    const idKey = `${entry.category}:${entry.id}`;
    if (seenIds.has(idKey)) {
      errors.push(`duplicate category/id: ${idKey}`);
    }
    seenIds.add(idKey);

    if (seenPaths.has(entry.relative_path)) {
      errors.push(`duplicate relative_path: ${entry.relative_path}`);
    }
    seenPaths.add(entry.relative_path);

    const absolutePath = resolve(corpusRoot, entry.relative_path);
    if (!isInside(corpusRoot, absolutePath)) {
      errors.push(`path traversal: ${entry.relative_path}`);
      continue;
    }

    const bytes = await readFile(absolutePath).catch((error) => {
      errors.push(
        `document unreadable: ${entry.relative_path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    });
    if (!bytes) continue;
    if (bytes.byteLength === 0) errors.push(`empty document: ${entry.relative_path}`);
    if (bytes.byteLength > (input.maxDocumentBytes ?? 1_000_000))
      errors.push(`oversized document: ${entry.relative_path}`);
    const content = bytes.toString("utf8");
    if (!content.trim()) errors.push(`blank document: ${entry.relative_path}`);
    if (content.includes("\uFFFD"))
      warnings.push(`possible utf8 replacement char: ${entry.relative_path}`);
    if (
      /(?:SpriteOutput\/|Prefab\/|Assets?\/|[A-Za-z0-9_./\\-]+\.(?:png|prefab|asset|wav|ogg|mp3))/iu.test(
        content,
      )
    ) {
      assetPollutedDocs += 1;
      if (assetPollutedDocs <= 5) {
        warnings.push(`possible asset/path pollution: ${entry.relative_path}`);
      }
    }
  }

  const manifestCount = manifest.length;
  const unresolvedTitleRate = manifestCount > 0 ? unresolvedTitles / manifestCount : 0;
  const assetPollutionRate = manifestCount > 0 ? assetPollutedDocs / manifestCount : 0;

  const maxUnresolvedAllowed = input.maxUnresolvedTitleRate ?? 0.2;
  if (unresolvedTitleRate >= maxUnresolvedAllowed) {
    errors.push(
      `unresolved title rate exceeds threshold: ${(unresolvedTitleRate * 100).toFixed(2)}% (limit: ${(maxUnresolvedAllowed * 100).toFixed(2)}%)`,
    );
  } else if (unresolvedTitleRate >= 0.05) {
    warnings.push(`unresolved title rate is notable: ${(unresolvedTitleRate * 100).toFixed(2)}%`);
  }

  for (const category of input.requiredCategories ?? REQUIRED_CATEGORIES) {
    if (!categories[category] || categories[category] === 0) {
      errors.push(`required category missing or empty: ${category}`);
    }
  }

  for (const metadataPath of [
    "metadata/starrail/source.json",
    "metadata/starrail/files.json",
    "metadata/starrail/stats.json",
    "metadata/starrail/issues.json",
    "metadata/starrail/hierarchy.json",
  ]) {
    await stat(resolve(corpusRoot, metadataPath)).catch(() =>
      errors.push(`metadata missing: ${metadataPath}`),
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifestEntries: manifestCount,
    categories,
    metrics: {
      unresolvedTitles,
      unresolvedTitleRate,
      assetPollutedDocs,
      assetPollutionRate,
    },
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(normalizedParent);
}
