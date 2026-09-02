import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import {
  MECHANISM_INPUTS,
  TextResolver,
  extractMechanisms,
} from "../packages/ingestion/src/anime-game-data/index.ts";
import type { MechanismRecord } from "../packages/ingestion/src/anime-game-data/index.ts";

/**
 * The converter deliberately lives in a side-effect-free module.  The CLI in
 * convert-anime-game-data.ts is only an adapter around this module so small
 * fixtures can exercise the exact same conversion path as a real checkout.
 */

export const CONVERTER_VERSION = "2.0.0";
export const SUPPORTED_LANGUAGE = "CHS" as const;
export const DEFAULT_LOCALE = "zh-CN" as const;
export const DEFAULT_UPSTREAM_DIR = "data/upstream/AnimeGameData" as const;
export const UPSTREAM_SOURCE = "DimbreathBot/AnimeGameData" as const;
export const RIGHTS_STATUS = "upstream-license-not-declared" as const;

export const INPUT_PATHS = {
  textMap: "TextMap/TextMap_MediumCHS.json",
  avatar: "ExcelBinOutput/AvatarExcelConfigData.json",
  fetterInfo: "ExcelBinOutput/FetterInfoExcelConfigData.json",
  fetterStory: "ExcelBinOutput/FetterStoryExcelConfigData.json",
  booksCodex: "ExcelBinOutput/BooksCodexExcelConfigData.json",
  bookSuit: "ExcelBinOutput/BookSuitExcelConfigData.json",
  document: "ExcelBinOutput/DocumentExcelConfigData.json",
  localization: "ExcelBinOutput/LocalizationExcelConfigData.json",
  material: "ExcelBinOutput/MaterialExcelConfigData.json",
  materialCodex: "ExcelBinOutput/MaterialCodexExcelConfigData.json",
} as const;

const FULL_TEXT_MAP_PATH = "TextMap/TextMapCHS.json" as const;

export type Category = "book" | "character_story" | "item_description" | "mechanism";
export type CategoryPlural = "books" | "characterStories" | "itemDescriptions" | "mechanisms";

type JsonObject = Record<string, unknown>;
type TextMap = Record<string, unknown>;
type UpstreamId = string | number | Record<string, unknown>;

export type FieldLineage = {
  relativeFile: string;
  upstreamId: UpstreamId;
  /** SHA-256 of the complete source file containing this field. */
  hash: string;
  /** SHA-256 of the raw field/value where one is available. */
  valueHash: string;
  /** Relative Readable path, or null for TextMap/Excel fields. */
  readablePath: string | null;
  /** Additional exact sources used to derive a composed field. */
  sources?: FieldLineage[];
};

export type ConverterContext = {
  upstreamCommit: string;
  upstreamCommitDate: string;
  upstreamVersion: string;
  upstreamVersionLabel: string;
  gameVersion: string;
  locale: typeof DEFAULT_LOCALE;
  language: typeof SUPPORTED_LANGUAGE;
  rightsStatus: string;
  converterVersion: string;
  upstreamSource: string;
};

export type AnimeGameRecord = {
  sourceKey: string;
  recordType: "document";
  title: string;
  documentType: "book" | "character_story" | "item_description" | "mechanism" | "tutorial";
  gameVersion: string;
  body: string;
  segments?: AnimeGameSegment[];
  entities?: Array<{
    sourceKey: string;
    name: string;
    /** Domain/ingestion contract calls this field `type`. */
    type: "character" | "item";
    summary?: string;
    properties: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown> & {
    lineage: Record<string, FieldLineage>;
    rawContentHash: string;
    normalizedContentHash: string;
    rawHash: string;
    normalizedHash: string;
    transforms: string[];
    verificationRiskFlags: string[];
  };
  contentHash: string;
  parserVersion: string;
};

export type AnimeGameSegment = {
  segmentKey: string;
  ordinal: number;
  headingPath: string[];
  body: string;
  startOffset: number;
  endOffset: number;
  metadata: {
    segmentStableId: string;
    bookStableId?: string;
    volumeStableId?: string;
    documentStableId?: string;
    mechanismStableId?: string;
  };
};

export type Failure = {
  category: Category;
  upstreamId: string;
  reason: string;
};

export type ExcludedEntry = {
  category: Category;
  upstreamId: string;
  reason: string;
};

export type ConversionManifest = {
  schemaVersion: 2;
  generatedAt: string;
  upstream: {
    commit: string;
    version: string;
    commitDate: string;
    subject: string;
  };
  gameVersion: string;
  locale: typeof DEFAULT_LOCALE;
  language: typeof SUPPORTED_LANGUAGE;
  rightsStatus: string;
  converterVersion: string;
  outputRecordsPath: string;
  discovered: Record<CategoryPlural, number>;
  converted: Record<CategoryPlural, number>;
  excluded: Record<CategoryPlural, number>;
  excludedEntries: ExcludedEntry[];
  failures: Failure[];
  /** Converted + excluded + failed source rows divided by discovered rows. */
  accountedCoverage: Record<CategoryPlural, number>;
  accounting: Record<
    CategoryPlural,
    {
      discovered: number;
      converted: number;
      excluded: number;
      failures: number;
      accounted: number;
      coverage: number;
    }
  >;
  /** Legacy converted/discovered coverage, retained alongside accountedCoverage. */
  coverage: Record<CategoryPlural, number>;
  unexplainedMissing: Array<{ category: CategoryPlural; count: number }>;
  inputHashes: Record<string, string>;
};

export type ConversionResult = {
  records: {
    books: AnimeGameRecord[];
    characterStories: AnimeGameRecord[];
    items: AnimeGameRecord[];
    mechanisms: AnimeGameRecord[];
  };
  manifest: Omit<ConversionManifest, "generatedAt" | "outputRecordsPath">;
};

export type ConvertOptions = {
  upstreamDir?: string;
  language?: string;
  context?: Partial<ConverterContext>;
};

type SourceFile<T> = {
  relativePath: string;
  absolutePath: string;
  raw: string;
  value: T;
  fileHash: string;
};

type LoadedInputs = {
  textMap: SourceFile<TextMap>;
  textMapFull?: SourceFile<TextMap>;
  avatar: SourceFile<unknown>;
  fetterInfo: SourceFile<unknown>;
  fetterStory: SourceFile<unknown>;
  booksCodex: SourceFile<unknown>;
  bookSuit: SourceFile<unknown>;
  document: SourceFile<unknown>;
  localization: SourceFile<unknown>;
  material: SourceFile<unknown>;
  materialCodex: SourceFile<unknown>;
};

type TextValue = {
  hash: number;
  raw: string;
  value: string;
  lineage: FieldLineage;
};

const CATEGORY_BY_PLURAL: Record<CategoryPlural, Category> = {
  books: "book",
  characterStories: "character_story",
  itemDescriptions: "item_description",
  mechanisms: "mechanism",
};

const PLURALS: CategoryPlural[] = ["books", "characterStories", "itemDescriptions", "mechanisms"];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function idValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** JSON canonicalization makes hashes and record bytes independent of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function cleanText(value: string): string {
  return value
    .replace(/<image\s+name=[^>]+\s*\/>/gi, "")
    .replace(/<color=[^>]+>/gi, "")
    .replace(/<\/color>/gi, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Stable identities deliberately do not contain a revision or content hash.
 * A document/segment database id is revision-scoped, while these keys identify
 * the same source object across re-imports.
 */
export function bookStableId(bookSuitId: number | string): string {
  return `book/${bookSuitId}`;
}

export function volumeStableId(bookId: string, volumeId: number | string): string {
  return `${bookId}/volume/${volumeId}`;
}

export function documentStableId(volumeId: string): string {
  return `document/${volumeId}`;
}

export function segmentStableId(documentId: string, ordinal: number): string {
  return `${documentId}/segment/${ordinal + 1}`;
}

function inferBookTitle(title: string): string {
  return (
    title
      .replace(
        /(?:[·・ ]+)?(?:第?[一二三四五六七八九十百千万\d]+(?:卷|册)|(?:卷|册)[一二三四五六七八九十百千万\d]+)$/,
        "",
      )
      .trim() || title
  );
}

const VOLUME_HEADING =
  /^(?:《)?(?:.+?[·・ ]+)?(?:第?[一二三四五六七八九十百千万\d]+(?:卷|册)|(?:卷|册)[一二三四五六七八九十百千万\d]+)(?:》)?$/;

function volumeHeading(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length > 120) return undefined;
  const match = VOLUME_HEADING.exec(trimmed);
  return match ? trimmed : undefined;
}

function splitParagraphGroups(
  body: string,
  headingPath: string[],
  documentId: string,
  ordinalStart: number,
  ids: { bookStableId: string; volumeStableId: string },
): AnimeGameSegment[] {
  const paragraphs: Array<{ start: number; end: number }> = [];
  const paragraphPattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const match of body.matchAll(paragraphPattern)) {
    const value = match[0];
    if (!value?.trim() || match.index === undefined) continue;
    const start = match.index + value.search(/\S/);
    paragraphs.push({ start, end: match.index + value.trimEnd().length });
  }
  if (!paragraphs.length) return [];

  const groups: Array<{ start: number; end: number }> = [];
  let current = paragraphs[0];
  for (const paragraph of paragraphs.slice(1)) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (paragraph.end - current.start <= 2_000) {
      current = { start: current.start, end: paragraph.end };
    } else {
      groups.push(current);
      current = paragraph;
    }
  }
  if (current) groups.push(current);

  return groups.map((range, index) => {
    const ordinal = ordinalStart + index;
    const segmentId = segmentStableId(documentId, ordinal);
    const path = groups.length > 1 ? [...headingPath, `段落组 ${index + 1}`] : headingPath;
    return {
      segmentKey: segmentId,
      ordinal,
      headingPath: path,
      body: body.slice(range.start, range.end).trim(),
      startOffset: range.start,
      endOffset: range.end,
      metadata: {
        segmentStableId: segmentId,
        bookStableId: ids.bookStableId,
        volumeStableId: ids.volumeStableId,
        documentStableId: documentId,
      },
    };
  });
}

