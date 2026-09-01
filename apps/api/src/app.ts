import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type RuntimeConfig } from "@gip/config";
import { KnowledgeService, type KnowledgeRepository } from "@gip/domain";
import { EvidenceQaService } from "@gip/qa";
import { OpenAICompatibleEmbeddingProvider, RetrievalService } from "@gip/retrieval";
import { registerAdminIngestionRoutes } from "./admin-ingestion-routes.js";
import { registerAdminOpsRoutes } from "./admin-ops-routes.js";
import { registerAdminPreviewRoutes } from "./admin-preview-routes.js";
import { registerAdminReviewRoutes } from "./admin-review-routes.js";
import { registerAppLifecycle } from "./app-lifecycle.js";
import { registerPublicRoutes } from "./public-routes.js";
import { registerGenshinRoutes } from "./genshin-routes.js";
import { GameDomainService } from "@gip/domain";

export type AppDependencies = {
  repository: KnowledgeRepository;
  config?: RuntimeConfig;
};

export function createApp({ repository, config = loadConfig() }: AppDependencies): FastifyInstance {
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger: { redact: ["req.headers.authorization", "*.apiKey", "*.prompt"] },
  });
  const domain = new KnowledgeService(repository);
  const gameDomain = new GameDomainService(repository);
  const embeddingProvider =
    config.embedding.modelId && config.embedding.modelVersion && config.llm.baseUrl
      ? new OpenAICompatibleEmbeddingProvider({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          model: config.embedding.modelId,
          modelVersion: config.embedding.modelVersion,
          dimension: config.embedding.dimension,
          timeoutMs: config.llm.timeoutMs,
        })
      : undefined;
  const retrieval = new RetrievalService(repository, embeddingProvider);
  const qa = new EvidenceQaService(repository, config);
  registerAppLifecycle(app, config);
  registerPublicRoutes(app, { repository, config, domain, retrieval, qa });
  registerGenshinRoutes(app, { gameDomain });
  registerAdminIngestionRoutes(app, { repository, config, domain });
  registerAdminReviewRoutes(app, { repository, config });
  registerAdminPreviewRoutes(app, { repository });
  registerAdminOpsRoutes(app, { repository, config });
  return app;
}

export async function startApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = createApp(dependencies);
  const config = dependencies.config ?? loadConfig();
  await app.listen({ host: config.host, port: config.apiPort });
  return app;
}
