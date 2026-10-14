#!/usr/bin/env bash
# Run every example against generated sample data. Requires `npm run build` first,
# since the examples import the package by name (resolved to dist/).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

node --experimental-strip-types "$root/examples/generate-sample-data.ts" "$workdir/sample-data.mrc"

cd "$workdir"
for example in "$root"/examples/0*.ts; do
  echo "::group::$(basename "$example")"
  node --experimental-strip-types "$example" sample-data.mrc
  echo "::endgroup::"
done
