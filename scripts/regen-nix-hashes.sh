#!/usr/bin/env bash
# Regenerate bun.nix from bun.lock and probe cargoHash from a failed nix build.
# Run from the repo root or any subdirectory.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# 1. bun.nix
echo "Regenerating bun.nix from bun.lock..."
nix run github:nix-community/bun2nix/staging-2.1.0 -- -l ./bun.lock -o ./bun.nix

# 2. cargoHash — blank it, build, read the "got:" hash from the error
echo "Probing cargoHash..."
jq '.cargoHash = ""' hashes.json > hashes.json.tmp && mv hashes.json.tmp hashes.json

got=$(nix build .#omp 2>&1 | awk '/got: *sha256-/{print $2; exit}') || true
if [ -z "$got" ]; then
  echo "could not extract cargoHash from build output" >&2
  exit 1
fi

jq --arg h "$got" '.cargoHash = $h' hashes.json > hashes.json.tmp && mv hashes.json.tmp hashes.json
echo "wrote cargoHash=$got"
