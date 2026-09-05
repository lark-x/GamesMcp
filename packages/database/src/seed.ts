import { loadConfig } from "@gip/config";
import { createDatabase, createPool } from "./client.js";
import { gameCapabilities, games } from "./schema.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);

try {
  const [game] = await db
    .insert(games)
    .values({ slug: "genshin-impact", name: "原神", status: "active" })
    .onConflictDoUpdate({
      target: games.slug,
      set: { name: "原神", status: "active", updatedAt: new Date() },
    })
    .returning();
  if (game) {
    await db
      .insert(gameCapabilities)
      .values([
        { gameId: game.id, capability: "entity_search", enabled: true },
        { gameId: game.id, capability: "lore_search", enabled: true },
        { gameId: game.id, capability: "relationships", enabled: true },
        { gameId: game.id, capability: "evidence_qa", enabled: true },
      ])
      .onConflictDoNothing();
  }

  const [starRail] = await db
    .insert(games)
    .values({ slug: "honkai-star-rail", name: "崩坏：星穹铁道", status: "active" })
    .onConflictDoUpdate({
      target: games.slug,
      set: { name: "崩坏：星穹铁道", status: "active", updatedAt: new Date() },
    })
    .returning();
  if (starRail) {
    await db
      .insert(gameCapabilities)
      .values([
        { gameId: starRail.id, capability: "entity_search", enabled: true },
        { gameId: starRail.id, capability: "lore_search", enabled: true },
        { gameId: starRail.id, capability: "relationships", enabled: true },
        { gameId: starRail.id, capability: "evidence_qa", enabled: true },
      ])
      .onConflictDoNothing();
  }
  console.log("Seed complete.");
} finally {
  await pool.end();
}