/**
 * Build stable, citation-ready book segments. Normal source rows represent one
 * volume, but this also accepts a body containing explicit volume headings so
 * older/combined readable sources remain section-addressable.
 */
export function segmentBookBody(
  bookTitle: string,
  volumeTitle: string,
  body: string,
  documentId: string,
  stableIds: {
    bookStableId?: string;
    volumeStableId?: string;
  } = {},
): AnimeGameSegment[] {
  const bookId = stableIds.bookStableId ?? bookTitle;
  const volumeId = stableIds.volumeStableId ?? volumeTitle;
  const lines = body.split("\n");
  const headings: Array<{ title: string; start: number; contentStart: number }> = [];
  let offset = 0;
  for (const line of lines) {
    const title = volumeHeading(line);
    if (title) headings.push({ title, start: offset, contentStart: offset + line.length + 1 });
    offset += line.length + 1;
  }

  if (headings.length >= 2) {
    const segments: AnimeGameSegment[] = [];
    for (const [index, heading] of headings.entries()) {
      const next = headings[index + 1];
      const start = heading.contentStart;
      const end = next?.start ?? body.length;
      const volumeBody = body.slice(start, end).trim();
      if (!volumeBody) continue;
      const headingPath = [bookTitle, heading.title];
      const volumeDocumentId = `${documentId}/volume/${index + 1}`;
      const headingVolumeId = `${volumeId}/volume/${index + 1}`;
      const volumeSegments =
        volumeBody.length > 2_000
          ? splitParagraphGroups(volumeBody, headingPath, volumeDocumentId, segments.length, {
              bookStableId: bookId,
              volumeStableId: headingVolumeId,
            })
          : [
              {
                segmentKey: segmentStableId(volumeDocumentId, 0),
                ordinal: segments.length,
                headingPath,
                body: volumeBody,
                startOffset: start,
                endOffset: end,
                metadata: {
                  segmentStableId: segmentStableId(volumeDocumentId, 0),
                  bookStableId: bookId,
                  volumeStableId: headingVolumeId,
                  documentStableId: volumeDocumentId,
                },
              },
            ];
      segments.push(...volumeSegments);
    }
    if (segments.length) return segments;
  }

  const headingPath = [bookTitle, volumeTitle];
  return body.length > 2_000
    ? splitParagraphGroups(body, headingPath, documentId, 0, {
        bookStableId: bookId,
        volumeStableId: volumeId,
      })
    : [
        {
          segmentKey: segmentStableId(documentId, 0),
          ordinal: 0,
          headingPath,
          body,
          startOffset: 0,
          endOffset: body.length,
          metadata: {
            segmentStableId: segmentStableId(documentId, 0),
            bookStableId: bookId,
            volumeStableId: volumeId,
            documentStableId: documentId,
          },
        },
      ];
}

function hasReplacementCharacter(value: unknown): boolean {
  return typeof value === "string" && value.includes("\uFFFD");
}

function hasFormatTags(value: unknown): boolean {
  return typeof value === "string" && /<(?:color|image)(?:\s|=|\/?>)/i.test(value);
}

function uniqueText(values: Array<string | undefined>): string[] {
  return [...new Set(values.flatMap((value) => (value?.trim() ? [value.trim()] : [])))];
}

function fieldHash(value: unknown): string {
  return sha256(typeof value === "string" ? value : stableStringify(value));
}

