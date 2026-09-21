#!/usr/bin/env bash
# Everything that must pass before a deploy. Run from the project root: bash scripts/preflight.sh
set -uo pipefail
fail=0
step() { printf "\n=== %s\n" "$1"; }

step "themes"
pnpm exec tsx scripts/gen-themes.ts || fail=1

step "typecheck"
pnpm exec tsc --noEmit -p tsconfig.json || fail=1

step "lint"
pnpm exec eslint src --ext .ts,.tsx || fail=1

step "tool packs"
pnpm exec tsx scripts/test-pack.ts all || fail=1

step "build"
pnpm build || fail=1

if [ "$fail" -ne 0 ]; then printf "\nPREFLIGHT FAILED\n"; exit 1; fi
printf "\nPreflight passed. Deploy with: vercel --prod --yes\n"
