import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import type {
  ClaimCandidate,
  EntityCandidate,
  ImportDiff,
  NormalizedRecord,
  RelationshipCandidate,
  ValidationIssue,
} from "@gip/domain";
import { validateNormalizedRecords } from "@gip/domain";

export const PARSER_VERSION = "1.0.0";

export type SourceType = "local_json" | "local_markdown" | "local_text" | "local_directory";

export type SourceInput = {
  sourceId: string;
  type: SourceType;
  path: string;
  storageDir: string;
};

export type SourceInspection = {
  type: SourceType;
  displayName: string;
  fileCount: number;
  bytes: number;
  supported: boolean;
  warnings: string[];
};

export type SourceSnapshotData = {
  sourceId: string;
  contentHash: string;
  storagePath: string;
  capturedAt: Date;
  metadata: Record<string, unknown>;
  files: Array<{ relativePath: string; content: string }>;
};

export type RawRecord = {
  sourceKey: string;
  recordType: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export interface SourceAdapter {
  inspect(input: SourceInput): Promise<SourceInspection>;
  snapshot(input: SourceInput): Promise<SourceSnapshotData>;
  parse(snapshot: SourceSnapshotData): AsyncIterable<RawRecord>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function fileEntry(path: string): Promise<{ relativePath: string; content: string }> {
  return { relativePath: basename(path), content: await readFile(path, "utf8") };
}

async function snapshotFiles(
  input: SourceInput,
  files: Array<{ relativePath: string; content: string }>,
  metadata: Record<string, unknown>,
): Promise<SourceSnapshotData> {
  const manifest = JSON.stringify(
    files.map((file) => ({
      path: file.relativePath,
      hash: sha256(file.content),
      bytes: Buffer.byteLength(file.content),
    })),
  );
  const contentHash = sha256(`${manifest}\n${files.map((file) => file.content).join("\n")}`);
  const snapshotDirectory = resolve(input.storageDir, "snapshots", input.sourceId);
  await mkdir(snapshotDirectory, { recursive: true });
  const storagePath = resolve(snapshotDirectory, `${contentHash}.json`);
  const serialized = JSON.stringify({ files, metadata, contentHash }, null, 2);
  try {
    await writeFile(storagePath, serialized, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(storagePath, "utf8"));
    } catch {
      throw new Error(`Immutable snapshot is unreadable: ${storagePath}`);
    }
    const existingObject = asObject(existing);
    const existingFiles = Array.isArray(existingObject.files) ? existingObject.files : [];
    if (
      existingObject.contentHash !== contentHash ||
      JSON.stringify(existingFiles) !== JSON.stringify(files)
    )
      throw new Error(`Immutable snapshot content mismatch: ${storagePath}`);
  }
  return {
    sourceId: input.sourceId,
    contentHash,
    storagePath,
    capturedAt: new Date(),
    metadata: { ...metadata, fileCount: files.length },
    files,
  };
}

export class LocalJsonAdapter implements SourceAdapter {
  async inspect(input: SourceInput): Promise<SourceInspection> {
    const info = await stat(input.path);
    return {
      type: "local_json",
      displayName: basename(input.path),
      fileCount: 1,
      bytes: info.size,
      supported: extname(input.path).toLowerCase() === ".json",
      warnings: [],
    };
  }

  async snapshot(input: SourceInput): Promise<SourceSnapshotData> {
    return snapshotFiles(input, [await fileEntry(input.path)], { adapter: "local_json" });
  }

  async *parse(snapshot: SourceSnapshotData): AsyncIterable<RawRecord> {
    const file = snapshot.files[0];
    if (!file) return;
    const parsed: unknown = JSON.parse(file.content);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    for (let index = 0; index < records.length; index += 1) {
      const payload = asObject(records[index]);
      yield {
        sourceKey: String(payload.sourceKey ?? payload.id ?? `${file.relativePath}#${index + 1}`),
        recordType: String(payload.recordType ?? payload.type ?? "document"),
        payload,
        metadata: { file: file.relativePath, index },
      };
    }
  }
}

export class LocalMarkdownAdapter implements SourceAdapter {
  async inspect(input: SourceInput): Promise<SourceInspection> {
    const info = await stat(input.path);
    return {
      type: "local_markdown",
      displayName: basename(input.path),
      fileCount: 1,
      bytes: info.size,
      supported: [".md", ".markdown"].includes(extname(input.path).toLowerCase()),
      warnings: [],
    };
  }

  async snapshot(input: SourceInput): Promise<SourceSnapshotData> {
    return snapshotFiles(input, [await fileEntry(input.path)], { adapter: "local_markdown" });
  }

  async *parse(snapshot: SourceSnapshotData): AsyncIterable<RawRecord> {
    const file = snapshot.files[0];
    if (!file) return;
    const heading = /^#\s+(.+)$/m.exec(file.content);
    yield {
      sourceKey: file.relativePath,
      recordType: "document",
      payload: {
        title: heading?.[1] ?? file.relativePath,
        body: file.content,
        documentType: "lore",
      },
      metadata: { file: file.relativePath },
    };
  }
}

export class LocalTextAdapter implements SourceAdapter {
  async inspect(input: SourceInput): Promise<SourceInspection> {
    const info = await stat(input.path);
    return {
      type: "local_text",
      displayName: basename(input.path),
      fileCount: 1,
      bytes: info.size,
      supported: true,
      warnings: [],
    };
  }

  async snapshot(input: SourceInput): Promise<SourceSnapshotData> {
    return snapshotFiles(input, [await fileEntry(input.path)], { adapter: "local_text" });
  }

  async *parse(snapshot: SourceSnapshotData): AsyncIterable<RawRecord> {
    const file = snapshot.files[0];
    if (!file) return;
    yield {
      sourceKey: file.relativePath,
      recordType: "document",
      payload: { title: file.relativePath, body: file.content, documentType: "lore" },
      metadata: { file: file.relativePath },
    };
  }
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

export class LocalDirectoryAdapter implements SourceAdapter {
  async inspect(input: SourceInput): Promise<SourceInspection> {
    const paths = await walk(input.path);
    const supportedExtensions = new Set([".json", ".md", ".markdown", ".txt", ".text"]);
    const supportedPaths = paths.filter((path) =>
      supportedExtensions.has(extname(path).toLowerCase()),
    );
    const sizes = await Promise.all(supportedPaths.map(async (path) => (await stat(path)).size));
    return {
      type: "local_directory",
      displayName: basename(input.path),
      fileCount: supportedPaths.length,
      bytes: sizes.reduce((sum, size) => sum + size, 0),
      supported: true,
      warnings:
        paths.length === supportedPaths.length
          ? []
          : [`Ignored ${paths.length - supportedPaths.length} unsupported files`],
    };
  }

  async snapshot(input: SourceInput): Promise<SourceSnapshotData> {
    const paths = await walk(input.path);
    const supportedExtensions = new Set([".json", ".md", ".markdown", ".txt", ".text"]);
    const files = await Promise.all(
      paths
        .filter((path) => supportedExtensions.has(extname(path).toLowerCase()))
        .map(async (path) => ({
          relativePath: relative(input.path, path).split(sep).join("/"),
          content: await readFile(path, "utf8"),
        })),
    );
    return snapshotFiles(input, files, {
      adapter: "local_directory",
      rootLabel: basename(input.path),
    });
  }

  async *parse(snapshot: SourceSnapshotData): AsyncIterable<RawRecord> {
    for (const file of snapshot.files) {
      const extension = extname(file.relativePath).toLowerCase();
      if (extension === ".json") {
        const parsed: unknown = JSON.parse(file.content);
        const records = Array.isArray(parsed) ? parsed : [parsed];
        for (let index = 0; index < records.length; index += 1) {
          const payload = asObject(records[index]);
          yield {
            sourceKey: String(
              payload.sourceKey ?? payload.id ?? `${file.relativePath}#${index + 1}`,
            ),
            recordType: String(payload.recordType ?? payload.type ?? "document"),
            payload,
            metadata: { file: file.relativePath, index },
          };
        }
      } else if (extension === ".md" || extension === ".markdown") {
        const heading = /^#\s+(.+)$/m.exec(file.content);
        yield {
          sourceKey: file.relativePath,
          recordType: "document",
          payload: {
            title: heading?.[1] ?? file.relativePath,
            body: file.content,
            documentType: "lore",
          },
          metadata: { file: file.relativePath },
        };
      } else {
        yield {
          sourceKey: file.relativePath,
          recordType: "document",
          payload: { title: file.relativePath, body: file.content, documentType: "lore" },
          metadata: { file: file.relativePath },
        };
      }
    }
  }
}

export function adapterFor(type: SourceType): SourceAdapter {
  switch (type) {
    case "local_json":
      return new LocalJsonAdapter();
    case "local_markdown":
      return new LocalMarkdownAdapter();
    case "local_text":
      return new LocalTextAdapter();
    case "local_directory":
      return new LocalDirectoryAdapter();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAliases(value: unknown): EntityCandidate["aliases"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ value: item, language: "und", primary: false }];
    const object = asObject(item);
    const alias = stringValue(object.value ?? object.name ?? object.alias);
    return alias
      ? [
          {
            value: alias,
            language: stringValue(object.language) ?? "und",
            primary: object.primary === true || object.isPrimary === true,
          },
        ]
      : [];
  });
}

