import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface GoldenSchema {
  tables: Record<string, { topLevel: string; primaryKeys: string[]; textKeys: string[] }>;
  fixtures: Record<string, { topLevel: string; recordKeys: string[] }>;
}

describe("StarRail Source Schema Drift Protection", () => {
  const goldenPath = resolve("data/evaluation/starrail/source-schema-golden.json");
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenSchema;

  it("verifies fixture files match golden schema signatures", () => {
    for (const [relPath, sig] of Object.entries(golden.fixtures)) {
      const fullPath = resolve("data/fixtures/starrail", relPath);
      expect(existsSync(fullPath), `Fixture file missing: ${relPath}`).toBe(true);

      const records = JSON.parse(readFileSync(fullPath, "utf8"));
      if (sig.topLevel === "array") {
        expect(Array.isArray(records)).toBe(true);
        expect(records.length).toBeGreaterThan(0);
        const sample = records[0];
        for (const key of sig.recordKeys) {
          expect(key in sample, `Missing record key '${key}' in fixture ${relPath}`).toBe(true);
        }
      }
    }
  });

  it("verifies real TurnBasedGameData tables match golden schema if present", () => {
    const realDataDir = resolve(
      process.env.GAMESMCP_STARRAIL_DATA_DIR ??
        "data/games/starrail/turn-based-game-data/8cdb905dc2f8e6fffa9be4eb07af3e34435d6091",
    );

    if (!existsSync(realDataDir)) {
      // Skipped in environments without real TurnBasedGameData checkout
      return;
    }

    for (const [relPath, sig] of Object.entries(golden.tables)) {
      const fullPath = resolve(realDataDir, relPath);
      expect(existsSync(fullPath), `Upstream table missing: ${relPath}`).toBe(true);

      let raw = readFileSync(fullPath, "utf8");
      raw = raw.replace(/:\s*(-?\d{15,})/gu, ': "$1"');
      const records = JSON.parse(raw);

      if (sig.topLevel === "array") {
        expect(Array.isArray(records)).toBe(true);
        expect(records.length).toBeGreaterThan(0);
        const sample = records[0];
        for (const key of sig.primaryKeys) {
          expect(key in sample, `Missing primary key '${key}' in ${relPath}`).toBe(true);
        }
        for (const key of sig.textKeys) {
          expect(key in sample, `Missing text key '${key}' in ${relPath}`).toBe(true);
        }
      }
    }
  });
});
