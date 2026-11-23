#!/usr/bin/env bash
# Deploys the testnet relayer to Railway: stages only what the image needs
# (sdk, relayer, the testnet deployments file) and runs `railway up` on it.
# RELAYER_KEY, ALLOW_ORIGIN and PORT are set on the Railway service, not here.
#   tools/deploy-relayer.sh -p <project-id> -e <environment-id> -s <service-id>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/sdk" "$STAGE/relayer" "$STAGE/contracts/deployments"
cp "$ROOT/sdk/package.json" "$STAGE/sdk/"
cp -R "$ROOT/sdk/src" "$STAGE/sdk/src"
cp "$ROOT/relayer/package.json" "$ROOT/relayer/package-lock.json" "$STAGE/relayer/"
cp -R "$ROOT/relayer/src" "$STAGE/relayer/src"
cp "$ROOT/contracts/deployments/46630.json" "$STAGE/contracts/deployments/"
cp "$ROOT/relayer/Dockerfile" "$STAGE/Dockerfile"
cd "$STAGE"
railway up "$@" --detach
