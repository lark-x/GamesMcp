import { z } from "zod";

export const gameIdSchema = z.string().uuid();
export const entityIdSchema = z.string().uuid();
export const documentIdSchema = z.string().uuid();
export const segmentIdSchema = z.string().uuid();
export const revisionIdSchema = z.string().uuid();

export const entityTypeSchema = z.enum([
  "character",
  "faction",
  "region",
  "location",
  "item",
  "event",
  "concept",
  "quest",
  "book",
  "npc",
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const documentTypeSchema = z.enum([
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
  "commission",
  "hangout",
  "other",
  "book",
  "character_story",
  "item_description",
  "official_notice",
  "mechanism",
  "tutorial",
  "lore",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const capabilitySchema = z.enum([
  "entity_search",
  "lore_search",
  "relationships",
  "evidence_qa",
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const relationshipPredicateSchema = z.enum([
  "member_of",
  "located_in",
  "related_to",
  "family_of",
  "ally_of",
  "enemy_of",
  "participated_in",
  "mentioned_by",
  "prerequisite_for",
  "part_of",
]);
export type RelationshipPredicate = z.infer<typeof relationshipPredicateSchema>;

export const claimStatusSchema = z.enum([
  "confirmed",
  "implied",
  "interpretation",
  "theory",
  "outdated",
  "rejected",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  types: z.array(z.enum(["entity", "document", "segment"])).optional(),
  entityTypes: z.array(entityTypeSchema).optional(),
  documentTypes: z.array(documentTypeSchema).optional(),
  gameVersions: z.array(z.string().trim().min(1).max(40)).optional(),
  locales: z.array(z.string().trim().min(1).max(40)).optional(),
  sourceId: z.string().uuid().optional(),
  revisionId: revisionIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  debug: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const qaRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  maxEvidence: z.number().int().min(1).max(20).default(8),
  revisionId: revisionIdSchema.optional(),
});
export type QaRequest = z.infer<typeof qaRequestSchema>;

export const citationSchema = z.object({
  documentId: documentIdSchema,
  sourceKey: z.string().optional().nullable(),
  sourceVersion: z.string().optional().nullable(),
  documentTitle: z.string(),
  segmentId: segmentIdSchema,
  quote: z.string(),
  sourceName: z.string(),
  gameVersion: z.string().nullable(),
  datasetRevision: z.string(),
  locale: z.string().optional().nullable(),
  questKey: z.string().optional().nullable(),
  subquestKey: z.string().optional().nullable(),
  dialogueNodeKey: z.string().optional().nullable(),
});
export type Citation = z.infer<typeof citationSchema>;

export const evidenceAnswerSchema = z.object({
  answer: z.string(),
  confidence: z.enum(["high", "medium", "low", "insufficient"]),
  citations: z.array(citationSchema),
  relatedEntities: z.array(
    z.object({ id: entityIdSchema, name: z.string(), type: entityTypeSchema }),
  ),
  datasetRevision: z.string(),
  warnings: z.array(z.string()),
});
export type EvidenceAnswer = z.infer<typeof evidenceAnswerSchema>;

export const reviewRequestSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(2_000).optional(),
  confirmedDeletionKeys: z.array(z.string().min(1)).default([]),
});

export const publishRequestSchema = z.object({
  releaseNote: z.string().trim().max(2_000).optional(),
});

export const rollbackRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

export const importFileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (value) => !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..",
      {
        message: "File name must not contain path separators",
      },
    ),
  contentBase64: z.string().min(1).max(16_000_000),
});
export type ImportFile = z.infer<typeof importFileSchema>;

export const createImportRequestSchema = z
  .object({
    gameId: gameIdSchema,
    sourceId: z.string().uuid(),
    path: z.string().trim().min(1).max(2_000).optional(),
    files: z.array(importFileSchema).min(1).max(50).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.files?.length), {
    message: "Provide either path or files",
  });
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;

export const verificationStatusSchema = z.enum([
  "exact_match",
  "formatting_only",
  "mismatch",
  "unavailable_due_unlock",
  "version_mismatch",
  "not_checked",
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const verificationChannelSchema = z.enum(["game_client", "hoyowiki"]);
export type VerificationChannel = z.infer<typeof verificationChannelSchema>;

export const updateVerificationItemSchema = z.object({
  status: verificationStatusSchema,
  channel: verificationChannelSchema,
  checkedGameVersion: z.string().trim().min(1).max(40),
  checkedLocale: z.string().trim().min(1).max(40),
  note: z.string().trim().max(2_000).optional(),
});

export const screenshotUploadSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(1).max(7_500_000),
});

export const resolveConflictSchema = z.object({
  resolution: z.string().trim().min(1).max(4_000),
  selectedObservationId: z.string().uuid().optional(),
});

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

export type GameSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  currentRevision?: string;
};

