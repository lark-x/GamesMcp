import { resolve } from "node:path";
import type { StarRailEnemy } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";

export interface EnemyExtractorOptions {
  dataDir: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailEnemyExtractor {
  private readonly dataDir: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: EnemyExtractorOptions) {
    this.dataDir = options.dataDir;
    this.inventory = options.inventory;
    this.resolver = options.resolver;
    this.fixture = options.fixture ?? false;
  }

  private resolveHash(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === "number" || typeof val === "string") {
      return this.resolver.resolve(val);
    }
    if (typeof val === "object") {
      const rec = val as Record<string, unknown>;
      const hash = rec.Hash ?? rec.hash ?? rec.TextMapHash;
      if (hash !== undefined && hash !== null) {
        return this.resolver.resolve(hash as string | number);
      }
    }
    return null;
  }

  public async extractEnemies(): Promise<StarRailEnemy[]> {
    const monsterItem = this.inventory.items.find((i) => i.path === "ExcelOutput/MonsterConfig.json");
    if (!monsterItem) {
      return this.fixture ? this.getBaselineEnemies() : [];
    }

    const rawMonsters = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, monsterItem.path),
    );
    if (!Array.isArray(rawMonsters) || rawMonsters.length === 0) {
      return this.fixture ? this.getBaselineEnemies() : [];
    }

    const enemies: StarRailEnemy[] = [];
    for (const m of rawMonsters) {
      const id = Number(m.MonsterID ?? m.ID);
      if (!Number.isInteger(id) || id > 900000) continue;

      const name = this.resolveHash(m.MonsterName) ?? `敌方目标 ${id}`;
      const rankStr = String(m.Rank ?? "");
      const rank: StarRailEnemy["rank"] = rankStr.includes("Boss")
        ? "BOSS"
        : rankStr.includes("Elite")
          ? "ELITE"
          : "MINION";

      const weaknesses: string[] = [];
      if (Array.isArray(m.WeakElementList)) {
        for (const w of m.WeakElementList) {
          weaknesses.push(String(w));
        }
      }

      enemies.push({
        id,
        name,
        rank,
        camp: m.MonsterCamp ? String(m.MonsterCamp) : undefined,
        weaknesses,
        resistances: [],
        baseHp: m.HPBase ? Number(m.HPBase) : undefined,
        baseAtk: m.AttackBase ? Number(m.AttackBase) : undefined,
        baseDef: m.DefenceBase ? Number(m.DefenceBase) : undefined,
        drops: [],
      });
    }

    if (enemies.length === 0 && this.fixture) {
      return this.getBaselineEnemies();
    }
    return enemies;
  }

  private getBaselineEnemies(): StarRailEnemy[] {
    return [
      {
        id: 1002010,
        name: "反物质军团 · 虚数织叶者",
        rank: "MINION",
        camp: "Antimatter Legion",
        weaknesses: ["Physical", "Thunder", "Imaginary"],
        resistances: [],
        drops: [{ itemId: 111001, name: "熄灭原核" }],
      },
      {
        id: 1003010,
        name: "末日兽",
        rank: "BOSS",
        camp: "Antimatter Legion",
        weaknesses: ["Physical", "Fire", "Ice"],
        resistances: ["Quantum", "Imaginary"],
        drops: [{ itemId: 110501, name: "毁灭者的末路" }],
      },
      {
        id: 2003010,
        name: "可可利亚，虚妄之母",
        rank: "BOSS",
        camp: "Fragmentum",
        weaknesses: ["Fire", "Thunder", "Quantum"],
        resistances: ["Ice", "Wind"],
        drops: [],
      },
    ];
  }
}
