import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import type { TalkAssetRecord, TalkDialogueRow, TalkSourceKind } from "./types.js";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function arrayOfIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(idText).filter((item): item is string => Boolean(item));
}

function hashText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  const object = asObject(value);
  return idText(object.hash ?? object.textMapHash ?? object.value);
}

function firstObject(value: unknown, keys: string[]): Json | undefined {
  const object = asObject(value);
  for (const key of keys) {
    const candidate = asObject(object[key]);
    if (Object.keys(candidate).length) return candidate;
  }
  return undefined;
}

function rowId(row: Json): string | undefined {
  return idText(
    row.dialogId ??
      row.GFLDJMJKIKE ??
      row.OIFGMOHKPOI ??
      row.NFIEHACCECI ??
      row.dialogueId ??
      row.id,
  );
}

function normalizeRow(
  row: Json,
  sourceFile: string,
  sourcePath: string,
  schemaKey: string,
): TalkDialogueRow | undefined {
  const dialogId = rowId(row);
  if (!dialogId) return undefined;
  const nextDialogIds = arrayOfIds(
    row.nextDialogIds ?? row.nextDialogs ?? row.KMLAFCBMFEI ?? row.GBLICFDCPCK,
  );
  const role = firstObject(row, ["talkRole", "role", "LFGCLNLPAPB", "PIBKEGJOJHN"]);
  const roleType = typeof role?._type === "string" ? role?._type : typeof role?.type === "string" ? role.type : undefined;
  const roleId = idText(role?._id ?? role?.id ?? role?.roleId);
  const bodyHash = hashText(
    row.talkContentTextMapHash ??
      row.bodyTextMapHash ??
      row.OACNIBLFFDI ??
      row.AIGJBMCHCJG ??
      row.contentTextMapHash,
  );
  const speakerNameHash = hashText(
    row.talkRoleNameTextMapHash ??
      row.speakerNameTextMapHash ??
      row.BKABCBAFIKD ??
      row.BMFGJJJPBBC,
  );
  return {
    dialogId,
    nextDialogIds,
    roleType,
    roleId,
    bodyHash,
    speakerNameHash,
    sourceFile,
    sourcePath,
    schemaKey,
  };
}

function collectDialogueRows(value: Json, sourceFile: string): TalkDialogueRow[] {
  const rows: TalkDialogueRow[] = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (!Array.isArray(candidate)) continue;
    for (const [index, item] of candidate.entries()) {
      const row = asObject(item);
      const normalized = normalizeRow(row, sourceFile, `${key}[${index}]`, key);
      if (normalized) rows.push(normalized);
    }
  }
  return rows;
}

function assetId(value: Json, relativePath: string): string | undefined {
  const fileStem = basename(relativePath, extname(relativePath));
  const metadataId = idText(
    value.talkId ??
      value.mainTalkId ??
      value.IOKNFDJFGDH ??
      value.AADKDKPMGNO ??
      value.GDDPNNHLGBL ??
      value.id,
  );
  // Hashed and zero-padded filenames are aliases.  The embedded asset ID is
  // the authoritative relation whenever it exists; only fall back to a
  // numeric filename when the file carries no explicit ID metadata.
  return metadataId ?? (/^\d+$/u.test(fileStem) ? fileStem : undefined);
}

export function schemaSignature(value: Json): string {
  return Object.keys(value).sort().join(",");
}

export function parseTalkAsset(
  raw: string | Uint8Array,
  relativePath: string,
  sourceKind: TalkSourceKind,
): TalkAssetRecord {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const value = asObject(JSON.parse(text));
  const rows = collectDialogueRows(value, relativePath);
  const ids = new Set(rows.map((row) => row.dialogId));
  const referenced = new Set(rows.flatMap((row) => row.nextDialogIds));
  return {
    talkId: assetId(value, relativePath),
    sourceKind,
    relativePath,
    fileHash: createHash("sha256").update(text).digest("hex"),
    schemaSignature: schemaSignature(value),
    dialogueRows: rows,
    rootDialogueIds: [...ids].filter((id) => !referenced.has(id)),
    referencedDialogueIds: [...referenced],
    metadata: {
      topLevelKeys: Object.keys(value).sort(),
      dialogueRowCount: rows.length,
    },
  };
}

export function parseTalkAssetValue(
  value: Json,
  relativePath: string,
  sourceKind: TalkSourceKind,
  fileHash = "",
): TalkAssetRecord {
  const rows = collectDialogueRows(value, relativePath);
  const ids = new Set(rows.map((row) => row.dialogId));
  const referenced = new Set(rows.flatMap((row) => row.nextDialogIds));
  return {
    talkId: assetId(value, relativePath),
    sourceKind,
    relativePath,
    fileHash,
    schemaSignature: schemaSignature(value),
    dialogueRows: rows,
    rootDialogueIds: [...ids].filter((id) => !referenced.has(id)),
    referencedDialogueIds: [...referenced],
    metadata: {
      topLevelKeys: Object.keys(value).sort(),
      dialogueRowCount: rows.length,
    },
  };
}
