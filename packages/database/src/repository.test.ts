import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { GenshinCharacter, NormalizedRecord } from "@gip/domain";
import type { Database } from "./client.js";
import { SqlGenshinStructuredRepository } from "./repository-genshin-core.js";
import { SqlSearchRepositoryPort } from "./search-port.js";
import {
  mergeReleaseCandidateRecords,
  releaseCandidateChecksum,
  SqlKnowledgeRepository,
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

  it("finds records by exact normalized name within a revision", async () => {
    const { db, calls } = fakeDb([[characterRow], []]);
    const repository = new SqlGenshinStructuredRepository(db);

    await expect(
      repository.findCharacterByNormalizedName(characterInput.revisionId, "纳西妲"),
    ).resolves.toMatchObject({ stableId: characterInput.stableId });
    await expect(
      repository.findCharacterByNormalizedName("00000000-0000-0000-0000-000000000099", "纳西妲"),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("queries entity text bindings with revision and binding type filters", async () => {
    const bindingRow = {
      id: "00000000-0000-0000-0000-000000000010",
      game_id: characterInput.gameId,
      revision_id: characterInput.revisionId,
      entity_type: "character",
      entity_stable_id: characterInput.stableId,
      document_id: "00000000-0000-0000-0000-000000000011",
      segment_id: "00000000-0000-0000-0000-000000000012",
      binding_type: "character_story" as const,
      confidence: "1.0",
      binding_source: "direct_upstream" as const,
      metadata: { field: "story" },
      created_at: new Date("2026-08-30T00:00:00.000Z"),
    };
    const { db, calls } = fakeDb([[bindingRow]]);
    const repository = new SqlKnowledgeRepository(db);

    await expect(
      repository.getEntityTextBindings(
        characterInput.revisionId,
        characterInput.stableId,
        "character_story",
      ),
    ).resolves.toMatchObject([
      {
        revisionId: characterInput.revisionId,
        entityStableId: characterInput.stableId,
        documentId: bindingRow.document_id,
        segmentId: bindingRow.segment_id,
        confidence: 1,
      },
    ]);

    const query = new PgDialect().sqlToQuery(calls[0] as SQL);
    expect(query.sql).toContain("from knowledge.text_bindings");
    expect(query.sql).toContain("revision_id = $1::uuid");
    expect(query.sql).toContain("entity_stable_id = $2");
    expect(query.sql).toContain("binding_type = $3");
    expect(query.params).toEqual([
      characterInput.revisionId,
      characterInput.stableId,
      "character_story",
    ]);
  });

  it("queries binding entities within one revision and optional segment", async () => {
    const { db, calls } = fakeDb([[]]);
    const repository = new SqlKnowledgeRepository(db);
    const documentId = "00000000-0000-0000-0000-000000000011";
    const segmentId = "00000000-0000-0000-0000-000000000012";

    await expect(
      repository.getBindingEntities(characterInput.revisionId, documentId, segmentId),
    ).resolves.toEqual([]);

    const query = new PgDialect().sqlToQuery(calls[0] as SQL);
    expect(query.sql).toContain("from knowledge.text_bindings");
    expect(query.sql).toContain("revision_id = $1::uuid");
    expect(query.sql).toContain("document_id = $2::uuid");
    expect(query.sql).toContain("segment_id = $3::uuid");
    expect(query.params).toEqual([characterInput.revisionId, documentId, segmentId]);
  });
});

describe("PostgreSQL search port", () => {
  function fakeSearchDb(resultSets: Array<unknown[]>): {
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

  it("uses revision-scoped PostgreSQL FTS and returns match metadata for structured hits", async () => {
    const { db, calls } = fakeSearchDb([
      [
        {
          kind: "character",
          stableId: "genshin:character:hutao",
          name: "胡桃",
          aliases: [],
          body: "往生堂堂主",
          rank: 1,
          matchType: "exact",
        },
      ],
    ]);
    const repository = new SqlSearchRepositoryPort(db);

    await expect(
      repository.listStructuredAtRevision("game-id", "revision-id", "胡桃"),
    ).resolves.toMatchObject([
      { stableId: "genshin:character:hutao", rank: 1, matchType: "exact" },
    ]);
    const shape = new PgDialect().sqlToQuery(calls[0] as SQL).sql;
    expect(shape).toContain("search_vector");
    expect(shape).toContain("@@");
    expect(shape).toContain("plainto_tsquery");
    expect(shape).toContain("websearch_to_tsquery");
    expect(shape).toContain("matchType");
    expect(shape).toContain("revision_id");
  });

  it("pushes dialogue filters into the revision-scoped SQL query", async () => {
    const { db, calls } = fakeSearchDb([
      [
        {
          document_id: "document-id",
          node_key: "node-1",
          subquest_key: "subquest-1",
          quest_key: "quest-1",
          speaker: "派蒙",
          body: "我们出发吧",
          document_title: "序章",
          document_type: "archon_quest",
          locale: "zh-CN",
          rank: 0.7,
          matchType: "fts",
        },
      ],
    ]);
    const repository = new SqlSearchRepositoryPort(db);

    await expect(
      repository.listDialogueHits("game-id", "revision-id", "出发", {
        speaker: "派蒙",
        quest: "quest-1",
        nodeType: "dialogue",
        locale: "zh-CN",
      }),
    ).resolves.toHaveLength(1);
    const shape = new PgDialect().sqlToQuery(calls[0] as SQL).sql;
    expect(shape).toContain("speaker_name");
    expect(shape).toContain("quest_key");
    expect(shape).toContain("node_type");
    expect(shape).toContain("d.locale");
    expect(shape).toContain("q.revision_id");
    expect(shape).toContain("matchType");
  });

  it("keeps a segment-only FTS hit when its parent document is not a direct hit", async () => {
    const { db } = fakeSearchDb([
      [],
      [
        {
          document_id: "document-id",
          segment_body: "只在段落中出现的文本",
          id: "document-id",
          source_key: "book/segment-only",
          title: "书籍",
          type: "book",
          locale: "zh-CN",
          document_body: "",
          rank: 0.4,
          matchType: "fts",
        },
      ],
    ]);
    const repository = new SqlSearchRepositoryPort(db);

    await expect(
      repository.listDocumentHits("game-id", "revision-id", "段落"),
    ).resolves.toMatchObject([
      {
        key: "document-id",
        body: "只在段落中出现的文本",
        matchType: "fts",
      },
    ]);
  });
});
