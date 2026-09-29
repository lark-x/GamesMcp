import { loadConfig } from "../packages/config/src/index.ts";
import type { NormalizedRecord } from "@gip/domain";
import { createPool } from "../packages/database/src/client.ts";
import {
  buildSharedQuestContentPack,
  SHARED_QUEST_CONTENT_SEMANTICS_VERSION,
} from "../packages/database/src/quest-content-sharing.ts";
import type { SharedQuestContentPack } from "../packages/database/src/quest-content-sharing.ts";
import type { PoolClient } from "pg";

const TARGET_REVISION_ID = "3ac03918-78d9-4f9c-bf89-754fb5cdc337";
const DEFAULT_CHUNK_SIZE = 100;

type Options = { revisionId: string; apply: boolean; chunkSize: number };
type QuestDocument = {
  document_id: string;
  source_key: string;
  payload: NormalizedRecord;
  content_hash: string | null;
};

function parseOptions(argv: string[]): Options {
  const args = new Map(
    argv
      .filter((value) => value.startsWith("--"))
      .map((value) => {
        const index = value.indexOf("=");
        return index < 0
          ? [value.slice(2), "true"]
          : [value.slice(2, index), value.slice(index + 1)];
      }),
  );
  const revisionId = args.get("revision");
  if (revisionId !== TARGET_REVISION_ID)
    throw new Error(`This guarded backfill only accepts --revision=${TARGET_REVISION_ID}`);
  const chunkSize = Number(args.get("chunk-size") ?? DEFAULT_CHUNK_SIZE);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500)
    throw new Error("--chunk-size must be an integer from 1 to 500");
  return { revisionId, apply: args.has("apply"), chunkSize };
}

async function loadClaimEvidenceKeys(client: PoolClient, manifestId: string): Promise<Set<string>> {
  const result = await client.query<{ source_key: string }>(
    `select distinct evidence->>'documentSourceKey' as source_key
       from knowledge.dataset_manifest_entries entry
       join knowledge.content_objects object on object.content_hash = entry.content_hash
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(object.payload->'claims') = 'array'
           then object.payload->'claims' else '[]'::jsonb end
       ) claim
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(claim->'evidence') = 'array'
           then claim->'evidence' else '[]'::jsonb end
       ) evidence
      where entry.manifest_id = $1::uuid
        and nullif(evidence->>'documentSourceKey', '') is not null`,
    [manifestId],
  );
  return new Set(result.rows.map((row) => row.source_key));
}

async function insertJsonRows(
  client: PoolClient,
  tableName: string,
  columns: Array<[string, string]>,
  rows: Array<Record<string, unknown>>,
  returning?: string,
): Promise<Array<Record<string, unknown>>> {
  if (!rows.length) return [];
  const names = columns.map(([name]) => name);
  const recordShape = columns.map(([name, type]) => `"${name}" ${type}`).join(", ");
  const result = await client.query(
    `insert into knowledge.${tableName} (${names.map((name) => `"${name}"`).join(", ")})
     select ${names.map((name) => `row_data."${name}"`).join(", ")}
       from jsonb_to_recordset($1::jsonb) as row_data(${recordShape})
     on conflict do nothing${returning ? ` returning ${returning}` : ""}`,
    [JSON.stringify(rows)],
  );
  return result.rows as Array<Record<string, unknown>>;
}

async function insertChunked(
  client: PoolClient,
  tableName: string,
  columns: Array<[string, string]>,
  rows: Array<Record<string, unknown>>,
  returning?: string,
): Promise<Array<Record<string, unknown>>> {
  const inserted: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < rows.length; offset += 1_500) {
    inserted.push(
      ...(await insertJsonRows(
        client,
        tableName,
        columns,
        rows.slice(offset, offset + 1_500),
        returning,
      )),
    );
  }
  return inserted;
}

function flattenUniquePacks(
  records: Array<{ record: NormalizedRecord; pack: SharedQuestContentPack }>,
) {
  return [...new Map(records.map(({ pack }) => [pack.contentHash, pack])).values()];
}

