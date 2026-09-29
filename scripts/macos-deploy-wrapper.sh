#!/usr/bin/env bash
# ==============================================================================
# GamesMcp macOS Unified Deployment Entry Point
# Defaults to Option B: Native macOS (Ultra-Low Memory ~250MB, Zero Docker)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

if [ "${1:-}" == "--docker" ]; then
    shift
    exec ./deploy-docker.sh "$@"
else
    exec ./deploy-native.sh "$@"
fi
