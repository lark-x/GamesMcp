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
corpus_hash="$(find "${STARRAIL_CORPUS_DIR}" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')"
cd "${ISTAROTH_DIR}"
python scripts/rag_tools.py build "${STARRAIL_CORPUS_DIR}" "${STARRAIL_CHECKPOINT_DIR}"
node -e "const fs=require('fs'); const out=process.argv[1]; const data={schemaVersion:1,game:'starrail',istarothCommit:process.argv[2],gamesMcpCorpusGeneratorCommit:process.argv[3],turnBasedGameDataCommit:process.argv[4],corpusHash:process.argv[5],embeddingBackend:process.env.ISTAROTH_EMBEDDING_BACKEND || null,embeddingModel:process.env.ISTAROTH_EMBEDDING_MODEL || null,builtAt:new Date().toISOString()}; fs.writeFileSync(out, JSON.stringify(data,null,2)+'\n')" "${STARRAIL_CHECKPOINT_DIR}/checkpoint-metadata.json" "${istaroth_commit}" "${gamesmcp_commit}" "${source_commit}" "${corpus_hash}"
