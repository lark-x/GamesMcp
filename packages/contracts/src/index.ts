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
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const documentTypeSchema = z.enum([
  "archon_quest",
  "story_quest",
  "world_quest",
  "book",
  "character_story",
  "item_description",
  "official_notice",
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
