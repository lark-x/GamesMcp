import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

interface CheckpointMetadata {
  schemaVersion: number;
  game: string;
  language: string;
  gamesMcp: { repository: string; commit: string };
  istaroth: { repository: string; commit: string };
  source: { repository: string; commit: string };
  corpus: {
    documentCount: number;
    corpusHash: string;
    validationOk: boolean;
  };
  embedding: {
    backend: string;
    model: string;
    device: string;
  };
  build: {
    runner: string;
    platform: string;
    createdAt: string;
  };
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const checkpointDir = resolve(
  args.checkpoint ?? process.env.STARRAIL_CHECKPOINT_DIR ?? "data/istaroth-starrail/checkpoint/chs",
);

const expectedSourceCommit =
  args["expected-source-commit"] ??
  process.env.TURN_BASED_GAME_DATA_REF ??
  "8cdb905dc2f8e6fffa9be4eb07af3e34435d6091";

const expectedIstarothCommit =
  args["expected-istaroth-commit"] ??
  process.env.ISTAROTH_REF ??
  "f22ea938704f414cfa6bfe03bc65b71142c781b7";

const expectedGamesMcpCommit =
  args["expected-gamesmcp-commit"] ?? process.env.GITHUB_SHA ?? undefined;

const expectedEmbeddingModel =
  args["expected-embedding-model"] ??
  process.env.ISTAROTH_EMBEDDING_MODEL ??
  "BAAI/bge-small-zh-v1.5";

console.log(`Verifying checkpoint under: ${checkpointDir}`);

if (!existsSync(checkpointDir)) {
  console.error(`ERROR: Checkpoint directory does not exist: ${checkpointDir}`);
  process.exit(1);
}

// 1. Check required files
const requiredFiles = [
  "checkpoint-metadata.json",
  "bm25_store.pkl",
  "documents.json",
  "config.json",
  "chroma_index",
  "text/manifest/starrail.json",
];

const missingFiles: string[] = [];
for (const rel of requiredFiles) {
  const full = resolve(checkpointDir, rel);
  if (!existsSync(full)) {
    missingFiles.push(rel);
  }
}

if (missingFiles.length > 0) {
  console.error(`ERROR: Missing required checkpoint files: ${missingFiles.join(", ")}`);
  process.exit(1);
}

// 2. Read and parse metadata
const metadataPath = resolve(checkpointDir, "checkpoint-metadata.json");
let metadata: CheckpointMetadata;
try {
  metadata = JSON.parse(await readFile(metadataPath, "utf8"));
} catch (error) {
  console.error(`ERROR: Failed to read or parse checkpoint metadata: ${String(error)}`);
  process.exit(1);
}

const errors: string[] = [];

if (metadata.schemaVersion !== 1) {
  errors.push(`Expected schemaVersion 1, got ${metadata.schemaVersion}`);
}
if (metadata.game !== "starrail") {
  errors.push(`Expected game 'starrail', got '${metadata.game}'`);
}
if (metadata.corpus.documentCount <= 0) {
  errors.push(`Document count must be > 0, got ${metadata.corpus.documentCount}`);
}
if (!metadata.corpus.corpusHash || metadata.corpus.corpusHash === "unknown") {
  errors.push(`Corpus hash must be non-empty, got '${metadata.corpus.corpusHash}'`);
}
if (!metadata.corpus.validationOk) {
  errors.push(`Corpus validation was not ok (validationOk: false)`);
}
if (metadata.embedding.model !== expectedEmbeddingModel) {
  errors.push(
    `Expected embedding model '${expectedEmbeddingModel}', got '${metadata.embedding.model}'`,
  );
}

if (expectedSourceCommit && metadata.source?.commit !== expectedSourceCommit) {
  errors.push(`Expected source commit '${expectedSourceCommit}', got '${metadata.source?.commit}'`);
}
if (expectedIstarothCommit && metadata.istaroth?.commit !== expectedIstarothCommit) {
  errors.push(
    `Expected istaroth commit '${expectedIstarothCommit}', got '${metadata.istaroth?.commit}'`,
  );
}
if (expectedGamesMcpCommit && metadata.gamesMcp?.commit !== expectedGamesMcpCommit) {
  errors.push(
    `Expected gamesMcp commit '${expectedGamesMcpCommit}', got '${metadata.gamesMcp?.commit}'`,
  );
}

// 3. File size checks
const bm25Stat = await stat(resolve(checkpointDir, "bm25_store.pkl"));
if (bm25Stat.size < 1024 * 1024) {
  errors.push(`bm25_store.pkl is suspiciously small: ${bm25Stat.size} bytes`);
}
const docsStat = await stat(resolve(checkpointDir, "documents.json"));
if (docsStat.size < 1024 * 1024) {
  errors.push(`documents.json is suspiciously small: ${docsStat.size} bytes`);
}

if (errors.length > 0) {
  console.error(`Checkpoint provenance verification FAILED with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkpointDir,
      documentCount: metadata.corpus.documentCount,
      corpusHash: metadata.corpus.corpusHash,
      embeddingModel: metadata.embedding.model,
      sourceCommit: metadata.source.commit,
      istarothCommit: metadata.istaroth.commit,
      gamesMcpCommit: metadata.gamesMcp.commit,
      bm25SizeBytes: bm25Stat.size,
      documentsSizeBytes: docsStat.size,
    },
    null,
    2,
  ),
);