function normalizeEntities(
  value: unknown,
  defaultSourceKey: string,
  defaultType?: EntityCandidate["type"],
): EntityCandidate[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item, index) => {
    const object = asObject(item);
    const name = stringValue(object.name ?? object.canonicalName ?? object.title);
    if (!name) return [];
    const sourceKey =
      stringValue(object.sourceKey ?? object.id) ?? `${defaultSourceKey}:entity:${index + 1}`;
    return [
      {
        sourceKey,
        name,
        type: (stringValue(object.entityType ?? object.type) ??
          defaultType ??
          "concept") as EntityCandidate["type"],
        summary: stringValue(object.summary ?? object.description),
        aliases: normalizeAliases(object.aliases ?? object.alternativeNames),
        properties: asObject(object.properties ?? object.metadata),
      },
    ];
  });
}

function normalizeRelationships(value: unknown): RelationshipCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = asObject(item);
    const subjectSourceKey = stringValue(object.subjectSourceKey ?? object.subject ?? object.from);
    const objectSourceKey = stringValue(object.objectSourceKey ?? object.object ?? object.to);
    const predicate = stringValue(object.predicate ?? object.type) as
      RelationshipCandidate["predicate"] | undefined;
    if (!subjectSourceKey || !objectSourceKey || !predicate) return [];
    return [
      {
        subjectSourceKey,
        objectSourceKey,
        predicate,
        confidence: numberValue(object.confidence),
        validFrom: stringValue(object.validFrom),
        validTo: stringValue(object.validTo),
      },
    ];
  });
}

