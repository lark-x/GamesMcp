import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { convertSnapshot, LOCKED_COMMIT, verifyCommit } from "./genshin-db-adapter.js";

const checkout = resolve("data/upstream/genshin-db");
describe("genshin-db adapter", () => {
  it("rejects a checkout at the wrong commit", async () => {
    await expect(verifyCommit(checkout, "0".repeat(40))).rejects.toThrow(
      "upstream_commit_mismatch",
    );
  });
  it("converts deterministic short facts without media or long bodies", async () => {
    await expect(access(resolve(checkout, "src/data/English/characters"))).resolves.toBeUndefined();
    const first = await convertSnapshot(checkout, { samplePerCategory: 10 });
    const second = await convertSnapshot(checkout, { samplePerCategory: 10 });
    expect(first.records).toEqual(second.records);
    expect(first.manifest.counts).toEqual({
      characters: 10,
      weapons: 10,
      artifacts: 10,
      materials: 10,
      enemies: 10,
    });
    expect(first.manifest.failures).toEqual([]);
    expect(JSON.stringify(first.records)).not.toMatch(/\.(png|jpg|jpeg|webp|mp3|wav)\b/i);
    expect(first.records.every((record) => record.title.length < 300 && !("body" in record))).toBe(
      true,
    );
  });
  it("records the locked commit and hash", async () => {
    const result = await convertSnapshot(checkout, { samplePerCategory: 1 });
    expect(result.records.every((record) => /^[a-f0-9]{64}$/.test(record.contentHash))).toBe(true);
    expect(result.manifest.upstream.commit).toBe(LOCKED_COMMIT);
    expect(await readFile(resolve("docs/genshin-db-data-sources.md"), "utf8")).toContain(
      LOCKED_COMMIT,
    );
  });
});
