import { resolve } from "node:path";
import type { StarRailRelic } from "./types.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";
import { readSafeJsonFile } from "../extractors/shared.js";
import { formatConfigText } from "./values.js";

export interface RelicExtractorOptions {
  dataDir: string;
  inventory: StarRailSourceInventory;
  resolver: StarRailTextMapResolver;
  fixture?: boolean;
}

export class StarRailRelicExtractor {
  private readonly dataDir: string;
  private readonly inventory: StarRailSourceInventory;
  private readonly resolver: StarRailTextMapResolver;
  private readonly fixture: boolean;

  constructor(options: RelicExtractorOptions) {
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

  public async extractRelics(): Promise<StarRailRelic[]> {
    const setItem = this.inventory.items.find((i) => i.path === "ExcelOutput/RelicSetConfig.json");
    if (!setItem) {
      return this.fixture ? this.getBaselineRelics() : [];
    }

    const rawSets = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, setItem.path),
    );
    if (!Array.isArray(rawSets) || rawSets.length === 0) {
      return this.fixture ? this.getBaselineRelics() : [];
    }

    // Load set skill descriptions (2pc, 4pc bonuses)
    const skillItem = this.inventory.items.find(
      (i) => i.path === "ExcelOutput/RelicSetSkillConfig.json",
    );
    const skillMap = new Map<number, { twoPiece?: string; fourPiece?: string }>();
    if (skillItem) {
      const rawSkills = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(this.dataDir, skillItem.path),
      );
      if (Array.isArray(rawSkills)) {
        for (const s of rawSkills) {
          const setId = Number(s.SetID);
          if (!Number.isInteger(setId)) continue;
          const reqNum = Number(s.RequireNum ?? 2);
          const desc = formatConfigText(this.resolveHash(s.SkillDesc) ?? "", s.AbilityParamList);
          const entry = skillMap.get(setId) ?? {};
          if (reqNum === 2) entry.twoPiece = desc;
          else if (reqNum === 4) entry.fourPiece = desc;
          skillMap.set(setId, entry);
        }
      }
    }

    const configs = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, "ExcelOutput/RelicConfig.json"),
    );
    const items = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(this.dataDir, "ExcelOutput/ItemConfigRelic.json"),
    );
    const itemMap = new Map((items ?? []).map((item) => [Number(item.ID), item]));
    const relics: StarRailRelic[] = [];
    for (const set of rawSets) {
      if (set.Release !== true) continue;
      const setId = Number(set.SetID ?? set.ID);
      if (!Number.isInteger(setId) || setId > 9000) continue;

      const setName = this.resolveHash(set.SetName) ?? `遗器套装 ${setId}`;
      const skills = skillMap.get(setId);

      for (const config of configs ?? []) {
        if (Number(config.SetID) !== setId) continue;
        const slot = String(config.Type) as StarRailRelic["slotType"];
        if (!["HEAD", "HAND", "BODY", "FOOT", "OBJECT", "NECK"].includes(slot))
          throw new Error(`Unknown relic slot: ${slot}`);
        const id = Number(config.ID);
        const item = itemMap.get(id);
        const name = this.resolveHash(item?.ItemName);
        if (!name) continue;
        const rarity = Number(/([2-5])$/u.exec(String(config.Rarity))?.[1]);
        if (!Number.isInteger(rarity)) throw new Error(`Unknown relic rarity: ${config.Rarity}`);
        relics.push({
          id,
          name,
          setId,
          setName,
          slotType: slot,
          rarity,
          twoPieceBonus: skills?.twoPiece,
          fourPieceBonus: skills?.fourPiece,
          story: this.resolveHash(item?.ItemBGDesc) ?? undefined,
        });
      }
    }

    if (relics.length === 0 && this.fixture) {
      return this.getBaselineRelics();
    }
    return relics;
  }

  private getBaselineRelics(): StarRailRelic[] {
    return [
      {
        id: "101_1",
        name: "净庭教宗的圣骑士 · 头部",
        setId: 101,
        setName: "净庭教宗的圣骑士",
        slotType: "HEAD",
        rarity: 5,
        twoPieceBonus: "防御力提高15%。",
        fourPieceBonus: "使装备者提供的护盾量提高20%。",
      },
      {
        id: "102_1",
        name: "野穗伴行的快枪手 · 头部",
        setId: 102,
        setName: "野穗伴行的快枪手",
        slotType: "HEAD",
        rarity: 5,
        twoPieceBonus: "攻击力提高12%。",
        fourPieceBonus: "使装备者的速度提高6%，普攻造成的伤害提高10%。",
      },
      {
        id: "116_1",
        name: "死水深潜的先驱 · 头部",
        setId: 116,
        setName: "死水深潜的先驱",
        slotType: "HEAD",
        rarity: 5,
        twoPieceBonus: "对受负面状态影响的敌人造成的伤害提高12%。",
        fourPieceBonus:
          "暴击率提高4%，装备者对陷入不少于2/3个负面状态的敌方目标造成伤害时，暴击伤害提高8%/12%。",
      },
    ];
  }
}
