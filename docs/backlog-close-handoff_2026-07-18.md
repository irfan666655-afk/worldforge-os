# Backlog Close — Handoff & Architectural State · 2026-07-18

Executing model: any. Target: the REAL P4 tree (`src/`, `shell.html`, `build.mjs`, `worldforge-os_5.html`) — which lives in Irfan's workspace, **not** in project knowledge. Every step below is against that tree.

## ⚠ P0 before anything: the persistence gap recurred

Project knowledge still holds **pre-M2 / pre-P4** files. Verified by md5 this session:
- `lint_worldforge.py` — no `PROMOTION_RULES` (pre-M2) → **replaced by this session's output**
- `gen_rules.py` — bootstrap fallback intact (pre-M2) → **replaced by this session's output**
- `wfkernel-p2-ext_v1_2.js` ≡ byte-identical to `_v1.js` (`28c3e4…`) — the real v1.2 from 2026-07-17 is still absent
- `worldforge-os_5.html`, `shell.html`, `src/forge-ui|guilds-data|escalation-viz`, fixed `build.mjs` — absent

**Irfan: upload to project knowledge** — this session's `lint_worldforge.py` + `gen_rules.py` + `rules.v1.json`, plus from the 2026-07-17 outputs: `worldforge-os_5.html`, real `wfkernel-p2-ext.v1.2.js`, `worldforge-kernel.v1.1.js`, fixed `build.mjs`, and `p4-source-tree.zip`. Until then every session re-hits this wall.

## Step 1 — P3-M1: foundry deletion (ratified, D-2026-07-18-01)

```bash
git rm foundry-visualizer*.html && git commit -m "P3-M1: retire foundry-visualizer (delete, no stub) [D-2026-07-18-01]"
python gen_rules.py --check && python lint_worldforge.py --roster agent-roster.v5.2.json --schema asset-library-schema.v3.1.json   # gate must stay 0/0
grep -ri foundry src/ shell.html build.mjs ci-p4.yml && echo "REFS FOUND — STOP" || echo clean
```
Also remove `foundry-visualizer_5.html` + `foundry-visualizer.js` from project knowledge (Irfan-side). Append D-2026-07-18-01 to the decision ledger.

## Step 2 — M2 linter (done this session, verified)

Replace repo copies with `lint_worldforge.py` + `gen_rules.py` from this session; commit `rules.v1.json` (source=`lint_worldforge.py`, 6 rules, sha256:1c4248d8…). CI: `python gen_rules.py --check` already covers it; exit 2 now means a stale bootstrap-sourced artifact survives on disk. Note the new `--library` behavior: the promotion evaluator now runs over the instance (state-tier backstop of the ext's event-tier evaluation). GOV-2 deliberately does not fire at state tier when `impact` is absent — the event tier owns it.

## Step 3 — P4-UI1: gate-override splice

1. Drop `wf-gate-override.v1.js` into `src/`; add to `build.mjs` bundle order after `forge-ui`.
2. In `src/forge-ui.js`, in the gate modal's action row, add an "Override…" tertiary button that mounts `WFGateOverride` with `{ kernel, projectId, stageId, onDone }`; advance the stage **only** in `onDone(rec)` when `rec` is non-null — the record lands before the stage moves (single-persist discipline).
3. **Burn MARKER UI1-K1**: open `worldforge-kernel.v1.1.js`, find the real decision-write method, and either (a) it matches one of the three detected seams (`recordGateOverride` → `recordDecision` → `ext.decisionLog.append`) — done, or (b) add `recordGateOverride` to the ext as a thin alias. Do not leave the runtime fail-closed branch as the resolution.
4. Gotcha: the module escapes all interpolated text; keep it that way if editing. `d-kind-gate-override` CSS hook already exists in shell.html (verified 2026-07-17).

## Step 4 — P2 visual pass splice

1. `wf-ufdm-visual.v1.js` → `src/`; `wf-ufdm-visual.v1.css` inlined into shell `<head>` by `build.mjs`.
2. `shell.html`: add `<section id="ufdm-surface"></section>` adjacent to the forge detail panel.
3. `src/app.js`, after `bindProject(id)`: mount `WFUFDMVisual`. One subscription only — the ext v1.2 chained channel delivers both event streams.
4. Burn the four read seams (`getLedger/getAssets/getDecisions/getBudget` vs `ext.*` variants) against the real kernel the same way as UI1-K1 — the module tolerates both, but pin the real names in a comment.
5. Gotchas encoded in the module: ledger sums **`cost`** (frozen shape — the `amount` bug class); `prefers-reduced-motion` kills all WAAPI; Framer Motion declined per D-2026-07-18-04.

## Step 5 — rebuild + gates

```bash
node build.mjs --bundle && node build.mjs --verify && node build.mjs --gate
node test/kernel-smoke.mjs        # 30/30
node test/ext-smoke.mjs           # 21/21
# per-block node --check on built artifact (mandatory since the $-splice bug)
```

## Architectural state after this session

| Track | State |
|---|---|
| Kernel + P4 modular shell | Shipped 2026-07-17 (os_5, 76→114KB, −82.6%); §5–6 browser passes running Irfan-side |
| P2 ext v1.2 | Shipped, all `VERIFY(kernel-src)` closed; **not in project knowledge** |
| M2 linter / rules pipeline | **Re-derived + verified this session**; linter sole authority; `RECONCILE(lint-src)` CLOSED |
| P3-M1 | RATIFIED: delete; physical act = Step 1 |
| P4-UI1 | RATIFIED + component shipped; open marker `UI1-K1` (kernel method name) |
| P2 visual | Modules shipped; splice = Step 4; Framer Motion declined (D-2026-07-18-04) |
| P3 graph | **UNBLOCKED next milestone** — frozen spec `P3-graph-spec_v1.md`; foundry retirement decided; edge data sources live (escalation ✓, pipeline sequence ✓ interim pending `PIPE-1`, promotion chain ✓ via decision_log) |

**Open markers:** `PIPE-1` (canonical pipeline.v1.json — defused, zero-code drop-in) · `ACT-1` (unchanged, export-tier enforcement) · `UI1-K1` (new, this session) · `MUST-VERIFY P4-UI1` → superseded by shipped component + UI1-K1 · `UFDM2-Q1–Q3` (unchanged) · `P4-SZ1` resolved 07-17 · `P4-CSS1` — fold into Irfan's §5–6 pass.

**Next priority:** P3 execution against the frozen graph spec — in the workspace that holds the real tree (Claude Code), or here once the P0 uploads land.
