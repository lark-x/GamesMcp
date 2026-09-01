import { describe, expect, it } from "vitest";
import type { GenshinCharacter, NormalizedRecord } from "@gip/domain";
import type { Database } from "./client.js";
import { SqlGenshinStructuredRepository } from "./repository-genshin-core.js";
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

describe("Genshin structured repository", () => {
  const characterInput: Omit<GenshinCharacter, "id"> = {
    gameId: "00000000-0000-0000-0000-000000000001",
    revisionId: "00000000-0000-0000-0000-000000000002",
    stableId: "genshin:character:nahida",
    sourceKey: "avatar/nahida",
    name: "纳西妲",
    locale: "zh-CN",
    gameVersion: "5.0",
    sourceId: "00000000-0000-0000-0000-000000000003",
    sourceSnapshotId: "00000000-0000-0000-0000-000000000004",
    provenance: { dataset: "test" },
    title: "白草净华",
    rarity: 5,
    element: "dendro",
    weaponType: "catalyst",
    region: "须弥",
    affiliation: "净善宫",
    birthday: "10-27",
    constellation: "智慧主座",
    description: "小吉祥草王",
    profile: { archon: true },
  };

  const characterRow = {
    id: "00000000-0000-0000-0000-000000000005",
    game_id: characterInput.gameId,
    revision_id: characterInput.revisionId,
    stable_id: characterInput.stableId,
    source_key: characterInput.sourceKey,
    name: characterInput.name,
    locale: characterInput.locale,
    game_version: characterInput.gameVersion,
    source_id: characterInput.sourceId,
    source_snapshot_id: characterInput.sourceSnapshotId,
    provenance: characterInput.provenance,
    title: characterInput.title,
    rarity: characterInput.rarity,
    element: characterInput.element,
    weapon_type: characterInput.weaponType,
    region: characterInput.region,
    affiliation: characterInput.affiliation,
    birthday: characterInput.birthday,
    constellation: characterInput.constellation,
    description: characterInput.description,
    profile: characterInput.profile,
  };

  function fakeDb(resultSets: Array<unknown[]>): {
    db: Database;
    calls: unknown[];
  } {
    const calls: unknown[] = [];
    return {
      db: {
        execute: async (query: unknown) => {
          calls.push(query);
          return resultSets.shift() ?? [];
        },
      } as unknown as Database,
      calls,
    };
  }

  it("upserts and maps revisioned character records", async () => {
    const { db, calls } = fakeDb([[characterRow]]);
    const repository = new SqlGenshinStructuredRepository(db);

    const character = await repository.upsertCharacter(characterInput);

    expect(calls).toHaveLength(1);
    expect(character).toMatchObject({
      id: characterRow.id,
      gameId: characterInput.gameId,
      revisionId: characterInput.revisionId,
      stableId: characterInput.stableId,
      name: "纳西妲",
      element: "dendro",
      weaponType: "catalyst",
      profile: { archon: true },
    });
  });

  it("reads records by revision and stable id without leaking other revisions", async () => {
    const { db, calls } = fakeDb([[characterRow], []]);
    const repository = new SqlGenshinStructuredRepository(db);

    await expect(
      repository.getCharacter(characterInput.revisionId, characterInput.stableId),
    ).resolves.toMatchObject({
      revisionId: characterInput.revisionId,
      stableId: characterInput.stableId,
    });
    await expect(
      repository.getCharacter("00000000-0000-0000-0000-000000000099", characterInput.stableId),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("lists revision-scoped records with bounded pagination", async () => {
    const { db, calls } = fakeDb([[characterRow]]);
    const repository = new SqlGenshinStructuredRepository(db);

    await expect(
      repository.listCharacters({
        revisionId: characterInput.revisionId,
        limit: 500,
        offset: -10,
        query: "纳西妲",
      }),
    ).resolves.toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
