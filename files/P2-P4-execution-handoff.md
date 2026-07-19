# P2–P4 Execution Handoff — for Opus/Sonnet in Claude Code

**Date:** 2026-07-12 · **Prepared by:** Fable 5 architecture session
**Scope:** Everything a downstream implementation model needs to wire P2 to the real kernel and execute P4, without re-deriving any decision.

**Session provenance (read first):** `worldforge-kernel.v1.js`, `worldforge-os_3.html`, `foundry-visualizer.js`, and `lint_worldforge.py` were **not available** in this session (uploads empty; conversation search returns fragments only — a known limitation). Reconciliation was therefore executed as *seam replacement*: every assumed private method in the ext was replaced with an injected seam + capability-detection chain, which is correct regardless of the real kernel's internals. All residual verification points are grep-able as `VERIFY(kernel-src)` in `wfkernel-p2-ext.v1.1.js` and `RECONCILE(lint-src)` in `gen_rules.py`. **First action in Claude Code: have Irfan attach the four source files, then burn down those markers (~30 min total).**

---

## 1. Reconciliation record — the three assumed methods

| v1.0 assumption | v1.1 resolution | Verify against kernel source |
|---|---|---|
| `kernel._persist(state)` | `_p2Persist()`: uses `kernel.persist \|\| saveProject \|\| save \|\| _persist` if any exists; else writes via the **injected storage adapter** under `pipeline.storage.projectPrefix + state.id` (`wfproj:` default — documented kernel behavior) | Confirm the key scheme is `prefix + id` verbatim; confirm whether `updateBudget`/`recordDecision` persist internally (assumed yes — if not, add a persist call inside the notify wrappers, marker present) |
| `kernel.readAssetBytes(id)` | Injected `opts.readAssetBytes(assetRecord)`. Absent → fingerprint verification returns tri-state `unverifiable` — never false-pass, never false-fail (Rule 4) | None needed until decision **P2-D-bytes** (asset-byte storage location: per-project storage keys vs external URLs + cached digests) is taken. That decision is still open and is Irfan's call — flag it, don't default it |
| `kernel.getRoster()` / `getPipeline()` | Canonical `pipeline.v1.json` + `agent-roster.v5.2.json` injected at `install()`; kernel methods used opportunistically if present | If the kernel exposes either, confirm return shape matches canonical JSON (`{stages:[…]}`, `{agents:[…]}`) |

Also verify: `recordDecision` frozen schema field names (ext currently writes `kind, asset_id, actor, approver, reason, impact, findings, ts`), `updateBudget` entry shape (`{action, amount}` assumed), decision-log field name on project state (`decisions` vs `decision_log` — export handles both), and asset-schema required minimums (ext enforces `id, type, name`; check v3.1).

**Smoke-tested this session** (mock kernel, Node): budget reserve with `reserve:` prefix, register, silent-promotion rejection (Rule 12), clean transactional promote (decision record + lock + single persist to `wfproj:p1`), GOV-2 approver gate on high impact, tri-state fingerprint, UFDM export→validate roundtrip. All green.

---

## 2. MockKernel → real kernel swap (exact steps)

The P2 mockup (`worldforge-ufdm-mockup.html`) becomes the real dashboard by swapping its MockKernel for the extended real kernel. In order:

1. **Load order in the HTML shell:** `worldforge-kernel.v1.js` (UMD, untouched) → `wfkernel-p2-ext.v1.1.js` → `wf-ufdm-components.v1.js` → boot script. All plain `<script>` tags — no `type="module"` (see gotcha G2).
2. **Boot script:**
   ```js
   const kernel = WFKernel.createKernel({
     storage: window.storage,          // the artifact adapter
     pipeline: PIPELINE_V1,            // embedded canonical JSON (generated, never hand-edited)
     actor: currentActor               // value or function — kernel accepts both
   });
   WFKernelP2Ext.install(kernel, {
     pipeline: PIPELINE_V1,
     roster: ROSTER_V52,               // embedded via gen_guilds discipline
     storage: window.storage,          // seam #1 fallback — pass the SAME adapter
     // readAssetBytes: <defer until P2-D-bytes is decided>
   });
   kernel.loadRules(RULES_V1);         // embedded rules.v1.json (from gen_rules.py)
   ```
3. **Delete MockKernel** and every reference; components already speak only the kernel API via mount/update/destroy, so this should be a removal, not a rewrite. Any component found reaching past the kernel is a bug to fix now.
4. **Regenerate embeds:** run `gen_guilds.py` and `gen_rules.py`; splice outputs. Never paste by hand.
5. **Run the P2 acceptance path:** register → verify → promote (clean path must complete **< 10 seconds** — hard design law; actor pre-filled, impact defaulted, GOV-2 modal only on rule flag) → export UFDM → validate → import roundtrip.
6. **Linter pass:** `lint_worldforge.py` against the new HTML (embedded `KERNEL_VERSION` + roster drift checks), plus `python gen_rules.py --check`.

