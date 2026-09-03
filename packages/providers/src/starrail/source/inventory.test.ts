import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStarRailInventory, toCanonicalSourcePath } from "./inventory.js";

describe("StarRail Source Inventory canonical paths", () => {
  it("normalizes Windows-style backslashes to forward slashes", () => {
    const root = join("C:", "data", "starrail");
    const file = join(root, "Story", "Mission", "Main.json");
    const canonical = toCanonicalSourcePath(root, file);
    expect(canonical).toBe("Story/Mission/Main.json");
    expect(canonical).not.toContain("\\");
  });

  it("preserves POSIX-style paths without modification", () => {
    const root = "/data/starrail";
    const file = "/data/starrail/ExcelOutput/ItemConfig.json";
    const canonical = toCanonicalSourcePath(root, file);
    expect(canonical).toBe("ExcelOutput/ItemConfig.json");
    expect(canonical).not.toContain("\\");
  });

  it("ensures buildStarRailInventory outputs only canonical paths", async () => {
    const inventory = await buildStarRailInventory({
      dataDir: "data/fixtures/starrail",
      sourceRef: "fixture",
    });

    expect(inventory.items.length).toBeGreaterThan(0);
    for (const item of inventory.items) {
      expect(item.path).not.toContain("\\");
      expect(item.path).toMatch(/^(?:Config|ExcelOutput|Story|TextMap)\//u);
    }
  });
});
