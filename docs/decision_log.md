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

## D-2026-07-19-04 — RATIFIED · recovery tier at the storage seam
`src/wf-recovery.v1.js` wraps the injected storage adapter (kernel/ext/
monetization untouched): every valid persist stamps a hash-verified shadow;
a corrupt primary read auto-rolls back to the last pristine state, loudly,
with the shadow's hash re-verified first — a forged shadow is refused, and
a corrupt write never lands. FNV-1a integrity provenance only; cryptographic
chaining is marker `PROV-1`. Gap analysis: `docs/SYSTEM_IDENTITY.md`.
Status: frozen.

## D-2026-07-19-05 — RATIFIED · cryptographic event chain (G2, PROV-1)
`src/wf-event-chain.v1.js`: every governance record appended through
`recordDecision` is hash-chained (pure-JS SHA-256, verified against Node
crypto on 13 vectors incl. multi-block + surrogates) to its predecessor via
`_chain = { seq, prev, hash }`; `verifyEventChain()` reports the exact break
index for content edits, deletions, reorders, insertions, and partial
re-forges. Honest scope frozen with it: keyless tamper-EVIDENCE — an
attacker rewriting the entire chain forward defeats it; keyed authenticity
is marker `PROV-2`. Frozen decision shape untouched (chain fields excluded
from the digest). Status: frozen.

## D-2026-07-19-06 — RATIFIED · artifact boot self-check (G5, SELF-1 closed)
`build.mjs` stamps per-block SHA-256 hashes (`data-wf` tagged bundle AND
kernel scripts) into the artifact; a boot-gate recomputes both via
SubtleCrypto and REFUSES to boot on mismatch with a full-screen tamper
notice. Negative-tested live: a kernel-block tamper and a bundle-block
tamper both refused with block-precise diagnostics; the kernel-block case
was a real coverage gap caught by the negative test (bundle-only hashing
booted a tampered kernel) and forced dual-block coverage. Inability to RUN
the check (no SubtleCrypto/secure context) boots with a loud warning —
unverifiable is not evidence of tampering. Status: frozen.

## Open markers
`PIPE-1` · `ACT-1` · `UFDM2-Q1–Q3` · `MON-1` (real gateway decision) ·
`PROV-2` (keyed/signed event authenticity) · `TEN-1` (multi-tenant prefixes) ·
`CAS-1` (storage-tier compare-and-swap) ·
§5–6 browser/a11y release passes (Irfan-side).
Closed this cycle: `PROV-1` → D-2026-07-19-05 · `SELF-1` → D-2026-07-19-06.
