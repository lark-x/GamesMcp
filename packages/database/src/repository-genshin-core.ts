import { sql } from "drizzle-orm";
import type {
  GenshinAchievement,
  GenshinArtifact,
  GenshinArtifactSet,
  GenshinCharacter,
  GenshinEnemy,
  GenshinMaterial,
  GenshinStructuredListOptions,
  GenshinStructuredRepository,
  GenshinWeapon,
} from "@gip/domain";
import type { Database } from "./client.js";
import { escapeLike, normalize } from "./repository-utils.js";

type StructuredKind =
  "character" | "weapon" | "artifactSet" | "artifact" | "material" | "achievement" | "enemy";

type StructuredRecord =
  | GenshinCharacter
  | GenshinWeapon
  | GenshinArtifactSet
  | GenshinArtifact
  | GenshinMaterial
  | GenshinAchievement
  | GenshinEnemy;

type StructuredInput = Omit<StructuredRecord, "id">;

type StructuredRow = {
  id: string;
  game_id: string;
  revision_id: string;
  stable_id: string;
  source_key: string;
  name: string;
  locale: string;
  game_version: string | null;
  source_id: string | null;
  source_snapshot_id: string | null;
  provenance: Record<string, unknown>;
  title?: string | null;
  rarity?: number | null;
  element?: string | null;
  weapon_type?: string | null;
  region?: string | null;
  affiliation?: string | null;
  birthday?: string | null;
  constellation?: string | null;
  profile?: Record<string, unknown>;
  base_attack?: number | null;
  sub_stat?: string | null;
  passive_name?: string | null;
  passive_description?: string | null;
  ascension_materials?: string[];
  max_rarity?: number | null;
  two_piece_bonus?: string | null;
  four_piece_bonus?: string | null;
  pieces?: string[];
  set_stable_id?: string | null;
  slot?: string | null;
  category?: string;
  description?: string | null;
  sources?: string[];
  used_by?: string[];
  requirement?: string | null;
  reward_primogems?: number | null;
  hidden?: boolean;
  family?: string | null;
  drops?: string[];
  resistances?: Record<string, unknown>;
};

type KindConfig = {
  table: string;
  columns: string[];
};

const configs: Record<StructuredKind, KindConfig> = {
  character: {
    table: "knowledge.genshin_characters",
    columns: [
      "title",
      "rarity",
      "element",
      "weapon_type",
      "region",
      "affiliation",
      "birthday",
      "constellation",
      "description",
      "profile",
    ],
  },
  weapon: {
    table: "knowledge.genshin_weapons",
    columns: [
      "weapon_type",
      "rarity",
      "base_attack",
      "sub_stat",
      "passive_name",
      "passive_description",
      "ascension_materials",
      "description",
    ],
  },
  artifactSet: {
    table: "knowledge.genshin_artifact_sets",
    columns: ["max_rarity", "two_piece_bonus", "four_piece_bonus", "pieces"],
  },
  artifact: {
    table: "knowledge.genshin_artifacts",
    columns: ["set_stable_id", "slot", "rarity", "description"],
  },
  material: {
    table: "knowledge.genshin_materials",
    columns: ["category", "rarity", "description", "sources", "used_by"],
  },
  achievement: {
    table: "knowledge.genshin_achievements",
    columns: ["category", "requirement", "reward_primogems", "hidden"],
  },
  enemy: {
    table: "knowledge.genshin_enemies",
    columns: ["category", "family", "description", "drops", "resistances"],
  },
};

const baseColumns = [
  "game_id",
  "revision_id",
  "stable_id",
  "source_key",
  "name",
  "normalized_name",
  "locale",
  "game_version",
  "source_id",
  "source_snapshot_id",
  "provenance",
];

export class SqlGenshinStructuredRepository implements GenshinStructuredRepository {
  constructor(private readonly db: Database) {}

  async upsertCharacter(input: Omit<GenshinCharacter, "id">): Promise<GenshinCharacter> {
    return this.upsert("character", input) as Promise<GenshinCharacter>;
  }

  async getCharacter(revisionId: string, stableId: string): Promise<GenshinCharacter | null> {
    return this.get("character", revisionId, stableId) as Promise<GenshinCharacter | null>;
  }

  async listCharacters(options: GenshinStructuredListOptions): Promise<GenshinCharacter[]> {
    return this.list("character", options) as Promise<GenshinCharacter[]>;
  }

  async upsertWeapon(input: Omit<GenshinWeapon, "id">): Promise<GenshinWeapon> {
    return this.upsert("weapon", input) as Promise<GenshinWeapon>;
  }

  async getWeapon(revisionId: string, stableId: string): Promise<GenshinWeapon | null> {
    return this.get("weapon", revisionId, stableId) as Promise<GenshinWeapon | null>;
  }

  async listWeapons(options: GenshinStructuredListOptions): Promise<GenshinWeapon[]> {
    return this.list("weapon", options) as Promise<GenshinWeapon[]>;
  }