Fail-closed behaviors to preserve (do not "fix" them): promotion is blocked if rules aren't loaded; unknown predicates evaluate as errors; bootstrap-sourced rules surface a `RULES-PROVENANCE` warning on every evaluation.

---

## 3. P4 execution sequence (per `P4-extraction-strategy.v1.0.md`)

Hard ordering rule: **modularization (step 3 below) is gated on P2 landing** — never run two refactors on the same HTML surface. Steps 1–2 and 4 can run parallel to P2.

1. `node build.mjs --inventory worldforge-os_3.html` — literal step one the moment the file is uploaded. Then `--xrefs` to get the edge list vs the target dependency graph (bootstrap → vendor-loader → kernel-adapter → wf-ufdm-components → text-roster → escalation-viz → app; edges point downward only — any upward/sideways import found is a design error to fix, not encode).
2. **Vendor cut:** delete vendored Three.js; `vendor-loader.js` (drafted, tested) is the only load path — CDN r128 with timeout, idempotent, fires `wf:vendor-fallback`. Verify ~25MB size delta.
3. **Extraction:** bootstrap reduced to ≤20 lines (load kernel UMD, inline bundle, `WF.app.boot()`); every `window.WFKernel` access moves behind `kernel-adapter.js` — `node build.mjs --gate` fails on any other file touching it; legacy UI blocks that duplicate a P2 surface are **DEAD** once the P2 component is wired — label, don't port.
4. **Dead code:** `node build.mjs --deadcheck` + CSS orphan diff. `foundry-visualizer.js` is dead by decision P4-D4 (below) — exclude from manifest, do not delete the file yet.
5. **Bundle:** `node build.mjs --bundle` (transform-free UMD concatenation in manifest order, LF-normalized hash embedded as `WF-BUNDLE-HASH`, spliced between `WF:BUNDLE:BEGIN/END` markers) → `worldforge-os_4.html`, one file, double-click-openable. `--verify` = determinism check, run twice.
6. **Accessibility:** axe-core in CI (serious/critical fail, moderate warn) against the built `file://` artifact is the **floor**; the manual keyboard + screen-reader passes are **release criteria** (see G3). Target is WCAG 2.1 **AA**, not AAA. A11y acceptance is folded into P2 component acceptance criteria, not retrofitted.

CI gates (`ci-p4.yml`, drafted): bundle freshness, global-scope confinement, axe-core — plus add `python gen_rules.py --check` from this session.

---

## 4. Known gotchas — every one has already cost time once

- **G1 · Contrast flag (dark UI):** automated contrast scans only see the state present at scan time. The **amber focus rings** on the dark theme require a *focused-state* manual contrast pass — no default axe/Lighthouse run will catch them. This is a named checklist item in the WCAG template; do not mark contrast complete on scan output alone.
- **G2 · UMD / `file://` rule:** the shipped artifact must open by double-click. Therefore: no `type="module"`, no `fetch()` of local files, no dynamic `import()` of local paths (CORS blocks all three on `file://`). All modules are UMD; dependencies resolve **at call time from `WF.*`, never at file scope** — that's the one rule that makes concat order forgiving.
- **G3 · A11y manual pass is a release criterion:** automated scans catch roughly a third to half of real violations. Keyboard-only navigation and a screen-reader pass are mandatory before ship, every release.
- **G4 · WebGL probe:** capability detection is a bare `canvas.getContext('webgl')` — never `new THREE.WebGLRenderer()`, which requires Three.js to already be loaded and is useless in exactly the failure scenario it's meant to detect.
- **G5 · Fallback re-entry:** `wf:vendor-fallback` can fire after boot has already decided the 3D path; `app.boot()` must stay idempotent (guard: only mount text roster if the mount is empty). Components never probe capabilities — `app.js` is the sole mode-decider.
- **G6 · Compiler discipline:** embedded GUILDS, kernel copy, and rules are generated (`gen_guilds.py`, `gen_rules.py`) — hand-editing an embed is a linter failure by design. Regenerate, splice, commit.
- **G7 · Provenance of this handoff:** kernel/linter contract details herein were reconstructed from prior-session records, not read from source. Anything contradicted by the actual files wins — the files are canon.

---

## 5. Decision records P4-D1–D4 — drafted in full

Frozen decision-record shape (dogfoods the Asset Library instance pattern; align field names with `recordDecision` on reconciliation). All four are **status: draft — pending Irfan's ratification**; paste into the decision ledger verbatim on approval, changing only `status` and `ts`.

