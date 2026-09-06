import { runStdio } from "./stdio.js";

// Compatibility entry: `pnpm --filter @gip/mcp-server start` keeps stdio
// semantics for existing local MCP clients.
await runStdio();
