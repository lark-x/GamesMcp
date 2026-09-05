import type { CodexMaterial, GameTerminology } from "@gip/contracts";
import type { Id, KnowledgeRepository } from "./index.js";

export interface GameArchiveAdapter {
  readonly gameSlug: string;
  getTerminology(): GameTerminology;
  listMaterials(
    revisionId: Id,
    options: { query?: string; category?: string; limit: number; offset?: number },
  ): Promise<CodexMaterial[]>;
  getMaterial(revisionId: Id, stableId: string): Promise<CodexMaterial | null>;
  listCharacters(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]>;
  getCharacter(revisionId: Id, stableId: string): Promise<unknown | null>;
  listWeapons(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]>;
  getWeapon(revisionId: Id, stableId: string): Promise<unknown | null>;
  listArtifactSets(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]>;
  getArtifactSet(revisionId: Id, stableId: string): Promise<unknown | null>;
  listEnemies(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]>;
  getEnemy(revisionId: Id, stableId: string): Promise<unknown | null>;
  listAchievements(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]>;
  getAchievement(revisionId: Id, stableId: string): Promise<unknown | null>;
}

export class GenshinArchiveAdapter implements GameArchiveAdapter {
  readonly gameSlug = "genshin-impact";

  constructor(private readonly repository: KnowledgeRepository) {}

  getTerminology(): GameTerminology {
    return {
      characterLabel: "角色",
      weaponLabel: "武器",
      artifactLabel: "圣遗物",
      materialLabel: "材料",
    };
  }

  async listMaterials(
    revisionId: Id,
    options: { query?: string; category?: string; limit: number; offset?: number },
  ): Promise<CodexMaterial[]> {
    return this.repository.genshin.listMaterials({
      revisionId,
      query: options.query,
      category: options.category,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getMaterial(revisionId: Id, stableId: string): Promise<CodexMaterial | null> {
    return this.repository.genshin.getMaterial(revisionId, stableId);
  }

  async listCharacters(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]> {
    return this.repository.genshin.listCharacters({
      revisionId,
      query: options.query,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getCharacter(revisionId: Id, stableId: string): Promise<unknown | null> {
    return this.repository.genshin.getCharacter(revisionId, stableId);
  }

  async listWeapons(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]> {
    return this.repository.genshin.listWeapons({
      revisionId,
      query: options.query,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getWeapon(revisionId: Id, stableId: string): Promise<unknown | null> {
    return this.repository.genshin.getWeapon(revisionId, stableId);
  }

  async listArtifactSets(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]> {
    return this.repository.genshin.listArtifactSets({
      revisionId,
      query: options.query,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getArtifactSet(revisionId: Id, stableId: string): Promise<unknown | null> {
    return this.repository.genshin.getArtifactSet(revisionId, stableId);
  }

  async listEnemies(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]> {
    return this.repository.genshin.listEnemies({
      revisionId,
      query: options.query,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getEnemy(revisionId: Id, stableId: string): Promise<unknown | null> {
    return this.repository.genshin.getEnemy(revisionId, stableId);
  }

  async listAchievements(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<unknown[]> {
    return this.repository.genshin.listAchievements({
      revisionId,
      query: options.query,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async getAchievement(revisionId: Id, stableId: string): Promise<unknown | null> {
    return this.repository.genshin.getAchievement(revisionId, stableId);
  }
}

export class StarRailArchiveAdapter implements GameArchiveAdapter {
  readonly gameSlug = "honkai-star-rail";

  constructor(private readonly repository: KnowledgeRepository) {}

  getTerminology(): GameTerminology {
    return {
      characterLabel: "角色",
      weaponLabel: "光锥",
      artifactLabel: "遗器",
      materialLabel: "材料",
    };
  }

  async listMaterials(
    revisionId: Id,
    options: { query?: string; category?: string; limit: number; offset?: number },
  ): Promise<CodexMaterial[]> {
    if (this.repository.genshin?.listMaterials) {
      return this.repository.genshin.listMaterials({
        revisionId,
        query: options.query,
        category: options.category,
        limit: options.limit,
        offset: options.offset,
      });
    }
    return [];
  }

  async getMaterial(revisionId: Id, stableId: string): Promise<CodexMaterial | null> {
    if (this.repository.genshin?.getMaterial) {
      return this.repository.genshin.getMaterial(revisionId, stableId);
    }
    return null;
  }

  async listCharacters(): Promise<unknown[]> {
    return [];
  }

  async getCharacter(): Promise<unknown | null> {
    return null;
  }

  async listWeapons(): Promise<unknown[]> {
    return [];
  }

  async getWeapon(): Promise<unknown | null> {
    return null;
  }

  async listArtifactSets(): Promise<unknown[]> {
    return [];
  }

  async getArtifactSet(): Promise<unknown | null> {
    return null;
  }

  async listEnemies(): Promise<unknown[]> {
    return [];
  }

  async getEnemy(): Promise<unknown | null> {
    return null;
  }

  async listAchievements(): Promise<unknown[]> {
    return [];
  }

  async getAchievement(): Promise<unknown | null> {
    return null;
  }
}
