#!/usr/bin/env bash
# scripts/production-deploy.sh — WorldForge OS staging deployment runtime.
#
# Runs every verification gate and STOPS AT THE LAUNCH PAD. It never pushes,
# tags, or touches hosting credentials: shipping is a human decision made
# with credentials in hand (docs/SYSTEM_IDENTITY.md — the record's
# trustworthiness outranks automation convenience).
#
# Gates, in order — the script aborts on the first red:
#   1. 48-lane verification matrix   (all suites, build, lint, telemetry)
#   2. strict hygiene pass           (roster + schema + artifact drift)
#   3. byte-level reproducibility    (rebuild, compare embedded hash — the
#                                     same layout the G5 boot self-check
#                                     verifies at runtime)
#   4. env preflight report          (which server seams would boot LIVE;
#                                     advisory here — production must pass
#                                     `node scripts/validate-env.mjs --strict`)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── gate 1/4 · 48-lane verification matrix ──────────────────"
node scripts/agent-matrix-48.mjs

echo "── gate 2/4 · hygiene: lint roster + schema + drift ────────"
python lint_worldforge.py \
  --roster agent-roster.v5.2.json \
  --schema asset-library-schema.v3.1.json \
  --html worldforge-os_5.html

echo "── gate 3/4 · byte-level reproducibility (G5 layout) ───────"
node build.mjs --verify

echo "── gate 4/4 · env preflight (server seams, advisory) ───────"
node scripts/validate-env.mjs

SIZE=$(wc -c < worldforge-os_5.html | tr -d ' ')
echo ""
echo "════════════════════════════════════════════════════════════"
echo "GATE MATRIX 100% GREEN: READY TO SHIP."
echo "  artifact: worldforge-os_5.html · ${SIZE} bytes · hash-verified"
echo "  Run 'vercel deploy' or git push manually."
echo "  (production server deploys must first pass:"
echo "   node scripts/validate-env.mjs --strict)"
echo "════════════════════════════════════════════════════════════"
