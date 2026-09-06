import { resolve } from "node:path";
import type { StarRailCharacter } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";

// AvatarBaseType -> 命途中文名
const PATH_CN: Record<string, string> = {
  Knight: "存护",
  Destruction: "毁灭",
  Rogue: "巡猎",
  Mage: "智识",
  Warlock: "虚无",
  Shaman: "丰饶",
  Priest: "同谐",
  Remembrance: "记忆",
  Memory: "记忆",
  Elation: "欢愉",
  Warrior: "毁灭",
};

function pathCn(path: string): string {
  return PATH_CN[path] ?? path;
}

export interface CharacterExtractorOptions {
  dataDir: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailCharacterExtractor {
  private readonly dataDir: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: CharacterExtractorOptions) {
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

  public async extractCharacters(): Promise<StarRailCharacter[]> {
    const avatarItem = this.inventory.items.find((i) => i.path === "ExcelOutput/AvatarConfig.json");
    if (!avatarItem) {
      return this.fixture ? this.getBaselineCharacters() : [];
    }

    const rawAvatars = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, avatarItem.path),
    );
    if (!Array.isArray(rawAvatars) || rawAvatars.length === 0) {
      return this.fixture ? this.getBaselineCharacters() : [];
    }

    // Load skills
    const skillItem = this.inventory.items.find((i) => i.path === "ExcelOutput/AvatarSkillConfig.json");
    const skillMap = new Map<number, Array<{ id: number; name: string; type: string; description: string }>>();
    if (skillItem) {
      const rawSkills = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, skillItem.path),
      );
      if (Array.isArray(rawSkills)) {
        for (const s of rawSkills) {
          const sId = Number(s.SkillID ?? s.ID);
          if (!Number.isInteger(sId)) continue;
          const avatarId = Math.floor(sId / 100);
          const name = this.resolveHash(s.SkillName) ?? `技能 ${sId}`;
          // SkillTypeDesc is a textmap hash; AttackType is the plain type label.
          const type =
            (typeof s.AttackType === "string" && s.AttackType) ||
            this.resolveHash(s.SkillTypeDesc) ||
            "Skill";
          const description = this.resolveHash(s.SkillDesc) ?? "";
          const list = skillMap.get(avatarId) ?? [];
          list.push({ id: sId, name, type, description });
          skillMap.set(avatarId, list);
        }
      }
    }

    // Load traces / skill tree
    const treeItem = this.inventory.items.find((i) => i.path === "ExcelOutput/AvatarSkillTreeConfig.json");
    const traceMap = new Map<number, Array<{ id: number; name: string; description: string; materialCosts: Array<{ id: number; count: number }> }>>();
    if (treeItem) {
      const rawTrees = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, treeItem.path),
      );
      if (Array.isArray(rawTrees)) {
        for (const t of rawTrees) {
          const pointId = Number(t.PointID ?? t.ID);
          const avatarId = Number(t.AvatarID);
          if (!Number.isInteger(pointId) || !Number.isInteger(avatarId)) continue;
          const name = this.resolveHash(t.PointName) ?? `行迹 ${pointId}`;
          const description = this.resolveHash(t.PointDesc) ?? "";
          const costs: Array<{ id: number; count: number }> = [];
          if (Array.isArray(t.MaterialList)) {
            for (const m of t.MaterialList) {
              if (m && typeof m === "object") {
                const rec = m as Record<string, unknown>;
                const mId = Number(rec.ItemID);
                const count = Number(rec.ItemNum ?? 1);
                if (Number.isInteger(mId)) costs.push({ id: mId, count });
              }
            }
          }
          const list = traceMap.get(avatarId) ?? [];
          list.push({ id: pointId, name, description, materialCosts: costs });
          traceMap.set(avatarId, list);
        }
      }
    }

    // Load Eidolons (RankConfig)
    const rankItem = this.inventory.items.find((i) => i.path === "ExcelOutput/AvatarRankConfig.json");
    const rankMap = new Map<number, Array<{ rank: number; name: string; description: string }>>();
    if (rankItem) {
      const rawRanks = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, rankItem.path),
      );
      if (Array.isArray(rawRanks)) {
        for (const r of rawRanks) {
          const rankId = Number(r.RankID ?? r.ID);
          if (!Number.isInteger(rankId)) continue;
          const avatarId = Math.floor(rankId / 100);
          const rank = Number(r.Rank ?? rankId % 10);
          const name = this.resolveHash(r.Name) ?? `星魂 ${rank}`;
          const description = this.resolveHash(r.Desc) ?? "";
          const list = rankMap.get(avatarId) ?? [];
          list.push({ rank, name, description });
          rankMap.set(avatarId, list);
        }
      }
    }

    const characters: StarRailCharacter[] = [];

    for (const a of rawAvatars) {
      const id = Number(a.AvatarID ?? a.ID);
      if (!Number.isInteger(id) || id > 900000) continue; // Filter test avatars

      const rawName = this.resolveHash(a.AvatarName) ?? "";
      const path = String(a.AvatarBaseType ?? "Destruction");
      const element = String(a.DamageType ?? "Physical");
      // 开拓者多形态的名称是 {NICKNAME} 模板；用命途区分形态。
      const name =
        rawName === "{NICKNAME}" || rawName === "开拓者"
          ? `开拓者•${pathCn(path)}`
          : rawName || `角色 ${id}`;
      const rarity = a.Rarity === "CombatPowerAvatarRarityType5" || a.Rarity === 5 ? 5 : 4;

      characters.push({
        id,
        name,
        rarity,
        path,
        element,
        baseHp: Number(a.AvatarBaseHP ?? 1000),
        baseAtk: Number(a.AvatarBaseATK ?? 500),
        baseDef: Number(a.AvatarBaseDEF ?? 400),
        baseSpeed: Number(a.AvatarBaseSpeed ?? 100),
        skills: skillMap.get(id) ?? [],
        traces: traceMap.get(id) ?? [],
        eidolons: rankMap.get(id) ?? [],
        ascensionMaterials: [],
      });
    }

    if (characters.length === 0 && this.fixture) {
      return this.getBaselineCharacters();
    }
    return characters;
  }

  private getBaselineCharacters(): StarRailCharacter[] {
    return [
      {
        id: 1001,
        name: "三月七",
        rarity: 4,
        path: "Preservation",
        element: "Ice",
        baseHp: 1058,
        baseAtk: 511,
        baseDef: 573,
        baseSpeed: 101,
        skills: [
          { id: 100101, name: "极寒的弓矢", type: "Normal", description: "对指定敌方单体造成等同于三月七50%攻击力的冰属性伤害。" },
          { id: 100102, name: "六相冰的庇护", type: "Skill", description: "为指定我方单体提供能够吸收等同于三月七38%防御力+190伤害的护盾。" },
          { id: 100103, name: "冰刻箭雨之时", type: "Ultimate", description: "对敌方全体造成等同于三月七90%攻击力的冰属性伤害。" },
        ],
        traces: [],
        eidolons: [
          { rank: 1, name: "记忆中的你", description: "终结技每冻结1个敌方目标，三月七恢复能量。" },
        ],
        ascensionMaterials: [{ id: 110401, count: 50 }],
      },
      {
        id: 1002,
        name: "丹恒",
        rarity: 4,
        path: "Hunt",
        element: "Wind",
        baseHp: 882,
        baseAtk: 546,
        baseDef: 396,
        baseSpeed: 110,
        skills: [
          { id: 100201, name: "云骑枪术·朔风", type: "Normal", description: "对指定敌方单体造成风属性伤害。" },
          { id: 100202, name: "云骑枪术·疾雨", type: "Skill", description: "对指定敌方单体造成风属性伤害，暴击时减速目标。" },
          { id: 100203, name: "洞天幻化，长梦一瞬", type: "Ultimate", description: "对指定敌方单体造成大量风属性伤害。" },
        ],
        traces: [],
        eidolons: [],
        ascensionMaterials: [{ id: 110402, count: 50 }],
      },
      {
        id: 1006,
        name: "银狼",
        rarity: 5,
        path: "Nihility",
        element: "Quantum",
        baseHp: 1047,
        baseAtk: 640,
        baseDef: 460,
        baseSpeed: 107,
        skills: [
          { id: 100601, name: "系统警告", type: "Normal", description: "对指定敌方单体造成量子属性伤害。" },
          { id: 100602, name: "是否允许更改？", type: "Skill", description: "为指定敌方单体植入弱点。" },
          { id: 100603, name: "账号已封禁", type: "Ultimate", description: "对指定敌方单体造成大量量子属性伤害并降低其防御力。" },
        ],
        traces: [],
        eidolons: [],
        ascensionMaterials: [],
      },
      {
        id: 1302,
        name: "黄泉",
        rarity: 5,
        path: "Nihility",
        element: "Thunder",
        baseHp: 1125,
        baseAtk: 698,
        baseDef: 436,
        baseSpeed: 101,
        skills: [
          { id: 130201, name: "三途枯涸", type: "Normal", description: "对指定敌方单体造成雷属性伤害。" },
          { id: 130202, name: "八雷飞渡", type: "Skill", description: "获得【残梦】，为敌方单体施加【集真赤】并造成雷属性伤害。" },
          { id: 130203, name: "残梦尽染，一刀缭断", type: "Ultimate", description: "发动4段攻击，无视弱点属性削减韧性，造成巨额雷属性伤害。" },
        ],
        traces: [],
        eidolons: [],
        ascensionMaterials: [],
      },
    ];
  }
}
