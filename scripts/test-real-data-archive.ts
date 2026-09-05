import { strict as assert } from "node:assert";
import { loadConfig } from "../packages/config/src/index.ts";
import { createDatabase, createPool, SqlKnowledgeRepository } from "../packages/database/src/index.ts";
import { GameDomainService } from "../packages/domain/src/index.ts";
import { createApp } from "../apps/api/src/app.ts";

async function main() {
  console.log("=== Starting Real Data Archive Quality & Isolation Gate ===");
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
  const gameDomain = new GameDomainService(repository);
  const app = createApp({ repository, config });

  try {
    // 1. Resolve Genshin Game & Published Revision
    const games = await repository.listGames();
    const genshin = games.find((g) => g.slug === "genshin-impact");
    assert.ok(genshin, "Genshin Impact game must exist in database");

    const revisions = await repository.listRevisions(genshin.id);
    const publishedRev = revisions.find((r) => r.lifecycleStatus === "published" && r.isCurrent);
    assert.ok(publishedRev, "Published, current revision must exist for Genshin Impact");
    console.log(`[PASS] Genshin Impact game: ${genshin.id}, revision: ${publishedRev.id}`);

    // 2. Story Narrative & Region Assertions
    console.log("--> Testing Story Catalog & Region Resolution...");
    const catalog = await repository.getStoryCatalog(genshin.id, publishedRev.id);
    assert.ok(catalog.regions.length > 0, "Catalog must contain regions");
    console.log(`[PASS] Catalog contains ${catalog.regions.length} regions`);

    // Verify key regions exist
    const regionNames = catalog.regions.map((r) => r.name);
    console.log("Found regionNames:", regionNames, "IDs:", catalog.regions.map((r) => r.id));
    assert.ok(regionNames.some((r) => r.includes("蒙德")), "Mondstadt region must exist");
    assert.ok(regionNames.some((r) => r.includes("璃月")), "Liyue region must exist");
    assert.ok(regionNames.some((r) => r.includes("稻妻")), "Inazuma region must exist");
    assert.ok(regionNames.some((r) => r.includes("须弥")), "Sumeru region must exist");
    console.log(`[PASS] Key Teyvat nations present: ${regionNames.join(", ")}`);

    // Verify Archon Quest (AQ) Region mapping
    const mondstadt = catalog.regions.find((r) => r.id === "mondstadt");
    assert.ok(mondstadt, "Mondstadt must exist");
    assert.ok(
      mondstadt.chapters.some((c) => c.name.includes("捕风的异乡人")),
      "Mondstadt must contain prologue chapter '捕风的异乡人'",
    );
    assert.ok(
      mondstadt.chapters.some((c) => c.name.includes("为了没有眼泪的明天")),
      "Mondstadt must contain prologue chapter '为了没有眼泪的明天'",
    );

    const liyue = catalog.regions.find((r) => r.id === "liyue");
    assert.ok(liyue, "Liyue must exist");
    assert.ok(
      liyue.chapters.some((c) => c.name.includes("浮生") || c.name.includes("辞行") || c.name.includes("客星") || c.name.includes("危途")),
      "Liyue must contain Chapter I Archon chapters",
    );
    console.log(`[PASS] Verified Archon quest chapters mapped to Mondstadt and Liyue regions`);

    // 3. Test Quest Dialogue & Multi-Mode Narrative
    console.log("--> Testing Quest Multi-Mode Narrative Pipeline...");
    const prologueQuest = await repository.getQuest(genshin.id, {
      questKey: "quest/354",
      nodeLimit: 50,
      revisionId: publishedRev.id,
    });
    if (prologueQuest) {
      assert.ok(prologueQuest.region, "Quest 354 must have region mapped");
      assert.ok(prologueQuest.narrative, "Quest 354 must have narrative model");
      assert.ok(
        ["structured_dialogue", "document", "objective_only"].includes(prologueQuest.narrative.mode),
        `Unexpected narrative mode: ${prologueQuest.narrative.mode}`,
      );
      console.log(`[PASS] Quest 354: region="${prologueQuest.region}", mode="${prologueQuest.narrative.mode}"`);
    }

    // 4. Test Material Domain (Sources, Usages, Categories)
    console.log("--> Testing Material Domain Quality...");
    const wolfhook = await repository.genshin.getMaterial(publishedRev.id, "genshin:material:100021");
    assert.ok(wolfhook, "Wolfhook (100021) must exist in database");
    assert.equal(wolfhook.name, "钩钩果");
    assert.equal(wolfhook.category, "local_specialty");
    assert.ok(wolfhook.sources.length > 0, "Wolfhook must have sources");
    assert.ok(wolfhook.sources.some((s) => s.includes("奔狼领")), `Wolfhook sources missing 奔狼领: ${wolfhook.sources}`);
    assert.ok(wolfhook.usedBy.length > 0, "Wolfhook must have usedBy");
    assert.ok(wolfhook.usedBy.includes("雷泽"), `Wolfhook usedBy missing 雷泽: ${wolfhook.usedBy}`);
    console.log(`[PASS] Wolfhook verified: category=${wolfhook.category}, sources=${JSON.stringify(wolfhook.sources)}, usedBy=${JSON.stringify(wolfhook.usedBy)}`);

    // Category Distribution Quality Gate (other <= 30%)
    const catAggregations = await repository.genshin.aggregateMaterialCategories(publishedRev.id);
    const totalMaterials = catAggregations.reduce((sum, c) => sum + c.count, 0);
    const otherCat = catAggregations.find((c) => c.key === "other");
    const otherRatio = otherCat ? (otherCat.count / totalMaterials) * 100 : 0;
    console.log(`[INFO] Material categories count: ${catAggregations.length}, total: ${totalMaterials}, 'other' ratio: ${otherRatio.toFixed(1)}%`);
    assert.ok(otherRatio <= 30, `'other' category ratio must be <= 30%, got ${otherRatio.toFixed(1)}%`);
    console.log("[PASS] Material categorization quality gate passed (other <= 30%)");

    // Search across used_by (e.g. search "雷泽" should find "钩钩果")
    const searchRazor = await repository.genshin.listMaterials({
      revisionId: publishedRev.id,
      query: "雷泽",
      limit: 20,
    });
    assert.ok(searchRazor.some((m) => m.name === "钩钩果"), "Searching '雷泽' must match '钩钩果' via used_by");
    console.log(`[PASS] Search by character usage: searching '雷泽' successfully found '钩钩果'`);

    // 5. Cross-Game Isolation Gate
    console.log("--> Testing Cross-Game Isolation Gate...");
    const starRail = games.find((g) => g.slug === "honkai-star-rail" || g.slug === "starrail");
    if (starRail) {
      const srAdapter = await gameDomain.getArchiveAdapter(starRail.id);
      const srTerms = srAdapter.getTerminology();
      assert.equal(srTerms.weaponLabel, "光锥", "StarRail weapon terminology must be '光锥'");
      assert.equal(srTerms.artifactLabel, "遗器", "StarRail artifact terminology must be '遗器'");

      const genshinAdapter = await gameDomain.getArchiveAdapter(genshin.id);
      const genshinTerms = genshinAdapter.getTerminology();
      assert.equal(genshinTerms.weaponLabel, "武器", "Genshin weapon terminology must be '武器'");
      assert.equal(genshinTerms.artifactLabel, "圣遗物", "Genshin artifact terminology must be '圣遗物'");

      // Test API endpoint terminology
      const termResp = await app.inject({
        method: "GET",
        url: `/api/games/${starRail.id}/codex/terminology`,
      });
      assert.equal(termResp.statusCode, 200);
      assert.equal(termResp.json().terminology.weaponLabel, "光锥");
      console.log("[PASS] Cross-game terminology isolation verified");
    }

    console.log("=== ALL P0 QUALITY & ISOLATION GATES PASSED! ===");
  } finally {
    await app.close();
    await pool.end();
  }
}

void main();
