import { describe, expect, it } from "vitest";
import type { NormalizedRecord } from "@gip/domain";
import {
  mergeReleaseCandidateRecords,
  releaseCandidateChecksum,
  stableEntityId,
} from "./repository.js";

describe("stable entity identity", () => {
  it("depends on game and source identity, not the display name", () => {
    const gameA = "00000000-0000-0000-0000-000000000001";
    const gameB = "00000000-0000-0000-0000-000000000002";
    const sourceKey = "entities/traveler";

    expect(stableEntityId(gameA, sourceKey)).toBe(stableEntityId(gameA, sourceKey));
    expect(stableEntityId(gameA, sourceKey)).not.toBe(stableEntityId(gameB, sourceKey));
    expect(stableEntityId(gameA, sourceKey)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("release candidate snapshots", () => {
  const record = (sourceKey: string, contentHash: string): NormalizedRecord => ({
    sourceKey,
    recordType: "document",
    title: sourceKey,
    metadata: {},
    contentHash,
    parserVersion: "test",
  });

  it("materializes an immutable full preview without mutating the formal base", () => {
    const base = [record("book/keep", "1"), record("book/change", "1"), record("book/delete", "1")];
    const preview = mergeReleaseCandidateRecords(base, [
      {
        records: [record("book/change", "2"), record("book/add", "1")],
        confirmedDeletionKeys: ["book/delete"],
      },
    ]);
    expect(preview.map((item) => item.sourceKey)).toEqual(["book/add", "book/change", "book/keep"]);
    expect(preview.find((item) => item.sourceKey === "book/change")?.contentHash).toBe("2");
    expect(base.map((item) => item.sourceKey)).toEqual(["book/keep", "book/change", "book/delete"]);
  });

  it("produces a stable checksum which changes with preview content", () => {
    const first = [record("book/1", "a")];
    const second = [record("book/1", "b")];
    expect(releaseCandidateChecksum(first)).toBe(releaseCandidateChecksum(first));
    expect(releaseCandidateChecksum(first)).not.toBe(releaseCandidateChecksum(second));
    expect(releaseCandidateChecksum(first)).toMatch(/^[a-f0-9]{64}$/);
  });
});