function normalizeClaims(value: unknown, defaultSourceKey: string): ClaimCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const object = asObject(item);
    const statement = stringValue(object.statement ?? object.normalizedStatement);
    const status = stringValue(object.status) as ClaimCandidate["status"] | undefined;
    if (!statement || !status) return [];
    const evidence = Array.isArray(object.evidence)
      ? object.evidence.flatMap((rawEvidence) => {
          const evidenceObject = asObject(rawEvidence);
          const documentSourceKey = stringValue(
            evidenceObject.documentSourceKey ?? evidenceObject.document ?? defaultSourceKey,
          );
          return documentSourceKey
            ? [
                {
                  documentSourceKey,
                  quote: stringValue(evidenceObject.quote),
                  strength: numberValue(evidenceObject.strength),
                  note: stringValue(evidenceObject.note),
                },
              ]
            : [];
        })
      : undefined;
    const entitySourceKeys = Array.isArray(object.entitySourceKeys)
      ? object.entitySourceKeys.flatMap((value) => (typeof value === "string" ? [value] : []))
      : undefined;
    return [
      {
        sourceKey: stringValue(object.sourceKey) ?? `${defaultSourceKey}:claim:${index + 1}`,
        statement,
        status,
        confidence: numberValue(object.confidence),
        createdBy:
          (stringValue(object.createdBy) as ClaimCandidate["createdBy"] | undefined) ?? "import",
        entitySourceKeys,
        evidence,
      },
    ];
  });
}

