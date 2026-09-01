import { describe, expect, it } from "vitest";
import { GameDomainService, type KnowledgeRepository } from "./index.js";

const gameId = "00000000-0000-0000-0000-000000000001";
const revisionId = "00000000-0000-0000-0000-0000000000aa";

function makeRepository(overrides: Partial<KnowledgeRepository> = {}): KnowledgeRepository {
  return {
    getGame: async (id: string) =>
      id === gameId ? { id, slug: "genshin-impact", name: "原神", status: "active" } : null,
    getCapabilities: async () => [
      { gameId, capability: "entity_search", enabled: true },
      { gameId, capability: "lore_search", enabled: true },
    ],
    listRevisions: async () => [
      {
        id: revisionId,
        gameId,
        revisionNumber: 4,
        sourceBatchId: "batch",
        releaseNote: null,
        lifecycleStatus: "published",
        indexStatus: "ready",
        publishedAt: new Date(),
        isCurrent: true,
        manifestId: "manifest",
      },
    ],
    search: async () => ({
      entities: [
        {
          id: "entity-1",
          sourceKey: "entities/hutao",
          name: "胡桃",
          type: "character" as const,
          aliases: ["堂主"],
        },
      ],
      documents: [],
      segments: [],
      revision: "r4",
      indexStatus: "ready" as const,
    }),
    getDocument: async () => ({
      id: "doc-1",
      sourceKey: "lore/story",
      type: "character_story" as const,
      title: "胡桃的故事",
      locale: "zh-CN",
      revision: "r4",
      body: "全文很长很长的正文。".repeat(40),
      segments: [
        {
          id: "seg-1",
          ordinal: 0,
          headingPath: ["往生堂"],
          body: "往生堂七十七代堂主。".repeat(20),
          startOffset: 0,
          endOffset: 12,
          mentions: [],
        },
        {
          id: "seg-2",
          ordinal: 1,
          headingPath: ["传说"],
          body: "传说部分内容。".repeat(20),
          startOffset: 12,
          endOffset: 24,
          mentions: [],
        },
      ],
    }),
    genshin: {
      getCharacter: async (_revision: string, stableId: string) =>
        stableId === "char/hutao"
          ? {
              id: "sc-1",
              gameId,
              revisionId,
              stableId: "char/hutao",
              sourceKey: "structured/char/hutao",
              name: "胡桃",
              locale: "zh-CN",
              provenance: {},
              profile: {},
              rarity: 5,
            }
          : null,
      listCharacters: async () => [],
      upsertCharacter: async () => {
        throw new Error("not used");
      },
      upsertWeapon: async () => {
        throw new Error("not used");
      },
      getWeapon: async () => null,
      listWeapons: async () => [],
      upsertArtifactSet: async () => {
        throw new Error("not used");
      },
      getArtifactSet: async () => null,
      listArtifactSets: async () => [],
      upsertArtifact: async () => {
        throw new Error("not used");
      },
      getArtifact: async () => null,
      listArtifacts: async () => [],
      upsertMaterial: async () => {
        throw new Error("not used");
      },
      getMaterial: async () => null,
      listMaterials: async () => [],
      upsertAchievement: async () => {
        throw new Error("not used");
      },
      getAchievement: async () => null,
      listAchievements: async () => [],
      upsertEnemy: async () => {
        throw new Error("not used");
      },
      getEnemy: async () => null,
      listEnemies: async () => [],
    },
    ...overrides,
  } as unknown as KnowledgeRepository;
}

describe("GameDomainService", () => {
  it("resolves the current public revision through the shared read model", async () => {
    const service = new GameDomainService(makeRepository());
    await expect(service.requirePublicRevision(gameId)).resolves.toBe(revisionId);
  });

  it("rejects alias resolution for unknown games", async () => {
    const service = new GameDomainService(makeRepository());
    await expect(
      service.resolveAlias("00000000-0000-0000-0000-000000000099", "胡桃"),
    ).rejects.toMatchObject({
      code: "game_not_found",
    });
  });

  it("resolves aliases to entity summaries", async () => {
    const service = new GameDomainService(makeRepository());
    const entity = await service.resolveAlias(gameId, "堂主");
    expect(entity?.name).toBe("胡桃");
  });

  it("reads a named section with citations", async () => {
    const service = new GameDomainService(makeRepository());
    const section = await service.readSection({
      gameId,
      documentId: "doc-1",
      section: "往生堂",
      maxChars: 100,
    });
    expect(section.headingPath).toEqual(["往生堂"]);
    expect(section.body.startsWith("往生堂七十七代堂主。")).toBe(true);
    expect(section.truncated).toBe(true);
    expect(section.citations[0]?.documentId).toBe("doc-1");
    expect(section.citations[0]?.segmentId).toBe("seg-1");
  });

  it("truncates over-budget section reads", async () => {
    const service = new GameDomainService(makeRepository());
    const section = await service.readSection({
      gameId,
      documentId: "doc-1",
      maxChars: 100,
    });
    expect(section.truncated).toBe(true);
    expect(section.body.length).toBeLessThanOrEqual(100);
  });

  it("exposes structured character reads scoped to the public revision", async () => {
    const service = new GameDomainService(makeRepository());
    const character = await service.getCharacter(gameId, "char/hutao");
    expect(character.name).toBe("胡桃");
    await expect(service.getCharacter(gameId, "char/missing")).rejects.toMatchObject({
      code: "character_not_found",
    });
  });

  it("finds structured records by name through the requested kind only", async () => {
    const calls: string[] = [];
    const service = new GameDomainService(
      makeRepository({
        genshin: {
          ...makeRepository().genshin,
          listMaterials: async (options) => {
            calls.push(`materials:${options.query}:${options.limit}`);
            return [
              {
                id: "material-1",
                gameId,
                revisionId,
                stableId: "material/nichang",
                sourceKey: "structured/material/nichang",
                name: "霓裳花",
                locale: "zh-CN",
                provenance: {},
                category: "local_specialty",
                sources: [],
                usedBy: [],
              },
            ];
          },
          getMaterial: async (_revision, stableId) =>
            stableId === "material/nichang"
              ? {
                  id: "material-1",
                  gameId,
                  revisionId,
                  stableId: "material/nichang",
                  sourceKey: "structured/material/nichang",
                  name: "霓裳花",
                  locale: "zh-CN",
                  provenance: {},
                  category: "local_specialty",
                  sources: [],
                  usedBy: [],
                }
              : null,
          listCharacters: async () => {
            calls.push("characters");
            return [];
          },
          listWeapons: async () => {
            calls.push("weapons");
            return [];
          },
        },
      }),
    );

    const material = await service.findStructuredByName(gameId, "material", "霓裳花");

    expect(material).toMatchObject({ stableId: "material/nichang", name: "霓裳花" });
    expect(calls).toEqual(["materials:霓裳花:200"]);
  });
});
