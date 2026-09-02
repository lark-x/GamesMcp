#!/usr/bin/env sh
set -eu

if [ -z "${ISTAROTH_IMAGE:-}" ]; then
  echo "ISTAROTH_IMAGE must be set to a pinned tag or digest." >&2
  exit 1
fi

if [ -z "${DATA_DIR:-}" ]; then
  echo "DATA_DIR must point to a persistent external data directory." >&2
  exit 1
fi

checkpoint_dir="${DATA_DIR}/istaroth/checkpoint/chs"

if [ -f "${checkpoint_dir}/documents.json" ]; then
  echo "Istaroth CHS checkpoint already exists at ${checkpoint_dir}; skipping download."
  exit 0
fi

if [ -d "${checkpoint_dir}" ]; then
  incomplete_dir="${checkpoint_dir}.incomplete.$(date +%Y%m%d%H%M%S)"
  echo "Existing checkpoint directory is incomplete; moving it to ${incomplete_dir}."
  mv "${checkpoint_dir}" "${incomplete_dir}"
fi

mkdir -p "$(dirname "${checkpoint_dir}")"

docker compose run --rm --no-deps --entrypoint python istaroth scripts/checkpoint_tools.py download chs /data/checkpoint/chs
