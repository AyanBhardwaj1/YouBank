#!/usr/bin/env bash
# Everything that must pass before a deploy. Run from the project root: bash scripts/preflight.sh
set -uo pipefail
fail=0
step() { printf "\n=== %s\n" "$1"; }

step "themes"
pnpm exec tsx scripts/gen-themes.ts || fail=1

step "tool catalog"
pnpm exec tsx scripts/gen-catalog.ts || fail=1
git diff --quiet -- src/lib/workflows/catalog.gen.ts || { echo "catalog.gen.ts was stale and has been regenerated: commit it"; }

step "typecheck"
pnpm exec tsc --noEmit -p tsconfig.json || fail=1

step "lint"
pnpm exec eslint src --ext .ts,.tsx || fail=1

step "inference"
pnpm exec tsx scripts/test-inference.ts > /tmp/youbank-test-inference.log 2>&1 && tail -1 /tmp/youbank-test-inference.log || { cat /tmp/youbank-test-inference.log; fail=1; }
step "newsroom"
pnpm exec tsx scripts/test-news.ts > /tmp/youbank-test-news.log 2>&1 && tail -1 /tmp/youbank-test-news.log || { cat /tmp/youbank-test-news.log; fail=1; }

step "edge"
pnpm exec tsx scripts/test-edge.ts > /tmp/youbank-test-edge.log 2>&1 && tail -1 /tmp/youbank-test-edge.log || { cat /tmp/youbank-test-edge.log; fail=1; }

step "crypto"
pnpm exec tsx scripts/test-crypto.ts > /tmp/youbank-test-crypto.log 2>&1 && tail -1 /tmp/youbank-test-crypto.log || { cat /tmp/youbank-test-crypto.log; fail=1; }
step "premium"
pnpm exec tsx scripts/test-premium.ts > /tmp/youbank-test-premium.log 2>&1 && tail -1 /tmp/youbank-test-premium.log || { cat /tmp/youbank-test-premium.log; fail=1; }
step "3d maps"
pnpm exec tsx scripts/test-maps.ts > /tmp/youbank-test-maps.log 2>&1 && tail -1 /tmp/youbank-test-maps.log || { cat /tmp/youbank-test-maps.log; fail=1; }

step "launch limits"
pnpm exec tsx scripts/test-launch.ts > /tmp/youbank-test-launch.log 2>&1 && tail -1 /tmp/youbank-test-launch.log || { cat /tmp/youbank-test-launch.log; fail=1; }

step "billing"
pnpm exec tsx scripts/test-billing.ts > /tmp/youbank-test-billing.log 2>&1 && tail -1 /tmp/youbank-test-billing.log || { cat /tmp/youbank-test-billing.log; fail=1; }
step "errors"
pnpm exec tsx scripts/test-errors.ts > /tmp/youbank-test-errors.log 2>&1 && tail -1 /tmp/youbank-test-errors.log || { cat /tmp/youbank-test-errors.log; fail=1; }

step "tool packs"
pnpm exec tsx scripts/test-pack.ts all || fail=1

step "build"
pnpm build || fail=1

if [ "$fail" -ne 0 ]; then printf "\nPREFLIGHT FAILED\n"; exit 1; fi
printf "\nPreflight passed. Deploy with: vercel --prod --yes\n"
