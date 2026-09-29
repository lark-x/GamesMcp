/**
 * r5 backfill: anchor remaining nested-shape quest docs (metadata.quest.*) that
 * update-starrail-codex-r4.ts missed — it only matched top-level metadata.region.
 * Applies the same anchoring chain as StarRailStoryResolver:
 * DailyMissionData unlock → MainMission WorldID → mission-id range → title heuristics → system_guide.
 */
import { resolve } from "node:path";
import pg from "../packages/database/node_modules/pg/lib/index.js";
const { Pool } = pg;
import { readSafeJsonFile } from "../packages/providers/src/starrail/extractors/shared.js";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://gip:gip@127.0.0.1:5432/gip",
  });
  const client = await pool.connect();

  try {
    const GAME_ID = "df3eb8fb-7a5c-431d-9f54-5db451f0cdd2";
    const revRes = await client.query<{ id: string; revision_number: number }>(
      `SELECT id, revision_number FROM knowledge.dataset_revisions
       WHERE game_id = $1 AND is_current AND lifecycle_status = 'published'`,
      [GAME_ID],
    );
    if (revRes.rows.length === 0) throw new Error("No active Star Rail revision found");
    const revisionId = revRes.rows[0].id;
    console.log(`Active Star Rail revision: ${revisionId} (r${revRes.rows[0].revision_number})`);

    const targetDir = resolve("data/upstream/TurnBasedGameData");
    const dailyPath = resolve(targetDir, "ExcelOutput/DailyMissionData.json");
    const rawDailies = await readSafeJsonFile<Array<Record<string, unknown>>>(dailyPath);
    const dailyUnlockMap = new Map<number, number>();
    if (Array.isArray(rawDailies)) {
      for (const d of rawDailies) {
        const dId = Number(d.ID);
        const unlockMain = Number(d.UnlockMainMission);
        if (Number.isInteger(dId) && Number.isInteger(unlockMain)) {
          dailyUnlockMap.set(dId, unlockMain);
          dailyUnlockMap.set(Math.floor(dId / 100), unlockMain);
        }
      }
    }

    const mainPath = resolve(targetDir, "ExcelOutput/MainMission.json");
    const rawMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(mainPath);
    const missionRowsById = new Map<number, Record<string, unknown>>();
    if (Array.isArray(rawMissions)) {
      for (const m of rawMissions) {
        const id = Number(m.MainMissionID ?? m.ID);
        if (Number.isInteger(id)) missionRowsById.set(id, m);
      }
    }

    const worldNames: Record<number, string> = {
      100: "星穹列车",
      101: "空间站「黑塔」",
      201: "雅利洛-Ⅵ",
      301: "仙舟「罗浮」",
      401: "匹诺康尼",
      501: "翁法罗斯",
      601: "二相乐园",
      602: "千星城",
    };

    const staleDocs = await client.query<{
      id: string;
      title: string;
      type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, title, type, metadata
       FROM knowledge.documents
       WHERE game_id = $1 AND revision_id = $2
         AND (metadata->'quest'->>'region' = '其他世界' OR metadata->'quest'->>'regionId' = 'world_0')`,
      [GAME_ID, revisionId],
    );
    console.log(`Found ${staleDocs.rows.length} nested-shape documents still in '其他世界'`);

    let anchored = 0;
    let systemGuide = 0;
    for (const doc of staleDocs.rows) {
      const quest = doc.metadata.quest as Record<string, unknown> | undefined;
      const order = Number(quest?.order ?? doc.metadata.order);
      const missionId = Number.isInteger(order) ? order : 0;
      let detectedWorldId: number | undefined;

      if (doc.type === "daily_mission") {
        const unlockMain =
          dailyUnlockMap.get(missionId) ?? dailyUnlockMap.get(Math.floor(missionId / 100));
        if (unlockMain) {
          const unlockMm = missionRowsById.get(unlockMain);
          if (unlockMm?.WorldID && Number(unlockMm.WorldID) > 0) {
            detectedWorldId = Number(unlockMm.WorldID);
          } else if (unlockMain >= 1000000 && unlockMain < 2000000) {
            detectedWorldId = 101;
          } else if (unlockMain >= 2000000 && unlockMain < 3000000) {
            detectedWorldId = 201;
          } else if (unlockMain >= 3000000 && unlockMain < 4000000) {
            detectedWorldId = 301;
          } else if (unlockMain >= 4000000 && unlockMain < 5000000) {
            detectedWorldId = 401;
          } else if (unlockMain >= 5000000 && unlockMain < 6000000) {
            detectedWorldId = 501;
          }
        }
      }

      if (!detectedWorldId) {
        if (missionId >= 3050000 && missionId < 3060000) detectedWorldId = 301;
        else if (missionId >= 4010000 && missionId < 4020000) detectedWorldId = 401;
        else if (missionId >= 8016000 && missionId < 8017000) detectedWorldId = 101;
        else if (missionId >= 8025000 && missionId < 8026000) detectedWorldId = 301;
        else if (missionId >= 8027000 && missionId < 8028000) detectedWorldId = 401;
        else if (missionId >= 8035000 && missionId < 8036000) detectedWorldId = 501;
        else if (missionId >= 8042000 && missionId < 8043000) detectedWorldId = 401;
      }

      let detectedWorldName: string | undefined;
      if (!detectedWorldId) {
        const t = doc.title;
        if (
          t.includes("模拟宇宙") ||
          t.includes("寰宇蝗灾") ||
          t.includes("黄金与机械") ||
          t.includes("差分宇宙") ||
          t.includes("空间站特派") ||
          t.includes("概率、美学与回路") ||
          t.includes("二律背反的圆舞曲") ||
          t.includes("虚境味探")
        ) {
          detectedWorldId = 101;
        } else if (
          t.includes("帕姆") ||
          t.includes("列车") ||
          t.includes("流光忆彩") ||
          t.includes("出门靠朋友") ||
          t.includes("反光地板") ||
          t.includes("寻找碟片") ||
          t.includes("掉毛危机") ||
          t.includes("常回家看看") ||
          t.includes("身高测量") ||
          t.includes("遗失的纽扣") ||
          t.includes("跟我聊会儿吧") ||
          t.includes("健康大作战") ||
          t.includes("落枕的帕姆") ||
          t.includes("车厢")
        ) {
          detectedWorldId = 100;
        } else if (t.includes("摄影展览") || t.includes("仙舟手信")) {
          detectedWorldId = 301;
        } else if (t.includes("旧瓶新友") || t.includes("果汁配方")) {
          detectedWorldId = 401;
        } else if (t.includes("凡人的赞美诗")) {
          detectedWorldId = 201;
        } else {
          detectedWorldName = "系统玩法引导";
        }
      }

      if (detectedWorldId) {
        detectedWorldName = worldNames[detectedWorldId] ?? `世界 ${detectedWorldId}`;
      }

      const finalRegion = detectedWorldName ?? "系统玩法引导";
      const finalRegionId = detectedWorldId ? `world_${detectedWorldId}` : "system_guide";
      if (detectedWorldId) anchored++;
      else systemGuide++;

      const nextQuest = {
        ...(quest ?? {}),
        region: finalRegion,
        regionId: finalRegionId,
        regionName: finalRegion,
      };
      const newMetadata = { ...doc.metadata, quest: nextQuest };
      await client.query(`UPDATE knowledge.documents SET metadata = $1 WHERE id = $2`, [
        newMetadata,
        doc.id,
      ]);
    }

    console.log(
      `Updated ${staleDocs.rows.length} documents (world-anchored: ${anchored}, system_guide: ${systemGuide})`,
    );

    const checkOther = await client.query(
      `SELECT count(*) FROM knowledge.documents
       WHERE game_id = $1 AND revision_id = $2
         AND (metadata->'quest'->>'region' = '其他世界' OR metadata->'quest'->>'regionId' = 'world_0'
              OR metadata->>'region' = '其他世界' OR metadata->>'regionId' = 'world_0')`,
      [GAME_ID, revisionId],
    );
    console.log(`Remaining stale documents: ${checkOther.rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
