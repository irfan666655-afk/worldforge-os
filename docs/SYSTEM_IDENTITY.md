# WorldForge OS — System Identity & Structural Thesis

*Synthesized 2026-07-19 from the full tree: src/, test/, build.mjs, docs/decision_log.md, chaos-report, and the shipped artifact.*

## The thesis, in one sentence

**WorldForge OS is a governance engine wearing a creative-pipeline UI: its real product is an unfakeable decision record, and every architectural choice in the tree — single-file artifact, injected seams, frozen shapes, fail-closed law, chaos suite — exists to keep that record trustworthy on hostile ground.**

## What the code actually says it is

Read as syntax, the repo is a project tracker: stages, gates, budgets, assets.
Read as structure, it is four nested trust boundaries:

1. **The kernel** (`worldforge-kernel.v1.1.js`, 1.1.1) owns mutation truth.
   Freshen → mutate → ONE persist. Decisions are append-only, capped, and
   written *atomically with* the state change they justify — you cannot move
   a stage and forget to say why. Gate semantics fire on *leaving* a stage:
   the system taxes exits, not entries, because regret is discovered late.
2. **The ext** (`wfkernel-p2-ext.v1.2.js`, 1.2.1) is the constitution's
   amendments: additive mixin only, the kernel file is never edited by it.
   It contributes the governance vocabulary (promotion, locking, budget,
   UFDM export) and — after the chaos pass — the mutation FIFO that makes
   in-process truth single-threaded (D-2026-07-19-02).
3. **The components** are deliberately powerless. Forge renders; it cannot
   reach the kernel except through the adapter (`--gate` enforces this
   mechanically, not by convention). The override ceremony is the clearest
   statement of identity in the codebase: the *easy* path is refusal, and
   the bypass costs a name and a reason, permanently, rendered next to
   every clean pass. Overrides are not exceptions to governance — they are
   its most important records.
4. **The build** (`build.mjs`) is a notary, not a compiler. Deterministic
   concat, embedded content hash, single-source kernel splice
   (D-2026-07-19-01), verify-by-rebuild. The artifact can prove what it is.

## Frozen invariants (violating any of these is an identity change, not a bug)

- One storage write per mutation; the record lands with the change.
- Ledger entries carry `cost` — `amount` is a detected, rejected shape.
- Fail-closed everywhere money or governance is involved: corrupt rows abort
  billing; unrecordable overrides do not happen; ambiguous gateway = unpaid.
- Fail-loud everywhere recovery is possible: corrupt entries skip with
  events and console noise, never silently.
- Vanilla JS + WAAPI, UMD, zero runtime dependencies (D-2026-07-18-04).
  The artifact must survive `file://` double-click on an offline machine.
- The chaos suite is part of the product. A fix without a probe is a rumor.

## Deep-domain gap analysis

Gaps found in this pass, with conceived solutions; status marks what ships now.

| # | Gap | Solution | Status |
|---|---|---|---|
| G1 | **No recovery tier.** Corruption-at-rest is detected loudly (kernel 1.1.1) but the data is simply lost — detection without restitution. | Shadow-state layer at the *storage seam*: every valid persist also writes a hash-stamped shadow copy; a corrupt primary read auto-rolls back to the last pristine shadow, loudly, with provenance verified before restore. Zero kernel/ext changes — it wraps the adapter. | **SHIPPED** — `src/wf-recovery.v1.js` (D-2026-07-19-04) |
| G2 | **No cryptographic event provenance.** The decision log is append-only by discipline, not by math; a hostile storage tier could rewrite history. | Hash-chain each decision/ledger append (`prev_hash` field, SubtleCrypto SHA-256 with sync-hash fallback); `verifyChain()` walks it. Foundation laid in G1's stamped shadows; full chain is a schema change to frozen shapes → needs its own ratification. | MARKED — `PROV-1` |
| G3 | **Single-tenant state.** `wfproj:` is one namespace; two orgs on one storage tier would interleave. | Tenant prefix derived at kernel construction (`pipeline.storage.tenantKey`), enforced at the adapter seam like the WFKernel gate. Mechanical, but touches every persisted key → migration decision required. | MARKED — `TEN-1` |
| G4 | **The FIFO is in-process only.** Two browser tabs still race at the storage tier (freshen narrows, does not close, the window). | Optimistic concurrency: version counter on the persisted state, compare-and-swap at the adapter, retry-with-freshen on conflict. Needs storage-tier `setIfVersion` — an API the current `window.storage` shim cannot express; record the requirement, do not fake it. | MARKED — `CAS-1` |
| G5 | **Recovery of the artifact itself.** A stale or tampered artifact has no self-check beyond the bundle hash. | Already 90% present: `--verify` recomputes the embedded hash. Remaining 10% is runtime self-verification (artifact hashes its own bundle block on boot, warns on mismatch). Cheap, additive. | MARKED — `SELF-1` |

**Why G1 first:** it is the only gap where the system currently *knows* it lost
user data and can do nothing. Every other gap is a hardening; G1 is restitution.
It also composes: G1's hash-stamped shadows are the substrate G2's chain and
G5's self-check will stand on.

## What this system is not

Not a SaaS backend (the monetization contract is deliberately bundle-excluded
behind MON-1), not a framework, not an agent runtime. It is a *record-keeping
machine for irreversible creative decisions* that happens to be pleasant to
look at. The moment a change makes the record less trustworthy to make the UI
more impressive, that change is against identity.
