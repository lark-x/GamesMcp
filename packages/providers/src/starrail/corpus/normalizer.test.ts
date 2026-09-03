import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeStarRailText } from "./normalizer.js";

const golden = JSON.parse(
  readFileSync("data/evaluation/starrail-normalizer-golden.json", "utf8"),
) as Record<string, Array<{ input: string; output: string }>>;

describe("normalizeStarRailText", () => {
  for (const group of ["markup", "variables", "branches"]) {
    it(`matches ${group} golden samples`, () => {
      expect(golden[group]).toHaveLength(20);
      for (const item of golden[group] ?? []) {
        expect(normalizeStarRailText(item.input)).toBe(item.output);
      }
    });
  }
});
