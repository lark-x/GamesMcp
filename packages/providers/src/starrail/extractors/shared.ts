import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StarRailCorpusCategory, StarRailCorpusDocument } from "../corpus/types.js";
import { deterministicCorpusId, naturalId } from "../corpus/ids.js";
import { hasLikelyNarrativeText, normalizeStarRailText } from "../corpus/normalizer.js";
import type { GameLocalizationResolver } from "../source/textmap.js";
import type { StarRailSourceInventory, StarRailInventoryItem } from "../source/inventory.js";

export interface ExtractorInput {
  dataDir: string;
  sourceRef: string;
  inventory: StarRailSourceInventory;
  resolver: GameLocalizationResolver;
  locale?: string;
}

export interface ExtractorResult {
  documents: StarRailCorpusDocument[];
  issues: Array<{ code: string; message: string; sourcePath?: string; sourceId?: string }>;
  unresolvedText: number;
}

export type PathMatcher = (path: string) => boolean;

export async function extractRecordDocuments(input: {
  extractor: ExtractorInput;
  category: StarRailCorpusCategory;
  matchPath: PathMatcher;
  naturalIdKeys: string[];
  titleKeys: string[];
  bodyKeys: string[];
  sourceIdPrefix: string;
  relativePathFor: (id: number, record: Record<string, unknown>, path: string) => string;
  format?: (record: Record<string, unknown>, context: RecordContext) => string;
  hierarchy?: (id: number, record: Record<string, unknown>) => StarRailCorpusDocument["hierarchy"];
}): Promise<ExtractorResult> {
  const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
  const items = input.extractor.inventory.items.filter(
    (item) => item.path.endsWith(".json") && input.matchPath(item.path),
  );
  for (const item of items) {
    const records = await readJsonRecords(input.extractor.dataDir, item);
    records.forEach((record, index) => {
      const context: RecordContext = {
        resolver: input.extractor.resolver,
        sourcePath: item.path,
        index,
        issues: result.issues,
      };
      const identity = identityFrom(record, input.naturalIdKeys) ?? `${item.path}:${index}`;
      const id =
        naturalId(identity) ??
        deterministicCorpusId({
          category: input.category,
          identity: `${item.path}:${identity}`,
        });
      const title =
        firstResolved(record, input.titleKeys, context) ??
        `<Name unresolved> ${input.sourceIdPrefix}:${identity}`;
      if (title.startsWith("<Name unresolved>")) {
        result.unresolvedText += 1;
        result.issues.push({
          code: "title_unresolved",
          message: `Could not resolve title for ${input.category}`,
          sourcePath: item.path,
          sourceId: String(identity),
        });
      }
      const content = normalizeStarRailText(
        input.format?.(record, context) ??
          defaultDocumentText({
            title,
            record,
            bodyKeys: input.bodyKeys,
            context,
          }),
      );
      if (!hasLikelyNarrativeText(content)) {
        result.issues.push({
          code: "empty_or_non_narrative_document",
          message: `Skipped empty/non-narrative ${input.category} document`,
          sourcePath: item.path,
          sourceId: String(identity),
        });
        return;
      }
      result.documents.push({
        category: input.category,
        id,
        relativePath: input.relativePathFor(id, record, item.path),
        title,
        content,
        sourceFiles: [item.path],
        sourceIds: [`${input.sourceIdPrefix}:${identity}`],
        metadata: {
          source: "turn-based-game-data",
          sourceCommit: input.extractor.sourceRef,
          sourcePath: item.path,
        },
        hierarchy: input.hierarchy?.(id, record),
      });
    });
  }
  return result;
}

export interface RecordContext {
  resolver: GameLocalizationResolver;
  sourcePath: string;
  index: number;
  issues: ExtractorResult["issues"];
}

export async function readJsonRecords(
  dataDir: string,
  item: StarRailInventoryItem,
): Promise<Record<string, unknown>[]> {
  const raw = await readFile(resolve(dataDir, item.path), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed)) {
    const values = Object.values(parsed);
    if (values.every(isRecord)) return values;
    return [parsed];
  }
  return [];
}

export function firstResolved(
  record: Record<string, unknown>,
  keys: string[],
  context: RecordContext,
): string | undefined {
  for (const key of keys) {
    const resolved = resolveTextCandidate(record[key], context);
    if (resolved) return resolved;
  }
  return undefined;
}

export function resolveTextCandidate(value: unknown, context: RecordContext): string | undefined {
  if (typeof value === "number") return context.resolver.resolve(value) ?? String(value);
  if (typeof value === "string") {
    const byHash = /^\d+$/u.test(value) ? context.resolver.resolve(value) : null;
    return normalizeStarRailText(byHash ?? value);
  }
  if (!isRecord(value)) return undefined;
  for (const key of ["TextMapHash", "MainTextMapHash", "Hash", "Value", "Text", "text"]) {
    const resolved = resolveTextCandidate(value[key], context);
    if (resolved) return resolved;
  }
  return undefined;
}

export function formatConversation(input: {
  title: string;
  subtitle?: string;
  record: Record<string, unknown>;
  context: RecordContext;
  containers: string[];
}): string {
  const lines = [`# ${input.title}`];
  if (input.subtitle) lines.push("", input.subtitle);
  lines.push("");
  for (const line of collectConversationLines(input.record, input.context, input.containers)) {
    lines.push(line);
  }
  return lines.join("\n");
}

function defaultDocumentText(input: {
  title: string;
  record: Record<string, unknown>;
  bodyKeys: string[];
  context: RecordContext;
}): string {
  const lines = [`# ${input.title}`, ""];
  for (const key of input.bodyKeys) {
    const resolved = resolveTextCandidate(input.record[key], input.context);
    if (resolved && hasLikelyNarrativeText(resolved)) lines.push(resolved);
  }
  if (lines.length === 2) {
    for (const line of collectConversationLines(input.record, input.context, [])) lines.push(line);
  }
  return lines.join("\n");
}

function collectConversationLines(
  value: unknown,
  context: RecordContext,
  allowedContainers: string[],
): string[] {
  const lines: string[] = [];
  visitConversation(value, context, allowedContainers, lines, "");
  return lines;
}

function visitConversation(
  value: unknown,
  context: RecordContext,
  allowedContainers: string[],
  lines: string[],
  speaker: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitConversation(item, context, allowedContainers, lines, speaker);
    return;
  }
  if (!isRecord(value)) return;
  const nextSpeaker =
    firstResolved(
      value,
      ["SpeakerTextMapHash", "SenderTextMapHash", "Speaker", "Sender"],
      context,
    ) ?? speaker;
  const text = firstResolved(
    value,
    ["TextMapHash", "MainTextMapHash", "ContentTextMapHash", "Text", "MainText", "Content"],
    context,
  );
  if (text && hasLikelyNarrativeText(text))
    lines.push(nextSpeaker ? `${nextSpeaker}：${text}` : text);
  for (const option of arrayFrom(value.Options ?? value.OptionList ?? value.Branches)) {
    const optionText = resolveTextCandidate(option, context);
    if (optionText && hasLikelyNarrativeText(optionText)) lines.push(`[选项] ${optionText}`);
  }
  const containers = allowedContainers.length
    ? allowedContainers
    : ["Talks", "Dialogues", "Dialogs", "Sentences", "Messages", "Sections", "Lines"];
  for (const key of containers) {
    if (key in value) visitConversation(value[key], context, allowedContainers, lines, nextSpeaker);
  }
}

function identityFrom(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" || typeof value === "string") return value;
  }
  return undefined;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
