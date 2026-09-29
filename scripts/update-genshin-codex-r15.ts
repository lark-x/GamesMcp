import pg from "../packages/database/node_modules/pg/lib/index.js";
const { Pool } = pg;
import { convertStructuredAnimeGameData } from "./anime-game-data-structured-converter.js";

function normalize(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "");
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://gip:gip@127.0.0.1:5432/gip",
  });

  const client = await pool.connect();
  try {
    const revRes = await client.query<{ id: string; revision_number: number }>(
      `SELECT id, revision_number FROM knowledge.dataset_revisions 
       WHERE game_id = 'e9cc55e6-466a-4bfa-b73a-be229946d0ff' 
         AND is_current AND lifecycle_status = 'published'`,
    );

    if (revRes.rows.length === 0) {
      throw new Error("No current published revision found for Genshin Impact");
    }

    const { id: revisionId, revision_number: revNum } = revRes.rows[0];
    console.log(`Found current Genshin revision: r${revNum} (${revisionId})`);

    console.log("Converting structured data from upstream AnimeGameData-current & genshin-db...");
    const converted = await convertStructuredAnimeGameData({
      upstreamDir: "./data/upstream/AnimeGameData-current",
      context: {
        gameId: "e9cc55e6-466a-4bfa-b73a-be229946d0ff",
        revisionId,
        upstreamCommit: "upstream-codex-update",
        upstreamVersion: "5.0",
        gameVersion: "5.0",
      },
    });

    const materials = converted.records.materials;
    const artifactSets = converted.records.artifactSets;
    const enemies = converted.records.enemies;

    console.log(`Converted:`);
    console.log(`- Materials: ${materials.length}`);
    console.log(`- Artifact Sets: ${artifactSets.length}`);
    console.log(`- Enemies: ${enemies.length}`);

    await client.query("BEGIN");

    // 1. Update Materials
    console.log("Updating materials...");
    const convertedMaterialStableIds = new Set(materials.map((m) => m.stableId));
    const delMatRes = await client.query(
      `DELETE FROM knowledge.genshin_materials 
       WHERE revision_id = $1 AND NOT (stable_id = ANY($2::text[]))`,
      [revisionId, Array.from(convertedMaterialStableIds)],
    );
    console.log(`Pruned ${delMatRes.rowCount} stale/placeholder materials.`);

    const chunkSize = 250;
    for (let i = 0; i < materials.length; i += chunkSize) {
      const chunk = materials.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const valueStrings: string[] = [];

      chunk.forEach((mat) => {
        const offset = values.length;
        values.push(
          mat.id,
          mat.gameId,
          mat.revisionId,
          mat.stableId,
          mat.sourceKey ?? `anime-game-data/material/${mat.stableId}`,
          mat.name,
          normalize(mat.name),
          mat.locale ?? "zh-CN",
          mat.gameVersion ?? "5.0",
          mat.category,
          mat.rarity ?? null,
          mat.description ?? null,
          JSON.stringify(mat.sources ?? []),
          JSON.stringify(mat.usedBy ?? []),
          JSON.stringify(mat.provenance ?? {}),
        );
        valueStrings.push(
          `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}::int, $${offset + 12}, $${offset + 13}::jsonb, $${offset + 14}::jsonb, $${offset + 15}::jsonb)`,
        );
      });

      const sql = `
        INSERT INTO knowledge.genshin_materials (
          id, game_id, revision_id, stable_id, source_key, name, normalized_name,
          locale, game_version, category, rarity, description, sources, used_by, provenance
        ) VALUES ${valueStrings.join(", ")}
        ON CONFLICT (revision_id, stable_id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          category = EXCLUDED.category,
          rarity = EXCLUDED.rarity,
          description = EXCLUDED.description,
          sources = EXCLUDED.sources,
          used_by = EXCLUDED.used_by,
          provenance = EXCLUDED.provenance,
          updated_at = NOW()
      `;
      await client.query(sql, values);
    }
    console.log(`Upserted ${materials.length} materials.`);

    // 2. Update Artifact Sets
    console.log("Updating artifact sets...");
    await client.query(
      `DELETE FROM knowledge.genshin_artifact_sets WHERE revision_id = $1`,
      [revisionId],
    );

    for (let i = 0; i < artifactSets.length; i += chunkSize) {
      const chunk = artifactSets.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const valueStrings: string[] = [];

      chunk.forEach((set) => {
        const offset = values.length;
        values.push(
          set.id,
          set.gameId,
          set.revisionId,
          set.stableId,
          set.sourceKey ?? `anime-game-data/artifact-set/${set.stableId}`,
          set.name,
          normalize(set.name),
          set.locale ?? "zh-CN",
          set.gameVersion ?? "5.0",
          JSON.stringify(set.provenance ?? {}),
          set.maxRarity ?? null,
          set.twoPieceBonus ?? null,
          set.fourPieceBonus ?? null,
          JSON.stringify(set.pieces ?? []),
        );
        valueStrings.push(
          `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::jsonb, $${offset + 11}::int, $${offset + 12}, $${offset + 13}, $${offset + 14}::jsonb)`,
        );
      });

      const sql = `
        INSERT INTO knowledge.genshin_artifact_sets (
          id, game_id, revision_id, stable_id, source_key, name, normalized_name,
          locale, game_version, provenance, max_rarity, two_piece_bonus, four_piece_bonus, pieces
        ) VALUES ${valueStrings.join(", ")}
        ON CONFLICT (revision_id, stable_id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          provenance = EXCLUDED.provenance,
          max_rarity = EXCLUDED.max_rarity,
          two_piece_bonus = EXCLUDED.two_piece_bonus,
          four_piece_bonus = EXCLUDED.four_piece_bonus,
          pieces = EXCLUDED.pieces,
          updated_at = NOW()
      `;
      await client.query(sql, values);
    }
    console.log(`Upserted ${artifactSets.length} artifact sets.`);

    // 3. Update Enemies
    console.log("Updating enemies...");
    await client.query(
      `DELETE FROM knowledge.genshin_enemies WHERE revision_id = $1`,
      [revisionId],
    );

    for (let i = 0; i < enemies.length; i += chunkSize) {
      const chunk = enemies.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const valueStrings: string[] = [];

      chunk.forEach((en) => {
        const offset = values.length;
        values.push(
          en.id,
          en.gameId,
          en.revisionId,
          en.stableId,
          en.sourceKey ?? `anime-game-data/enemy/${en.stableId}`,
          en.name,
          normalize(en.name),
          en.locale ?? "zh-CN",
          en.gameVersion ?? "5.0",
          JSON.stringify(en.provenance ?? {}),
          en.category,
          en.family ?? null,
          en.description ?? null,
          JSON.stringify(en.drops ?? []),
          JSON.stringify(en.resistances ?? {}),
        );
        valueStrings.push(
          `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::jsonb, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}::jsonb, $${offset + 15}::jsonb)`,
        );
      });

      const sql = `
        INSERT INTO knowledge.genshin_enemies (
          id, game_id, revision_id, stable_id, source_key, name, normalized_name,
          locale, game_version, provenance, category, family, description, drops, resistances
        ) VALUES ${valueStrings.join(", ")}
        ON CONFLICT (revision_id, stable_id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          provenance = EXCLUDED.provenance,
          category = EXCLUDED.category,
          family = EXCLUDED.family,
          description = EXCLUDED.description,
          drops = EXCLUDED.drops,
          resistances = EXCLUDED.resistances,
          updated_at = NOW()
      `;
      await client.query(sql, values);
    }
    console.log(`Upserted ${enemies.length} enemies.`);

    await client.query("COMMIT");
    console.log("Codex data update committed successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to update codex data, rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
