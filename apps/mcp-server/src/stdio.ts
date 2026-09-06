import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { createMcpRuntime } from "./runtime.js";

/**
 * Local stdio entry. One process equals one client session; stdout belongs to
 * the MCP protocol, so diagnostics must stay on stderr.
 */
export async function runStdio(): Promise<void> {
  const runtime = await createMcpRuntime();
  const server = createMcpServer(runtime.repository, { providers: runtime.providers });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    await runtime.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
