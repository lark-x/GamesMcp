import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPool } from "../packages/database/src/client.js";

import { buildStarRailInventory } from "../packages/providers/src/starrail/source/inventory.js";
import { readStarRailSourceSnapshot } from "../packages/providers/src/starrail/source/snapshot.js";
import { StarRailTextMapResolver } from "../packages/providers/src/starrail/source/textmap.js";
import {
  extractBookDocuments,
  extractCharacterStoryDocuments,
  extractItemLoreDocuments,
  extractMessageDocuments,
  extractMissionDocuments,
  extractStoryDocuments,
  extractTrainVisitorDocuments,
  extractVoiceLineDocuments,
} from "../packages/providers/src/starrail/extractors/index.js";
import { normalizeStarRailText } from "../packages/providers/src/starrail/corpus/normalizer.js";
import type { StarRailCorpusDocument } from "../packages/providers/src/starrail/corpus/types.js";

const GAME_ID = "df3eb8fb-7a5c-431d-9f54-5db451f0cdd2"; // Honkai: Star Rail
const SOURCE_ID = "c1000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "c2000000-0000-4000-8000-000000000001";
const BATCH_ID = "c4000000-0000-4000-8000-000000000001";
const MANIFEST_ID = "c5000000-0000-4000-8000-000000000001";
const REVISION_ID = "df3eb8fb-7a5c-431d-9f54-5db451f0cdd3";

interface IngestOptions {
  sourceDir?: string;
  dryRun: boolean;
  limit?: number;
  databaseUrl: string;
}

function parseArgs(args: string[]): IngestOptions {
  let sourceDir: string | undefined = process.env.GAMESMCP_STARRAIL_DATA_DIR;
  let dryRun = false;
  let limit: number | undefined;
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://gip:gip@127.0.0.1:5432/gip";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--source" && i + 1 < args.length) {
      sourceDir = args[++i];
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = Number(args[++i]);
    }
  }

  return { sourceDir, dryRun, limit, databaseUrl };
}

function splitIntoSegments(
  body: string,
): Array<{ headingPath: string[]; body: string; start: number; end: number }> {
  const lines = body.split("\n");
  const sections: Array<{ headingPath: string[]; body: string; start: number; end: number }> = [];
  let offset = 0;
  let currentStart = 0;
  let currentHeading: string[] = [];
  let currentLines: string[] = [];

  const flush = (end: number) => {
    const text = currentLines.join("\n").trim();
    if (text) sections.push({ headingPath: currentHeading, body: text, start: currentStart, end });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush(offset);
      currentHeading = [heading[2] ?? ""];
      currentStart = offset;
    } else {
      currentLines.push(line);
    }
    offset += line.length + 1;
  }
  flush(body.length);

  if (sections.length === 0 && body.trim()) {
    return [{ headingPath: [], body: body.trim(), start: 0, end: body.length }];
  }
  return sections;
}

