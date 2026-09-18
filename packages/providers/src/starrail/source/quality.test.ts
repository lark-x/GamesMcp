import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSourceJson } from "./json.js";
import { buildStarRailInventory } from "./inventory.js";
import { StarRailTextMapResolver } from "./textmap.js";
import { readStarRailSourceSnapshot } from "./snapshot.js";
import { readSafeJsonFile, resolveTextCandidate } from "../extractors/shared.js";

describe("source integrity", () => {
  it("preserves 64-bit hashes in objects/arrays without corrupting strings or decimals", () => {
    expect(
      parseSourceJson(
        '{"hash":18446744073709551615,"ids":[-18446744073709551615],"text":"value:1234567890123456789","decimal":123456789012345.5,"exponent":1e20}',
      ),
    ).toEqual({
      hash: "18446744073709551615",
      ids: ["-18446744073709551615"],
      text: "value:1234567890123456789",
      decimal: 123456789012345.5,
      exponent: 1e20,
    });
  });

  it("rebuilds changed inventories, merges locale shards, rejects missing locales and conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "sr-source-quality-"));
    await mkdir(join(root, "TextMap"));
    const file = join(root, "TextMap/TextMapCHS_0.json");
    await writeFile(file, '{"1":"甲"}');
    const output = join(root, "inventory.json");
    const before = await buildStarRailInventory({ dataDir: root, sourceRef: "one", output });
    await writeFile(file, '{"1":"乙","12720770977431568614":"治疗量提高"}');
    await writeFile(join(root, "TextMap/TextMapCHS_1.json"), '{"2":"丙"}');
    const inventory = await buildStarRailInventory({ dataDir: root, sourceRef: "two", output });
    expect(inventory.sourceRef).toBe("two");
    expect(inventory.items[0]?.hash).not.toBe(before.items[0]?.hash);
    const resolver = new StarRailTextMapResolver({ dataDir: root, inventory });
    expect((await resolver.load()).totalKeys).toBe(3);
    expect(resolver.resolve("RelicDesc_1012")).toBe("治疗量提高");
    expect(resolver.resolve(1)).toBe("乙");
    await expect(
      new StarRailTextMapResolver({ dataDir: root, inventory, locale: "EN" }).load(),
    ).rejects.toThrow("Missing TextMap");
    await writeFile(join(root, "TextMap/TextMapCHS_1.json"), '{"1":"冲突"}');
    await expect(new StarRailTextMapResolver({ dataDir: root, inventory }).load()).rejects.toThrow(
      "Conflicting",
    );
    await writeFile(file, "{broken");
    await expect(readSafeJsonFile(file)).rejects.toThrow();
  });

  it("does not label fixtures with the parent repository's commit", async () => {
    expect((await readStarRailSourceSnapshot("data/fixtures/starrail")).ref).toBe("unknown");
  });

  it("reports unresolved hashes instead of publishing them as prose", () => {
    const context = {
      resolver: { resolve: () => null },
      sourcePath: "test.json",
      index: 0,
      issues: [],
    };
    expect(resolveTextCandidate({ Hash: "18446744073709551615" }, context)).toBeUndefined();
    expect(context.issues).toHaveLength(1);
    expect(resolveTextCandidate("普通文本", context)).toBe("普通文本");
  });
});
