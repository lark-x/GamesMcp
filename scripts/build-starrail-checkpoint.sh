#!/usr/bin/env sh
set -eu

: "${ISTAROTH_DIR:?Set ISTAROTH_DIR to a lark-x/istaroth checkout}"
: "${STARRAIL_CORPUS_DIR:?Set STARRAIL_CORPUS_DIR to an Istaroth-compatible StarRail corpus}"
: "${STARRAIL_CHECKPOINT_DIR:?Set STARRAIL_CHECKPOINT_DIR to the checkpoint output path}"

if [ ! -f "${ISTAROTH_DIR}/scripts/rag_tools.py" ]; then
  echo "Istaroth rag_tools.py not found under ISTAROTH_DIR=${ISTAROTH_DIR}" >&2
  exit 1
fi

mkdir -p "${STARRAIL_CHECKPOINT_DIR}"
gamesmcp_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
istaroth_commit="$(git -C "${ISTAROTH_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
source_commit="$(node -e "const fs=require('fs'); const p=process.argv[1]; try { console.log(JSON.parse(fs.readFileSync(p,'utf8')).sourceCommit || 'unknown') } catch { console.log('unknown') }" "${STARRAIL_CORPUS_DIR}/metadata/starrail/source.json")"
corpus_hash="$(node -e "
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...getFiles(full));
    else files.push(full);
  }
  return files.sort();
}
const hasher = crypto.createHash('sha256');
for (const f of getFiles(process.argv[1])) {
  hasher.update(fs.readFileSync(f));
}
console.log(hasher.digest('hex'));
" "${STARRAIL_CORPUS_DIR}")"

export ISTAROTH_EMBEDDINGS="local"
export ISTAROTH_EMBEDDING_MODEL="${ISTAROTH_EMBEDDING_MODEL:-BAAI/bge-small-zh-v1.5}"
export ISTAROTH_EMBEDDINGS_MODEL="${ISTAROTH_EMBEDDINGS_MODEL:-${ISTAROTH_EMBEDDING_MODEL}}"
export ISTAROTH_TRAINING_DEVICE="${ISTAROTH_TRAINING_DEVICE:-cpu}"
export ISTAROTH_DEVICE="${ISTAROTH_DEVICE:-cpu}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-2}"
CONCURRENCY="${ISTAROTH_BUILD_CONCURRENCY:-4}"

cd "${ISTAROTH_DIR}"
PYTHON_CMD="python"
if command -v uv >/dev/null 2>&1 && [ -f "${ISTAROTH_DIR}/pyproject.toml" ]; then
  PYTHON_CMD="uv run python"
fi
$PYTHON_CMD scripts/rag_tools.py build "${STARRAIL_CORPUS_DIR}" "${STARRAIL_CHECKPOINT_DIR}" -f --concurrency "${CONCURRENCY}"

if [ ! -d "${STARRAIL_CHECKPOINT_DIR}/text" ]; then
  echo "Copying corpus to ${STARRAIL_CHECKPOINT_DIR}/text..."
  cp -R "${STARRAIL_CORPUS_DIR}" "${STARRAIL_CHECKPOINT_DIR}/text"
fi

node -e "
const fs = require('fs');
const out = process.argv[1];
const corpusDir = process.argv[5];
let docCount = 0;
let validationOk = true;
try {
  const manifest = JSON.parse(fs.readFileSync(corpusDir + '/manifest/starrail.json', 'utf8'));
  docCount = Array.isArray(manifest) ? manifest.length : 0;
} catch {}
try {
  const issues = JSON.parse(fs.readFileSync(corpusDir + '/metadata/starrail/issues.json', 'utf8'));
  if (Array.isArray(issues) && issues.some(i => i.severity === 'error')) validationOk = false;
} catch {}

const data = {
  schemaVersion: 1,
  game: 'starrail',
  language: 'CHS',
  gamesMcp: {
    repository: process.env.GITHUB_REPOSITORY || 'lark-x/GamesMcp',
    commit: process.argv[3],
  },
  istaroth: {
    repository: 'lark-x/istaroth',
    commit: process.argv[2],
  },
  source: {
    repository: 'DimbreathBot/TurnBasedGameData',
    commit: process.argv[4],
  },
  corpus: {
    documentCount: docCount,
    corpusHash: process.argv[6],
    validationOk,
  },
  embedding: {
    backend: process.env.ISTAROTH_EMBEDDING_BACKEND || 'sentence-transformers',
    model: process.env.ISTAROTH_EMBEDDING_MODEL || 'BAAI/bge-small-zh-v1.5',
    device: process.env.ISTAROTH_DEVICE || process.env.ISTAROTH_TRAINING_DEVICE || 'cpu',
  },
  build: {
    runner: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local',
    platform: process.platform,
    createdAt: new Date().toISOString(),
  },
};
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log('Wrote checkpoint metadata to ' + out);
" "${STARRAIL_CHECKPOINT_DIR}/checkpoint-metadata.json" "${istaroth_commit}" "${gamesmcp_commit}" "${source_commit}" "${STARRAIL_CORPUS_DIR}" "${corpus_hash}"

