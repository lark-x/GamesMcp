import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { GameKnowledgeDocument } from "./types.js";

const MAX_DOCUMENT_CHARS = 12_000;

export async function buildStarRailCorpus(input: {
  dataDir: string;
  sourceRef: string;
  inventory: StarRailSourceInventory;
  minTextLength?: number;
}): Promise<GameKnowledgeDocument[]> {
  const documents: GameKnowledgeDocument[] = [];
  for (const item of input.inventory.items) {
    if (!item.path.endsWith(".json")) continue;
    if (!["Story", "ExcelOutput", "TextMap"].includes(item.family)) continue;
    const raw = await readFile(resolve(input.dataDir, item.path), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (item.family === "TextMap") {
      for (const [key, text] of textMapEntries(parsed)) {
        if (text.length < (input.minTextLength ?? 4)) continue;
        documents.push({
          stableId: `starrail/textmap/${key}`,
          game: "starrail",
          category: "TextMap",
          title: key,
          content: text.slice(0, MAX_DOCUMENT_CHARS),
          sourcePath: item.path,
          sourceRef: input.sourceRef,
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            textMapKey: key,
          },
        });
      }
      continue;
    }
    let index = 0;
    for (const text of extractTextUnits(parsed)) {
      const content = text.trim();
      if (content.length < (input.minTextLength ?? 12)) continue;
      index += 1;
      documents.push({
        stableId: `starrail/${item.family.toLowerCase()}/${stablePathId(item.path)}/${index}`,
        game: "starrail",
        category: item.family,
        content: content.slice(0, MAX_DOCUMENT_CHARS),
        sourcePath: item.path,
        sourceRef: input.sourceRef,
        metadata: { source: "turn-based-game-data", sourceCommit: input.sourceRef },
      });
    }
  }
  return dedupeDocuments(documents);
}

function textMapEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object") return [];
  const entries: Array<[string, string]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string" && candidate.trim()) entries.push([key, candidate.trim()]);
    else if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedText = nested.Value ?? nested.value ?? nested.Text ?? nested.text;
      if (typeof nestedText === "string" && nestedText.trim())
        entries.push([key, nestedText.trim()]);
    }
  }
  return entries;
}

function extractTextUnits(value: unknown): string[] {
  const units: string[] = [];
  visit(value, units);
  return units;
}

function visit(value: unknown, units: string[]): void {
  if (typeof value === "string") {
    if (/[一-龥ぁ-んァ-ヶ가-힣A-Za-z]/u.test(value)) units.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, units);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const semanticText = [
    record.Text,
    record.text,
    record.Content,
    record.content,
    record.Desc,
    record.desc,
    record.Title,
    record.title,
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
  if (semanticText) units.push(semanticText);
  for (const [key, item] of Object.entries(record)) {
    if (["Text", "text", "Content", "content", "Desc", "desc", "Title", "title"].includes(key))
      continue;
    visit(item, units);
  }
}

function stablePathId(path: string): string {
  return path
    .replace(/\.json$/iu, "")
    .replace(/[^A-Za-z0-9_-]+/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
}

function dedupeDocuments(documents: GameKnowledgeDocument[]): GameKnowledgeDocument[] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.stableId)) return false;
    seen.add(document.stableId);
    return true;
  });
}
