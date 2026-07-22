# Chaos Engineering Report — 2026-07-19

**Session scope:** reconstruct the real P4 tree from project-knowledge zips (`files 3.zip`, `files 4.zip`), execute backlog-close handoff Steps 2–5, then run a hostile fuzz/audit pass against kernel v1.1 + ext v1.2 and patch every confirmed failure.

**Harness:** `test/chaos-fuzz.mjs` (permanent regression asset). Probes: malformed ledger shapes, cost/amount conformance, racing mutations under async storage latency, subscription-chain integrity, corrupt persisted entries, global-scope leaks on the built artifact.

## Findings & immunities (all fixed, all regression-tested)

| # | Sev | Failure mode | Immunity |
|---|---|---|---|
| 1 | CRITICAL | One `null` row in `budget_ledger` crashed `getBudgetSummary()` — whole budget UI dead from a single corrupt row | Corrupt rows counted (`summary.corrupt`) and console-errored, never fatal (ext) |
| 2 | HIGH | `reserveBudget` wrote `{amount}` — the exact frozen-shape violation the handoff flags; visual tier sums only `cost`, so reservations were invisible and burnstrip rendered NaN | Writes `{cost, ts}`; legacy `amount` still honored on read for old data (ext) |
| 3 | HIGH | Racing `advance()` vs `updateBudget()` lost ledger writes: kernel `freshen()` replaces the in-memory object while ext holds the old reference — last persist silently wins | Global in-process mutation FIFO wrapping all 12 state-replacing ops (ext, wrap applied at end of `install`) |
| 4 | HIGH (browser-proven) | First-use race: in-flight `loadProjects()` wholesale-replaces the projects array and wipes a concurrent `createProject()` — new project vanished, visual mount threw, user saw "Save failed" | Same FIFO — `loadProjects`/`createProject` serialized with the mutators |
| 5 | MEDIUM | Corrupt project entry skipped **silently** on load — a project vanishes with no trace (fail-open) | Loud skip: `console.error` + `corrupt-entry` event + `corrupt` count on the `loaded` event (kernel → **1.1.1**) |

Probes that survived unpatched: overdraw refusal, chained kernel+ext eventing (one subscribe, both channels; hostile listener contained; unsubscribe severs both), global scope confined to the 6 expected UMD names (`WFKernel, WF, WFKernelP2Ext, WFUFDM, WFGateOverride, WFUFDMVisual`).

## Handoff steps closed this session

- **Step 1 (P3-M1):** vacuous in this repo — no foundry-visualizer files ever tracked; `--deadcheck` zero refs stands. Project-knowledge deletion remains Irfan-side.
- **Step 2:** M2 linter + `gen_rules.py` + `rules.v1.json` landed at repo root; `--check` fresh.
- **Step 3 (P4-UI1):** Override… button in the gate modal → `WFGateOverride` ceremony. **MARKER UI1-K1 BURNED:** the kernel's decision-write for an override IS `advance(id, {override:true, reason})` — atomic record+advance, one persist. Ext provides `recordGateOverride` as a thin alias over it (option b); when it resolves the stage has already moved, so `onDone` only refreshes. Fails loudly on an ungated stage.
- **Step 4 (P2 visual):** `wf-ufdm-visual.v1.js` + CSS spliced; `#ufdm-surface` mounted while a project is bound. **Read seams BURNED:** ext now exposes `getLedger` (budget_ledger), `getDecisions` (decisions + decision_log merged view, normalized), `getBudget` (budget_start). Without these every panel rendered empty — the seam names the component probes did not exist on the real ext.
- **Step 5:** full matrix green (see below).
- **P4-CSS1 closed:** `.d-kind-gate-override` rule added.

## Architectural change requiring ratification

**D-2026-07-19-01 (proposed):** shell.html no longer carries a hand-synced inline kernel copy; `build.mjs` splices `worldforge-kernel.v1.1.js` between `WF:KERNEL` markers and folds it (plus the CSS) into the determinism hash. Motive: finding 5's kernel fix demonstrably did not reach the artifact through the duplicated copy. Single source of truth now enforced by the build.

**D-2026-07-19-02 (proposed):** in-process mutation FIFO in the ext (finding 3/4). Cross-client concurrency semantics unchanged (freshen, last-writer-wins). Maintainer rule: a queued method must never call another queued method.

## Verification matrix (final)

- `build.mjs --bundle` → sha256 `82a0b064421cb…` · `--verify` fresh · `--gate` clean
- `test/kernel-smoke.mjs` **30/30** · `test/p2-ext-smoke.mjs` **31/31** (21 baseline + 6 seam + 4 chaos regressions) · `test/chaos-fuzz.mjs` **no findings**
- `gen_rules.py --check` fresh · `lint_worldforge.py` 0 errors / 0 warnings · per-block `node --check` 3/3
- Browser (served artifact): boot clean, first-use create OK, gate fires, reason-less override **refused** (GOV-1/Rule 7), ceremony records `gate-override · Irfan` and advances exactly one stage, UFDM surface renders Budget/Locked assets/Decision chain live, zero console errors.

## Artifact size

143,484 B (vs 113,880 B pre-splice; includes the `_p2Enqueue` seam, D-2026-07-19-02). The delta is the P2 surface actually landing: gate-override + ufdm-visual modules, inlined CSS, chaos-immunity code and their comments. Monolith baseline remains 653,674 B → **−78.1%**. No minification pass: source readability is the ratified engineering language (D-2026-07-18-04 spirit); byte-shredding via comment-stripping would fight the audit discipline that caught these bugs.

## Open markers (unchanged)

`PIPE-1` (canonical pipeline.v1.json drop-in) · `ACT-1` (export-tier actor enforcement) · `UFDM2-Q1–Q3` · §5–6 browser/a11y passes (Irfan-side release criterion).

**P0 persistence note:** upload to project knowledge from this session: `wfkernel-p2-ext.v1.2.js` (now v1.2.1), `worldforge-kernel.v1.1.js` (now 1.1.1), `shell.html` (kernel markers), `build.mjs` (kernel+css splice), `test/chaos-fuzz.mjs`, `test/p2-ext-smoke.mjs`, this report.
