import { inArray } from "drizzle-orm";
import type { EntitySummary } from "@gip/contracts";
import type { Database } from "./client.js";
import { documents, entityAliases, evidence } from "./schema.js";

export async function addAliases(db: Database, rows: EntitySummary[]): Promise<EntitySummary[]> {
  if (!rows.length) return rows;
  const aliasRows = await db
    .select()
    .from(entityAliases)
    .where(
      inArray(
        entityAliases.entityId,
        rows.map((row) => row.id),
      ),
    );
  const map = new Map<string, string[]>();
  for (const alias of aliasRows)
    map.set(alias.entityId, [...(map.get(alias.entityId) ?? []), alias.value]);
  return rows.map((row) => ({ ...row, aliases: map.get(row.id) ?? [] }));
}

export async function getAliases(
  db: Database,
  entityIds: string[],
): Promise<Map<string, string[]>> {
  if (!entityIds.length) return new Map();
  const rows = await db
    .select()
    .from(entityAliases)
    .where(inArray(entityAliases.entityId, entityIds));
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.entityId, [...(map.get(row.entityId) ?? []), row.value]);
  return map;
}

export async function evidenceViews(db: Database, rows: Array<typeof evidence.$inferSelect>) {
  if (!rows.length) return [];
  const docIds = [...new Set(rows.map((row) => row.documentId))];
  const docs = await db.select().from(documents).where(inArray(documents.id, docIds));
  const names = new Map(docs.map((row) => [row.id, row.title]));
  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentTitle: names.get(row.documentId) ?? "",
    segmentId: row.segmentId,
    quote: row.quote,
    strength: row.strength,
    note: row.note,
  }));
}
