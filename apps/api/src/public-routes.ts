import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeConfig } from "@gip/config";
import {
  documentTypeSchema,
  entityTypeSchema,
  qaRequestSchema,
  relationshipPredicateSchema,
  revisionIdSchema,
  searchRequestSchema,
} from "@gip/contracts";
import { DomainError, type KnowledgeRepository, type KnowledgeService } from "@gip/domain";
import type { EvidenceQaService } from "@gip/qa";
import type { RetrievalService } from "@gip/retrieval";
import { parseIdParams, parsePositive, parseQuery, questTypeSchema } from "./route-utils.js";

export type PublicRoutesDependencies = {
  repository: KnowledgeRepository;
  config: RuntimeConfig;
  domain: KnowledgeService;
  retrieval: RetrievalService;
  qa: EvidenceQaService;
};

export function registerPublicRoutes(
  app: FastifyInstance,
  { repository, config, domain, retrieval, qa }: PublicRoutesDependencies,
): void {
  app.get("/api/health", async () => ({ status: "ok", service: "api" }));
  app.get("/api/ready", async (_request, reply) => {
    const health = await repository.health();
    if (health.database === "down" || health.currentRevision === "missing")
      return reply.code(503).send({ status: "not_ready", ...health });
    return { status: "ready", ...health };
  });
  app.get("/api/ready/search", async (_request, reply) => {
    const health = await repository.health();
    if (health.searchIndex !== "ready")
      return reply.code(503).send({ status: "not_ready", search: health.searchIndex });
    return { status: "ready", search: "ready" };
  });
  app.get("/api/ready/worker", async (_request, reply) => {
    const worker = repository.workerHealth ? await repository.workerHealth() : "not_ready";
    if (worker !== "up") return reply.code(503).send({ status: "not_ready", worker });
    return { status: "ready", worker };
  });
  app.get("/api/ready/llm", async (_request, reply) => {
    const llmReady = Boolean(config.llm.baseUrl && config.llm.modelId);
    if (!llmReady) return reply.code(503).send({ status: "not_ready", llm: "not_configured" });
    return { status: "configured", llm: "configured" };
  });

  app.get("/api/games", async () => ({ games: await domain.listGames() }));
  app.get("/api/games/:gameId/sources", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const sources = await repository.listSources(gameId);
    return {
      sources: sources.map((source) => ({ id: source.id, name: source.name, type: source.type })),
    };
  });
  app.get("/api/games/:gameId/capabilities", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    return { gameId, capabilities: await repository.getCapabilities(gameId) };
  });

  app.get("/api/games/:gameId/home", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    if (!repository.getArchiveHome)
      throw new DomainError(
        "archive_home_not_ready",
        "Archive home is not implemented",
        undefined,
        501,
      );
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    const locale = typeof query.locale === "string" && query.locale.trim() ? query.locale : "zh-CN";
    return repository.getArchiveHome(gameId, {
      locale,
      revisionId,
      limit: parsePositive(query.limit, 6, 12),
    });
  });

  app.get("/api/games/:gameId/entities", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const type = query.type ? entityTypeSchema.parse(String(query.type)) : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return {
      entities: await repository.listEntities(gameId, {
        query: typeof query.q === "string" ? query.q : undefined,
        type,
        limit: parsePositive(query.limit, 20, 100),
        offset: Math.max(0, Number(query.offset ?? 0) || 0),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/entities/:entityId", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return { entity: await domain.getEntity(gameId, entityId ?? "", revisionId) };
  });

  app.get("/api/games/:gameId/entities/:entityId/relationships", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const predicate = query.predicate
      ? relationshipPredicateSchema.parse(String(query.predicate))
      : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    await domain.getEntity(gameId, entityId ?? "", revisionId);
    return {
      relationships: await repository.getRelationships(gameId, entityId ?? "", {
        predicate,
        limit: parsePositive(query.limit, 50, 200),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/entities/:entityId/documents", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    await domain.getEntity(gameId, entityId ?? "", revisionId);
    return {
      documents: await repository.getEntityDocuments(
        gameId,
        entityId ?? "",
        parsePositive(query.limit, 20, 100),
        revisionId,
      ),
    };
  });

  app.get("/api/games/:gameId/documents", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const type = query.type ? documentTypeSchema.parse(String(query.type)) : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return {
      documents: await repository.listDocuments(gameId, {
        query: typeof query.q === "string" ? query.q : undefined,
        type,
        locale: typeof query.locale === "string" ? query.locale : undefined,
        limit: parsePositive(query.limit, 20, 100),
        offset: Math.max(0, Number(query.offset ?? 0) || 0),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/documents/:documentId", async (request) => {
    const { gameId, documentId } = parseIdParams(request);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return { document: await domain.getDocument(gameId, documentId ?? "", revisionId) };
  });

  app.get("/api/games/:gameId/quests", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    if (!repository.searchQuests)
      throw new DomainError("quest_tools_not_ready", "Quest search is not implemented");
    const query = parseQuery(request);
    const questType = query.type ? questTypeSchema.parse(String(query.type)) : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return {
      quests: await repository.searchQuests(gameId, {
        query: typeof query.q === "string" && query.q.trim() ? query.q : "quest/",
        questTypes: questType ? [questType] : undefined,
        locale: typeof query.locale === "string" ? query.locale : "zh-CN",
        gameVersion: typeof query.gameVersion === "string" ? query.gameVersion : undefined,
        limit: parsePositive(query.limit, 20, 100),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/quests/:questId", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    if (!repository.getQuest)
      throw new DomainError("quest_tools_not_ready", "Quest reading is not implemented");
    const params = request.params as { questId?: unknown };
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    const quest = await repository.getQuest(gameId, {
      questKey: z.string().min(1).max(120).parse(params.questId),
      locale: typeof query.locale === "string" ? query.locale : "zh-CN",
      subquestId: typeof query.subquestId === "string" ? query.subquestId : undefined,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      nodeLimit: parsePositive(query.limit, 100, 300),
      revisionId,
    });
    if (!quest) throw new DomainError("quest_not_found", "Quest was not found", undefined, 404);
    return { quest };
  });

  app.get("/api/games/:gameId/story/catalog", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    if (!repository.getStoryCatalog) {
      throw new DomainError("story_catalog_not_ready", "Story catalog is not implemented");
    }
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    const catalog = await repository.getStoryCatalog(gameId, revisionId);
    return catalog;
  });

  app.post("/api/games/:gameId/search", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const parsed = searchRequestSchema.parse(request.body);
    const result = await retrieval.search(gameId, parsed);
    if (!result.revision)
      throw new DomainError(
        "index_not_ready",
        "No searchable Dataset Revision is ready",
        undefined,
        503,
      );
    return result;
  });

  app.post("/api/games/:gameId/qa", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireCapability(gameId, "evidence_qa");
    const parsed = qaRequestSchema.parse(request.body);
    try {
      return await qa.answer(gameId, parsed.question, parsed.maxEvidence, parsed.revisionId);
    } catch (error) {
      if (error instanceof Error && "code" in error)
        throw new DomainError(String(error.code), error.message, undefined, 502);
      throw error;
    }
  });
}
