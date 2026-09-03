import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildStarRailIstarothCorpus } from "./build.js";
import { deterministicCorpusId } from "./ids.js";
import { validateStarRailIstarothCorpus } from "./validator.js";

const FIXTURE_DIR = "data/fixtures/starrail";

describe("StarRail Istaroth corpus build", () => {
  it("builds an Istaroth-compatible fixture corpus with P0 categories", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "gamesmcp-starrail-corpus-"));
    const result = await buildStarRailIstarothCorpus({
      sourceDir: FIXTURE_DIR,
      outputDir,
      locale: "CHS",
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    expect(result.metadata.stats.categories).toMatchObject({
      sr_mission: 1,
      sr_story: 1,
      sr_message: 1,
      sr_train_visitor: 1,
      sr_book: 1,
      sr_character_story: 1,
      sr_voiceline: 1,
      sr_item_lore: 1,
    });
    expect(result.documents.map((document) => document.relativePath)).toContain(
      "sr_mission/1001001.txt",
    );
    expect(
      result.documents.find((document) => document.category === "sr_mission")?.content,
    ).toContain("卡芙卡：听我说");

    const validation = await validateStarRailIstarothCorpus({ corpusDir: outputDir });
    expect(validation).toMatchObject({ ok: true, manifestEntries: 8 });
  });

  it("uses deterministic synthetic ids when natural ids are absent", () => {
    expect(
      deterministicCorpusId({ category: "sr_story", identity: "Story/SideStory.json:missing" }),
    ).toBe(
      deterministicCorpusId({ category: "sr_story", identity: "Story/SideStory.json:missing" }),
    );
  });
});
