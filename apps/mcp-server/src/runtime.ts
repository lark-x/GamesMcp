import { loadConfig, type RuntimeConfig } from "@gip/config";
import { createDatabase, createPool, SqlKnowledgeRepository } from "@gip/database";
import type { KnowledgeRepository } from "@gip/domain";
import { createProviderRegistry, type GameProviderRegistry } from "@gip/providers";
import { McpTelemetry } from "./telemetry.js";
import { join } from "node:path";

type Pool = ReturnType<typeof createPool>;

/**
 * Shared dependency graph for every MCP transport. Both stdio and Streamable
 * HTTP entries call this exactly once per process and close it on shutdown.
 */
export interface McpRuntime {
  config: RuntimeConfig;
  pool: Pool;
  repository: KnowledgeRepository;
  providers: GameProviderRegistry;
  telemetry: McpTelemetry;
  close(): Promise<void>;
}

export async function createMcpRuntime(
  overrides: { config?: RuntimeConfig } = {},
): Promise<McpRuntime> {
  const config = overrides.config ?? loadConfig();
  const pool = createPool(config.databaseUrl);
  const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
  const providers = createProviderRegistry(config.providers);
  const telemetry = new McpTelemetry({
    logDir: join(config.dataDir, "logs"),
  });
  return {
    config,
    pool,
    repository,
    providers,
    telemetry,
    async close() {
      await providers.close();
      await pool.end();
    },
  };
}