async function insertNewContent(
  client: PoolClient,
  packs: SharedQuestContentPack[],
  gameId: string,
) {
  const created = await insertChunked(
    client,
    "quest_content_objects",
    [
      ["content_hash", "text"],
      ["semantics_version", "integer"],
    ],
    packs.map((pack) => ({
      content_hash: pack.contentHash,
      semantics_version: SHARED_QUEST_CONTENT_SEMANTICS_VERSION,
    })),
    "content_hash",
  );
  const createdHashes = new Set(created.map((row) => String(row.content_hash)));
  const newPacks = packs.filter((pack) => createdHashes.has(pack.contentHash));

  await insertChunked(
    client,
    "quest_content_segments",
    [
      ["id", "uuid"],
      ["content_hash", "text"],
      ["segment_key", "text"],
      ["ordinal", "integer"],
      ["heading_path", "jsonb"],
      ["heading_key", "text"],
      ["metadata", "jsonb"],
      ["body", "text"],
      ["start_offset", "integer"],
      ["end_offset", "integer"],
      ["token_estimate", "integer"],
      ["body_content_hash", "text"],
      ["search_text", "text"],
    ],
    newPacks.flatMap((pack) =>
      pack.segments.map((segment) => ({
        id: segment.id,
        content_hash: pack.contentHash,
        segment_key: segment.segmentKey,
        ordinal: segment.ordinal,
        heading_path: segment.headingPath,
        heading_key: segment.headingKey,
        metadata: segment.metadata,
        body: segment.body,
        start_offset: segment.startOffset,
        end_offset: segment.endOffset,
        token_estimate: segment.tokenEstimate,
        body_content_hash: segment.bodyContentHash,
        search_text: segment.searchText,
      })),
    ),
  );
  await insertChunked(
    client,
    "quest_content_subquests",
    [
      ["content_hash", "text"],
      ["subquest_key", "text"],
      ["subquest_id", "text"],
      ["ordinal", "integer"],
      ["title", "text"],
      ["objective", "text"],
      ["completeness", "text"],
      ["metadata", "jsonb"],
    ],
    newPacks.flatMap((pack) =>
      pack.subquests.map((row) => ({
        content_hash: pack.contentHash,
        subquest_key: row.subquestKey,
        subquest_id: row.subquestId,
        ordinal: row.ordinal,
        title: row.title,
        objective: row.objective,
        completeness: row.completeness,
        metadata: row.metadata,
      })),
    ),
  );
  await insertChunked(
    client,
    "quest_content_dialogue_nodes",
    [
      ["content_hash", "text"],
      ["quest_key", "text"],
      ["subquest_key", "text"],
      ["node_key", "text"],
      ["node_id", "text"],
      ["node_type", "text"],
      ["speaker_key", "text"],
      ["speaker_name", "text"],
      ["body", "text"],
      ["segment_id", "uuid"],
      ["ordinal", "integer"],
      ["variants", "jsonb"],
      ["metadata", "jsonb"],
    ],
    newPacks.flatMap((pack) =>
      pack.dialogueNodes.map((row) => ({
        content_hash: pack.contentHash,
        quest_key: row.questKey,
        subquest_key: row.subquestKey,
        node_key: row.nodeKey,
        node_id: row.nodeId,
        node_type: row.nodeType,
        speaker_key: row.speakerKey,
        speaker_name: row.speakerName,
        body: row.body,
        segment_id: row.segmentId,
        ordinal: row.ordinal,
        variants: row.variants,
        metadata: row.metadata,
      })),
    ),
  );
  await insertChunked(
    client,
    "quest_content_dialogue_edges",
    [
      ["content_hash", "text"],
      ["edge_key", "text"],
      ["from_node_key", "text"],
      ["to_node_key", "text"],
      ["edge_type", "text"],
      ["option_text", "text"],
      ["metadata", "jsonb"],
    ],
    newPacks.flatMap((pack) =>
      pack.dialogueEdges.map((row) => ({
        content_hash: pack.contentHash,
        edge_key: row.edgeKey,
        from_node_key: row.fromNodeKey,
        to_node_key: row.toNodeKey,
        edge_type: row.edgeType,
        option_text: row.optionText,
        metadata: row.metadata,
      })),
    ),
  );

  const entityKeys = [
    ...new Set(newPacks.flatMap((pack) => pack.mentions.map((row) => row.entitySourceKey))),
  ];
  const entities = entityKeys.length
    ? await client.query<{ id: string; source_key: string }>(
        `select id::text, source_key from knowledge.entities
          where game_id = $1::uuid and source_key = any($2::text[])`,
        [gameId, entityKeys],
      )
    : { rows: [] };
  const entityIdByKey = new Map(entities.rows.map((row) => [row.source_key, row.id]));
  await insertChunked(
    client,
    "quest_content_mentions",
    [
      ["content_segment_id", "uuid"],
      ["entity_id", "uuid"],
      ["raw_text", "text"],
      ["start_offset", "integer"],
      ["end_offset", "integer"],
      ["match_method", "text"],
      ["confidence", "real"],
    ],
    newPacks.flatMap((pack) =>
      pack.mentions.flatMap((row) => {
        const entityId = entityIdByKey.get(row.entitySourceKey);
        return entityId
          ? [
              {
                content_segment_id: row.segmentId,
                entity_id: entityId,
                raw_text: row.rawText,
                start_offset: row.startOffset,
                end_offset: row.endOffset,
                match_method: row.matchMethod,
                confidence: row.confidence,
              },
            ]
          : [];
      }),
    ),
  );
  return { newPacks, createdObjects: createdHashes.size };
}