  async upsertArtifactSet(input: Omit<GenshinArtifactSet, "id">): Promise<GenshinArtifactSet> {
    return this.upsert("artifactSet", input) as Promise<GenshinArtifactSet>;
  }

  async getArtifactSet(revisionId: string, stableId: string): Promise<GenshinArtifactSet | null> {
    return this.get("artifactSet", revisionId, stableId) as Promise<GenshinArtifactSet | null>;
  }

  async listArtifactSets(options: GenshinStructuredListOptions): Promise<GenshinArtifactSet[]> {
    return this.list("artifactSet", options) as Promise<GenshinArtifactSet[]>;
  }

  async upsertArtifact(input: Omit<GenshinArtifact, "id">): Promise<GenshinArtifact> {
    return this.upsert("artifact", input) as Promise<GenshinArtifact>;
  }

  async getArtifact(revisionId: string, stableId: string): Promise<GenshinArtifact | null> {
    return this.get("artifact", revisionId, stableId) as Promise<GenshinArtifact | null>;
  }

  async listArtifacts(options: GenshinStructuredListOptions): Promise<GenshinArtifact[]> {
    return this.list("artifact", options) as Promise<GenshinArtifact[]>;
  }

  async upsertMaterial(input: Omit<GenshinMaterial, "id">): Promise<GenshinMaterial> {
    return this.upsert("material", input) as Promise<GenshinMaterial>;
  }

  async getMaterial(revisionId: string, stableId: string): Promise<GenshinMaterial | null> {
    return this.get("material", revisionId, stableId) as Promise<GenshinMaterial | null>;
  }

  async listMaterials(options: GenshinStructuredListOptions): Promise<GenshinMaterial[]> {
    return this.list("material", options) as Promise<GenshinMaterial[]>;
  }

  async upsertAchievement(input: Omit<GenshinAchievement, "id">): Promise<GenshinAchievement> {
    return this.upsert("achievement", input) as Promise<GenshinAchievement>;
  }

  async getAchievement(revisionId: string, stableId: string): Promise<GenshinAchievement | null> {
    return this.get("achievement", revisionId, stableId) as Promise<GenshinAchievement | null>;
  }

  async listAchievements(options: GenshinStructuredListOptions): Promise<GenshinAchievement[]> {
    return this.list("achievement", options) as Promise<GenshinAchievement[]>;
  }

  async upsertEnemy(input: Omit<GenshinEnemy, "id">): Promise<GenshinEnemy> {
    return this.upsert("enemy", input) as Promise<GenshinEnemy>;
  }

  async getEnemy(revisionId: string, stableId: string): Promise<GenshinEnemy | null> {
    return this.get("enemy", revisionId, stableId) as Promise<GenshinEnemy | null>;
  }

  async listEnemies(options: GenshinStructuredListOptions): Promise<GenshinEnemy[]> {
    return this.list("enemy", options) as Promise<GenshinEnemy[]>;
  }

  private async upsert(kind: StructuredKind, input: StructuredInput): Promise<StructuredRecord> {
    const config = configs[kind];
    const columns = [...baseColumns, ...config.columns];
    const values = columns.map((column) => valueForColumn(input, column));
    const updates = columns
      .filter((column) => column !== "game_id" && column !== "revision_id")
      .map((column) => sql.raw(`${column} = excluded.${column}`));
    const [row] = rowsFromExecuteResult(
      await this.db.execute(sql`
      insert into ${sql.raw(config.table)} (${sql.raw(columns.join(", "))})
      values (${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )})
      on conflict (revision_id, stable_id) do update set
        ${sql.join(updates, sql`, `)},
        updated_at = now()
      returning *
    `),
    );
    if (!row) {
      throw new Error(`Failed to upsert ${kind} structured record`);
    }
    return mapRow(kind, row);
  }

  private async get(
    kind: StructuredKind,
    revisionId: string,
    stableId: string,
  ): Promise<StructuredRecord | null> {
    const config = configs[kind];
    const [row] = rowsFromExecuteResult(
      await this.db.execute(sql`
      select * from ${sql.raw(config.table)}
      where revision_id = ${revisionId}::uuid and stable_id = ${stableId}
      limit 1
    `),
    );
    return row ? mapRow(kind, row) : null;
  }