function sourceLineage(
  relativeFile: string,
  upstreamId: UpstreamId,
  fileHash: string,
  rawValue: unknown,
  readablePath: string | null = null,
): FieldLineage {
  return {
    relativeFile,
    upstreamId,
    hash: fileHash,
    valueHash: fieldHash(rawValue),
    readablePath,
  };
}

function composedLineage(sources: FieldLineage[], primaryIndex = 0): FieldLineage {
  const primary = sources[primaryIndex] ?? sources[0];
  if (!primary) throw new Error("A lineage field requires at least one source");
  return sources.length > 1 ? { ...primary, sources } : primary;
}

function textValue(
  hash: unknown,
  textMap: SourceFile<TextMap>,
  upstreamIds: UpstreamId,
): TextValue | undefined {
  const numericHash = idValue(hash);
  if (numericHash === undefined) return undefined;
  const raw = textMap.value[String(numericHash)];
  if (typeof raw !== "string") return undefined;
  const value = cleanText(raw);
  if (!value) return undefined;
  return {
    hash: numericHash,
    raw,
    value,
    lineage: sourceLineage(textMap.relativePath, upstreamIds, textMap.fileHash, raw),
  };
}

function mapRowsById(rows: JsonObject[], field: string): Map<number, JsonObject> {
  const result = new Map<number, JsonObject>();
  for (const row of rows) {
    const id = idValue(row[field]);
    if (id === undefined) continue;
    const previous = result.get(id);
    // Duplicate lookup rows are not allowed to depend on source array order.
    // Select the lexicographically first canonical row; category rows still
    // report duplicate canonical keys in the audit manifest below.
    if (!previous || stableStringify(row).localeCompare(stableStringify(previous)) < 0) {
      result.set(id, row);
    }
  }
  return result;
}

function sortedRows(
  value: unknown,
  idFields: string[],
): Array<{ row: JsonObject; rawHash: string }> {
  return asArray(value)
    .map((row) => ({ row, rawHash: sha256(stableStringify(row)) }))
    .sort((left, right) => {
      for (const field of idFields) {
        const leftId = idValue(left.row[field]);
        const rightId = idValue(right.row[field]);
        if (leftId !== undefined && rightId !== undefined && leftId !== rightId) {
          return leftId - rightId;
        }
        if (leftId === undefined && rightId !== undefined) return 1;
        if (leftId !== undefined && rightId === undefined) return -1;
      }
      return left.rawHash.localeCompare(right.rawHash);
    });
}

function rowId(row: JsonObject, fields: string[], fallbackHash: string): string {
  for (const field of fields) {
    const id = idValue(row[field]);
    if (id !== undefined) return String(id);
  }
  return `row:${fallbackHash.slice(0, 16)}`;
}

function countFailures(failures: Failure[], category: Category): number {
  return failures.filter((failure) => failure.category === category).length;
}

function countExcluded(excluded: ExcludedEntry[], category: Category): number {
  return excluded.filter((entry) => entry.category === category).length;
}

function sortedFailures(failures: Failure[]): Failure[] {
  return [...failures].sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.upstreamId.localeCompare(right.upstreamId) ||
      left.reason.localeCompare(right.reason),
  );
}

function sortedExcluded(excluded: ExcludedEntry[]): ExcludedEntry[] {
  return [...excluded].sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.upstreamId.localeCompare(right.upstreamId) ||
      left.reason.localeCompare(right.reason),
  );
}

function normalizedHash(record: {
  sourceKey: string;
  recordType: string;
  title: string;
  documentType: string;
  gameVersion: string;
  body: string;
  entities?: unknown;
  segments?: unknown;
}): string {
  return sha256(
    stableStringify({
      sourceKey: record.sourceKey,
      recordType: record.recordType,
      title: record.title,
      documentType: record.documentType,
      gameVersion: record.gameVersion,
      body: record.body,
      entities: record.entities ?? [],
      segments: record.segments ?? [],
    }),
  );
}

function makeMetadata(
  context: ConverterContext,
  lineage: Record<string, FieldLineage>,
  rawContentHash: string,
  normalizedContentHash: string,
  transforms: string[],
  extras: Record<string, unknown>,
): AnimeGameRecord["metadata"] {
  const { verificationRiskFlags: suppliedRiskFlags, ...metadataExtras } = extras;
  const verificationRiskFlags = Array.from(
    new Set(
      Array.isArray(suppliedRiskFlags)
        ? suppliedRiskFlags.filter((flag): flag is string => typeof flag === "string")
        : [],
    ),
  ).sort();
  return {
    upstreamSource: context.upstreamSource,
    upstreamCommit: context.upstreamCommit,
    upstreamCommitDate: context.upstreamCommitDate,
    commit: context.upstreamCommit,
    upstreamVersion: context.upstreamVersion,
    upstreamVersionLabel: context.upstreamVersionLabel,
    version: context.gameVersion,
    locale: context.locale,
    language: context.language,
    gameVersion: context.gameVersion,
    converterVersion: context.converterVersion,
    rightsStatus: context.rightsStatus,
    lineage,
    rawContentHash,
    normalizedContentHash,
    rawHash: rawContentHash,
    normalizedHash: normalizedContentHash,
    transforms,
    verificationRiskFlags,
    ...metadataExtras,
  };
}

function makeRecord(
  context: ConverterContext,
  record: Omit<AnimeGameRecord, "metadata" | "contentHash" | "parserVersion">,
  lineage: Record<string, FieldLineage>,
  rawContentHash: string,
  transforms: string[],
  extras: Record<string, unknown>,
): AnimeGameRecord {
  const contentHash = normalizedHash(record);
  return {
    ...record,
    metadata: makeMetadata(context, lineage, rawContentHash, contentHash, transforms, extras),
    contentHash,
    parserVersion: context.converterVersion,
  };
}

function defaultContext(context: Partial<ConverterContext> = {}): ConverterContext {
  const upstreamVersion = context.upstreamVersion ?? context.gameVersion ?? "unknown";
  return {
    upstreamCommit: context.upstreamCommit ?? "unknown",
    upstreamCommitDate: context.upstreamCommitDate ?? "unknown",
    upstreamVersion,
    upstreamVersionLabel: context.upstreamVersionLabel ?? upstreamVersion,
    gameVersion: context.gameVersion ?? upstreamVersion,
    locale: DEFAULT_LOCALE,
    language: SUPPORTED_LANGUAGE,
    rightsStatus: context.rightsStatus ?? RIGHTS_STATUS,
    converterVersion: context.converterVersion ?? CONVERTER_VERSION,
    upstreamSource: context.upstreamSource ?? UPSTREAM_SOURCE,
  };
}