```json
{
  "id": "P4-D1",
  "kind": "architecture-decision",
  "title": "Three.js: vendored → CDN with timeout fallback",
  "actor": "irfan",
  "impact": "medium",
  "decision": "Remove the ~25MB vendored Three.js from the shipped artifact. Load r128 from cdnjs via vendor-loader.js (timeout-guarded, idempotent, fires wf:vendor-fallback). On CDN failure or WebGL absence, degrade to the accessible text roster (text-roster.js).",
  "alternatives_considered": [
    "Keep vendoring (rejected: 25MB artifact, synchronous parse blocks first render)",
    "Ship two artifacts, online/offline (rejected: doubles the release surface; violates single-file discipline)"
  ],
  "reason": "CDN fallback is a hard requirement given the single-file offline use case; the text roster preserves full data access when 3D is unavailable, so the degradation loses polish, not capability.",
  "links": ["vendor-loader.js", "components/text-roster.js", "P4-extraction-strategy.v1.0.md §vendor"],
  "status": "draft",
  "ts": "2026-07-12T00:00:00Z"
}
```

```json
{
  "id": "P4-D2",
  "kind": "architecture-decision",
  "title": "Module system: UMD + transform-free concatenation (no bundler)",
  "actor": "irfan",
  "impact": "high",
  "decision": "All modules are authored UMD (the established kernel/P2 pattern). build.mjs concatenates in explicit manifest order with an embedded LF-normalized source hash; no esbuild/vite/webpack, no ES modules in the shipped artifact.",
  "alternatives_considered": [
    "ESM + vite-plugin-singlefile (rejected: adds a toolchain dependency; ESM breaks file:// double-click open)",
    "esbuild IIFE bundle (rejected: transform step makes byte-level determinism and drift-guarding harder for zero gain at this scale)"
  ],
  "reason": "Transform-free concatenation is trivially deterministic with zero dependencies — the gen_guilds drift-guard pattern applied to the artifact itself (build.mjs --verify). Node is the only required tool, dissolving the Windows/bash question.",
  "links": ["build.mjs", "module-wrapper-template.js", "P4-extraction-strategy.v1.0.md §0.3"],
  "status": "draft",
  "ts": "2026-07-12T00:00:00Z"
}
```

```json
{
  "id": "P4-D3",
  "kind": "architecture-decision",
  "title": "Accessibility: WCAG 2.1 AA, automated floor + manual release criteria, folded into P2 acceptance",
  "actor": "irfan",
  "impact": "medium",
  "decision": "Target WCAG 2.1 AA. CI runs axe-core against the built file:// artifact (serious/critical fail the build; moderate warns). Manual keyboard-only and screen-reader passes are release criteria, including the focused-state contrast check on amber focus rings (G1). A11y acceptance criteria live inside each P2 component's acceptance checklist — no separate retrofit pass.",
  "alternatives_considered": [
    "AAA target (rejected: disproportionate for an internal production tool; AA is the defensible standard)",
    "Automated-only gate (rejected: scans catch ~1/3–1/2 of real violations; state-dependent issues like focus contrast are invisible to them)",
    "Separate post-P2 a11y sprint (rejected: retrofit ordering guarantees rework on freshly-built components)"
  ],
  "reason": "Folding a11y into component acceptance makes it machine-checkable where possible and procedurally mandatory where not — governance-as-code applied to accessibility.",
  "links": ["ci-p4.yml", "P4-extraction-strategy.v1.0.md §7 (WCAG template)"],
  "status": "draft",
  "ts": "2026-07-12T00:00:00Z"
}
```

```json
{
  "id": "P4-D4",
  "kind": "architecture-decision",
  "title": "foundry-visualizer.js: declared dead in P4, retired in P3",
  "actor": "irfan",
  "impact": "low",
  "decision": "foundry-visualizer.js is excluded from the P4 bundle manifest and labeled DEAD in the deadcheck inventory, but the file is not deleted in P4. Deletion lands in P3 when decorative visualizations are replaced by real canonical graph edges, so the P3 session can mine it for any reusable rendering logic first.",
  "alternatives_considered": [
    "Delete now (rejected: P3 graph work may reuse scene/camera scaffolding; deleting before P3 scopes that is premature)",
    "Keep in bundle until P3 (rejected: ships dead code and its Three.js surface area; contradicts the P4 hygiene mandate)"
  ],
  "reason": "Exclude-but-retain gets the hygiene win (nothing dead ships) without foreclosing P3 reuse; the deadcheck label keeps the debt visible rather than silent.",
  "links": ["build.mjs --deadcheck", "P3 roadmap item: canonical graph edges"],
  "status": "draft",
  "ts": "2026-07-12T00:00:00Z"
}
```

---

## 6. Open items owed to Irfan (business-defining, not defaulted here)

1. **P2-D-bytes** — asset-byte storage location for fingerprint verification: per-project storage keys vs external URLs + cached digests. Blocks the `readAssetBytes` injection; everything else ships without it (tri-state keeps Rule 4 honest meanwhile).
2. **Ratify P4-D1–D4** above.
3. **Upload the four source files** — the only remaining blocker for closing every `VERIFY`/`RECONCILE` marker and running `build.mjs --inventory` for real.
