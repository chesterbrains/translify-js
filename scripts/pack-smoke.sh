#!/usr/bin/env bash
# Packs the package and installs the tarball into a scratch project: ESM import, CJS require
# and the bin must all work from a consumer's point of view.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

tgz="$(cd "$root" && pnpm pack --pack-destination "$tmp" 2>/dev/null | tail -1)"
cd "$tmp"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "$tgz" >/dev/null

node --input-type=module -e "import('@translifyhq/client').then((m) => { if (typeof m.createTranslify !== 'function' || typeof m.localStorageStorage !== 'function') process.exit(1); })"
node -e "const m = require('@translifyhq/client'); if (typeof m.createTranslify !== 'function' || typeof m.TranslifyError !== 'function') process.exit(1)"
npx translify-client types --help | grep -q -- '--base-url'
npx translify-client --help | grep -q -- '--base-url'
test -f node_modules/@translifyhq/client/dist/index.d.ts

echo "pack smoke ok"