export type EntitySummary = {
  id: string;
  sourceKey?: string | null;
  name: string;
  type: EntityType;
  summary?: string | null;
  aliases: string[];
  score?: number;
  match?: string;
  revision?: string;
};

export type DocumentSummary = {
  id: string;
  sourceKey?: string | null;
  sourceVersion?: string | null;
  title: string;
  type: DocumentType;
  gameVersion?: string | null;
  locale?: string | null;
  snippet?: string;
  score?: number;
  match?: string;
  revision?: string;
};

export type SearchResult = {
  entities: EntitySummary[];
  documents: DocumentSummary[];
  segments: Array<DocumentSummary & { segmentId: string }>;
  revision: string;
  revisionId?: string;
  indexStatus: string;
  debug?: Record<string, unknown>;
};

/** Lightweight, name-only data used to build the public archive landing page. */
export type ArchiveHomeEntry = {
  id: string;
  name: string;
  kind: "entity" | "document";
  type: string;
  locale?: string | null;
  /** Parent document for entries that point at a text node, such as dialogue. */
  documentId?: string;
  /** Stable node/anchor key when the entry represents a child of a document. */
  anchorId?: string;
};

export type ArchiveHomeCategory = {
  id: string;
  label: string;
  description: string;
  count: number;
  entries: ArchiveHomeEntry[];
};

export type ArchiveHomeResponse = {
  gameId: string;
  revision: string;
  locale: string;
  categories: ArchiveHomeCategory[];
  /** Revision actually used for the category read model (selected or current). */
  revisionId?: string;
  /** Latest published revision, independent of an optional historical selection. */
  latestRevision?: string;
  latestRevisionId?: string;
};

export const genshinElementSchema = z.enum([
  "anemo",
  "geo",
  "electro",
  "dendro",
  "hydro",
  "pyro",
  "cryo",
]);
export type GenshinElement = z.infer<typeof genshinElementSchema>;

export const genshinWeaponTypeSchema = z.enum(["sword", "claymore", "polearm", "bow", "catalyst"]);
export type GenshinWeaponType = z.infer<typeof genshinWeaponTypeSchema>;

export const genshinMaterialCategorySchema = z.enum([
  "character_development",
  "weapon_development",
  "local_specialty",
  "currency",
  "consumable",
  "quest_item",
  "forging",
  "cooking",
  "furnishing",
  "other",
]);
export type GenshinMaterialCategory = z.infer<typeof genshinMaterialCategorySchema>;

export const genshinAchievementCategorySchema = z.enum([
  "wonders_of_the_world",
  "memories_of_the_heart",
  "teyvat_fishing_guide",
  "challenger",
  "elemental_specialist",
  "other",
]);
export type GenshinAchievementCategory = z.infer<typeof genshinAchievementCategorySchema>;

export const genshinEnemyCategorySchema = z.enum([
  "common",
  "elite",
  "normal_boss",
  "weekly_boss",
  "wildlife",
  "other",
]);
export type GenshinEnemyCategory = z.infer<typeof genshinEnemyCategorySchema>;

