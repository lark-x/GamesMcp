import { IstarothMcpClient } from "../packages/providers/src/index.js";

const url = process.env.ISTAROTH_INTEGRATION_URL ?? process.env.GAMESMCP_ISTAROTH_URL;
if (!url) {
  console.log(JSON.stringify({ skipped: true, reason: "No Istaroth URL configured" }));
  process.exit(0);
}

const client = new IstarothMcpClient({
  url,
  connectTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS ?? 3_000),
  requestTimeoutMs: Number(process.env.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000),
});

try {
  const tools = await client.listTools();
  const required = ["retrieve", "retrieve_bm25", "get_file_content", "get_document_hierarchy"];
  const missing = required.filter((tool) => !tools.includes(tool));
  console.log(
    JSON.stringify({
      ok: missing.length === 0,
      url,
      tools,
      missing,
      checkedAt: new Date().toISOString(),
    }),
  );
  process.exit(missing.length === 0 ? 0 : 1);
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    }),
  );
  process.exit(1);
} finally {
  await client.close();
}
