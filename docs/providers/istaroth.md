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

The adapter sends conservative retrieval budget derived from `limit`, and then applies GamesMcp response shaping before returning to MCP callers. `limit` is not sent to Istaroth `retrieve` or `retrieve_bm25`; it is a GamesMcp response-shaping limit only.

For document reads, GamesMcp maps contract pagination to Istaroth chunk pagination:

```json
{
  "file_id": "<document_id>",
  "start_index": 0,
  "max_chunks": 20
}
```

## Docker

`docker-compose.yml` includes an optional `istaroth` service:

```env
ISTAROTH_IMAGE=isundaylee/istaroth:<tag-or-digest>
GAMESMCP_ISTAROTH_ENABLED=true
GAMESMCP_ISTAROTH_URL=http://istaroth:8000/mcp
ISTAROTH_MCP_LANGUAGE=CHS
ISTAROTH_DOCUMENT_STORE_SET=CHS:/data/checkpoint/chs
ISTAROTH_TRAINING_DEVICE=cpu
```

Checkpoint data is mounted under:

```text
${DATA_DIR}/istaroth/
├── checkpoint/chs
├── models/
└── cache/
```

For production or long-running LAN use, pin `ISTAROTH_IMAGE` to a tag or digest instead of `latest`. The compose file intentionally requires `ISTAROTH_IMAGE` to be set.

Health and protocol checks:

```bash
docker compose up -d istaroth
docker compose ps
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm check:istaroth-health
GAMESMCP_ISTAROTH_URL=http://127.0.0.1:8000/mcp pnpm test:istaroth-provider
```

Checkpoint provisioning is explicit and idempotent:

```bash
ISTAROTH_IMAGE=isundaylee/istaroth:<tag-or-digest> DATA_DIR=/persistent/gamesmcp pnpm bootstrap:istaroth
```

If `${DATA_DIR}/istaroth/checkpoint/chs` already contains files, the bootstrap script skips the download.

## Recovery behavior

- GamesMcp does not connect to Istaroth at process start unless a provider request or health check needs it.
- Istaroth connection failures are isolated and normalized.
- The MCP client is reused across requests.
- On request failure the client is closed and one retry is attempted for transient timeout/unavailable/protocol failures.
- Restarting Istaroth should not kill the GamesMcp process; later provider calls reconnect lazily.

## License and data boundary

Istaroth software is MIT licensed. GamesMcp only calls the Istaroth service and does not copy Istaroth source code into this repository.

AnimeGameData and Genshin text/checkpoints are data assets with separate licensing and should not be committed to GamesMcp.
