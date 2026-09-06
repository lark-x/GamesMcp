import { z } from "zod";

export const textKindSchema = z.enum([
  "books",
  "character-stories",
  "voices",
  "item-texts",
  "tutorials",
  "guides",
  "exploration-tips",
  "system-tips",
  "loading-tips",
  "mechanics",
  "gcg",
  "activity-tutorials",
  "messages",
  "train-visitors",
  "story-atlas",
  "discussion",
  "lightcone-lore",
  "relic-lore",
]);
export type TextKind = z.infer<typeof textKindSchema>;

export const textCatalogGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number().int().nonnegative(),
  subtitle: z.string().nullable().optional(),
  order: z.number().int().default(0),
});
export type TextCatalogGroup = z.infer<typeof textCatalogGroupSchema>;

export const textCatalogEntrySchema = z.object({
  documentId: z.string(),
  stableId: z.string(),
  kind: textKindSchema,
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  preview: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  groupName: z.string().nullable().optional(),
  order: z.number().int().default(0),
  segmentCount: z.number().int().nullable().optional(),
  gameVersion: z.string().nullable().optional(),
  locale: z.string(),
  provenance: z
    .object({
      sourceKey: z.string().nullable().optional(),
      sourceType: z.string().nullable().optional(),
    })
    .passthrough()
    .optional(),
});
export type TextCatalogEntry = z.infer<typeof textCatalogEntrySchema>;

export const textCatalogResponseSchema = z.object({
  gameId: z.string(),
  revisionId: z.string(),
  locale: z.string(),
  kind: textKindSchema,
  groups: z.array(textCatalogGroupSchema),
  entries: z.array(textCatalogEntrySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextOffset: z.number().int().nullable(),
});
export type TextCatalogResponse = z.infer<typeof textCatalogResponseSchema>;