export function normalizeRawRecord(
  raw: RawRecord,
  parserVersion = PARSER_VERSION,
): NormalizedRecord {
  const payload = raw.payload;
  const resolvedParserVersion = stringValue(payload.parserVersion) ?? parserVersion;
  const body = stringValue(payload.body ?? payload.content ?? payload.text);
  const title = stringValue(payload.title ?? payload.name);
  const entityType = stringValue(payload.entityType) as NormalizedRecord["entityType"] | undefined;
  const documentType = stringValue(payload.documentType) as
    NormalizedRecord["documentType"] | undefined;
  const ownEntity =
    entityType && title
      ? normalizeEntities(
          [{ ...payload, sourceKey: raw.sourceKey, name: title, entityType }],
          raw.sourceKey,
          entityType,
        )
      : [];
  const entities = [
    ...ownEntity,
    ...normalizeEntities(payload.entities ?? payload.entity, raw.sourceKey),
  ];
  const normalized: Omit<NormalizedRecord, "contentHash"> = {
    sourceKey: raw.sourceKey,
    recordType: raw.recordType,
    title,
    body,
    entityType,
    documentType,
    gameVersion: stringValue(payload.gameVersion ?? payload.version),
    entities,
    relationships: normalizeRelationships(payload.relationships ?? payload.relations),
    claims: normalizeClaims(payload.claims, raw.sourceKey),
    metadata: { ...raw.metadata, ...asObject(payload.metadata), parserRecordType: raw.recordType },
    parserVersion: resolvedParserVersion,
  };
  return { ...normalized, contentHash: sha256(JSON.stringify(normalized)) };
}

export async function normalizeSnapshot(
  snapshot: SourceSnapshotData,
  adapter: SourceAdapter,
  parserVersion = PARSER_VERSION,
): Promise<{ records: NormalizedRecord[]; parseIssues: ValidationIssue[] }> {
  const records: NormalizedRecord[] = [];
  const parseIssues: ValidationIssue[] = [];
  try {
    for await (const raw of adapter.parse(snapshot)) {
      try {
        records.push(normalizeRawRecord(raw, parserVersion));
      } catch (error) {
        parseIssues.push({
          severity: "error",
          code: "record_parse_failed",
          message: error instanceof Error ? error.message : "Record parsing failed",
          sourceKey: raw.sourceKey,
        });
      }
    }
  } catch (error) {
    parseIssues.push({
      severity: "error",
      code: "source_parse_failed",
      message: error instanceof Error ? error.message : "Source parsing failed",
    });
  }
  return { records, parseIssues };
}

export function computeDiff(
  records: NormalizedRecord[],
  previous: Map<string, string> = new Map(),
  issues: ValidationIssue[] = [],
): ImportDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  for (const record of records) {
    const oldHash = previous.get(record.sourceKey);
    if (!oldHash) added.push(record.sourceKey);
    else if (oldHash === record.contentHash) unchanged.push(record.sourceKey);
    else modified.push(record.sourceKey);
  }
  const currentKeys = new Set(records.map((record) => record.sourceKey));
  const deletionCandidates = [...previous.keys()].filter((key) => !currentKeys.has(key));
  const conflicts = [
    ...new Set(
      issues
        .filter((issue) => issue.code === "duplicate_source_key" || issue.code.includes("conflict"))
        .map((issue) => issue.sourceKey)
        .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
    ),
  ];
  const unparsed = [
    ...new Set(
      issues
        .filter((issue) => issue.code.includes("parse") || issue.code === "invalid_encoding")
        .map((issue) => issue.sourceKey ?? "<source>"),
    ),
  ];
  return { added, modified, deletionCandidates, unchanged, conflicts, unparsed };
}

export function validateImport(
  records: NormalizedRecord[],
  parseIssues: ValidationIssue[] = [],
  previousKeys: Map<string, string> = new Map(),
  knownEntityKeys: Set<string> = new Set(),
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const issues = [...parseIssues, ...validateNormalizedRecords(records, knownEntityKeys)];
  if (!records.length && !parseIssues.length) {
    issues.push({
      severity: "error",
      code: "no_records",
      message: "Source did not produce any records",
    });
  }
  const currentKeys = new Set(records.map((record) => record.sourceKey));
  const deletionCount = [...previousKeys.keys()].filter((key) => !currentKeys.has(key)).length;
  if (previousKeys.size > 0 && deletionCount / previousKeys.size > 0.3) {
    issues.push({
      severity: "warning",
      code: "abnormal_deletion_ratio",
      message: `Import removes ${deletionCount} of ${previousKeys.size} previous records; manual review is required`,
    });
  }
  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning" || issue.severity === "info"),
  };
}

export * from "./genshin-db-adapter.js";
