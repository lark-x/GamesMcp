import { resolve } from "node:path";
import type { MaterialCategory, MaterialSource, MaterialUsage, StarRailMaterial } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";
import { normalizeStarRailText } from "../corpus/normalizer.js";

export interface MaterialExtractorOptions {
  dataDir: string;
  sourceRef: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailMaterialExtractor {
  private readonly dataDir: string;
  private readonly sourceRef: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: MaterialExtractorOptions) {
    this.dataDir = options.dataDir;
    this.sourceRef = options.sourceRef;
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

  public async extractMaterials(): Promise<StarRailMaterial[]> {
    const itemConfig = this.inventory.items.find((i) => i.path === "ExcelOutput/ItemConfig.json");
    if (!itemConfig) {
      return this.fixture ? this.getBaselineMaterials() : [];
    }

    const rawItems = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, itemConfig.path),
    );
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return this.fixture ? this.getBaselineMaterials() : [];
    }

    // Load ItemPurpose for usage classification
    const purposeItem = this.inventory.items.find((i) => i.path === "ExcelOutput/ItemPurpose.json");
    const purposeMap = new Map<number, string>();
    if (purposeItem) {
      const rawPurposes = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, purposeItem.path),
      );
      if (Array.isArray(rawPurposes)) {
        for (const p of rawPurposes) {
          const pId = Number(p.PurposeID ?? p.ID);
          const desc = this.resolveHash(p.PurposeDesc) ?? "";
          if (desc) purposeMap.set(pId, desc);
        }
      }
    }

    const materials: StarRailMaterial[] = [];

    // 培养材料白名单：只收游戏中「漫游手册-材料」会出现的道具类型，
    // 贴纸/书籍/摆设/活动小道具/内部展示条目不进入材料页。
    const MATERIAL_SUBTYPES = new Set([
      "AvatarExp",
      "EquipmentExp",
      "RelicExp",
      "AvatarRank",
      "TracePath",
      "CommonMonsterDrop",
      "WeeklyMonsterDrop",
      "ComposeMaterial",
      "Material",
      "Virtual",
    ]);

    for (const item of rawItems) {
      const id = Number(item.ItemID ?? item.ID);
      if (!Number.isInteger(id)) continue;

      const mainType = String(item.ItemMainType ?? "");
      const subType = String(item.ItemSubType ?? "");
      const isMaterial =
        mainType === "Material" ||
        mainType === "Virtual" ||
        mainType === "Mission" ||
        (mainType === "Usable" && subType === "Food");
      if (!isMaterial) continue;
      if (!MATERIAL_SUBTYPES.has(subType) && subType !== "Food" && subType !== "Mission") continue;

      const name = this.resolveHash(item.ItemName) ?? `物品 ${id}`;
      const lowerName = name.toLowerCase();
      // 未解析模板（{TEXTJOIN#N}）、调试名（Hello 迷World! / W?）等垃圾名过滤
      if (
        id >= 900000 ||
        lowerName.includes("test") ||
        lowerName.includes("测试") ||
        subType.includes("Test") ||
        /[{}#]/u.test(name)
      ) {
        continue;
      }

      const rarity =
        item.Rarity === "VeryRare" || item.Rarity === 5
          ? 5
          : item.Rarity === "Rare" || item.Rarity === 4
            ? 4
            : item.Rarity === "NotCommon" || item.Rarity === 3
              ? 3
              : 2;

      const desc = normalizeStarRailText(this.resolveHash(item.ItemDesc) ?? "");
      const story = normalizeStarRailText(this.resolveHash(item.ItemBGDesc) ?? "") || undefined;
      const cleanName = normalizeStarRailText(name);

      // 按游戏内分类体系映射（子类型枚举精确匹配，而非 includes 猜测）
      let category: MaterialCategory = "material";

      if (subType === "Virtual") {
        category = "currency";
      } else if (subType === "AvatarExp") {
        category = "exp_material";
      } else if (subType === "EquipmentExp") {
        category = "lightcone_exp";
      } else if (subType === "RelicExp") {
        category = "relic_exp";
      } else if (subType === "AvatarRank") {
        category = "character_ascension";
      } else if (subType === "TracePath") {
        category = "trace";
      } else if (subType === "CommonMonsterDrop") {
        category = "enemy_drop";
      } else if (subType === "WeeklyMonsterDrop") {
        category = "weekly_boss";
      } else if (subType === "ComposeMaterial") {
        category = "synthesis";
      } else if (subType === "Food") {
        category = "consumable";
      } else if (subType === "Mission") {
        category = "mission";
      }

      // Generate sources
      const sources: MaterialSource[] = [];
      const purposeId = Number(item.PurposeType);
      const purpose = purposeMap.get(purposeId);
      if (purpose) {
        sources.push({ type: "purpose_indicator", description: purpose });
      }

      if (category === "character_ascension") {
        sources.push({ type: "stagnant_shadow", description: "凝滞虚影挑战获得" });
      } else if (category === "trace") {
        sources.push({ type: "calyx", description: "拟造花萼（赤）挑战获得" });
      } else if (category === "weekly_boss") {
        sources.push({ type: "echo_of_war", description: "历战余响挑战获得" });
      } else if (category === "enemy_drop") {
        sources.push({ type: "enemy_drop", description: "大地图敌方目标掉落" });
      } else if (category === "synthesis") {
        sources.push({ type: "omni_synthesizer", description: "万能合成机合成" });
      } else if (category === "exp_material" || category === "lightcone_exp") {
        sources.push({ type: "calyx_golden", description: "拟造花萼（金）挑战获得" });
      } else if (category === "relic_exp") {
        sources.push({ type: "cavern_of_corrosion", description: "侵蚀隧洞挑战获得" });
      }

      // Usages
      const usages: MaterialUsage[] = [];
      if (category === "character_ascension") {
        usages.push({
          type: "character_ascension",
          targetId: "avatar_general",
          targetName: "角色等级晋阶突破",
        });
      } else if (category === "trace") {
        usages.push({
          type: "character_trace",
          targetId: "trace_general",
          targetName: "角色行迹技能升级",
        });
      } else if (category === "lightcone_exp") {
        usages.push({
          type: "lightcone_ascension",
          targetId: "lightcone_general",
          targetName: "光锥等级晋阶突破",
        });
      } else if (category === "exp_material") {
        usages.push({ type: "character_exp", targetId: "avatar_exp", targetName: "角色等级提升" });
      } else if (category === "relic_exp") {
        usages.push({ type: "relic_exp", targetId: "relic_exp", targetName: "遗器强化升级" });
      } else if (category === "synthesis") {
        usages.push({
          type: "synthesis",
          targetId: "synthesis",
          targetName: "万能合成机合成高阶材料",
        });
      }

      materials.push({
        id,
        name: cleanName,
        category,
        rarity,
        description: desc,
        story,
        sources,
        usages,
        visibility: "public",
        provenance: {
          source: "turn-based-game-data",
          sourceCommit: this.sourceRef,
          itemMainType: mainType,
          itemSubType: subType,
        },
      });
    }

    if (materials.length === 0 && this.fixture) {
      return this.getBaselineMaterials();
    }
    return materials;
  }

  private getBaselineMaterials(): StarRailMaterial[] {
    return [
      {
        id: 110401,
        name: "暴风之眼",
        category: "character_ascension",
        rarity: 4,
        description: "风属性角色的晋阶材料。",
        story: "暴风核心凝聚的冰冷结晶，隐约能听到呼啸的狂风。",
        sources: [{ type: "stagnant_shadow", description: "凝滞虚影【风起之形】掉落" }],
        usages: [{ type: "character_ascension", targetId: 1002, targetName: "丹恒" }],
        visibility: "public",
        provenance: { source: "baseline" },
      },
      {
        id: 110402,
        name: "恒温晶壳",
        category: "character_ascension",
        rarity: 4,
        description: "火属性角色的晋阶材料。",
        story: "永远散发着温热气息的奇异晶石。",
        sources: [{ type: "stagnant_shadow", description: "凝滞虚影【燔燎之形】掉落" }],
        usages: [
          { type: "character_ascension", targetId: "fire_avatars", targetName: "火属性角色晋阶" },
        ],
        visibility: "public",
        provenance: { source: "baseline" },
      },
      {
        id: 110501,
        name: "黯淡黑曜",
        category: "trace",
        rarity: 2,
        description: "虚无角色的行迹升级材料，光锥晋阶材料。",
        story: "散发着微弱暗光的虚无黑曜石。",
        sources: [{ type: "calyx", description: "拟造花萼（赤）【虚无之蕾】掉落" }],
        usages: [
          { type: "character_trace", targetId: 1006, targetName: "银狼" },
          { type: "character_trace", targetId: 1302, targetName: "黄泉" },
        ],
        visibility: "public",
        provenance: { source: "baseline" },
      },
      {
        id: 110502,
        name: "虚空黑曜",
        category: "trace",
        rarity: 3,
        description: "虚无角色的高阶行迹升级材料。",
        story: "浓缩了虚无力量的黑曜石矿物。",
        sources: [{ type: "calyx", description: "拟造花萼（赤）【虚无之蕾】掉落" }],
        usages: [
          { type: "character_trace", targetId: 1006, targetName: "银狼" },
          { type: "character_trace", targetId: 1302, targetName: "黄泉" },
        ],
        visibility: "public",
        provenance: { source: "baseline" },
      },
      {
        id: 110503,
        name: "沉沦黑曜",
        category: "trace",
        rarity: 4,
        description: "虚无角色的珍稀高级行迹升级材料。",
        story: "极致沉沦与幽邃的深黑結晶。",
        sources: [{ type: "calyx", description: "拟造花萼（赤）【虚无之蕾】掉落" }],
        usages: [{ type: "character_trace", targetId: 1302, targetName: "黄泉" }],
        visibility: "public",
        provenance: { source: "baseline" },
      },
      {
        id: 1,
        name: "信用点",
        category: "currency",
        rarity: 3,
        description: "星际和平公司发行并通行的货币。",
        story: "在星际间广泛流通的通用购买力凭证。",
        sources: [{ type: "calyx", description: "拟造花萼（金）【藏珍之蕾】掉落" }],
        usages: [{ type: "character_ascension", targetId: "all", targetName: "全培养消耗" }],
        visibility: "public",
        provenance: { source: "baseline" },
      },
    ];
  }
}
