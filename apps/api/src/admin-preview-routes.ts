import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError, type KnowledgeRepository } from "@gip/domain";
import { getPreviewQuest, searchPreviewQuests } from "./preview-quests.js";
import { parseIdParams, questTypeSchema } from "./route-utils.js";

export type AdminPreviewRoutesDependencies = {
  repository: KnowledgeRepository;
};

export function registerAdminPreviewRoutes(
  app: FastifyInstance,
  { repository }: AdminPreviewRoutesDependencies,
): void {
  app.get("/api/admin/previews/:buildId/entities", async (request) => {
    const build = await requirePreviewBuild(repository, parseIdParams(request).buildId);
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(500).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(request.query);
    const entities = build.normalizedRecords.flatMap((record) => {
      if (record.entities?.length)
        return record.entities.map((candidate) => ({
          sourceKey: candidate.sourceKey,
          recordSourceKey: record.sourceKey,
          type: candidate.type,
          name: candidate.name,
          summary: candidate.summary ?? "",
          aliases: candidate.aliases ?? [],
          properties: candidate.properties ?? {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        }));
      if (record.recordType !== "entity" && !record.entityType) return [];
      return [
        {
          sourceKey: record.sourceKey,
          recordSourceKey: record.sourceKey,
          type: (record.entityType ?? record.recordType) as
            | "character"
            | "faction"
            | "region"
            | "location"
            | "item"
            | "event"
            | "concept"
            | "quest"
            | "book",
          name: record.title ?? record.sourceKey,
          summary: record.body ?? "",
          aliases: [],
          properties: {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        },
      ];
    }) as unknown as Array<Record<string, unknown>>;
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      entities: entities.slice(query.offset, query.offset + query.limit),
      total: entities.length,
    };
  });

  app.get("/api/admin/previews/:buildId/records", async (request) => {
    const build = await requirePreviewBuild(repository, parseIdParams(request).buildId);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        q: z.string().optional(),
        kind: z.enum(["all", "entity", "document"]).default("all"),
        category: z.string().trim().min(1).max(60).optional(),
      })
      .parse(request.query);
    const needle = query.q?.trim().toLocaleLowerCase();
    const records = build.normalizedRecords.flatMap((record) => {
      const primaryEntity = record.entities?.[0];
      const isEntity =
        record.recordType === "entity" ||
        Boolean(record.entityType) ||
        Boolean(record.entities?.length);
      const displayKind = isEntity ? "entity" : "document";
      if (query.kind !== "all" && query.kind !== displayKind) return [];
      if (
        query.category &&
        query.category !== "all" &&
        !record.sourceKey.startsWith(`genshin-db/${query.category}/`)
      )
        return [];
      const haystack = `${record.sourceKey} ${record.title ?? ""} ${record.body ?? ""} ${
        primaryEntity?.name ?? ""
      } ${(primaryEntity?.aliases ?? []).map((alias) => alias.value).join(" ")} ${JSON.stringify(
        primaryEntity?.properties ?? {},
      )}`.toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) return [];
      return [
        {
          sourceKey: primaryEntity?.sourceKey ?? record.sourceKey,
          recordSourceKey: record.sourceKey,
          displayKind,
          type:
            primaryEntity?.type ?? record.entityType ?? record.documentType ?? record.recordType,
          title: primaryEntity?.name ?? record.title ?? record.sourceKey,
          body: primaryEntity?.summary ?? record.body ?? "",
          aliases: primaryEntity?.aliases ?? [],
          properties: primaryEntity?.properties ?? {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        },
      ];
    });
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      records: records.slice(query.offset, query.offset + query.limit),
      total: records.length,
      offset: query.offset,
      limit: query.limit,
    };
  });

  app.get("/api/admin/previews/:buildId/quests", async (request) => {
    const build = await requirePreviewBuild(repository, parseIdParams(request).buildId);
    const query = z
      .object({
        q: z.string().trim().max(120).default("quest/"),
        type: questTypeSchema.optional(),
        locale: z.string().trim().min(1).max(16).default("zh-CN"),
        gameVersion: z.string().trim().min(1).max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return {
      preview: true,
      buildId: build.id,
      candidateId: build.candidateId,
      quests: searchPreviewQuests(build, {
        query: query.q,
        questType: query.type,
        locale: query.locale,
        gameVersion: query.gameVersion,
        limit: query.limit,
      }),
    };
  });

  app.get("/api/admin/previews/:buildId/quests/:questId", async (request) => {
    const build = await requirePreviewBuild(repository, parseIdParams(request).buildId);
    const params = request.params as { questId?: unknown };
    const query = z
      .object({
        locale: z.string().trim().min(1).max(16).default("zh-CN"),
        cursor: z.string().trim().min(1).max(2000).optional(),
        limit: z.coerce.number().int().min(1).max(300).default(100),
      })
      .parse(request.query);
    const quest = getPreviewQuest(build, {
      questId: z.string().min(1).max(120).parse(params.questId),
      locale: query.locale,
      nodeLimit: query.limit,
      cursor: query.cursor,
    });
    if (!quest)
      throw new DomainError("quest_not_found", "Preview quest was not found", undefined, 404);
    return { preview: true, buildId: build.id, candidateId: build.candidateId, quest };
  });

  app.get("/api/admin/previews/:buildId/documents", async (request) => {
    const build = await requirePreviewBuild(repository, parseIdParams(request).buildId);
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(500).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(request.query);
    const documents = build.normalizedRecords
      .filter(
        (record) =>
          record.recordType === "document" ||
          Boolean(record.documentType) ||
          (record.recordType !== "entity" && !record.entityType && Boolean(record.body)),
      )
      .map((record) => ({
        sourceKey: record.sourceKey,
        type: record.documentType ?? record.recordType,
        title: record.title ?? record.sourceKey,
        body: record.body ?? "",
        metadata: record.metadata ?? {},
        contentHash: record.contentHash,
        parserVersion: record.parserVersion,
      }));
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      documents: documents.slice(query.offset, query.offset + query.limit),
      total: documents.length,
    };
  });
}

async function requirePreviewBuild(repository: KnowledgeRepository, buildId: string | undefined) {
  if (!repository.getReleaseCandidateBuild)
    throw new DomainError(
      "release_candidates_not_supported",
      "Release candidates are not supported",
      undefined,
      501,
    );
  const build = await repository.getReleaseCandidateBuild(buildId ?? "");
  if (!build)
    throw new DomainError("build_not_found", "Preview build was not found", undefined, 404);
  return build;
}
