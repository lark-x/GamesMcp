import { describe, expect, it } from "vitest";
import {
  assertUniqueCorpusIds,
  buildStableContentIdentity,
  deterministicCorpusId,
  naturalId,
} from "./ids.js";

describe("StarRail Corpus ID Stability", () => {
  it("generates deterministic ids from natural numbers", () => {
    expect(naturalId(1001001)).toBe(1001001);
    expect(naturalId("1001001")).toBe(1001001);
    expect(naturalId("invalid")).toBeUndefined();
    expect(naturalId(-1)).toBeUndefined();
  });

  it("ensures deterministic content identity does not depend on array index", () => {
    const recordA = { id: 101, title: "Item A" };
    const recordB = { id: 102, title: "Item B" };
    const recordC = { id: 103, title: "Item C" };

    const originalList = [recordA, recordB, recordC];
    const reorderedList = [{ id: 999, title: "New Item X" }, recordA, recordB, recordC];

    const idA1 = buildStableContentIdentity({
      category: "sr_item_lore",
      canonicalSourcePath: "ExcelOutput/ItemConfig.json",
      semanticKeys: [originalList[0]!.id],
      normalizedTitle: originalList[0]!.title,
    });
    const idA2 = buildStableContentIdentity({
      category: "sr_item_lore",
      canonicalSourcePath: "ExcelOutput/ItemConfig.json",
      semanticKeys: [reorderedList[1]!.id],
      normalizedTitle: reorderedList[1]!.title,
    });

    expect(idA1).toBe(idA2);

    const hashIdA1 = deterministicCorpusId({
      category: "sr_item_lore",
      identity: idA1,
    });
    const hashIdA2 = deterministicCorpusId({
      category: "sr_item_lore",
      identity: idA2,
    });

    expect(hashIdA1).toBe(hashIdA2);
  });

  it("detects duplicate category and id collision", () => {
    expect(() =>
      assertUniqueCorpusIds([
        { category: "sr_mission", id: 1001, relativePath: "sr_mission/1001.txt" },
        { category: "sr_mission", id: 1001, relativePath: "sr_mission/duplicate.txt" },
      ]),
    ).toThrow(/Duplicate StarRail corpus id/u);
  });
});
