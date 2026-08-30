import { describe, expect, it } from "vitest";
import type { KnowledgeRepository } from "./index.js";
import { KnowledgeService } from "./index.js";

const genshinId = "00000000-0000-0000-0000-000000000001";
const otherGameId = "00000000-0000-0000-0000-000000000002";

describe("game isolation", () => {
  it("keeps same-name searches scoped to the requested game", async () => {
    const calls: string[] = [];
    const repository = {
      getGame: async (gameId: string) =>
        [genshinId, otherGameId].includes(gameId)
          ? { id: gameId, slug: gameId, name: "同名游戏", status: "active" }
          : null,
      search: async (gameId: string) => {
        calls.push(gameId);
        return {
          entities: [
            {
              id: `${gameId}-entity`,
              sourceKey: "entities/same-name",
              name: "同名角色",
              type: "character" as const,
              aliases: [],
            },
          ],
          documents: [],
          segments: [],
          revision: "r1",
          indexStatus: "ready",
        };
      },
    } as unknown as KnowledgeRepository;
    const service = new KnowledgeService(repository);

    const first = await service.search(genshinId, { query: "同名角色", limit: 5, debug: false });
    const second = await service.search(otherGameId, { query: "同名角色", limit: 5, debug: false });

    expect(calls).toEqual([genshinId, otherGameId]);
    expect(first.entities[0]?.id).not.toBe(second.entities[0]?.id);
    expect(first.entities[0]?.sourceKey).toBe(second.entities[0]?.sourceKey);
  });
});
