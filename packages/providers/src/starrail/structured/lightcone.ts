import { resolve } from "node:path";
import type { StarRailLightCone } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";
import { configNumber, formatConfigText } from "./values.js";

export interface LightConeExtractorOptions {
  dataDir: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailLightConeExtractor {
  private readonly dataDir: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: LightConeExtractorOptions) {
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

  public async extractLightCones(): Promise<StarRailLightCone[]> {
    const equipItem = this.inventory.items.find(
      (i) => i.path === "ExcelOutput/EquipmentConfig.json",
    );
    if (!equipItem) {
      return this.fixture ? this.getBaselineLightCones() : [];
    }

    const rawEquips = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, equipItem.path),
    );
    if (!Array.isArray(rawEquips) || rawEquips.length === 0) {
      return this.fixture ? this.getBaselineLightCones() : [];
    }

    // Load skills
    const skillItem = this.inventory.items.find(
      (i) => i.path === "ExcelOutput/EquipmentSkillConfig.json",
    );
    const skillMap = new Map<number, { skillName: string; skillDesc: string }>();
    if (skillItem) {
      const rawSkills = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, skillItem.path),
      );
      if (Array.isArray(rawSkills)) {
        for (const s of rawSkills) {
          if (Number(s.Level ?? 1) !== 1) continue;
          const sId = Number(s.SkillID ?? s.ID);
          if (!Number.isInteger(sId)) continue;
          const skillName = this.resolveHash(s.SkillName) ?? "";
          const skillDesc = formatConfigText(this.resolveHash(s.SkillDesc) ?? "", s.ParamList);
          skillMap.set(sId, { skillName, skillDesc });
        }
      }
    }

    const promotions = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, "ExcelOutput/EquipmentPromotionConfig.json"),
    );
    const baseStats = new Map(
      (promotions ?? [])
        .filter((p) => Number(p.Promotion ?? 0) === 0)
        .map((p) => [Number(p.EquipmentID), p]),
    );
    const cones: StarRailLightCone[] = [];
    for (const e of rawEquips) {
      if (e.Release !== true) continue;
      const id = Number(e.EquipmentID ?? e.ID);
      if (!Number.isInteger(id) || id > 90000) continue;

      const name = this.resolveHash(e.EquipmentName) ?? `光锥 ${id}`;
      const rarity = Number(/([345])$/u.exec(String(e.Rarity))?.[1]);
      if (!Number.isInteger(rarity)) throw new Error(`Unknown light cone rarity: ${e.Rarity}`);
      const path = String(e.AvatarBaseType ?? "Destruction");

      const skillId = Number(e.SkillID);
      const skill = skillMap.get(skillId);
      const stats = baseStats.get(id);

      cones.push({
        id,
        name,
        rarity,
        path,
        baseHp: configNumber(stats?.BaseHP),
        baseAtk: configNumber(stats?.BaseAttack),
        baseDef: configNumber(stats?.BaseDefence),
        skillName: skill?.skillName,
        skillDesc: skill?.skillDesc,
        ascensionMaterials: [],
      });
    }

    if (cones.length === 0 && this.fixture) {
      return this.getBaselineLightCones();
    }
    return cones;
  }

  private getBaselineLightCones(): StarRailLightCone[] {
    return [
      {
        id: 21001,
        name: "无可取代的东西",
        rarity: 5,
        path: "Destruction",
        baseHp: 1164,
        baseAtk: 582,
        baseDef: 396,
        skillName: "家人",
        skillDesc: "使装备者的攻击力提高24%。当装备者消灭敌方目标或受到攻击后，立即回复生命值。",
        ascensionMaterials: [],
      },
      {
        id: 23001,
        name: "行于流逝的岸",
        rarity: 5,
        path: "Nihility",
        baseHp: 1058,
        baseAtk: 635,
        baseDef: 396,
        skillName: "司舵",
        skillDesc: "使装备者的暴击伤害提高36%。当装备者击中敌方目标时，使其陷入【泡影】状态。",
        ascensionMaterials: [],
      },
      {
        id: 22001,
        name: "余生的第一天",
        rarity: 4,
        path: "Preservation",
        baseHp: 952,
        baseAtk: 370,
        baseDef: 463,
        skillName: "深呼吸",
        skillDesc: "使装备者的防御力提高16%。进入战斗后，使我方全体的全属性抗性提高8%。",
        ascensionMaterials: [],
      },
    ];
  }
}
