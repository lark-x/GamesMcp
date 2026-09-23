/* eslint-disable @typescript-eslint/no-explicit-any */
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
  ): Promise<any[]>;
  getCharacter(revisionId: Id, stableId: string): Promise<any | null>;
  listWeapons(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<any[]>;
  getWeapon(revisionId: Id, stableId: string): Promise<any | null>;
  listArtifactSets(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<any[]>;
  getArtifactSet(revisionId: Id, stableId: string): Promise<any | null>;
  listEnemies(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<any[]>;
  getEnemy(revisionId: Id, stableId: string): Promise<any | null>;
  listAchievements(
    revisionId: Id,
    options: { query?: string; limit: number; offset?: number },
  ): Promise<any[]>;
  getAchievement(revisionId: Id, stableId: string): Promise<any | null>;
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

const STARRAIL_CATEGORY_LABELS: Record<string, string> = {
  character_ascension: "角色晋阶材料",
  exp_material: "角色经验材料",
  lightcone_exp: "光锥升级材料",
  relic_exp: "遗器强化材料",
  material: "通用培养材料",
  trace: "行迹材料",
  trace_material: "行迹材料",
  lightcone_ascension: "光锥晋阶材料",
  enemy_drop: "敌方掉落",
  weekly_boss: "周本材料",
  currency: "货币",
  synthesis: "合成材料",
  consumable: "消耗品",
  mission: "任务道具",
  event: "活动道具",
  other: "其他素材",
};

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
    const materials = await this.repository.genshin.listMaterials({
      revisionId,
      query: options.query,
      category: options.category,
      limit: options.limit,
      offset: options.offset,
    });
    return materials.map((material) => ({
      id: `sr_mat_${material.stableId}`,
      gameId: material.gameId,
      revisionId: material.revisionId,
      stableId: material.stableId,
      sourceKey: material.sourceKey ?? undefined,
      name: material.name,
      category: material.category,
      categoryLabel: STARRAIL_CATEGORY_LABELS[material.category] ?? material.category,
      rarity: material.rarity ?? null,
      description: material.description ?? null,
      sources: material.sources ?? [],
      usedBy: material.usedBy ?? [],
      provenance: material.provenance,
    }));
  }

  async getMaterial(revisionId: Id, stableId: string): Promise<CodexMaterial | null> {
    const material = await this.repository.genshin.getMaterial(revisionId, stableId);
    if (!material) return null;
    return {
      id: `sr_mat_${material.stableId}`,
      gameId: material.gameId,
      revisionId: material.revisionId,
      stableId: material.stableId,
      sourceKey: material.sourceKey ?? undefined,
      name: material.name,
      category: material.category,
      categoryLabel: STARRAIL_CATEGORY_LABELS[material.category] ?? material.category,
      rarity: material.rarity ?? null,
      description: material.description ?? null,
      sources: material.sources ?? [],
      usedBy: material.usedBy ?? [],
      provenance: material.provenance,
    };
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