async function readJsonSource<T>(
  upstreamDir: string,
  relativePath: string,
): Promise<SourceFile<T>> {
  const absolutePath = resolve(upstreamDir, relativePath);
  const raw = await readFile(absolutePath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    relativePath,
    absolutePath,
    raw,
    value: value as T,
    fileHash: sha256(raw),
  };
}

async function readOptionalJsonSource<T>(
  upstreamDir: string,
  relativePath: string,
): Promise<SourceFile<T> | undefined> {
  try {
    return await readJsonSource<T>(upstreamDir, relativePath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ((error as { code?: unknown }).code === "ENOENT" ||
        (error as { code?: unknown }).code === "ENOTDIR")
    )
      return undefined;
    throw error;
  }
}

async function loadInputs(upstreamDir: string): Promise<LoadedInputs> {
  const entries = await Promise.all(
    Object.entries(INPUT_PATHS).map(
      async ([name, path]) => [name, await readJsonSource<unknown>(upstreamDir, path)] as const,
    ),
  );
  const byName = Object.fromEntries(entries) as Record<
    keyof typeof INPUT_PATHS,
    SourceFile<unknown>
  >;
  return {
    textMap: byName.textMap as SourceFile<TextMap>,
    textMapFull: await readOptionalJsonSource<TextMap>(upstreamDir, FULL_TEXT_MAP_PATH),
    avatar: byName.avatar,
    fetterInfo: byName.fetterInfo,
    fetterStory: byName.fetterStory,
    booksCodex: byName.booksCodex,
    bookSuit: byName.bookSuit,
    document: byName.document,
    localization: byName.localization,
    material: byName.material,
    materialCodex: byName.materialCodex,
  };
}