async function verifyParity(client: PoolClient, revisionId: string) {
  const result = await client.query<{
    bindings: number;
    segment_mismatches: number;
    subquest_mismatches: number;
    node_mismatches: number;
    edge_mismatches: number;
    unbound_text_bindings: number;
  }>(
    `with shared as (
       select b.document_id,
              coalesce(s.segments, 0)::int as segments,
              coalesce(q.subquests, 0)::int as subquests,
              coalesce(n.nodes, 0)::int as nodes,
              coalesce(e.edges, 0)::int as edges
         from knowledge.revision_quest_content_bindings b
         left join (select content_hash, count(*)::int as segments from knowledge.quest_content_segments group by content_hash) s
           on s.content_hash = b.content_hash
         left join (select content_hash, count(*)::int as subquests from knowledge.quest_content_subquests group by content_hash) q
           on q.content_hash = b.content_hash
         left join (select content_hash, count(*)::int as nodes from knowledge.quest_content_dialogue_nodes group by content_hash) n
           on n.content_hash = b.content_hash
         left join (select content_hash, count(*)::int as edges from knowledge.quest_content_dialogue_edges group by content_hash) e
           on e.content_hash = b.content_hash
        where b.revision_id = $1::uuid
     ), legacy as (
       select d.id as document_id,
              (select count(*)::int from knowledge.document_segments x where x.document_id = d.id) as segments,
              (select count(*)::int from knowledge.quest_subquests x where x.document_id = d.id and x.revision_id = d.revision_id) as subquests,
              (select count(*)::int from knowledge.quest_dialogue_nodes x where x.document_id = d.id and x.revision_id = d.revision_id) as nodes,
              (select count(*)::int from knowledge.quest_dialogue_edges x where x.document_id = d.id and x.revision_id = d.revision_id) as edges
         from knowledge.documents d
        where d.revision_id = $1::uuid
          and exists (select 1 from knowledge.revision_quest_content_bindings b where b.document_id = d.id and b.revision_id = d.revision_id)
     )
     select count(*)::int as bindings,
            count(*) filter (where l.segments <> s.segments)::int as segment_mismatches,
            count(*) filter (where l.subquests <> s.subquests)::int as subquest_mismatches,
            count(*) filter (where l.nodes <> s.nodes)::int as node_mismatches,
            count(*) filter (where l.edges <> s.edges)::int as edge_mismatches,
            (select count(*)::int from knowledge.text_bindings tb
              join knowledge.revision_quest_content_bindings b on b.document_id = tb.document_id and b.revision_id = tb.revision_id
             where tb.revision_id = $1::uuid and tb.segment_id is not null and tb.content_segment_id is null) as unbound_text_bindings
       from shared s join legacy l using (document_id)`,
    [revisionId],
  );
  return result.rows[0]!;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    const revisionResult = await client.query<{
      game_id: string;
      slug: string;
      revision_number: number;
      lifecycle_status: string;
      is_current: boolean;
      manifest_id: string | null;
    }>(
      `select r.game_id::text, g.slug, r.revision_number, r.lifecycle_status, r.is_current, r.manifest_id::text
         from knowledge.dataset_revisions r
         join knowledge.games g on g.id = r.game_id
        where r.id = $1::uuid`,
      [options.revisionId],
    );
    const revision = revisionResult.rows[0];
    if (!revision) throw new Error(`Revision ${options.revisionId} was not found`);
    if (!revision.slug.toLowerCase().includes("genshin"))
      throw new Error(`Guard mismatch: revision belongs to game "${revision.slug}", not Genshin`);
    if (
      revision.revision_number !== 13 ||
      revision.lifecycle_status !== "published" ||
      !revision.is_current
    )
      throw new Error(
        `Guard mismatch: expected current published r13; found r${revision.revision_number} ${revision.lifecycle_status} current=${revision.is_current}`,
      );
    if (!revision.manifest_id) throw new Error("Target revision has no immutable dataset manifest");

    const migrationCheck = await client.query<{ ready: boolean }>(
      `select to_regclass('knowledge.quest_content_backfill_checkpoints') is not null as ready`,
    );
    if (options.apply && !migrationCheck.rows[0]?.ready)
      throw new Error(
        "Shared-content migration is not applied; run the reviewed database migration first",
      );

    const [evidenceKeys, allQuestDocs, alreadyBound] = await Promise.all([
      loadClaimEvidenceKeys(client, revision.manifest_id),
      client.query<{ count: number }>(
        `select count(*)::int as count
           from knowledge.dataset_manifest_entries entry
           join knowledge.content_objects object on object.content_hash = entry.content_hash
           join knowledge.documents d on d.source_key = entry.canonical_key and d.revision_id = $1::uuid
          where entry.manifest_id = $2::uuid and jsonb_typeof(object.payload->'quest') = 'object'`,
        [options.revisionId, revision.manifest_id],
      ),
      migrationCheck.rows[0]?.ready
        ? client.query<{ count: number }>(
            `select count(*)::int as count from knowledge.revision_quest_content_bindings where revision_id = $1::uuid`,
            [options.revisionId],
          )
        : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);
    const evidenceQuestDocs = await client.query<{ count: number }>(
      `select count(*)::int as count
         from knowledge.dataset_manifest_entries entry
         join knowledge.content_objects object on object.content_hash = entry.content_hash
         join knowledge.documents d on d.source_key = entry.canonical_key and d.revision_id = $1::uuid
        where entry.manifest_id = $2::uuid and jsonb_typeof(object.payload->'quest') = 'object'
          and d.source_key = any($3::text[])`,
      [options.revisionId, revision.manifest_id, [...evidenceKeys]],
    );
    const expectedEligible =
      Number(allQuestDocs.rows[0]?.count ?? 0) - Number(evidenceQuestDocs.rows[0]?.count ?? 0);
    const alreadyBoundCount = Number(alreadyBound.rows[0]?.count ?? 0);
    console.log(
      JSON.stringify(
        {
          mode: options.apply ? "apply" : "dry-run",
          revisionId: options.revisionId,
          revisionNumber: revision.revision_number,
          game: revision.slug,
          manifestId: revision.manifest_id,
          chunkSize: options.chunkSize,
          manifestQuestDocuments: Number(allQuestDocs.rows[0]?.count ?? 0),
          claimEvidenceExcluded: Number(evidenceQuestDocs.rows[0]?.count ?? 0),
          expectedEligible,
          alreadyBound: alreadyBoundCount,
          unboundEligible: Math.max(0, expectedEligible - alreadyBoundCount),
        },
        null,
        2,
      ),
    );
    if (!options.apply) return;

    const evidenceKeySet = evidenceKeys;
    await client.query(
      `insert into knowledge.quest_content_backfill_checkpoints(revision_id, status)
       values ($1::uuid, 'pending') on conflict (revision_id) do nothing`,
      [options.revisionId],
    );
    let totals = await client.query<{
      status: string;
      last_document_id: string | null;
      documents_processed: number;
      documents_bound: number;
      content_objects_created: number;
      updated_text_bindings: number;
    }>(
      `select status, last_document_id::text, documents_processed, documents_bound,
              content_objects_created, updated_text_bindings
         from knowledge.quest_content_backfill_checkpoints where revision_id = $1::uuid`,
      [options.revisionId],
    );
    if (totals.rows[0]?.status === "completed") {
      console.log("Checkpoint already completed; verifying without rewriting content.");
    } else {
      let cursor = totals.rows[0]?.last_document_id ?? null;
      await client.query(
        `update knowledge.quest_content_backfill_checkpoints set status = 'running', updated_at = now()
          where revision_id = $1::uuid`,
        [options.revisionId],
      );
      for (;;) {
        const batch = await client.query<QuestDocument>(
          `select d.id::text as document_id, d.source_key, object.payload, binding.content_hash
             from knowledge.documents d
             join knowledge.dataset_manifest_entries entry
               on entry.manifest_id = $2::uuid and entry.canonical_key = d.source_key
             join knowledge.content_objects object on object.content_hash = entry.content_hash
             left join knowledge.revision_quest_content_bindings binding
               on binding.revision_id = d.revision_id and binding.document_id = d.id
            where d.revision_id = $1::uuid and jsonb_typeof(object.payload->'quest') = 'object'
              and ($3::uuid is null or d.id > $3::uuid)
            order by d.id limit $4`,
          [options.revisionId, revision.manifest_id, cursor, options.chunkSize],
        );
        if (!batch.rows.length) break;
        const eligible = batch.rows.filter((row) => !evidenceKeySet.has(row.source_key));
        const packed = eligible.flatMap((row) => {
          const record = row.payload as NormalizedRecord;
          const pack = buildSharedQuestContentPack(record, revision.game_id);
          if (pack && row.content_hash && row.content_hash !== pack.contentHash)
            throw new Error(
              `Existing binding hash disagrees with the manifest payload for ${row.source_key}`,
            );
          return pack ? [{ documentId: row.document_id, record, pack }] : [];
        });
        const uniquePacks = flattenUniquePacks(packed);
        let createdObjects = 0;
        let updatedTextBindings = 0;
        await client.query("begin");
        try {
          const { createdObjects: created, newPacks } = await insertNewContent(
            client,
            uniquePacks,
            revision.game_id,
          );
          createdObjects = created;
          const newHashSet = new Set(newPacks.map((pack) => pack.contentHash));
          const objectRows = [...new Set(packed.map(({ pack }) => pack.contentHash))];
          const missing = objectRows.filter((hash) => !newHashSet.has(hash));
          if (missing.length) {
            const existing = await client.query<{
              content_hash: string;
              segments: number;
              subquests: number;
              nodes: number;
              edges: number;
            }>(
              `select object.content_hash,
                        (select count(*)::int from knowledge.quest_content_segments x where x.content_hash = object.content_hash) as segments,
                        (select count(*)::int from knowledge.quest_content_subquests x where x.content_hash = object.content_hash) as subquests,
                        (select count(*)::int from knowledge.quest_content_dialogue_nodes x where x.content_hash = object.content_hash) as nodes,
                        (select count(*)::int from knowledge.quest_content_dialogue_edges x where x.content_hash = object.content_hash) as edges
                   from knowledge.quest_content_objects object where object.content_hash = any($1::text[])`,
              [missing],
            );
            const packByHash = new Map(uniquePacks.map((pack) => [pack.contentHash, pack]));
            if (existing.rows.length !== missing.length)
              throw new Error("One or more pre-existing content objects are missing");
            for (const row of existing.rows) {
              const pack = packByHash.get(row.content_hash)!;
              if (
                row.segments !== pack.segments.length ||
                row.subquests !== pack.subquests.length ||
                row.nodes !== pack.dialogueNodes.length ||
                row.edges !== pack.dialogueEdges.length
              )
                throw new Error(
                  `Existing content hash ${row.content_hash} has an incomplete child set`,
                );
            }
          }

          await insertChunked(
            client,
            "revision_quest_content_bindings",
            [
              ["revision_id", "uuid"],
              ["document_id", "uuid"],
              ["content_hash", "text"],
            ],
            packed.map(({ documentId, pack }) => ({
              revision_id: options.revisionId,
              document_id: documentId,
              content_hash: pack.contentHash,
            })),
          );
          const mapped = await client.query(
            `update knowledge.text_bindings tb
                set content_segment_id = segment.id
               from knowledge.document_segments old_segment
               join knowledge.revision_quest_content_bindings binding
                 on binding.document_id = old_segment.document_id and binding.revision_id = old_segment.revision_id
               join knowledge.quest_content_segments segment
                 on segment.content_hash = binding.content_hash and segment.segment_key = old_segment.segment_key
              where tb.revision_id = $1::uuid and tb.revision_id = old_segment.revision_id
                and tb.document_id = old_segment.document_id and tb.segment_id = old_segment.id
                and tb.content_segment_id is null`,
            [options.revisionId],
          );
          updatedTextBindings = mapped.rowCount ?? 0;
          await client.query(
            `update knowledge.quest_content_backfill_checkpoints
                set status = 'running', last_document_id = $2::uuid,
                    documents_processed = documents_processed + $3,
                    documents_bound = documents_bound + $4,
                    content_objects_created = content_objects_created + $5,
                    updated_text_bindings = updated_text_bindings + $6,
                    counts = jsonb_build_object(
                      'segments', coalesce((counts->>'segments')::int, 0) + $7,
                      'subquests', coalesce((counts->>'subquests')::int, 0) + $8,
                      'dialogueNodes', coalesce((counts->>'dialogueNodes')::int, 0) + $9,
                      'dialogueEdges', coalesce((counts->>'dialogueEdges')::int, 0) + $10
                    ), updated_at = now()
              where revision_id = $1::uuid`,
            [
              options.revisionId,
              batch.rows.at(-1)!.document_id,
              batch.rows.length,
              packed.length,
              createdObjects,
              updatedTextBindings,
              packed.reduce((sum, row) => sum + row.pack.segments.length, 0),
              packed.reduce((sum, row) => sum + row.pack.subquests.length, 0),
              packed.reduce((sum, row) => sum + row.pack.dialogueNodes.length, 0),
              packed.reduce((sum, row) => sum + row.pack.dialogueEdges.length, 0),
            ],
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
        cursor = batch.rows.at(-1)!.document_id;
        totals = await client.query(
          `select status, last_document_id::text, documents_processed, documents_bound,
                  content_objects_created, updated_text_bindings
             from knowledge.quest_content_backfill_checkpoints where revision_id = $1::uuid`,
          [options.revisionId],
        );
        const checkpoint = totals.rows[0]!;
        console.log(
          JSON.stringify({
            checkpoint: checkpoint.last_document_id,
            processed: checkpoint.documents_processed,
            bound: checkpoint.documents_bound,
            objectsCreated: checkpoint.content_objects_created,
            textBindingsLinked: checkpoint.updated_text_bindings,
          }),
        );
      }
    }

    const parity = await verifyParity(client, options.revisionId);
    console.log(JSON.stringify({ parity }, null, 2));
    const mismatchCount =
      parity.segment_mismatches +
      parity.subquest_mismatches +
      parity.node_mismatches +
      parity.edge_mismatches;
    if (mismatchCount > 0)
      throw new Error(`Shared/legacy read-model parity failed for ${mismatchCount} count checks`);
    if (parity.unbound_text_bindings > 0)
      throw new Error(
        `${parity.unbound_text_bindings} legacy text bindings could not be linked to shared segments`,
      );
    if (options.apply) {
      await client.query(
        `update knowledge.quest_content_backfill_checkpoints set status = 'completed', updated_at = now()
          where revision_id = $1::uuid`,
        [options.revisionId],
      );
      await client.query("analyze knowledge.quest_content_objects");
      await client.query("analyze knowledge.quest_content_segments");
      await client.query("analyze knowledge.quest_content_dialogue_nodes");
      await client.query("analyze knowledge.revision_quest_content_bindings");
    }
    const current = await client.query<{ is_current: boolean; lifecycle_status: string }>(
      `select is_current, lifecycle_status from knowledge.dataset_revisions where id = $1::uuid`,
      [options.revisionId],
    );
    if (!current.rows[0]?.is_current || current.rows[0]?.lifecycle_status !== "published")
      throw new Error("Backfill changed the target revision lifecycle/current state unexpectedly");
  } catch (error) {
    if (options.apply) {
      await client
        .query(
          `update knowledge.quest_content_backfill_checkpoints set status = 'failed', updated_at = now()
          where revision_id = $1::uuid`,
          [options.revisionId],
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
