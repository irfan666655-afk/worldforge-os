# WorldForge OS — Decision Log

Append-only. A decision with real weight gets recorded, not just decided (Rule 7).
Ratification authority: Irfan. Records below marked RATIFIED were ratified by
Irfan via executive directive, 2026-07-19.

---

## D-2026-07-18-01 — RATIFIED · foundry-visualizer retirement
Delete, no redirect stub. Physical act vacuous in the repo (never tracked);
project-knowledge deletion is Irfan-side. `--deadcheck` zero refs on record.

## D-2026-07-18-04 — RATIFIED · engineering language
Vanilla JS + WAAPI, UMD, zero build-chain dependencies. Framer Motion declined
(React library; conflicts with the frozen architecture). Reopening requires a
new record here.

## D-2026-07-19-01 — RATIFIED · kernel single-source splice
`shell.html` no longer carries a hand-synced inline kernel copy. `build.mjs`
splices `worldforge-kernel.v1.1.js` between `WF:KERNEL` markers and folds it
(with the CSS) into the determinism hash. Motive: a kernel fix demonstrably
failed to reach the artifact through the duplicated copy (chaos finding 5,
`docs/chaos-report_2026-07-19.md`). Status: frozen.

## D-2026-07-19-02 — RATIFIED · in-process mutation FIFO
All state-replacing kernel/ext operations serialize through one in-process
FIFO installed by ext v1.2.1 (fuzz finding 3, browser finding 4 — silent lost
writes). Cross-client semantics unchanged (freshen, last-writer-wins).
Maintainer law: a queued method must never call another queued method
(deadlock); un-queued callers may call queued ones. The queue seam is exposed
to sibling extensions as `kernel._p2Enqueue`. Status: frozen.

## D-2026-07-19-03 — RATIFIED · monetization contract v1 (mock gateway)
`src/wf.monetization.v1.js` ships as a FROZEN billing contract: deterministic
usage metering on the frozen ledger vocabulary (`cost`, never `amount`;
`meter:` action prefix; own `metering_ledger`, separate from `budget_ledger`
and both decision ledgers), fail-closed validation, tamper-checked invoicing,
and an injected gateway seam. Constraints frozen with it:
- The default gateway is a MOCK. No real payment processing exists anywhere
  in the codebase.
- The module is NOT in the browser bundle manifest. It enters the artifact
  only after a real-gateway decision is recorded here (marker MON-1).
- Billing never guesses: a corrupt metering row aborts invoicing; a tampered
  invoice total refuses to charge; a null/ambiguous gateway response is a
  failure, never an assumed success.

## Open markers
`PIPE-1` · `ACT-1` · `UFDM2-Q1–Q3` · `MON-1` (real gateway decision) ·
§5–6 browser/a11y release passes (Irfan-side).
