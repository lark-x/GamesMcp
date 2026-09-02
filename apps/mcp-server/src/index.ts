import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "@gip/config";
import { createDatabase, createPool, SqlKnowledgeRepository } from "@gip/database";
import { createProviderRegistry } from "@gip/providers";
import { createMcpServer } from "./server.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
const providers = createProviderRegistry(config.providers);
const server = createMcpServer(repository, { providers });
const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  await server.close();
  await providers.close();
  await pool.end();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