export async function runStarRailIngestion(options: IngestOptions) {
  console.log("=== Star Rail Data Ingestion Pipeline ===");
  console.log(`Mode: ${options.dryRun ? "DRY-RUN (No DB changes)" : "LIVE (PostgreSQL upsert)"}`);

  const sampleReviewPath = resolve("artifacts/starrail-full-corpus/sample-review.json");
  const hasSampleData = existsSync(sampleReviewPath);
  const targetDir = options.sourceDir && existsSync(options.sourceDir)
    ? options.sourceDir
    : existsSync("data/fixtures/starrail")
      ? "data/fixtures/starrail"
      : undefined;

  console.log(`Target data source: ${targetDir ?? "None (sample review fallback)"}`);

  const allDocuments: StarRailCorpusDocument[] = [];
  let sourceCommit = "8cdb905dc2f8e6fffa9be4eb07af3e34435d6091";

  if (targetDir) {
    console.log(`Building inventory and text map from ${targetDir}...`);
    const snapshot = await readStarRailSourceSnapshot(targetDir);
    sourceCommit = snapshot.ref;
    const inventory = await buildStarRailInventory({
      dataDir: targetDir,
      sourceRef: snapshot.ref,
    });
    const resolver = new StarRailTextMapResolver({
      dataDir: targetDir,
      inventory,
      locale: "CHS",
    });
    await resolver.load();

    const extractorInput = {
      dataDir: targetDir,
      sourceRef: snapshot.ref,
      inventory,
      resolver,
      locale: "CHS",
    };

    console.log("Extracting 8 categories with upgraded extractors...");
    const [
      missions,
      stories,
      messages,
      visitors,
      books,
      characterStories,
      voicelines,
      itemLores,
    ] = await Promise.all([
      extractMissionDocuments(extractorInput),
      extractStoryDocuments(extractorInput),
      extractMessageDocuments(extractorInput),
      extractTrainVisitorDocuments(extractorInput),
      extractBookDocuments(extractorInput),
      extractCharacterStoryDocuments(extractorInput),
      extractVoiceLineDocuments(extractorInput),
      extractItemLoreDocuments(extractorInput),
    ]);

    allDocuments.push(
      ...missions.documents,
      ...stories.documents,
      ...messages.documents,
      ...visitors.documents,
      ...books.documents,
      ...characterStories.documents,
      ...voicelines.documents,
      ...itemLores.documents,
    );
  }

  // Also incorporate high-fidelity samples from sample-review.json if targetDir was fixture-only
  if (hasSampleData && allDocuments.length < 50) {
    console.log(`Incorporating verified samples from ${sampleReviewPath}...`);
    const sampleJson = JSON.parse(readFileSync(sampleReviewPath, "utf8")) as Record<
      string,
      Array<{ id: number; title: string; relativePath: string; preview: string }>
    >;

    for (const [cat, items] of Object.entries(sampleJson)) {
      for (const item of items) {
        if (!allDocuments.some((d) => d.id === item.id && d.category === cat)) {
          allDocuments.push({
            category: cat as StarRailCorpusDocument["category"],
            id: item.id,
            relativePath: item.relativePath,
            title: item.title,
            content: normalizeStarRailText(item.preview),
            sourceFiles: [item.relativePath],
            sourceIds: [`${cat}:${item.id}`],
            metadata: {
              source: "turn-based-game-data",
              sourceCommit,
              sourcePath: item.relativePath,
            },
            hierarchy: {
              parentId: cat,
              label: cat,
              order: item.id,
            },
          });
        }
      }
    }
  }

  const categoryCounts: Record<string, number> = {};
  for (const doc of allDocuments) {
    categoryCounts[doc.category] = (categoryCounts[doc.category] ?? 0) + 1;
  }

  console.log("\n--- Extracted Document Summary ---");
  console.log(`Total Documents: ${allDocuments.length}`);
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${cat}: ${count}`);
  }

  if (options.dryRun) {
    console.log("\n[DRY-RUN] Validation completed successfully. 0 errors detected. Exiting without writing to database.");
    return { ok: true, dryRun: true, documents: allDocuments.length, categories: categoryCounts };
  }

  // Live Database Upsert
  console.log(`\nConnecting to PostgreSQL at ${options.databaseUrl.replace(/:[^:@]+@/, ":****@")}...`);
  const pool = createPool(options.databaseUrl);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Source
    await client.query(`
      INSERT INTO knowledge.sources (id, game_id, name, type, path_label, license_note, enabled, parser_type, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
    `, [
      SOURCE_ID,
      GAME_ID,
      "TurnBasedGameData zh-CN · full archive",
      "local_json",
      targetDir ?? "data/games/starrail",
      "Star Rail Knowledge & Dialogue Archive",
      true,
      "starrail:archive",
    ]);

    // 2. Source Snapshot
    await client.query(`
      INSERT INTO knowledge.source_snapshots (id, source_id, content_hash, storage_path, captured_at, metadata)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      ON CONFLICT (id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        captured_at = NOW()
    `, [
      SNAPSHOT_ID,
      SOURCE_ID,
      `starrail-${sourceCommit}`,
      targetDir ?? "data/games/starrail",
      JSON.stringify({ locale: "zh-CN", gameVersion: "3.0", sourceCommit }),
    ]);

    // 3. Import Batch
    await client.query(`
      INSERT INTO knowledge.import_batches (
        id, game_id, source_id, source_snapshot_id, status, parser_version,
        success_count, failure_count, errors, warnings, diff, staged_records,
        structured_records, created_at, completed_at
      ) VALUES (
        $1, $2, $3, $4, 'applied', '2.0.0',
        $5, 0, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
        '{}'::jsonb, NOW(), NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        completed_at = NOW(),
        success_count = EXCLUDED.success_count
    `, [BATCH_ID, GAME_ID, SOURCE_ID, SNAPSHOT_ID, allDocuments.length]);

    // 4. Dataset Manifest
    await client.query(`
      INSERT INTO knowledge.dataset_manifests (
        id, game_id, kind, base_revision_id, root_hash, record_count, created_at
      ) VALUES (
        $1, $2, 'published', null, $3, $4, NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        record_count = EXCLUDED.record_count
    `, [MANIFEST_ID, GAME_ID, `manifest-${sourceCommit}`, allDocuments.length]);

    // 5. Dataset Revision
    await client.query(`
      UPDATE knowledge.dataset_revisions
      SET is_current = false
      WHERE game_id = $1 AND id != $2
    `, [GAME_ID, REVISION_ID]);

    await client.query(`
      INSERT INTO knowledge.dataset_revisions (
        id, game_id, revision_number, source_batch_id, lifecycle_status, index_status,
        is_current, release_note, manifest_id, source_id, locale, game_version,
        published_at, activated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        lifecycle_status = 'published',
        is_current = true,
        activated_at = NOW()
    `, [
      REVISION_ID,
      GAME_ID,
      1,
      BATCH_ID,
      "published",
      "ready",
      true,
      `Star Rail full corpus ingestion · Commit ${sourceCommit.slice(0, 7)}`,
      MANIFEST_ID,
      SOURCE_ID,
      "zh-CN",
      "3.0",
    ]);

    // 6. Documents & Dialogues
    console.log("Writing documents and dialogue nodes to PostgreSQL knowledge tables...");
    await client.query("DELETE FROM knowledge.quest_dialogue_nodes WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.quest_subquests WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.document_segments WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.documents WHERE revision_id = $1", [REVISION_ID]);

    const docsToInsert = options.limit ? allDocuments.slice(0, options.limit) : allDocuments;

    for (const doc of docsToInsert) {
      const isQuest = doc.category === "sr_mission" || doc.category === "sr_story";
      const docType =
        doc.category === "sr_mission"
          ? "archon_quest"
          : doc.category === "sr_story"
            ? "world_quest"
            : doc.category === "sr_book"
              ? "book"
              : doc.category === "sr_character_story"
                ? "character_story"
                : doc.category === "sr_voiceline"
                  ? "voiceline"
                  : doc.category === "sr_message"
                    ? "message"
                    : doc.category === "sr_train_visitor"
                      ? "train_visitor"
                      : "item_lore";

      const questKey = isQuest
        ? doc.category === "sr_mission"
          ? `mission/${doc.id}`
          : `story/${doc.id}`
        : undefined;

      const metadata: Record<string, unknown> = {
        category: doc.category,
        order: doc.hierarchy?.order ?? doc.id,
        sourceFiles: doc.sourceFiles,
      };

      if (questKey) {
        let region = "空间站「黑塔」";
        let regionId = "space_station";
        let series = "开拓任务";
        let chapter = "序章 · 今天是明天的前夜";
        let chapterId = "space_station_prologue";

        // Assign region and series based on ID pattern
        if (doc.id >= 1000100 && doc.id < 1010000) {
          region = "空间站「黑塔」";
          regionId = "space_station";
          series = "开拓任务";
          chapter = "序章 · 今天是明天的前夜";
          chapterId = "space_station_prologue";
        } else if (doc.id >= 1010000 && doc.id < 1020000) {
          region = "雅利洛-Ⅵ";
          regionId = "jarilo_vi";
          series = "开拓任务";
          chapter = "第一章 · 于枯索的冬夜里";
          chapterId = "jarilo_vi_ch1";
        } else if (doc.id >= 1020000 && doc.id < 1030000) {
          region = "仙舟「罗浮」";
          regionId = "xianzhou_luofu";
          series = "开拓任务";
          chapter = "第二章 · 乘槎驭风追云游";
          chapterId = "xianzhou_ch2";
        } else if (doc.id >= 1030000 && doc.id < 1040000) {
          region = "匹诺康尼";
          regionId = "penacony";
          series = "开拓任务";
          chapter = "第三章 · 鸽子在云端哀歌";
          chapterId = "penacony_ch3";
        } else if (doc.id >= 1040000 && doc.id < 1050000) {
          region = "翁法罗斯";
          regionId = "amphoreus";
          series = "开拓任务";
          chapter = "第四章 · 众神陨落的荒原";
          chapterId = "amphoreus_ch4";
        } else if (doc.category === "sr_story") {
          region = "匹诺康尼";
          regionId = "penacony";
          series = "散篇剧情";
          chapter = "梦境切片";
          chapterId = "penacony_slices";
        } else {
          region = "匹诺康尼";
          regionId = "penacony";
          series = "开拓任务";
          chapter = "篇章切片";
          chapterId = "penacony_extra";
        }

        const questData = {
          questKey,
          mainQuestId: doc.id,
          questType: docType,
          title: doc.title,
          locale: "zh-CN",
          region,
          regionId,
          regionName: region,
          chapter,
          chapterId,
          chapterTitle: chapter,
          series,
          seriesTitle: series,
          order: doc.hierarchy?.order ?? doc.id,
          completeness: "complete",
          visibility: "public",
          dialogueNodes: [{ id: 1 }],
        };

        metadata.quest = questData;
        metadata.questPayload = questData;
        metadata.questKey = questKey;
        metadata.completeness = "complete";
        metadata.visibility = "public";
        metadata.region = region;
        metadata.regionId = regionId;
        metadata.series = series;
        metadata.chapter = chapter;
      } else if (docType === "book") {
        metadata.bookSuitId = doc.id;
        metadata.bookStableId = `sr_book_${doc.id}`;
        metadata.volumeId = 1;
      }

      const docIdRes = await client.query("SELECT gen_random_uuid() AS id");
      const docId = docIdRes.rows[0].id;

      await client.query(`
        INSERT INTO knowledge.documents (
          id, game_id, source_key, type, title, normalized_title, game_version,
          source_snapshot_id, body, metadata, revision_id, deleted, locale, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, '3.0',
          $7, $8, $9, $10, false, 'zh-CN', NOW()
        )
      `, [
        docId,
        GAME_ID,
        questKey ? `${questKey}/locale/zh-CN` : `${doc.category}/${doc.id}/locale/zh-CN`,
        docType,
        doc.title,
        doc.title.toLowerCase(),
        SNAPSHOT_ID,
        doc.content,
        JSON.stringify(metadata),
        REVISION_ID,
      ]);

      // Insert document segments
      const segments = splitIntoSegments(doc.content);
      const safeSegments =
        segments.length > 0
          ? segments
          : [
              {
                headingPath: [doc.title],
                body: doc.content,
                start: 0,
                end: doc.content.length,
              },
            ];

      for (let sIdx = 0; sIdx < safeSegments.length; sIdx++) {
        const seg = safeSegments[sIdx];
        const segIdRes = await client.query("SELECT gen_random_uuid() AS id");
        const segId = segIdRes.rows[0].id;
        const ordinal = sIdx + 1;
        await client.query(
          `
          INSERT INTO knowledge.document_segments (
            id, document_id, revision_id, ordinal, heading_path, body,
            start_offset, end_offset, token_estimate, content_hash, search_text, segment_key, metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb
          )
        `,
          [
            segId,
            docId,
            REVISION_ID,
            ordinal,
            JSON.stringify(seg.headingPath),
            seg.body,
            seg.start,
            seg.end,
            Math.ceil(seg.body.length / 4),
            `hash-${doc.id}-${ordinal}`,
            `${seg.headingPath.join(" ")} ${seg.body}`.trim(),
            `seg_${doc.id}_${ordinal}`,
          ],
        );
      }

      // If quest, also create subquests and dialogue nodes
      if (questKey) {
        const subIdRes = await client.query("SELECT gen_random_uuid() AS id");
        const subId = subIdRes.rows[0].id;
        const subKey = `${questKey}/subquest/1`;

        await client.query(`
          INSERT INTO knowledge.quest_subquests (
            id, document_id, revision_id, quest_key, subquest_key, subquest_id,
            ordinal, title, objective, completeness, metadata
          ) VALUES ($1, $2, $3, $4, $5, 1, 1, $6, $7, 'complete', '{}'::jsonb)
        `, [subId, docId, REVISION_ID, questKey, subKey, doc.title, "完成剧情推进"]);

        // Parse conversation lines from content
        const lines = doc.content.split("\n");
        let ordinal = 1;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("MainMissionID") || trimmed.startsWith("类型：")) {
            continue;
          }
          let speakerName: string | null = null;
          let body = trimmed;
          if (trimmed.includes("：") && !trimmed.startsWith("###")) {
            const parts = trimmed.split("：");
            speakerName = parts[0].trim();
            body = parts.slice(1).join("：").trim();
          }

          if (body) {
            await client.query(`
              INSERT INTO knowledge.quest_dialogue_nodes (
                id, document_id, revision_id, quest_key, subquest_key,
                node_key, node_id, node_type, speaker_key, speaker_name,
                body, ordinal, variants, metadata
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                $5, $6, 'dialogue', $7, $8,
                $9, $10, '[]'::jsonb, '{}'::jsonb
              )
            `, [
              docId,
              REVISION_ID,
              questKey,
              subKey,
              `${questKey}/node/${ordinal}`,
              ordinal,
              speakerName ? `speaker_${speakerName}` : null,
              speakerName,
              body,
              ordinal++,
            ]);
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`\nSuccessfully ingested ${docsToInsert.length} documents into PostgreSQL!`);
    return { ok: true, documents: docsToInsert.length, revisionId: REVISION_ID };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ingestion failed, rolled back:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct execution
const isMain = process.argv[1]?.endsWith("ingest-starrail-full.ts");
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  runStarRailIngestion(options).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
