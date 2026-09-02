# Istaroth Provider

Istaroth is used as an external MCP Streamable HTTP service. GamesMcp does not embed Python, ChromaDB, LangChain, bge-m3, BM25, or Istaroth internals.

## Tool mapping

GamesMcp maps provider gateway tools to Istaroth MCP tools:

| GamesMcp tool                               | Istaroth tool            |
| ------------------------------------------- | ------------------------ |
| `search_game_knowledge` with `mode=hybrid`  | `retrieve`               |
| `search_game_knowledge` with `mode=keyword` | `retrieve_bm25`          |
| `get_game_document`                         | `get_file_content`       |
| `get_game_document_hierarchy`               | `get_document_hierarchy` |

The adapter sends conservative retrieval budget derived from `limit`, and then applies GamesMcp response shaping before returning to MCP callers.

For document reads, the adapter passes both `document_id` and `file_id` for compatibility with Istaroth deployments that use either name.

## Docker

`docker-compose.yml` includes an optional `istaroth` service:

```env
ISTAROTH_IMAGE=ghcr.io/isundaylee/istaroth:latest
GAMESMCP_ISTAROTH_ENABLED=true
GAMESMCP_ISTAROTH_URL=http://istaroth:8000/mcp/
```

Checkpoint data is mounted under:

```text
${DATA_DIR}/istaroth-checkpoints
```

For production or long-running LAN use, pin `ISTAROTH_IMAGE` to a tag or digest instead of `latest`. The first phase records this explicitly rather than pretending `latest` is reproducible.

## Recovery behavior

- GamesMcp does not connect to Istaroth at process start unless a provider request or health check needs it.
- Istaroth connection failures are isolated and normalized.
- The MCP client is reused across requests.
- On request failure the client is closed and one retry is attempted for transient timeout/unavailable/protocol failures.
- Restarting Istaroth should not kill the GamesMcp process; later provider calls reconnect lazily.

## License and data boundary

Istaroth software is MIT licensed. GamesMcp only calls the Istaroth service and does not copy Istaroth source code into this repository.

AnimeGameData and Genshin text/checkpoints are data assets with separate licensing and should not be committed to GamesMcp.