export const structuredBindingSchema = z.object({
  stableId: z.string().min(1),
  documentId: documentIdSchema.optional(),
  segmentId: segmentIdSchema.optional(),
  sourceKey: z.string().min(1).optional(),
  relation: z.enum(["primary_text", "story", "lore", "quote", "source_record"]),
});
export type StructuredBinding = z.infer<typeof structuredBindingSchema>;

const structuredBaseSchema = z.object({
  id: z.string().uuid(),
  gameId: gameIdSchema,
  revisionId: revisionIdSchema,
  stableId: z.string().min(1),
  sourceKey: z.string().min(1),
  name: z.string().min(1),
  locale: z.string().min(1).default("und"),
  gameVersion: z.string().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshotId: z.string().uuid().nullable().optional(),
  provenance: z.record(z.string(), z.unknown()).default({}),
});

export const genshinCharacterSchema = structuredBaseSchema.extend({
  title: z.string().nullable().optional(),
  rarity: z.number().int().min(4).max(5).nullable().optional(),
  element: genshinElementSchema.nullable().optional(),
  weaponType: genshinWeaponTypeSchema.nullable().optional(),
  region: z.string().nullable().optional(),
  affiliation: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  constellation: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  profile: z.record(z.string(), z.unknown()).default({}),
});
export type GenshinCharacter = z.infer<typeof genshinCharacterSchema>;

export const genshinWeaponSchema = structuredBaseSchema.extend({
  weaponType: genshinWeaponTypeSchema,
  rarity: z.number().int().min(1).max(5),
  baseAttack: z.number().nullable().optional(),
  baseAttackResolved: z.boolean().optional(),
  subStat: z.string().nullable().optional(),
  passiveName: z.string().nullable().optional(),
  passiveDescription: z.string().nullable().optional(),
  ascensionMaterials: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
});
export type GenshinWeapon = z.infer<typeof genshinWeaponSchema>;

export const genshinArtifactSetSchema = structuredBaseSchema.extend({
  maxRarity: z.number().int().min(1).max(5).nullable().optional(),
  twoPieceBonus: z.string().nullable().optional(),
  fourPieceBonus: z.string().nullable().optional(),
  pieces: z.array(z.string()).default([]),
});
export type GenshinArtifactSet = z.infer<typeof genshinArtifactSetSchema>;

export const genshinArtifactSchema = structuredBaseSchema.extend({
  setStableId: z.string().nullable().optional(),
  slot: z.string().nullable().optional(),
  rarity: z.number().int().min(1).max(5).nullable().optional(),
  description: z.string().nullable().optional(),
});
export type GenshinArtifact = z.infer<typeof genshinArtifactSchema>;

export const genshinMaterialSchema = structuredBaseSchema.extend({
  category: genshinMaterialCategorySchema,
  rarity: z.number().int().min(1).max(5).nullable().optional(),
  description: z.string().nullable().optional(),
  sources: z.array(z.string()).default([]),
  usedBy: z.array(z.string()).default([]),
});
export type GenshinMaterial = z.infer<typeof genshinMaterialSchema>;

export const genshinAchievementSchema = structuredBaseSchema.extend({
  category: genshinAchievementCategorySchema,
  requirement: z.string().nullable().optional(),
  rewardPrimogems: z.number().int().min(0).nullable().optional(),
  hidden: z.boolean().default(false),
  displayState: z.string().nullable().optional(),
});
export type GenshinAchievement = z.infer<typeof genshinAchievementSchema>;

export const genshinEnemySchema = structuredBaseSchema.extend({
  category: genshinEnemyCategorySchema,
  family: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  drops: z.array(z.string()).default([]),
  dropsResolved: z.boolean().optional(),
  resistances: z.record(z.string(), z.unknown()).default({}),
});
export type GenshinEnemy = z.infer<typeof genshinEnemySchema>;