  private async list(
    kind: StructuredKind,
    options: GenshinStructuredListOptions,
  ): Promise<StructuredRecord[]> {
    const config = configs[kind];
    const limit = Math.min(Math.max(options.limit, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const query = options.query ? `%${escapeLike(normalize(options.query))}%` : undefined;
    const rows = rowsFromExecuteResult(
      await this.db.execute(sql`
      select * from ${sql.raw(config.table)}
      where revision_id = ${options.revisionId}::uuid
        ${query ? sql`and normalized_name like ${query}` : sql``}
      order by name asc
      limit ${limit}
      offset ${offset}
    `),
    );
    return rows.map((row) => mapRow(kind, row));
  }
}

function rowsFromExecuteResult(result: unknown): StructuredRow[] {
  if (Array.isArray(result)) return result as StructuredRow[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  )
    return (result as { rows: StructuredRow[] }).rows;
  return [];
}

function valueForColumn(input: StructuredInput, column: string): unknown {
  const record = input as Record<string, unknown>;
  if (column === "game_id") return input.gameId;
  if (column === "revision_id") return input.revisionId;
  if (column === "stable_id") return input.stableId;
  if (column === "source_key") return input.sourceKey;
  if (column === "normalized_name") return normalize(input.name);
  if (column === "game_version") return input.gameVersion ?? null;
  if (column === "source_id") return input.sourceId ?? null;
  if (column === "source_snapshot_id") return input.sourceSnapshotId ?? null;
  if (column === "set_stable_id") return record.setStableId ?? null;
  if (column === "base_attack") return record.baseAttack ?? null;
  if (column === "sub_stat") return record.subStat ?? null;
  if (column === "passive_name") return record.passiveName ?? null;
  if (column === "passive_description") return record.passiveDescription ?? null;
  if (column === "ascension_materials") return record.ascensionMaterials ?? [];
  if (column === "max_rarity") return record.maxRarity ?? null;
  if (column === "two_piece_bonus") return record.twoPieceBonus ?? null;
  if (column === "four_piece_bonus") return record.fourPieceBonus ?? null;
  if (column === "used_by") return record.usedBy ?? [];
  if (column === "reward_primogems") return record.rewardPrimogems ?? null;
  return record[camelCase(column)] ?? defaultColumnValue(column);
}

function defaultColumnValue(column: string): unknown {
  if (["provenance", "profile", "resistances"].includes(column)) return {};
  if (["ascension_materials", "pieces", "sources", "used_by", "drops"].includes(column)) return [];
  if (column === "hidden") return false;
  if (column === "locale") return "und";
  return null;
}

function mapRow(kind: StructuredKind, row: StructuredRow): StructuredRecord {
  const base = {
    id: row.id,
    gameId: row.game_id,
    revisionId: row.revision_id,
    stableId: row.stable_id,
    sourceKey: row.source_key,
    name: row.name,
    locale: row.locale,
    gameVersion: row.game_version,
    sourceId: row.source_id,
    sourceSnapshotId: row.source_snapshot_id,
    provenance: row.provenance ?? {},
  };
  if (kind === "character")
    return {
      ...base,
      title: row.title,
      rarity: row.rarity,
      element: row.element as GenshinCharacter["element"],
      weaponType: row.weapon_type as GenshinCharacter["weaponType"],
      region: row.region,
      affiliation: row.affiliation,
      birthday: row.birthday,
      constellation: row.constellation,
      description: row.description,
      profile: row.profile ?? {},
    };
  if (kind === "weapon")
    return {
      ...base,
      weaponType: row.weapon_type as GenshinWeapon["weaponType"],
      rarity: row.rarity ?? 1,
      baseAttack: row.base_attack,
      baseAttackResolved:
        typeof row.provenance?.baseAttackResolved === "boolean"
          ? row.provenance.baseAttackResolved
          : row.base_attack !== null && row.base_attack !== undefined,
      subStat: row.sub_stat,
      passiveName: row.passive_name,
      passiveDescription: row.passive_description,
      ascensionMaterials: row.ascension_materials ?? [],
      description: row.description,
    };
  if (kind === "artifactSet")
    return {
      ...base,
      maxRarity: row.max_rarity,
      twoPieceBonus: row.two_piece_bonus,
      fourPieceBonus: row.four_piece_bonus,
      pieces: row.pieces ?? [],
    };
  if (kind === "artifact")
    return {
      ...base,
      setStableId: row.set_stable_id,
      slot: row.slot,
      rarity: row.rarity,
      description: row.description,
    };
  if (kind === "material")
    return {
      ...base,
      category: row.category as GenshinMaterial["category"],
      rarity: row.rarity,
      description: row.description,
      sources: row.sources ?? [],
      usedBy: row.used_by ?? [],
    };
  if (kind === "achievement")
    return {
      ...base,
      category: row.category as GenshinAchievement["category"],
      requirement: row.requirement,
      rewardPrimogems: row.reward_primogems,
      hidden: row.hidden ?? false,
      displayState:
        typeof row.provenance?.displayState === "string"
          ? row.provenance.displayState
          : row.hidden
            ? "hidden"
            : "displayed",
    };
  return {
    ...base,
    category: row.category as GenshinEnemy["category"],
    family: row.family,
    description: row.description,
    drops: row.drops ?? [],
    dropsResolved:
      typeof row.provenance?.dropsResolved === "boolean"
        ? row.provenance.dropsResolved
        : Boolean(row.drops?.length),
    resistances: row.resistances ?? {},
  };
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