function inputHashes(
  inputs: LoadedInputs,
  readableHashes: Map<string, string>,
): Record<string, string> {
  const hashes = new Map<string, string>(
    Object.values(inputs)
      .filter((source): source is SourceFile<unknown> => Boolean(source))
      .map((source) => [source.relativePath, source.fileHash]),
  );
  for (const [path, hash] of readableHashes) hashes.set(path, hash);
  return Object.fromEntries(
    [...hashes.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function readablePathFromLocalization(
  localization: JsonObject,
): { path: string; field: string } | undefined {
  // These are the exact CHS fields emitted by AnimeGameData.  Do not scan all
  // values or infer a book from a filename: that would turn a provenance edge
  // into a fuzzy match.
  const fields = ["chsPath", "DHHBMABKMMN", "HKLGNINJMGG", "DEFNEHAFMMA", "JDNBKKPEFAI"];
  for (const field of fields) {
    const candidate = stringValue(localization[field]);
    if (!candidate) continue;
    const normalized = candidate.replaceAll("\\", "/");
    const marker = "/Readable/CHS/";
    const markerIndex = normalized.indexOf(marker);
    const relativeMarker = "Readable/CHS/";
    const relativeIndex = normalized.startsWith(relativeMarker) ? 0 : -1;
    const suffix =
      markerIndex >= 0
        ? normalized.slice(markerIndex + marker.length)
        : relativeIndex === 0
          ? normalized.slice(relativeMarker.length)
          : undefined;
    if (!suffix || suffix.includes("..") || suffix.startsWith("/")) continue;
    const path = `Readable/CHS/${suffix}`;
    return {
      path: extname(path).toLowerCase() === ".txt" ? path : `${path}.txt`,
      field,
    };
  }
  return undefined;
}

async function readReadable(
  upstreamDir: string,
  path: string,
  readableHashes: Map<string, string>,
): Promise<{ raw: string; value: string; lineage: FieldLineage } | undefined> {
  const absolutePath = resolve(upstreamDir, path);
  try {
    const bytes = await readFile(absolutePath);
    const raw = bytes.toString("utf8");
    const fileHash = sha256(bytes);
    readableHashes.set(path, fileHash);
    return {
      raw,
      value: cleanText(raw),
      lineage: sourceLineage(path, path, fileHash, raw, path),
    };
  } catch {
    return undefined;
  }
}

function textLineage(value: TextValue, upstreamIds: UpstreamId): FieldLineage {
  return {
    ...value.lineage,
    upstreamId: upstreamIds,
    sources: value.lineage.sources,
  };
}

function sourceRowLineage(
  source: SourceFile<unknown>,
  row: JsonObject,
  upstreamId: UpstreamId,
): FieldLineage {
  return sourceLineage(source.relativePath, upstreamId, source.fileHash, row);
}

function rawHashFor(values: unknown): string {
  return sha256(stableStringify(values));
}

function addFailure(
  failures: Failure[],
  category: Category,
  upstreamId: string,
  reason: string,
): void {
  failures.push({ category, upstreamId, reason });
}

function addExcluded(
  excluded: ExcludedEntry[],
  category: Category,
  upstreamId: string,
  reason: string,
): void {
  excluded.push({ category, upstreamId, reason });
}

function hasAnyReplacement(values: unknown[]): boolean {
  return values.some(hasReplacementCharacter);
}

function recordEntitySourceKey(record: AnimeGameRecord): string[] {
  return (record.entities ?? []).map((entity) => entity.sourceKey);
}

const MECHANISM_SOURCE_BY_STABLE_PREFIX = Object.fromEntries(
  Object.values(MECHANISM_INPUTS).map((path) => {
    const basename = path.split("/").at(-1) ?? path;
    const sourcePrefix = basename.replace(/ExcelConfigData\.json$/, "").replace(/Excel$/, "");
    return [sourcePrefix, path];
  }),
) as Record<string, string>;

function mechanismSourcePath(record: MechanismRecord, inputHashes: Record<string, string>): string {
  const sourcePrefix = /^mechanism\/([^/]+)\//.exec(record.mechanismStableId)?.[1];
  const mapped = sourcePrefix ? MECHANISM_SOURCE_BY_STABLE_PREFIX[sourcePrefix] : undefined;
  if (mapped) return mapped;
  return Object.keys(inputHashes).sort()[0] ?? "ExcelBinOutput/MechanismUnknownSource.json";
}

function mechanismDocumentFromRecord(
  context: ConverterContext,
  record: MechanismRecord,
  inputHashes: Record<string, string>,
): AnimeGameRecord {
  const sourceFile = mechanismSourcePath(record, inputHashes);
  const sourceFileHash = inputHashes[sourceFile] ?? rawHashFor(record);
  const rawContentHash = rawHashFor(record);
  return makeRecord(
    context,
    {
      sourceKey: record.mechanismStableId,
      recordType: "document",
      title: record.title,
      documentType: record.documentType,
      gameVersion: context.gameVersion,
      body: record.body,
      segments: [
        {
          segmentKey: `${record.mechanismStableId}/segment/1`,
          ordinal: 0,
          headingPath: [record.title],
          body: record.body,
          startOffset: 0,
          endOffset: record.body.length,
          metadata: {
            segmentStableId: `${record.mechanismStableId}/segment/1`,
            documentStableId: record.mechanismStableId,
            mechanismStableId: record.mechanismStableId,
          },
        },
      ],
    },
    {
      title: sourceLineage(sourceFile, record.mechanismStableId, sourceFileHash, record.title),
      body: sourceLineage(sourceFile, record.mechanismStableId, sourceFileHash, record.body),
    },
    rawContentHash,
    ["MechanismExtractor field whitelist", "TextMap fallback resolution"],
    {
      canonicalKey: record.mechanismStableId,
      mechanismStableId: record.mechanismStableId,
      mechanismCategory: record.category,
      textResolution: record.textResolution,
      relatedEntities: record.relatedEntities ?? [],
      sourceFiles: Object.keys(inputHashes).sort(),
    },
  );
}

export async function convertAnimeGameData(options: ConvertOptions): Promise<ConversionResult> {
  const language = options.language ?? SUPPORTED_LANGUAGE;
  if (language !== SUPPORTED_LANGUAGE) {
    throw new Error("The AnimeGameData converter supports ANIME_GAME_LANGUAGE=CHS only");
  }

  const context = defaultContext(options.context);
  const upstreamDir = resolve(options.upstreamDir ?? DEFAULT_UPSTREAM_DIR);
  const inputs = await loadInputs(upstreamDir);
  const readableHashes = new Map<string, string>();
  const failures: Failure[] = [];
  const excludedEntries: ExcludedEntry[] = [];
  const books: AnimeGameRecord[] = [];
  const characterStories: AnimeGameRecord[] = [];
  const items: AnimeGameRecord[] = [];

  const textMap = inputs.textMap;
  const mechanismInputHashes: Record<string, string> = {};
  const mechanismResult = await extractMechanisms({
    upstreamDir,
    upstreamCommit: context.upstreamCommit,
    upstreamVersion: context.upstreamVersion,
    gameVersion: context.gameVersion,
    locale: context.locale,
    textResolver: new TextResolver({
      maps: [
        { locale: context.locale, values: textMap.value },
        ...(inputs.textMapFull
          ? [{ locale: context.locale, values: inputs.textMapFull.value }]
          : []),
      ],
    }),
    inputHashes: mechanismInputHashes,
  });
  excludedEntries.push(
    ...mechanismResult.failures.map((failure) => ({
      category: "mechanism" as const,
      upstreamId: failure.upstreamId ?? "unknown",
      reason: failure.code,
    })),
  );
  const mechanisms = mechanismResult.records.map((record) =>
    mechanismDocumentFromRecord(context, record, mechanismResult.inputHashes),
  );
  const documents = mapRowsById(asArray(inputs.document.value), "id");
  const localizations = mapRowsById(asArray(inputs.localization.value), "id");
  const bookSuits = mapRowsById(asArray(inputs.bookSuit.value), "id");
  const avatars = mapRowsById(asArray(inputs.avatar.value), "id");
  const materials = mapRowsById(asArray(inputs.material.value), "id");
  const fetterInfos = asArray(inputs.fetterInfo.value);

  const bookKeys = new Set<string>();
  for (const { row: codex, rawHash: codexRawHash } of sortedRows(inputs.booksCodex.value, [
    "id",
    "materialId",
  ])) {
    const codexId = idValue(codex.id);
    const documentId = idValue(codex.materialId);
    const fallbackId = rowId(codex, ["id", "materialId"], codexRawHash);
    if (codexId === undefined || documentId === undefined) {
      addFailure(failures, "book", fallbackId, "upstream_id_missing");
      continue;
    }
    const sourceKey = `book/${documentId}`;
    if (bookKeys.has(sourceKey)) {
      addExcluded(excludedEntries, "book", `${codexId}:${documentId}`, "duplicate_canonical_key");
      continue;
    }
    bookKeys.add(sourceKey);
    const document = documents.get(documentId);
    if (!document) {
      addFailure(failures, "book", String(documentId), "document_missing");
      continue;
    }
    const questIds = Array.isArray(document.questIDList)
      ? document.questIDList.flatMap((value) => {
          const id = idValue(value);
          return id === undefined ? [] : [id];
        })
      : [];
    if (!questIds.length) {
      addFailure(failures, "book", String(documentId), "quest_id_missing");
      continue;
    }
    const localizationEntry = questIds
      .map((questId) => ({ questId, row: localizations.get(questId) }))
      .find((entry) => entry.row !== undefined);
    if (!localizationEntry?.row) {
      addFailure(failures, "book", String(documentId), "localization_missing");
      continue;
    }
    const readableResolution = readablePathFromLocalization(localizationEntry.row);
    if (!readableResolution) {
      addFailure(failures, "book", String(documentId), "chs_readable_path_missing");
      continue;
    }
    const readablePath = readableResolution.path;
    const titleValue = textValue(document.titleTextMapHash, textMap, documentId);
    if (!titleValue) {
      addFailure(failures, "book", String(documentId), "title_missing");
      continue;
    }
    const readable = await readReadable(upstreamDir, readablePath, readableHashes);
    if (!readable) {
      addFailure(failures, "book", String(documentId), "readable_file_missing");
      continue;
    }
    if (hasAnyReplacement([titleValue.raw, readable.raw])) {
      addFailure(failures, "book", String(documentId), "replacement_character");
      continue;
    }
    if (!readable.value) {
      addFailure(failures, "book", String(documentId), "empty_body");
      continue;
    }
    const material = materials.get(documentId);
    const suitId = idValue(material?.setID) ?? idValue(codex.bookSuitId);
    const stableBookId =
      suitId === undefined
        ? bookStableId(`title:${inferBookTitle(titleValue.value)}`)
        : bookStableId(suitId);
    const stableVolumeId = volumeStableId(stableBookId, codexId);
    const stableDocumentId = documentStableId(stableVolumeId);
    const suit = suitId === undefined ? undefined : bookSuits.get(suitId);
    const suitTitleValue = suit ? textValue(suit.suitNameTextMapHash, textMap, suitId) : undefined;
    const bookTitle = suitTitleValue?.value ?? titleValue.value;
    const segments = segmentBookBody(
      bookTitle,
      titleValue.value,
      readable.value,
      stableDocumentId,
      { bookStableId: stableBookId, volumeStableId: stableVolumeId },
    );
    const codexLineage = sourceRowLineage(inputs.booksCodex, codex, codexId);
    const documentLineage = sourceRowLineage(inputs.document, document, documentId);
    const localizationLineage = sourceRowLineage(
      inputs.localization,
      localizationEntry.row,
      localizationEntry.questId,
    );
    const bodyLineage = composedLineage(
      [readable.lineage, documentLineage, localizationLineage],
      0,
    );
    const titleLineage = composedLineage(
      [titleLineageWithUpstreamId(titleValue, documentId), documentLineage],
      0,
    );
    const baseRecord = {
      sourceKey,
      recordType: "document" as const,
      title: titleValue.value,
      documentType: "book" as const,
      gameVersion: context.gameVersion,
      body: readable.value,
      segments,
    };
    const rawContentHash = rawHashFor({
      codex: { file: inputs.booksCodex.relativePath, row: codex },
      document: { file: inputs.document.relativePath, row: document },
      bookSuit: suit ? { file: inputs.bookSuit.relativePath, row: suit } : undefined,
      localization: { file: inputs.localization.relativePath, row: localizationEntry.row },
      title: titleValue.raw,
      readable: { path: readablePath, content: readable.raw },
    });
    const verificationRiskFlags = [
      ...(hasFormatTags(titleValue.raw) || hasFormatTags(readable.raw) ? ["format_tags"] : []),
    ];
    books.push(
      makeRecord(
        context,
        baseRecord,
        {
          codex: codexLineage,
          document: documentLineage,
          localization: localizationLineage,
          title: titleLineage,
          body: bodyLineage,
          ...(suit ? { bookSuit: sourceRowLineage(inputs.bookSuit, suit, suitId) } : {}),
        },
        rawContentHash,
        [
          "BooksCodex.materialId→Document.id",
          "Document.questIDList→Localization.id",
          "Localization.CHSPath→Readable/CHS",
          "TextMap_MediumCHS hash resolution",
          "Readable markup cleanup and line-ending normalization",
        ],
        {
          canonicalKey: sourceKey,
          sourceFiles: [
            inputs.booksCodex.relativePath,
            ...(suit ? [inputs.bookSuit.relativePath] : []),
            inputs.document.relativePath,
            inputs.localization.relativePath,
            textMap.relativePath,
            readablePath,
          ],
          upstreamIds: {
            codexId,
            documentId,
            questIds,
            localizationId: localizationEntry.questId,
          },
          textMapHashes: { title: titleValue.hash },
          readableFile: readablePath,
          readablePathField: readableResolution.field,
          bookStableId: stableBookId,
          volumeStableId: stableVolumeId,
          documentStableId: stableDocumentId,
          bookSuitId: suitId,
          volumeId: codexId,
          sortOrder: idValue(codex.sortOrder),
          verificationRiskFlags,
        },
      ),
    );
  }

  const characterKeys = new Set<string>();
  for (const { row: story, rawHash: storyRawHash } of sortedRows(inputs.fetterStory.value, [
    "avatarId",
    "fetterId",
  ])) {
    const avatarId = idValue(story.avatarId);
    const fetterId = idValue(story.fetterId);
    const fallbackId = rowId(story, ["avatarId", "fetterId"], storyRawHash);
    if (avatarId === undefined || fetterId === undefined) {
      addFailure(failures, "character_story", fallbackId, "upstream_id_missing");
      continue;
    }
    const sourceKey = `character/${avatarId}/story/${fetterId}`;
    if (characterKeys.has(sourceKey)) {
      addExcluded(
        excludedEntries,
        "character_story",
        `${avatarId}:${fetterId}`,
        "duplicate_canonical_key",
      );
      continue;
    }
    characterKeys.add(sourceKey);
    const avatar = avatars.get(avatarId);
    if (!avatar) {
      addFailure(failures, "character_story", `${avatarId}:${fetterId}`, "character_missing");
      continue;
    }
    const nameValue = textValue(avatar.nameTextMapHash, textMap, avatarId);
    if (!nameValue) {
      addFailure(failures, "character_story", `${avatarId}:${fetterId}`, "character_name_missing");
      continue;
    }
    const primaryTitleValue = textValue(
      story.storyTitleTextMapHash,
      textMap,
      `${avatarId}:${fetterId}`,
    );
    const fallbackTitleValue = textValue(
      story.storyTitle2TextMapHash,
      textMap,
      `${avatarId}:${fetterId}`,
    );
    const titleValue = primaryTitleValue ?? fallbackTitleValue;
    const primaryBodyValue = textValue(
      story.storyContextTextMapHash,
      textMap,
      `${avatarId}:${fetterId}`,
    );
    const fallbackBodyValue = textValue(
      story.storyContext2TextMapHash,
      textMap,
      `${avatarId}:${fetterId}`,
    );
    const bodyValue = primaryBodyValue ?? fallbackBodyValue;
    if (!titleValue) {
      addFailure(failures, "character_story", `${avatarId}:${fetterId}`, "title_missing");
      continue;
    }
    if (!bodyValue) {
      addFailure(failures, "character_story", `${avatarId}:${fetterId}`, "body_missing");
      continue;
    }
    const infoCandidates = fetterInfos
      .filter((candidate) => idValue(candidate.avatarId) === avatarId)
      .sort((left, right) => {
        const leftExact = idValue(left.fetterId) === fetterId ? 0 : 1;
        const rightExact = idValue(right.fetterId) === fetterId ? 0 : 1;
        return (
          leftExact - rightExact || stableStringify(left).localeCompare(stableStringify(right))
        );
      });
    const info = infoCandidates[0];
    const infoSummaryValue = info
      ? textValue(info.avatarDetailTextMapHash, textMap, avatarId)
      : undefined;
    const avatarSummaryValue = textValue(avatar.descTextMapHash, textMap, avatarId);
    const summaryValue = infoSummaryValue ?? avatarSummaryValue;
    const textValues = [nameValue.raw, titleValue.raw, bodyValue.raw, summaryValue?.raw];
    if (hasAnyReplacement(textValues)) {
      addFailure(failures, "character_story", `${avatarId}:${fetterId}`, "replacement_character");
      continue;
    }
    const title = `${nameValue.value} · ${titleValue.value}`;
    const storyLineage = sourceRowLineage(inputs.fetterStory, story, {
      avatarId,
      fetterId,
    });
    const avatarLineage = sourceRowLineage(inputs.avatar, avatar, avatarId);
    const infoLineage = info
      ? sourceRowLineage(inputs.fetterInfo, info, { avatarId, fetterId })
      : undefined;
    const nameLineage = textLineage(nameValue, avatarId);
    const titleTextLineage = textLineage(titleValue, { avatarId, fetterId });
    const bodyLineage = textLineage(bodyValue, { avatarId, fetterId });
    const summaryLineage = summaryValue
      ? textLineage(summaryValue, { avatarId, fetterId })
      : undefined;
    const entity = {
      sourceKey: `character/${avatarId}`,
      name: nameValue.value,
      type: "character" as const,
      ...(summaryValue ? { summary: summaryValue.value } : {}),
      properties: {
        avatarId,
        icon: stringValue(avatar.iconName),
        weaponType: stringValue(avatar.weaponType),
        qualityType: stringValue(avatar.qualityType),
      },
    };
    const baseRecord = {
      sourceKey,
      recordType: "document" as const,
      title,
      documentType: "character_story" as const,
      gameVersion: context.gameVersion,
      body: bodyValue.value,
      entities: [entity],
    };
    const normalizedTitleLineage = composedLineage([nameLineage, titleTextLineage], 1);
    const rawContentHash = rawHashFor({
      avatar: { file: inputs.avatar.relativePath, row: avatar },
      fetterInfo: info ? { file: inputs.fetterInfo.relativePath, row: info } : null,
      story: { file: inputs.fetterStory.relativePath, row: story },
      text: {
        name: nameValue.raw,
        title: titleValue.raw,
        body: bodyValue.raw,
        summary: summaryValue?.raw,
      },
    });
    const verificationRiskFlags = [
      ...(primaryTitleValue ? [] : ["fallback_field"]),
      ...(primaryBodyValue ? [] : ["fallback_field"]),
      ...(infoSummaryValue ? [] : avatarSummaryValue ? ["fallback_field"] : []),
      ...(hasFormatTags(nameValue.raw) ||
      hasFormatTags(titleValue.raw) ||
      hasFormatTags(bodyValue.raw) ||
      hasFormatTags(summaryValue?.raw)
        ? ["format_tags"]
        : []),
    ];
    characterStories.push(
      makeRecord(
        context,
        baseRecord,
        {
          avatar: avatarLineage,
          fetterStory: storyLineage,
          ...(infoLineage ? { fetterInfo: infoLineage } : {}),
          name: nameLineage,
          title: normalizedTitleLineage,
          body: bodyLineage,
          ...(summaryLineage ? { entitySummary: summaryLineage } : {}),
        },
        rawContentHash,
        [
          "Avatar.id→FetterStory.avatarId",
          "FetterStory TextMap hash resolution",
          "TextMap_MediumCHS hash resolution",
          "TextMap markup cleanup and line-ending normalization",
        ],
        {
          canonicalKey: sourceKey,
          sourceFiles: [
            inputs.avatar.relativePath,
            inputs.fetterStory.relativePath,
            ...(info ? [inputs.fetterInfo.relativePath] : []),
            textMap.relativePath,
          ],
          upstreamIds: { avatarId, fetterId },
          textMapHashes: {
            name: nameValue.hash,
            title: titleValue.hash,
            body: bodyValue.hash,
            ...(summaryValue ? { summary: summaryValue.hash } : {}),
          },
          verificationRiskFlags,
        },
      ),
    );
  }

  const materialCodexRows = sortedRows(inputs.materialCodex.value, ["id", "materialId"]);
  const materialMappingCounts = new Map<number, number>();
  for (const { row: codex } of materialCodexRows) {
    const materialId = idValue(codex.materialId);
    if (materialId !== undefined) {
      materialMappingCounts.set(materialId, (materialMappingCounts.get(materialId) ?? 0) + 1);
    }
  }
  const itemKeys = new Set<string>();
  for (const { row: codex, rawHash: codexRawHash } of materialCodexRows) {
    const codexId = idValue(codex.id);
    const materialId = idValue(codex.materialId);
    const fallbackId = rowId(codex, ["id", "materialId"], codexRawHash);
    if (codexId === undefined || materialId === undefined) {
      addFailure(failures, "item_description", fallbackId, "upstream_id_missing");
      continue;
    }
    const sourceKey = `item-codex/${codexId}`;
    if (itemKeys.has(sourceKey)) {
      addExcluded(excludedEntries, "item_description", String(codexId), "duplicate_canonical_key");
      continue;
    }
    itemKeys.add(sourceKey);
    const material = materials.get(materialId);
    if (!material) {
      addFailure(failures, "item_description", String(codexId), "material_missing");
      continue;
    }
    const nameValue = textValue(material.nameTextMapHash, textMap, materialId);
    const codexTitleValue = textValue(codex.nameTextMapHash, textMap, codexId);
    const titleValue = codexTitleValue ?? nameValue;
    const candidateParagraphs = [
      textValue(codex.descTextMapHash, textMap, codexId),
      textValue(material.descTextMapHash, textMap, materialId),
      textValue(material.specialDescTextMapHash, textMap, materialId),
      textValue(material.effectDescTextMapHash, textMap, materialId),
    ];
    if (!nameValue || !titleValue) {
      addFailure(failures, "item_description", String(codexId), "item_name_missing");
      continue;
    }
    if (
      hasAnyReplacement([
        nameValue.raw,
        titleValue.raw,
        ...candidateParagraphs.flatMap((paragraph) => (paragraph ? [paragraph.raw] : [])),
      ])
    ) {
      addFailure(failures, "item_description", String(codexId), "replacement_character");
      continue;
    }
    const paragraphs = uniqueText(candidateParagraphs.map((paragraph) => paragraph?.value));
    if (!paragraphs.length) {
      addFailure(failures, "item_description", String(codexId), "body_missing");
      continue;
    }
    const codexLineage = sourceRowLineage(inputs.materialCodex, codex, codexId);
    const materialLineage = sourceRowLineage(inputs.material, material, materialId);
    const nameLineage = textLineage(nameValue, materialId);
    const titleLineage = codexTitleValue
      ? textLineage(codexTitleValue, codexId)
      : textLineage(nameValue, materialId);
    const materialSummaryValue = textValue(material.descTextMapHash, textMap, materialId);
    const paragraphLineages = candidateParagraphs
      .filter((paragraph): paragraph is TextValue => paragraph !== undefined)
      .map((paragraph) => textLineage(paragraph, { codexId, materialId }));
    const bodyLineage = composedLineage(paragraphLineages);
    const entity = {
      sourceKey: `item/${materialId}`,
      name: nameValue.value,
      type: "item" as const,
      ...(materialSummaryValue ? { summary: materialSummaryValue.value } : {}),
      properties: {
        materialId,
        itemType: stringValue(material.itemType),
        materialType: stringValue(material.materialType),
        rankLevel: idValue(material.rankLevel),
        icon: stringValue(material.icon),
      },
    };
    const baseRecord = {
      sourceKey,
      recordType: "document" as const,
      title: titleValue.value,
      documentType: "item_description" as const,
      gameVersion: context.gameVersion,
      body: paragraphs.join("\n\n"),
      entities: [entity],
    };
    const rawContentHash = rawHashFor({
      codex: { file: inputs.materialCodex.relativePath, row: codex },
      material: { file: inputs.material.relativePath, row: material },
      text: {
        name: nameValue.raw,
        title: titleValue.raw,
        paragraphs: candidateParagraphs.map((paragraph) => paragraph?.raw),
      },
    });
    const verificationRiskFlags = [
      ...(codexTitleValue ? [] : ["fallback_field"]),
      ...((materialMappingCounts.get(materialId) ?? 0) > 1 ? ["duplicate_item_mapping"] : []),
      ...(hasFormatTags(nameValue.raw) ||
      hasFormatTags(titleValue.raw) ||
      candidateParagraphs.some((paragraph) => hasFormatTags(paragraph?.raw))
        ? ["format_tags"]
        : []),
    ];
    items.push(
      makeRecord(
        context,
        baseRecord,
        {
          materialCodex: codexLineage,
          material: materialLineage,
          name: nameLineage,
          title: titleLineage,
          body: bodyLineage,
          entityName: nameLineage,
          ...(materialSummaryValue
            ? { entitySummary: textLineage(materialSummaryValue, materialId) }
            : {}),
        },
        rawContentHash,
        [
          "MaterialCodex.materialId→Material.id",
          "MaterialCodex/Material TextMap hash resolution",
          "TextMap markup cleanup and line-ending normalization",
          "Duplicate paragraph removal",
        ],
        {
          canonicalKey: sourceKey,
          sourceFiles: [
            inputs.materialCodex.relativePath,
            inputs.material.relativePath,
            textMap.relativePath,
          ],
          upstreamIds: { codexId, materialId },
          textMapHashes: {
            name: nameValue.hash,
            title: titleValue.hash,
            paragraphs: candidateParagraphs
              .filter((paragraph): paragraph is TextValue => paragraph !== undefined)
              .map((paragraph) => paragraph.hash),
          },
          sortOrder: idValue(codex.sortOrder),
          verificationRiskFlags,
        },
      ),
    );
  }

  books.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  characterStories.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  items.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  mechanisms.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));

  const records = { books, characterStories, items, mechanisms };
  const seenRecordKeys = new Set<string>();
  const seenEntityKeys = new Set<string>();
  for (const record of [...books, ...characterStories, ...items, ...mechanisms]) {
    if (seenRecordKeys.has(record.sourceKey)) {
      throw new Error(`Duplicate sourceKey after conversion: ${record.sourceKey}`);
    }
    seenRecordKeys.add(record.sourceKey);
    for (const entityKey of recordEntitySourceKey(record)) seenEntityKeys.add(entityKey);
    if (!record.title.trim() || !record.body.trim()) {
      throw new Error(`Empty title or body after conversion: ${record.sourceKey}`);
    }
    if (stableStringify(record).includes("\uFFFD")) {
      throw new Error(`Replacement character after conversion: ${record.sourceKey}`);
    }
  }

  const discovered: Record<CategoryPlural, number> = {
    books: asArray(inputs.booksCodex.value).length,
    characterStories: asArray(inputs.fetterStory.value).length,
    itemDescriptions: asArray(inputs.materialCodex.value).length,
    mechanisms: mechanismResult.coverage.discovered,
  };
  const converted: Record<CategoryPlural, number> = {
    books: books.length,
    characterStories: characterStories.length,
    itemDescriptions: items.length,
    mechanisms: mechanisms.length,
  };
  const excluded: Record<CategoryPlural, number> = {
    books: countExcluded(excludedEntries, "book"),
    characterStories: countExcluded(excludedEntries, "character_story"),
    itemDescriptions: countExcluded(excludedEntries, "item_description"),
    mechanisms: countExcluded(excludedEntries, "mechanism"),
  };
  const accounting = Object.fromEntries(
    PLURALS.map((plural) => {
      const category = CATEGORY_BY_PLURAL[plural];
      const categoryFailures = countFailures(failures, category);
      const accounted = converted[plural] + excluded[plural] + categoryFailures;
      const total = discovered[plural];
      return [
        plural,
        {
          discovered: total,
          converted: converted[plural],
          excluded: excluded[plural],
          failures: categoryFailures,
          accounted,
          coverage: total === 0 ? 1 : accounted / total,
        },
      ];
    }),
  ) as ConversionManifest["accounting"];
  const unexplainedMissing = PLURALS.flatMap((plural) => {
    const entry = accounting[plural];
    return entry.accounted === entry.discovered
      ? []
      : [{ category: plural, count: entry.discovered - entry.accounted }];
  });
  const accountedCoverage = Object.fromEntries(
    PLURALS.map((plural) => [plural, accounting[plural].coverage]),
  ) as Record<CategoryPlural, number>;
  const coverage = Object.fromEntries(
    PLURALS.map((plural) => {
      const total = discovered[plural];
      return [plural, total === 0 ? 0 : converted[plural] / total];
    }),
  ) as Record<CategoryPlural, number>;

  const manifest: ConversionResult["manifest"] = {
    schemaVersion: 2,
    upstream: {
      commit: context.upstreamCommit,
      version: context.upstreamVersion,
      commitDate: context.upstreamCommitDate,
      subject: context.upstreamVersionLabel,
    },
    gameVersion: context.gameVersion,
    locale: context.locale,
    language: context.language,
    rightsStatus: context.rightsStatus,
    converterVersion: context.converterVersion,
    discovered,
    converted,
    excluded,
    excludedEntries: sortedExcluded(excludedEntries),
    failures: sortedFailures(failures),
    accountedCoverage,
    accounting,
    coverage,
    unexplainedMissing,
    inputHashes: {
      ...inputHashes(inputs, readableHashes),
      ...mechanismResult.inputHashes,
    },
  };
  return { records, manifest };
}

function titleLineageWithUpstreamId(value: TextValue, upstreamId: UpstreamId): FieldLineage {
  return { ...value.lineage, upstreamId };
}

export async function writeConversionResult(
  result: ConversionResult,
  outputRoot: string,
  generatedAt = new Date().toISOString(),
): Promise<ConversionManifest> {
  const absoluteOutputRoot = resolve(outputRoot);
  const recordsDir = resolve(absoluteOutputRoot, "records");
  await mkdir(recordsDir, { recursive: true });
  const writeJson = async (path: string, value: unknown): Promise<void> => {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };
  await Promise.all([
    writeJson(resolve(recordsDir, "books.json"), result.records.books),
    writeJson(resolve(recordsDir, "character-stories.json"), result.records.characterStories),
    writeJson(resolve(recordsDir, "items.json"), result.records.items),
    writeJson(resolve(recordsDir, "mechanisms.json"), result.records.mechanisms),
  ]);
  const manifest: ConversionManifest = {
    ...result.manifest,
    generatedAt,
    outputRecordsPath: relative(process.cwd(), recordsDir) || ".",
  };
  await writeJson(resolve(absoluteOutputRoot, "manifest.json"), manifest);
  return manifest;
}
