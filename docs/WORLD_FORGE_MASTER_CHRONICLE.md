# WORLDFORGE OS — MASTER ARCHITECTURAL CHRONICLE

**Document class:** Principal-architect system chronicle · ground-zero independent derivation
**Repository under analysis:** `D:\worlforge-os` (git `main`, HEAD `eb9e87d`)
**Analysis date:** 2026-07-20
**Method:** full source-tree read (kernel, ext, components, server, build, tests, linters, scripts, decision records) followed by live execution of the entire verification matrix. Every number in Parts II and IV was physically measured on this machine at the time of writing, not copied from prior documentation. Where an existing document disagrees with the disk, the disk wins and the divergence is called out.

---

## TABLE OF CONTENTS

- **Part 0** — Executive abstract
- **Part I** — System ontology & architectural philosophy
  - I.1 What this system actually is
  - I.2 The problem it solves
  - I.3 The four nested trust boundaries
  - I.4 The isolation doctrine — why the engine is deliberately constrained
  - I.5 The frozen invariants
  - I.6 Fail-closed vs. fail-loud: the two-law discipline
- **Part II** — Exhaustive subsystem & feature catalog
  - II.1 Physical measurements (byte weights, LOC, dependency graph)
  - II.2 Tier 0 — the kernel
  - II.3 Tier 1 — the P2 extension
  - II.4 Tier 2 — trust layer (recovery, event chain, boot self-check)
  - II.5 Tier 3 — commercial layer (monetization, payment bridge)
  - II.6 Tier 4 — presentation
  - II.7 Tier 5 — build, notary, and gates
  - II.8 Tier 6 — server plane
  - II.9 Tier 7 — governance data & linters
  - II.10 Tier 8 — orchestration & telemetry
  - II.11 Complete error-code register
- **Part III** — End-user & enterprise implementation manual
- **Part IV** — Production status, testing hygiene, open gaps
- **Part V** — Intellectual expansion layer (independent engineering vision)
- **Appendix A** — Measured file inventory
- **Appendix B** — Live execution transcript summary

---

# PART 0 — EXECUTIVE ABSTRACT

WorldForge OS presents itself as a 3D creative-production pipeline tracker. That is its surface. Structurally it is a **governance kernel**: a small, hard, dependency-free state machine whose actual product is a **decision record that cannot be quietly falsified**, wrapped in a UI pleasant enough that people will actually use it.

The entire tree is organized around one asymmetry: *mutations are cheap, records are expensive to fake*. Every architectural decision in the repository — the single-file artifact, the injected seams, the frozen data shapes, the mutation FIFO, the hash chain, the boot self-check, the notary-style build, the chaos harness — exists to preserve the trustworthiness of that record on hostile ground (a browser, someone else's storage tier, an offline `file://` double-click, a spoofed webhook).

At the time of this chronicle the system is **green across 48 verification lanes, 133 assertions in 6 unit suites, and 9 families of hostile chaos probes, with zero findings**, and ships as a **163,940-byte single HTML file with zero runtime dependencies** that refuses to boot if a single byte of its own executable payload has been altered.

---

# PART I — SYSTEM ONTOLOGY & ARCHITECTURAL PHILOSOPHY

## I.1 What this system actually is

Read the repository as syntax and you see a project tracker: ten pipeline stages, three gates, a budget ledger, an asset library, a 3D guild visualizer.

Read it as *structure* and you see something else entirely. Consider what the code spends its effort on:

- `worldforge-kernel.v1.1.js` has **257 lines**. Roughly a third of them exist purely to guarantee that a decision record lands in the same storage write as the state change it justifies.
- `wf-event-chain.v1.js` contains a **hand-written pure-JS SHA-256** — 158 lines of bit-twiddling — for no reason other than that SubtleCrypto is async and the record-append path is synchronous. The system would rather implement a hash function than let a governance record be appended without provenance.
- `build.mjs` is not a compiler. It has no minifier, no transpiler, no tree-shaker. It is a **notary**: it concatenates in a hand-declared order, computes a content hash, embeds it, and can re-derive it to prove freshness.
- `test/chaos-fuzz.mjs` is 340 lines of attacks against the system's own honesty — spoofed signatures, byte-flipped payloads, forged recovery shadows, racing mutations, corrupt ledger rows.

Nothing here is optimizing for throughput, features, or bundle size. Everything is optimizing for one property: **when this system tells you who decided what, and when, and why, that statement is hard to make false.**

**Thesis (independently derived, and — I note — matching the thesis already recorded in `docs/SYSTEM_IDENTITY.md`, which is itself strong evidence the architecture is legible from the code alone):**

> WorldForge OS is a governance engine wearing a creative-pipeline UI. Its real product is an unfakeable decision record, and every architectural choice in the tree exists to keep that record trustworthy on hostile ground.

## I.2 The problem it solves

The domain is AI-assisted creative production — ten stages from `Ideation → Film Bible` through `Learning`, with generation budget burned irreversibly at stages 5–8. The concrete failure modes of that domain are:

1. **Irreversible spend without a recorded justification.** A model-generation batch is money that does not come back. Six weeks later nobody remembers who approved it or on what basis.
2. **Silent reversal.** Someone steps a project back a stage to redo work. The reason evaporates; the same mistake is re-made.
3. **Gate theatre.** Checkpoints exist, everyone clicks through them, and the checkpoint records nothing — so the checkpoint is decoration.
4. **Untraceable promotion.** An asset becomes canon. Nobody can reconstruct which version, verified how, approved by whom.

The system's answer is structural rather than procedural. It does not ask people to be disciplined; it makes the undisciplined path *mechanically unavailable*:

- `stepBack()` **throws** without a reason string. Not warns — throws (`kernel:222`).
- `advance()` past a gated stage **returns `{ok:false, reason:'gate'}`** unless the caller passes an explicit `gatePassed` or `override` (`kernel:204`).
- An override **throws** without a reason (`kernel:207`), and the resulting record is rendered in the decision list next to every clean pass, in its own warning color (`shell.html:146`).
- `promoteAsset()` re-runs the rule evaluator **at commit time**, never trusting a stale UI evaluation (`ext:485`).

And the single most revealing design choice in the codebase:

**Gates fire on *leaving* a stage, not entering it** (`kernel:202`, marked "frozen semantics"). The system taxes exits because regret is discovered late. You do not know a previz was inadequate when you start previz; you know it when you are about to spend generation budget on it.

## I.3 The four nested trust boundaries

The tree is a set of concentric rings, each with strictly less authority than the one inside it. This is enforced mechanically, not by convention.

```
┌──────────────────────────────────────────────────────────────┐
│ RING 3 — BUILD / NOTARY  (build.mjs)                         │
│  deterministic concat · embedded content hash · verify-by-    │
│  rebuild · per-block self-check hashes                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ RING 2 — COMPONENTS  (forge, ufdm-visual, gate-override,  │ │
│ │  escalation-viz, text-roster) — DELIBERATELY POWERLESS   │ │
│ │  zero storage calls · zero kernel globals · one seam      │ │
│ │ ┌──────────────────────────────────────────────────────┐ │ │
│ │ │ RING 1 — EXT  (wfkernel-p2-ext.v1.2.js @ 1.2.1)      │ │ │
│ │ │  additive mixin · never edits the kernel file ·      │ │ │
│ │ │  contributes governance vocabulary + mutation FIFO   │ │ │
│ │ │ ┌──────────────────────────────────────────────────┐ │ │ │
│ │ │ │ RING 0 — KERNEL  (worldforge-kernel.v1.1.js@1.1.1)│ │ │ │
│ │ │ │  owns mutation truth · freshen→mutate→ONE persist │ │ │ │
│ │ │ │  append-only capped decisions · gate-on-leaving   │ │ │ │
│ │ │ └──────────────────────────────────────────────────┘ │ │ │
│ │ └──────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Ring 0 — the kernel owns mutation truth.** Every mutator follows `freshen → mutate → ONE storage.set`. The record and the change it justifies land in the *same* write. There is no code path that moves a stage and then separately writes a reason — so there is no code path where the second write can fail and leave the first standing.

**Ring 1 — the ext is the amendments, never a rewrite.** `wfkernel-p2-ext.v1.2.js` is a pure additive mixin. It reads (`ext:143`) `kernel.persist || kernel.saveProject || kernel.save || kernel._persist` and falls back to the injected storage adapter if none exist. Its own change log documents six `VERIFY(kernel-src)` markers burned against the real kernel — including a genuine bug it found in itself: v1.1 wrote to storage *without* the `shared=true` flag while the kernel wrote *with* it, silently splitting personal and shared scopes (`ext:R3`). The mixin discipline is why that was findable: the kernel file was never touched, so the divergence was between two readable statements rather than inside one edited file.

**Ring 2 — the components cannot reach the kernel.** `components/forge.js` — 261 lines of the primary UI — contains **zero** storage calls and **zero** kernel references. It receives an adapter. And this is not a code-review promise; it is a build gate:

```js
/* build.mjs --gate */
if (/window\s*\.\s*WFKernel/.test(line)) offenders.push(...)
// every src/**/*.{js,html} except kernel-adapter.js
```

Run today: `OK: global-scope gate clean — kernel access confined to kernel-adapter.js`.

The clearest identity statement in the entire codebase lives in this ring — `wf-gate-override.v1.js`. The override ceremony is designed so that **the easy path is refusal**. The bypass costs a name and a reason, permanently, rendered next to every clean pass. And if no decision-write seam can be found at runtime, the component does not fall back to advancing anyway; it prints `FATAL: no kernel decision-write seam found` and refuses (`wf-gate-override:108-113`). *An unrecordable override does not happen.* Overrides are not exceptions to governance here — they are its most important records.

**Ring 3 — the build is a notary.** Deterministic, hand-ordered manifest ("Explicit order = deterministic build. Never glob."), a content hash folded over bundle + CSS + kernel, and `--verify` that rebuilds and compares. The artifact can prove what it is.

## I.4 The isolation doctrine — why the engine is deliberately constrained

The system observes a strict rule that took me a while to name precisely: **capability is admitted only where it is structurally necessary, and never inward.**

Three separate enforcement mechanisms implement this:

**(a) Bundle exclusion as a security boundary.** `src/wf.monetization.v1.js` (9,926 B, a complete billing contract) and `src/wf-payment-bridge.v1.js` (7,788 B, HMAC webhook verification) both exist, both are fully tested — and **neither appears in `build.mjs`'s manifest**. I verified this directly against `CONFIG.manifest` (13 entries, neither module present). The artifact therefore physically cannot process payments, because the code is not in it. The monetization module's own header states the condition for entry: *"The module is NOT in the browser bundle manifest. It enters the artifact only after a real-gateway decision is recorded here (marker MON-1)."* Bundle membership is a ratification-gated privilege.

**(b) Zero runtime dependencies (D-2026-07-18-04).** Vanilla JS, UMD, WAAPI. Framer Motion was requested and formally **declined** with a recorded decision, because it is a React library and would conflict with the frozen architecture. `wf-ufdm-visual.v1.js` then delivers the same motion language — spring entrances, animated bar fills, count-up numerals, lock-chip pulse — in 10,130 bytes of Web Animations API calls. The requirement this protects: *the artifact must survive `file://` double-click on an offline machine.* Every dependency is a network call at the worst possible time.

**(c) The single-seam rule.** One module touches `window.WFKernel`. One module (`app.js`) decides 3D vs. fallback — "components never probe capabilities" (`app.js:3`). One degradation path with two triggers (WebGL missing OR CDN dead). Reducing the number of places a decision can be made is itself a governance act: fewer places to disagree, fewer places to lie.

The philosophy underneath all three: **a governance record is only as trustworthy as the least trustworthy thing that can write it.** So the number of things that can write it is kept absurdly small, and each one is individually justified.

## I.5 The frozen invariants

These are marked in-source as frozen. Violating one is an identity change, not a bug fix.

| # | Invariant | Where enforced | Consequence of violation |
|---|---|---|---|
| **F1** | One storage write per mutation; the record lands with the change | `kernel:95-99`, every mutator | A stage could move without its reason |
| **F2** | Ledger entries carry **`cost`**, never `amount` | `ext:284`, `monetization:45`, `bridge:101-106`, `ufdm-visual:119` | Money becomes invisible to the summing tier |
| **F3** | Gates fire on **leaving** a stage | `kernel:202` | Regret would be taxed before it is discoverable |
| **F4** | Decisions are append-only, capped at 100 | `kernel:69,85` | Unbounded growth, or history rewriting |
| **F5** | Fail-closed where money or governance is involved | monetization, bridge, recovery, override | The system would guess about consequential things |
| **F6** | Fail-loud where recovery is possible | `kernel:132-138`, `ext:288`, `recovery:57` | Data would vanish silently |
| **F7** | Vanilla JS + WAAPI, UMD, zero runtime deps | D-2026-07-18-04 | Offline `file://` operation lost |
| **F8** | The chaos suite is part of the product | `test/chaos-fuzz.mjs` | *"A fix without a probe is a rumor."* |
| **F9** | A queued method must never call another queued method | `ext:193` | Instant FIFO deadlock |

**On F2 specifically** — the `cost`/`amount` invariant recurs in *five separate modules* and has its own dedicated fuzz probe (`[ok] processor 'amount' never survives into governance records`). This is not pedantry. Chaos finding #2 (2026-07-19) was `reserveBudget` writing `{amount}`: the visual tier sums only `cost`, so budget reservations were **invisible** and the burnstrip rendered `NaN`. A vocabulary drift of one word made the money display lie. The payment bridge now performs the translation explicitly at the trust boundary — processor `amount` (minor units) → governance `cost` (major units) — and `PAY-06` refuses the event outright if *both* fields are present: `"ambiguous money — refused, never guessed."`

## I.6 Fail-closed vs. fail-loud: the two-law discipline

The most sophisticated philosophical machinery in this codebase is that it does **not** apply a single error policy. It applies two, and the choice between them is principled:

> **Fail CLOSED** when continuing would produce a *false record*.
> **Fail LOUD** when continuing preserves an *incomplete but honest* record.

Worked examples from the tree:

| Situation | Policy | Reasoning |
|---|---|---|
| Corrupt row in `metering_ledger` | **CLOSED** — invoicing aborts entirely (`monetization:156`) | A partial invoice is a *wrong number on a bill* |
| Corrupt row in `budget_ledger` | **LOUD** — row excluded, counted in `summary.corrupt`, console-errored (`ext:282-288`) | A budget display is advisory; killing the whole UI over one bad row is worse |
| Corrupt project entry on load | **LOUD** — skipped with `console.error` + `corrupt-entry` event + count on the `loaded` event (`kernel:132-138`) | One bad row must not take the floor down — but a project vanishing silently is unacceptable (this was chaos finding #5) |
| Corrupt value being **written** | **CLOSED** — the write throws, nothing lands (`recovery:71-74`) | A corrupt transaction must never reach durable storage |
| Corrupt value being **read**, shadow valid | **RECOVER, LOUDLY** (`recovery:91-105`) | Restitution is possible and provenance is verifiable |
| Corrupt read, shadow *forged* | **CLOSED, loud null** (`recovery:97-100`) | *"Recovery never guesses"* — inventing state is worse than absence |
| Gateway response null/ambiguous | **CLOSED** — treated as NOT charged (`monetization:194`) | Assuming success on ambiguity invents revenue |
| Asset fingerprint, no reader injected | **TRI-STATE `unverifiable`** (`ext:406-415`) | Never a false pass, never a false fail |
| Boot self-check *cannot run* (no SubtleCrypto) | **BOOT with loud warning** (`shell.html:332`) | *"Inability to verify is not evidence of tampering"* — bricking an honest offline artifact is the worse failure |
| Boot self-check *runs and fails* | **CLOSED** — full-screen tamper notice, boot refused (`shell.html:317-326`) | *"A decision record written by an unverifiable artifact cannot be trusted"* |

The tri-state `unverifiable` and the SubtleCrypto-absent branch are the tells of genuine engineering maturity. A less careful system would collapse both into booleans and would either brick honest users or wave through tampered ones.

---

# PART II — EXHAUSTIVE SUBSYSTEM & FEATURE CATALOG

## II.1 Physical measurements

All figures measured on disk 2026-07-20, excluding `node_modules/`, `__pycache__/`, `.git/`, worktrees, and `.zip` archives.

### Aggregate weights

| Area | Bytes | Notes |
|---|---:|---|
| `src/` (js + css) | **158,629** | 17 modules |
| `test/` | **58,332** | 7 suites |
| `scripts/` | **33,752** | 5 tools |
| `docs/` (md only) | **24,165** | excludes 272,826 B of PDF blueprints |
| **Shipped artifact** `worldforge-os_5.html` | **163,940** | single file, zero deps |
| `shell.html` (pre-bundle template) | 21,935 | markers only, no payload |
| Governance data (roster + schema + rules + maps) | 40,767 | canonical JSON |
| Python governance tooling | 27,265 | `lint_worldforge.py` + `gen_rules.py` |

### Line counts of load-bearing files

| File | Lines |
|---|---:|
| `src/wfkernel-p2-ext.v1.2.js` | 547 |
| `lint_worldforge.py` | 434 |
| `test/chaos-fuzz.mjs` | 340 |
| `worldforge-kernel.v1.1.js` | 257 |
| `build.mjs` | 209 |
| `gen_rules.py` | 147 |

### Per-module weights (`src/`, descending)

| Module | Bytes | Ring | In bundle? |
|---|---:|---|---|
| `wfkernel-p2-ext.v1.2.js` | 30,066 | 1 | ✅ |
| `wf-ufdm-components.v1.js` | 12,170 | 2 | ✅ |
| `components/forge.js` | 11,518 | 2 | ✅ |
| `components/escalation-viz.js` | 11,395 | 2 | ✅ |
| `guilds-data.js` | 10,996 | data | ✅ |
| `wf-ufdm-visual.v1.js` | 10,130 | 2 | ✅ |
| `src/server.js` | 9,948 | 6 | ❌ server-only |
| `src/app.js` | 9,938 | 2 | ✅ |
| `wf.monetization.v1.js` | 9,926 | 3 | ❌ **MON-1 gated** |
| `wf-payment-bridge.v1.js` | 7,788 | 3 | ❌ server-only |
| `wf-event-chain.v1.js` | 7,733 | 2 | ✅ |
| `wf-gate-override.v1.js` | 6,100 | 2 | ✅ |
| `wf-recovery.v1.js` | 5,651 | 2 | ✅ |
| `components/text-roster.js` | 5,644 | 2 | ✅ |
| `wf-ufdm-visual.v1.css` | 3,384 | 2 | ✅ (inlined) |
| `kernel-adapter.js` | 2,431 | 2 | ✅ **sole seam** |
| `vendor-loader.js` | 2,244 | 2 | ✅ |
| `env-validation.js` | 1,567 | 6 | ❌ server-only |

### Build integrity fingerprints (live, this session)

```
WF-BUNDLE-HASH   sha256:529777fc753de81e4de752b2fe6dc7df5794a7cd3a9ebaa6059a28b08877a051
__WF_SELFCHECK__ bundle: 53a7869804bfd588e480daa1d17d1be9333de2fdbc0e0f5397be64b8f91b546a
                 kernel: 4f7ba5aedb88284e1be675a9f475e851c714d5e5dd1a89804d559a88ca825a62
```

Three distinct hashes, by design. The `WF-BUNDLE-HASH` is a *folded determinism hash* over `body + CSS + kernel` — it proves the build is fresh but cannot be reconstructed at runtime (the runtime cannot see the CSS as the builder concatenated it). The two `__WF_SELFCHECK__` hashes are **per-block** hashes the runtime *can* rebuild from its own `<script>` `textContent`. The comment at `build.mjs:180-183` records why both exist:

> *"BOTH executable blocks are covered — a kernel-only tamper booting clean was the negative-test finding that forced the second hash."*

A negative test found a real hole (bundle-only hashing let a tampered kernel boot), and the fix is documented at the site of the fix. This is exactly the hygiene the rest of the tree claims to have.

### Dependency graph (browser artifact)

```
                     ┌──────────────────┐
                     │  window.storage  │  (host API, may be absent)
                     └────────┬─────────┘
                              │
                  ┌───────────▼────────────┐
                  │  wf-recovery.v1.js     │  shadow/rollback wrapper
                  └───────────┬────────────┘
                              │ (same adapter object, one instance)
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐   ┌────────▼─────────┐  ┌────────▼──────────┐
│ kernel-adapter │──▶│ worldforge-kernel│◀─│ wfkernel-p2-ext   │ (mixin)
│ (SOLE SEAM)    │   │      v1.1.1      │  │      v1.2.1       │
└───────┬────────┘   └──────────────────┘  └────────┬──────────┘
        │                                            │ wraps recordDecision
        │                                   ┌────────▼──────────┐
        │                                   │ wf-event-chain.v1 │ SHA-256 chain
        │                                   └───────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│  app.js  — sole mode decider, sole component wirer            │
└───┬────────────┬────────────┬──────────────┬─────────────────┘
    │            │            │              │
┌───▼───┐  ┌─────▼──────┐ ┌───▼──────────┐ ┌─▼──────────────┐
│ forge │  │ufdm-visual │ │gate-override │ │ escalation-viz │
└───────┘  └────────────┘ └──────────────┘ └───┬────────────┘
                                                │
                                        ┌───────▼────────┐
                                        │ vendor-loader  │─▶ Three.js r128 CDN
                                        └───────┬────────┘     (8s timeout)
                                                │ on failure
                                        ┌───────▼────────┐
                                        │  text-roster   │  (fallback)
                                        └────────────────┘
```

Excluded from this graph by construction: `wf.monetization.v1.js`, `wf-payment-bridge.v1.js`, `env-validation.js`, `server.js`.

## II.2 Tier 0 — The kernel (`worldforge-kernel.v1.1.js` @ 1.1.1, 11,539 B, 257 lines)

UMD module exporting `{ KERNEL_VERSION, PROJECT_SCHEMA_VERSION, createKernel }`.

### Construction contract

```js
createKernel({ storage, pipeline, actor })
```

- `storage` — **required**; throws without `get`/`set`. Async adapter: `get(k,shared)`, `set(k,v,shared)`, `delete(k,shared)`, `list(prefix,shared)`.
- `pipeline` — **required**, ≥2 stages; throws otherwise. Carries `stages`, `gates` (index → def), `storage.{projectPrefix, legacyKey, profileKey}`, `budget.currency`.
- `actor` — string or `() => string`. The function form is what allows the gate-override modal to set the actor name *immediately before* the record is written (`app.js:141-147`).

Six deliberate divergences from the original inline monolith are logged in-header as `ED-1`…`ED-6`: storage injection, constant derivation, gate semantics, actor seam, pipeline injection, versioning. **Every extraction difference is a documented decision, not drift.** This is uncommon and worth naming — most extractions lose their rationale within a week.

### Storage key scheme

| Key | Scope | Purpose |
|---|---|---|
| `wfproj:<id>` | shared | one project, whole state |
| `worldforge-projects-v1` | shared | legacy pre-migration blob |
| `worldforge-profile-v1` | **personal** | actor name |
| `wfshadow:wfproj:<id>` | shared | recovery tier (added by Ring 2) |

Note the `shared=false` on the profile key. The forger's name is personal; the floor is shared. That distinction cost a real bug (`ext` R3) when the ext forgot the flag.

### Mutation set

| Method | Gate/precondition | Records | Persists |
|---|---|---|---|
| `createProject({name,type})` | `name` required (throws) | — | 1 |
| `advance(id, gateResult)` | gate on **leaving**; `{gatePassed}` or `{override,reason}` | `gate-pass` / `gate-override` | 1 |
| `stepBack(id, reason)` | **reason required (throws, Rule 7)** | `step-back` | 1 |
| `saveNotes(id, text)` | — | — | 1 |
| `deleteProject(id)` | — | emits `delete-unsynced` on failure | delete |

`advance()`'s return shape is a discriminated result, not an exception: `{ok:false, reason:'gate'|'complete', gate, project}`. The UI in `forge.js:144-164` uses exactly this — attempt, catch the gate, open the modal, re-attempt with the result. The failure path is a first-class, ordinary path.

### Hydration & migration

`loadProjects()` lists by prefix, `Promise.allSettled`s the gets (one slow key cannot stall the floor), parses each. On zero keys it attempts one-time legacy migration, upgrading unstamped records to `schemaVersion: 2` best-effort per project. On a listing failure it *also* falls back to migration, then to `[]`. Three layers of graceful degradation, none silent — the terminal `loaded` event always carries `{count, corrupt}`.

### Concurrency primitive: `freshen()`

```js
// Re-read right before mutating: stale local copies never clobber
// someone else's newer stage/notes/decisions.
```

Every mutator calls it first. This is honest last-writer-wins with a narrowed window — and the tree is explicit that it is *narrowed, not closed* (gap `CAS-1`). It does not claim transactionality it does not have.

### Decision record shape (frozen)

```js
{ ts: Number, by: String, kind: String, label: String, note: String }
```

Capped at 100, sliced from the tail. Kinds: `gate-pass`, `gate-override`, `step-back`.

### Error handling

- Listener exceptions are swallowed with an explicit comment — *"listener errors never break the kernel"* (`kernel:78`). A hostile subscriber cannot wedge governance.
- `persist()` throws `persist-failed` on a falsy adapter return — the mutation propagates the failure to the caller rather than reporting success.
- Corrupt entries: loud skip (see I.6).

## II.3 Tier 1 — The P2 extension (`src/wfkernel-p2-ext.v1.2.js` @ 1.2.1, 30,066 B, 547 lines)

The single largest module in the tree, and the constitutional amendments layer. `install(kernel, opts)` where `opts.pipeline` and `opts.roster` are **required** (throws) and `storage`, `rules`, `readAssetBytes`, `digest` are optional seams.

### II.3.1 The mutation FIFO — the most important 12 lines in the repository

```js
var _mutTail = Promise.resolve();
function enqueue(fn) {
  var run = _mutTail.then(fn, fn);
  _mutTail = run.then(function () {}, function () {});
  return run;
}
kernel._p2Enqueue = enqueue;
```

Note `_mutTail.then(fn, fn)` — the same handler on both fulfil and reject. **A failed operation rejects to its own caller but never wedges the queue.** The tail is then separately swallowed. Twelve lines, and they close two proven lost-write races:

1. `freshen()` re-reads storage and *replaces* the in-memory project object while an in-flight ext mutation holds the old reference — whichever persists last silently wins.
2. `loadProjects()` wholesale-replaces the projects array while a concurrent `createProject()` is mid-flight — the new project vanishes from memory. (Browser-proven: users saw "Save failed" on first use.)

Twelve operations are wrapped, and the wrap is applied at the **very end of `install`** so it covers ext methods too: `loadProjects, createProject, advance, stepBack, saveNotes, deleteProject, updateBudget, registerAsset, lockAsset, unlockAsset, promoteAsset, importUFDM`.

**The maintainer law (F9), stated in-source:** *a queued method must never call another queued method* — it deadlocks the tail. Un-queued callers (`reserveBudget`, `recordGateOverride`) may call queued ones. This is exactly the kind of invariant that is invisible in a diff and catastrophic in production, and it is written down at the enqueue site, in the decision log (D-2026-07-19-02), and in the project memory. Correctly treated as a first-class hazard.

**Honest scope:** this is in-process only. Two browser tabs still race at the storage tier. Recorded as gap `CAS-1`, not papered over.

### II.3.2 Eventing — the chained subscription fix

v1.1 did `kernel.subscribe || fallback`, which left ext-originated events invisible to kernel subscribers: **two disjoint channels**, a class of bug where half your events silently do not arrive. v1.2 chains them — one `subscribe()` registers for both, and the returned unsubscribe severs both. Async mutators notify *after* completion, because with the FIFO in place the state a subscriber reads must already contain the mutation it was told about.

### II.3.3 Budget subsystem

Frozen ledger entry: `{stage_id, actor, action, cost, ts}`. `getBudgetSummary()` walks `budget_ledger`, treats an `action` with a `reserve:` prefix as *reserved* rather than *spent*, tolerates legacy `amount` on read, counts corrupt rows without dying (fail-loud), and returns `{start, spent, reserved, corrupt, available, currency}`. `reserveBudget(amount,label)` refuses overdraw against `available`.

### II.3.4 Asset ledger

`registerAsset` (required `id`/`type`/`name`, duplicate-id refused), `lockAsset`, `unlockAsset` (**reason required — Rule 7**, and the unlock writes a `asset-unlock` decision record). `verifyAssetFingerprint(id)` is the tri-state verifier: `verified` | `mismatch` | `unverifiable` | `error`. It returns `unverifiable` rather than guessing when no byte-reader is injected, no fingerprint is recorded, or no digest implementation exists in the runtime.

### II.3.5 Rule evaluator (`rules.v1.json` DSL)

Three predicates — `missing_field`, `impact_gte`, `asset_unlocked_promotion` — evaluated over a context. Three fail-closed behaviors worth naming:

- **Rules not loaded** → `RULES-MISSING`, severity `error`, promotion blocked.
- **Unknown predicate id** → finding of severity `error` ("regenerate ext or rules"). A rules file newer than the ext blocks promotions rather than silently skipping checks.
- **Bootstrap provenance** → `RULES-PROVENANCE` warning if `rules.source === 'bootstrap'`, marking the evaluation advisory-only.

That third one is subtle and excellent: the evaluator *knows whether its own rules came from the authoritative linter or a fallback table*, and says so in its output.

### II.3.6 `promoteAsset` — the transactional ceremony

Six ordered stages, each with its own failure `stage` label:

1. `lookup` — unknown asset
2. `schema` — reason required (Rule 12: *no silent promotion*), actor required
3. `rules` — **commit-time re-run**; never trust a stale UI evaluation
4. `gov2` — if `GOV-2` fired (high impact), a second `approver` is required
5. record the decision — *before* the mutation, atomic with it
6. promotion log + lock + **single persist**

Returns `elapsed_ms` with the comment `design law: clean path < 10s`. The system budgets the *human* ceremony, not just the machine.

### II.3.7 UFDM export / validate / import

`exportUFDM()` emits a v1.0.0 document with kernel version, ext version, full project, stages, agents, assets, the merged decision log, and a budget summary. `validateUFDM(doc)` is **validate-all-report-all**, never fail-fast: it accumulates every problem — version, project id, stage count, **canonical stage-sequence equality**, roster membership of every `decision_log[i].actor` (allowing the literal `'human'`), and asset ids. `importUFDM` validates then does an atomic single-persist reconstruct.

The stage-sequence check is the interesting one: an imported document whose pipeline differs from canon is rejected. A decision record only means something relative to the pipeline it was made in.

### II.3.8 The burned markers

Two markers were resolved in this file, and both resolutions changed a *contract*, not just an implementation:

- **UI1-K1** — the kernel's decision-write for a gate override *is* `advance(id,{override:true,reason})`. Record and stage move are ONE mutation, ONE persist. `recordGateOverride` is therefore a thin alias, and **when its promise resolves the stage has already advanced** — so `onDone` refreshes, never advances again. It rejects loudly on an ungated stage, because an ungated advance masquerading as an override would record nothing.
- **Step 4.4 read seams** — `getLedger`, `getDecisions`, `getBudget`. Without them every visual panel rendered empty: the names the component probed did not exist on the real ext. `getDecisions` merges the kernel's `decisions` (numeric ts, `by`/`kind`/`label`/`note`) with the P2 `decision_log` (ISO ts, `actor`/`kind`/`reason`) into one normalized, time-sorted view — the storage-level separation holds; the merge is a *view*.

## II.4 Tier 2 — The trust layer

### II.4.1 `wf-recovery.v1.js` (5,651 B) — restitution at the storage seam

Wraps the injected adapter. Kernel, ext, and monetization are all untouched and unaware.

- **WRITE** — a guarded key whose value does not parse as a JSON object **throws**. Fail-closed: a corrupt transaction never lands. After the primary persists, a hash-stamped shadow `{h, v, ts}` is written to `wfshadow:<key>`.
- **READ** — a guarded primary that fails to parse triggers rollback: the shadow's FNV-1a hash is **re-verified first**, the primary is rewritten from it, the event is loud, and the caller transparently receives recovered state (`{recovered:true}`).
- **Forged shadow** → loud null. **Missing shadow** → loud null. *"Recovery never guesses."*
- `list()` filters shadow keys out, so the tier above never sees its own safety net.
- Shadow-write failure is non-fatal (the primary landed; a missing shadow only narrows future recovery) but still loud.

**Honest scope, stated in-header:** FNV-1a is *integrity* provenance — bit-rot, truncation, partial writes — not cryptographic tamper-proofing. That was escalated separately as G2/PROV-1.

**Why this gap was closed first:** it was the only gap where the system *knew* it had lost user data and could do nothing. Everything else was hardening; this was restitution. It also composes — the hash-stamped shadows are the substrate the event chain and boot self-check now stand on.

### II.4.2 `wf-event-chain.v1.js` (7,733 B) — tamper-evident history (G2 / PROV-1)

Every record appended through `recordDecision` is stamped `_chain = {seq, prev, hash}` where `hash = SHA-256(prevHash + "|" + canonical(record))`.

Three implementation decisions carry the weight:

1. **Pure-JS SHA-256.** SubtleCrypto is async-only in browsers and the record path is synchronous. Rather than make the append async (and thereby introduce a window between mutation and record), the module implements SHA-256 in 60 lines. Verified against Node's crypto on **13 vectors including multi-block inputs and surrogate pairs**.
2. **Canonical serialization** with stable key order that **excludes `_chain` itself** — so a record's hash never depends on itself, and the frozen decision shape is untouched.
3. **`verifyEventChain()` returns the exact break index and reason** — distinguishing `unchained record (inserted without the chain)`, `prev-hash link broken (reorder/delete)`, and `content altered after signing`.

**Honest scope, again stated in-header:** this is keyless tamper-*evidence*. An attacker who controls all bytes and recomputes the entire chain forward defeats it. Keyed authenticity is marker `PROV-2`. The value delivered is that **any partial edit is caught** — and partial edits are what actually happen.

### II.4.3 Boot self-check (G5 / SELF-1 — `shell.html:295-357` + `build.mjs:180-206`)

The build stamps per-block SHA-256 hashes of the bundle body and the kernel body into `window.__WF_SELFCHECK__`. At boot, before `WF.app.boot()`, the artifact recomputes both from its own `<script data-wf="...">` `textContent` and compares.

- Mismatch → full-screen `ARTIFACT INTEGRITY FAILURE`, boot **refused**, exception thrown.
- Missing hashes or missing tagged blocks → warn, boot.
- No SubtleCrypto / no `TextEncoder` / digest failure → warn, boot.

The reconstruction is fussy in exactly the right way — it strips the `"use strict";` prologue from the bundle and the splice template's single leading/trailing newline from both blocks, because it must reproduce *byte-for-byte* what the builder hashed.

I want to flag the negative-test finding again because it is the strongest evidence of testing culture in this repo: **bundle-only hashing booted a tampered kernel clean.** Someone deliberately tampered with the kernel block to check the check, found it passed, and added the second hash. Most self-check implementations never get audited by their own author.

## II.5 Tier 3 — Commercial layer (bundle-excluded)

### II.5.1 `wf.monetization.v1.js` (9,926 B) — FROZEN billing contract v1

Its own `metering_ledger`, distinct from `budget_ledger` and both decision ledgers. R6-style separation with a one-line justification that is genuinely clarifying: *money spent making the thing vs. money owed for using the thing.*

- `validateEntry` **throws on the literal presence of an `amount` key** (`"frozen shape violation"`), requires a `meter:`-prefixed action, an actor (*"Rule 7 — usage is attributable"*), finite `cost >= 0`, numeric `ts`.
- **Rate-table defense.** The caller's rates object is validated, **copied, and `Object.freeze`d**. The comment: *"the caller's object is NOT the contract. Holding the reference would let anyone with it re-rate (or zero-rate) billing after install."* This is a capability-leak defense, chaos-probed. Most billing code holds the reference.
- `getUsageSummary()` **aborts on any corrupt row** (fail-closed — billing never guesses), naming the row index.
- `invoice()` is deterministic: same ledger → same `invoice_id`, always.
- `charge(invoice)` **recomputes the invoice from the ledger and compares** — id, total, and line items — *before* the gateway sees anything. Tampered → refused. Zero total → refused. Gateway response not exactly `{ok:true, receipt_id:String}` → **"treated as NOT charged"**. `res.charged !== fresh.total` → treated as failed.
- Joins the ext's FIFO via `kernel._p2Enqueue`, with a local tail fallback so the serialization law holds even if a bare kernel is injected in tests.
- The default gateway is a **deterministic mock** that receipts and moves no money.

### II.5.2 `wf-payment-bridge.v1.js` (7,788 B) — MON-1 server bridge

Explicitly server-only, explicitly absent from the manifest. What it is: *the verification and provenance half of a payment integration*. What it is not, in its own words: *"it moves no money, calls no processor API, and holds no card data."*

- **`verifySignature`** — Stripe-scheme: header `t=<unix>,v1=<hex64>`, HMAC-SHA256 over `` `${t}.${rawBody}` ``, `crypto.timingSafeEqual` **with a length check first** (timingSafeEqual throws on length mismatch — a real footgun, handled), 300-second replay window.
- **`normalizeProcessorEvent`** — the vocabulary translation boundary. Accepts Stripe-shaped (`data.object.amount`, minor units) or pre-normalized (`cost`, major units). Both present → `PAY-06` refused. Neither → `PAY-06` refused. Currency must be a 3-letter code. Output carries `cost` only.
- **`ingest`** — duplicate scan and `recordDecision` append are **one synchronous block with no `await` between them**, so concurrent ingests of the same id cannot both pass the scan. The record flows through the kernel's chained `recordDecision`, so verified payments are hash-chained like any other governance record and persisted once.
- A deterministic `txHash` computed with the *same* primitive and canonicalization as the G2 chain — provenance is one system, not two.

## II.6 Tier 4 — Presentation

| Module | Bytes | Role |
|---|---:|---|
| `app.js` | 9,938 | Sole mode decider, sole wirer. Owns `GATE_AFTER` (gates at stages 4, 5, 8). Boot order: storage → recovery wrap → adapter → ext → chain → mode → mounts. |
| `components/forge.js` | 11,518 | The forge floor. Zero storage calls, zero kernel refs. Project list, stage rail, decision render, gate modal, new-project modal, toast. |
| `wf-ufdm-visual.v1.js` + `.css` | 13,514 | Live governance surface: Budget (count-up + animated burn bar), Locked assets (lock chips with fingerprint prefix, pulse on state change), Decision chain, Verified payments. WAAPI only. |
| `wf-ufdm-components.v1.js` | 12,170 | `WFComponent` base contract (mount/update/destroy) + derived budget categorization (`vision`/`video`/`motion`/`other`) — **category is derived, never stored**. |
| `wf-gate-override.v1.js` | 6,100 | The override ceremony. Escapes all interpolated text. `REASON_FLOOR = 10` chars, advisory (*"write it for the reviewer, not the checkbox"*). |
| `components/escalation-viz.js` | 11,395 | Three.js guild/escalation scene. |
| `components/text-roster.js` | 5,644 | Non-3D fallback roster. |
| `vendor-loader.js` | 2,244 | Three.js r128 CDN load, 8s timeout, `async` script, WebGL probe deliberately Three-free. Fires `wf:vendor-fallback`. |
| `guilds-data.js` | 10,996 | 10 canonical STAGES + 8 guilds / 48 agents. |

**The 10 canonical stages:** `Ideation → Film Bible`, `Story & Character`, `Cinematography Design`, `Production Planning`, `Scene Simulation`, `Model Routing & Budget Check`, `Prompt Compilation`, `Model-Specific Generation`, `Validation & Repair`, `Learning`.

**The 3 gates**, and note precisely where they sit:

| Fires on leaving | Gate | Doctrine |
|---|---|---|
| 4 · Scene Simulation | Previz gate — has a cheap draft been produced *and explicitly approved*? | Rule 3 |
| 5 · Model Routing & Budget Check | Budget & routing — does budget cover this batch, were routed models verified current (not deprecated)? | Rules 3 & 11 |
| 8 · Validation & Repair | Validation — every shot passed tiered validation and fingerprint diff against locked canon. *"A failure gets targeted re-generation, not a blanket pass."* | Rule 4 |

All three sit immediately before or immediately after irreversible generation spend. The gate placement is the domain model.

Two presentation-layer defenses worth calling out:

- **XSS discipline.** `forge.js` escapes via `document.createElement('div').textContent` round-trip; `wf-ufdm-visual` and `wf-gate-override` use explicit entity-map escapers. Every user-controlled string in the decision record — actor names, reasons, project names — passes through one of them. A governance record whose reason field can execute script is not a governance record.
- **`ingestServerEvents`** on the visual tier validates every incoming server event and **refuses any object carrying `amount`**, loudly. The display tier enforces the frozen vocabulary at its own boundary rather than trusting the server.

## II.7 Tier 5 — Build & gates (`build.mjs`, 10,602 B, 209 lines, zero dependencies)

Six commands: `--inventory`, `--xrefs`, `--gate`, `--deadcheck`, `--bundle`, `--verify`.

Four design decisions worth recording:

1. **Explicit manifest, never glob.** 13 entries in a hand-chosen order. Determinism is the point; a directory listing is not a specification.
2. **Function replacer, never string.** `build.mjs:198-199`: *"replacement STRINGS interpret `$`-patterns (`$&`, `$1`…), and bundled source may legitimately contain them. Never splice with a string."* This was a real bug (referenced in the handoff as "the $-splice bug"), and the fix is annotated at the fix site.
3. **Single-source kernel splice (D-2026-07-19-01).** The shell used to carry a hand-synced inline kernel copy. A kernel fix demonstrably failed to reach the artifact through the duplicate. The build now splices from the file and folds it into the hash. Duplication of a source of truth is treated as an architectural defect, and the correction is a ratified decision.
4. **UMD/IIFE shape warning** on every manifest entry that does not look wrapped — advisory, not fatal.

`--deadcheck <name>` deserves a mention: it reports `DEAD: <name> — zero references. Safe to delete; write the decision record.` The tooling itself prompts for the governance act.

## II.8 Tier 6 — Server plane (`src/server.js`, 9,948 B)

Express app, exported as `module.exports = app` for serverless, `app.listen` guarded by `require.main === module`.

**Ordering as a security property.** The webhook route is registered with `express.raw({type:'*/*'})` **before** `app.use(express.json())`. HMAC verification needs the exact bytes the processor signed, not a re-serialized parse. Route-registration order in Express is a correctness requirement here, and it is commented as such.

**Real governance kernel on the server.** `governance()` builds the *same* kernel + ext + G2 chain the artifact runs, on a JSON-file storage seam at `work/server-governance.json` (overridable via `WF_GOV_FILE`), memoized in a promise so concurrent requests share one instance. Verified payments land in a hash-chained `decision_log`, on disk, surviving restarts.

**Env-gated seams (`env-validation.js`).** One spec, two consumers. Codes `ENV-01`/`ENV-02` (Supabase → `roster-api`), `ENV-03` (`WF_WEBHOOK_SECRET` → `payment-webhook`). Unpopulated seams are **DISABLED**, answering 503 with the code — the server still boots for what it *can* do. Fail-closed here means *refuses to operate, loudly, with an actionable code* — never limping along on undefined credentials.

**Endpoints:**

| Route | Behavior |
|---|---|
| `POST /api/webhooks/payment` | Raw-body HMAC verify → normalize → ingest. Coded HTTP mapping: PAY-01→503, 02/03/04→401, 05/06→400, **07→409**, 08→500. |
| `GET /api/payments` | Read-only provenance view: chain verification result + serialized payment records. |
| `GET /` | Serves `worldforge_v6_0.html`. |
| `GET/POST /api/roster`, `POST /api/agents` | Supabase-backed roster, all guarded by `if (!supabase) return rosterDisabled(res)`. |

The `PAY-07 → 409 Conflict` mapping is a small correctness detail done right: a duplicate webhook is not an error, it is a conflict, and the processor should not retry it as if it failed.

## II.9 Tier 7 — Governance data & linters

| Artifact | Bytes | Role |
|---|---:|---|
| `agent-roster.v5.2.json` | 17,573 | Canonical roster: `rosterVersion`, `authorityRoles`, `externalRoles`, 8 guilds |
| `asset-library-schema.v3.1.json` | 9,914 | JSON Schema draft 2020-12, compile-verified by the linter |
| `rules.v1.json` | 2,212 | 6 rules, `source: lint_worldforge.py`, `source_hash: sha256:1c4248d8…` |
| `p4-decision-records.json` | 7,564 | Structured decision records |
| `p4-categorization-map.json` | 3,504 | Block categorization from the extraction pass |
| `lint_worldforge.py` | 20,200 (434 L) | Roster + schema + **artifact drift** validation |
| `gen_rules.py` | 7,065 (147 L) | Compiles `rules.v1.json` from the linter; `--check` fails on staleness |

**The provenance chain here is the point.** `lint_worldforge.py` is the sole authority on promotion rules. `gen_rules.py` compiles them into `rules.v1.json` and stamps a `source_hash`. The ext loads that JSON and **warns if `source === 'bootstrap'`**, marking its own findings advisory. `gen_rules.py --check` is a CI gate that fails if the compiled artifact drifts from the source. And `lint_worldforge.py --html` checks that the roster **embedded in the shipped artifact** still matches canon.

Live result today: `[ok] Drift worldforge-os_5.html: embedded roster consistent with canon.` — the 163,940-byte artifact's embedded data is verified against the canonical JSON on every gate run.

**The six rules:**

| ID | Doctrine | Predicate | Severity | Meaning |
|---|---|---|---|---|
| GOV-1 | Rule 12 / 7 | `missing_field: promotion.reason` | error | No silent promotion |
| GOV-1b | Rule 7 | `missing_field: promotion.actor` | error | Decisions require an actor |
| GOV-2 | Rule 7 | `impact_gte: high` | warn | High impact → second approver |
| GOV-3 | Rule 12 | `missing_field: asset.fingerprint` | warn | Promoted asset can't be diffed against canon |
| SCHEMA-1 | schema v3.1 | `missing_field: asset.type` | error | Required field |
| SCHEMA-2 | schema v3.1 | `missing_field: asset.name` | error | Required field |

GOV-2 is `warn` at rule level but is **escalated to a hard block** by `promoteAsset` stage 4 when no approver is present. Severity is advisory; the ceremony enforces.

## II.10 Tier 8 — Orchestration & telemetry

Both orchestration scripts open with an explicit **HONESTY CONTRACT**, and this deserves architectural credit rather than a footnote.

`scripts/agent-matrix-48.mjs` (12,730 B):

> *"This is a PARALLEL JOB RUNNER, not a distributed system. The 48 'nodes' are lanes in a local worker pool on ONE machine… There are no model calls, no network, no remote compute, and nothing here makes WorldForge OS 'decentralized'… Every ✓ below is an exit code 0 that you can reproduce by running the job yourself."*

`scripts/jarvis-core.mjs` (6,482 B):

> *"the three 'agents' below are ROLE PERSONAS routing REAL local jobs — no model is called, nothing leaves this machine."*

The disclaimer is also **written into the persisted telemetry JSON**, so it survives being quoted out of context. A system whose entire thesis is the trustworthiness of records applying that same standard to its own marketing surface is consistent in a way that most projects are not. Impressive dashboards that overstate what ran are the exact failure mode this codebase exists to prevent.

The 48 lanes across 5 clusters: Engine Core (10), Crypto & Red-Team (12), Perf & WAAPI (10), Hygiene & Linters (8), Branding & Telemetry (8). The runner warns if a cluster's actual job count diverges from its declared size — the matrix validates its own manifest.

`scripts/production-deploy.sh` (2,368 B) runs four gates in order, `set -euo pipefail`, aborting on the first red, and **stops at "READY TO SHIP"**. It never pushes, tags, or touches hosting credentials:

> *"shipping is a human decision made with credentials in hand — the record's trustworthiness outranks automation convenience."*

## II.11 Complete error-code register

| Code | Tier | Meaning | HTTP |
|---|---|---|---|
| `PAY-01` | bridge | no webhook secret configured | 503 |
| `PAY-02` | bridge | malformed/missing signature header | 401 |
| `PAY-03` | bridge | timestamp outside 300s tolerance (replay) | 401 |
| `PAY-04` | bridge | HMAC mismatch | 401 |
| `PAY-05` | bridge | event missing id/type, or body not JSON | 400 |
| `PAY-06` | bridge | ambiguous/absent/invalid money or currency | 400 |
| `PAY-07` | bridge | duplicate event id (idempotent, ledger untouched) | 409 |
| `PAY-08` | bridge | kernel lacks ext + event chain | 500 |
| `ENV-01` | server | `SUPABASE_URL` unset → roster-api disabled | 503 |
| `ENV-02` | server | `SUPABASE_ANON_KEY` unset → roster-api disabled | 503 |
| `ENV-03` | server | `WF_WEBHOOK_SECRET` unset → webhook disabled | 503 |
| `GOV-1/1b/2/3` | rules | promotion governance findings | — |
| `SCHEMA-1/2` | rules | asset schema violations | — |
| `RULES-MISSING` | ext | rules not loaded — promotion blocked | — |
| `RULES-PROVENANCE` | ext | rules from bootstrap — advisory only | — |
| `UI1-K1` | UI | no decision-write seam (fail-closed) | — |
| `corrupt-write-refused` | recovery | non-object write refused | — |
| `rollback-refused` | recovery | shadow missing/forged | — |
| `rolled-back` | recovery | pristine state restored | — |
| `corrupt-entry` | kernel | project row skipped loudly | — |

---

# PART III — END-USER & ENTERPRISE IMPLEMENTATION MANUAL

## III.1 Deployment modes

The system supports three genuinely distinct deployment postures. Choosing among them is the first decision an adopter makes.

### Mode A — Offline artifact (the default, and the design target)

Copy `worldforge-os_5.html` (163,940 B) anywhere. Double-click it. That is the entire installation.

- No server, no build, no network, no dependencies.
- On boot it verifies its own integrity and refuses to run if modified.
- Without a host `window.storage` API it prints `[wf] window.storage unavailable — using in-memory session store (nothing persists)` and runs session-only. **Data does not persist in this configuration** — the warning is the contract.
- Without WebGL or if the Three.js CDN is unreachable (8s timeout), it degrades to the text roster automatically. One fallback, two triggers.

### Mode B — Hosted artifact with a storage host

Same file, served by a host that provides `window.storage` with `{get,set,delete,list}` and a shared/personal scope flag. The floor becomes genuinely shared: *"anything forged here is visible to everyone who opens this artifact."* Concurrency is `freshen()`-based last-writer-wins across clients (see `CAS-1`).

### Mode C — Full plane (artifact + Express server)

```bash
npm install                    # express, cors, dotenv, @supabase/supabase-js
cp .env.example .env           # populate
node scripts/validate-env.mjs --strict   # production gate — must exit 0
npm start                      # → port 5000 (or $PORT)
```

Adds: server-side governance ledger on disk, verified payment webhook ingestion, `/api/payments` provenance view, Supabase-backed roster. Vercel-compatible via the exported app + `vercel.json`.

## III.2 Operational lifecycle — a project, end to end

**1. Identify and create.** "+ Start Forging" → forger name and project name (both required) and a type. The name is persisted to the personal profile key and becomes the `actor` for every subsequent record. `createProject` stamps `id`, `createdBy`, `createdAt`, `schemaVersion: 2`, `stage: 0` and persists once.

**2. Advance through ungated stages.** "Advance" → `adapter.advance(id, null)` → kernel freshens, increments, stamps, persists once. Nothing is recorded for an ungated advance — the system does not manufacture ceremony where none is due.

**3. Meet a gate (stages 4, 5, 8).** `advance()` returns `{ok:false, reason:'gate', gate}`. The UI opens the gate modal with the gate's title and text. Three exits:

- **"Not yet"** — nothing advances, nothing is recorded.
- **"Confirm — on the record"** — re-attempt with `{gatePassed:true, reason}` → a `gate-pass` record and the stage move land in **one write**.
- **"Override…"** — the ceremony.

**4. The override ceremony.** A modal that states plainly: *"An override bypasses this gate's check. It is written to the decision record with your name and reason, permanently, next to every clean pass."* Actor and reason both required; a reason under 10 characters draws an advisory nudge. On commit, `recordGateOverride` → `advance({override:true, reason})` → record + stage move, atomic, one persist. **When the promise resolves the stage has already moved** — the UI refreshes rather than advancing again. The record renders in its own amber color in the decision list, permanently.

If no decision-write seam exists, the commit fails visibly and nothing advances.

**5. Reverse a stage.** "Step back" **always** requires a reason — this is not a gate-conditional requirement, it is unconditional (`kernel:221`). The modal states: *"A reversal is a decision — it goes on the record (Rule 7)."* Records `step-back` with the destination stage as the label.

**6. Register and promote assets** (via the ext API). `registerAsset({id,type,name,fingerprint?})` → `promoteAsset({asset_id, actor, reason, impact, approver?})`. The six-stage ceremony runs; high-impact promotions without an approver are refused at stage `gov2`; on success the asset is locked, the promotion logged, one persist.

**7. Unlock.** Requires a reason and writes an `asset-unlock` decision. Locking is cheap; unlocking costs a record.

**8. Budget.** `updateBudget({stage_id, actor, action, cost, ts})`. `reserveBudget(amount, label)` writes a `reserve:`-prefixed entry and refuses overdraw. The visual tier shows spend, remaining, a burn bar that turns warning-colored under 20% remaining, and the last six ledger movements.

**9. Export.** "Export UFDM" produces a portable v1.0.0 document: full project, stages, agents, assets, merged decision log, budget summary, kernel and ext versions. This is the audit deliverable.

**10. Import.** `importUFDM(doc)` validates all-and-reports-all before touching anything. Stage sequence must match canon; every actor must be in the roster or literally `'human'`.

## III.3 Administrative ceremonies

### Making a code change (the mandatory sequence)

```bash
# 1. edit src/ or worldforge-kernel.v1.1.js
node build.mjs --bundle     # REQUIRED — the artifact WILL refuse to boot otherwise
node build.mjs --verify     # embedded hash matches rebuild
node build.mjs --gate       # kernel access confined to the adapter
node scripts/agent-matrix-48.mjs      # all 48 lanes
```

**This is the single most important operational rule in the system.** After editing the shell or the kernel you *must* rebuild, or the G5 boot self-check will refuse to start the artifact. The safety mechanism does not distinguish between an attacker and a developer who forgot a step — by design.

### Adding a module to the artifact

Append to `CONFIG.manifest` in `build.mjs` **in a deliberate position** (order is the specification), ensure UMD/IIFE wrapping, rebuild, re-run the matrix. Bundle membership is a privilege — for a commercially-scoped module it additionally requires a ratified decision record.

### Recording a decision

Append to `docs/decision_log.md` in the existing format: `D-YYYY-MM-DD-NN — RATIFIED · <title>`, motive, status. Authority is the owner's. Reopening a frozen decision requires a **new record**, never an edit to the old one — the log is append-only by the same discipline it enforces on the runtime.

### Retiring code

```bash
node build.mjs --deadcheck <name>
# DEAD: zero references. Safe to delete; write the decision record.
```

### Pre-ship

```bash
bash scripts/production-deploy.sh   # 4 gates, aborts on first red, STOPS at READY TO SHIP
```

It will not deploy. Deployment is a human act with credentials in hand.

### Configuring the payment webhook (Mode C)

1. Set `WF_WEBHOOK_SECRET` to the processor's signing secret.
2. `node scripts/validate-env.mjs --strict` → must exit 0.
3. Point the processor at `POST /api/webhooks/payment`, header `wf-signature: t=<unix>,v1=<hex64>`.
4. Verify: signed events return `{received:true, tx_hash, chain_head}`; unsigned/replayed/tampered are refused with a code; duplicates return 409 with the ledger untouched.
5. Audit any time via `GET /api/payments` — it returns the chain verification result alongside the records.

**Enterprise note:** this seam verifies and records. It does not charge. Charging requires ratifying MON-1 and admitting `wf.monetization.v1.js` past the bundle boundary — a governance act, not a config change.

## III.4 Integration surface for a commercial adopter

The system is designed to be embedded, and the seams are deliberate:

| Seam | Interface | Purpose |
|---|---|---|
| Storage | `{get,set,delete,list}` async, shared/personal flag | Back it with anything — localStorage, IndexedDB, a REST tier, S3 |
| Actor | `String \| () => String` | Wire your SSO identity here |
| Pipeline | `{stages, gates, storage, budget}` | Your stages, your gate copy, your currency |
| Roster | `{agents:[…]}` | Your org chart; export validation enforces membership |
| Rules | `rules.v1.json` via `loadRules(doc)` | Your promotion policy, compiled from your linter |
| Asset bytes | `async (record) => bytes` | Fingerprint verification against your object store |
| Digest | `async (bytes) => hex` | Node/HSM/custom crypto |
| Gateway | `{charge(invoice)}` | Your processor (MON-1 gated) |
| Server events | `ingestServerEvents(events)` | Read-only provenance display |

Nothing above requires forking. Every one is an injection point the kernel or ext already reads. That is what "constrained engine" buys you: the constraints are on *capability*, not on *configuration*.

---

# PART IV — PRODUCTION STATUS, TESTING HYGIENE, OPEN GAPS

## IV.1 Live execution results (2026-07-20, this machine)

I ran the entire matrix rather than quoting prior reports. Verbatim outcomes:

### Build gates

```
node build.mjs --verify → OK: bundle fresh — embedded hash matches rebuild
node build.mjs --gate   → OK: global-scope gate clean — kernel access confined to kernel-adapter.js
```

### Unit suites — 133 assertions, 0 failures

| Suite | Result | Covers |
|---|---|---|
| `test/kernel-smoke.mjs` | **30 passed, 0 failed** | Kernel contract, gates, single-persist, migration |
| `test/p2-ext-smoke.mjs` | **31 passed, 0 failed** | Ext v1.2.1, FIFO, seams, chaos regressions |
| `test/event-chain-smoke.mjs` | **16 passed, 0 failed** | SHA-256 vectors, chain integrity, break localization |
| `test/monetization-smoke.mjs` | **20 passed, 0 failed** | Billing contract, tamper checks, rate freezing |
| `test/recovery-smoke.mjs` | **11 passed, 0 failed** | Shadow write, rollback, forged-shadow refusal |
| `test/payment-bridge-smoke.mjs` | **25 passed, 0 failed** | HMAC, replay, normalization, idempotency |
| **Total** | **133 / 133** | |

### Chaos harness — `no findings — all probes survived`

Nine probe families, live output:

```
[ok] metering ledger separate — no bleed into decision ledgers
[ok] 6 corruption styles all rolled back to pristine hash
[ok] forged shadow refused — recovery never invents state
[ok] corrupt write refused at the seam — never persisted
[ok] 50 spoofed/forged signature headers all refused
[ok] byte-flipped bodies all failed authentication
[ok] ingest race: 6 distinct landed, duplicate landed exactly once, chain verifies
[ok] processor `amount` never survives into governance records
[ok] HTTP storm: 1 legit landed, 13 attacks refused loudly, ledger untouched
```

The harness produces **expected** stderr noise — corrupt-entry stack traces, ENV-01/02 disabled-seam warnings, PAY-04/PAY-07 refusals. That noise *is* the assertion: the system is required to be loud, and the suite verifies it is.

### 48-lane matrix — **48/48 GREEN**

```
Engine Core           10/10 ·  4308ms
Crypto & Red-Team     12/12 ·  9084ms
Perf & WAAPI          10/10 ·  3076ms
Hygiene & Linters       8/8 ·  3781ms
Branding & Telemetry    8/8 ·   393ms

lanes 48/48 green · wall 3675ms · serial 20642ms · speedup 5.62×
artifact: 163,940 B · status: GREEN
```

### Linters

```
python gen_rules.py --check  → gen_rules --check: fresh.
python lint_worldforge.py …  → 0 error(s), 0 warning(s).
   [ok] Schema  asset-library-schema compiles as valid JSON Schema draft 2020-12.
   [ok] Drift   worldforge-os_5.html: embedded roster consistent with canon.
```

### Environment preflight

```
wf env preflight — DEGRADED (fail-closed seams below)
  DISABLED roster-api
  LIVE     payment-webhook
  [ENV-01] SUPABASE_URL unset → roster-api refuses to operate.
  [ENV-02] SUPABASE_ANON_KEY unset → roster-api refuses to operate.
```

This is **correct fail-closed behavior**, not a defect: the local `.env` carries a webhook secret and no Supabase credentials, so the roster seam is disabled rather than running on undefined values. Production requires `--strict` to exit 0.

### Working-tree effect of this analysis

Running the matrix modified exactly one file — `work/matrix-48-run.json`, the telemetry log the matrix is designed to write. `git status` shows `M work/matrix-48-run.json` and nothing else. The re-bundle and branding regeneration lanes both produced byte-identical output, which is itself a useful confirmation: **the build is genuinely deterministic.**

## IV.2 Test architecture assessment

Coverage is unusually well-targeted. What distinguishes it:

- **Regression probes are attached to real incidents.** Every chaos finding from the 2026-07-19 pass has a permanent probe. The stated law — *"a fix without a probe is a rumor"* — is actually observed.
- **The suite tests the checks themselves.** The bundle-only-hashing hole was found by deliberately tampering with the kernel block to see whether the self-check would catch it. It didn't. The check was then fixed.
- **Cryptographic primitives verified against a reference.** The hand-rolled SHA-256 is checked against Node's crypto on 13 vectors including multi-block and surrogate-pair inputs — the two cases hand-written SHA-256 implementations classically get wrong.
- **Adversarial volume where it matters.** 50 spoofed signature headers, byte-flipped bodies, a 14-request HTTP storm, a concurrent ingest race with duplicates, 6 distinct corruption styles.
- **Race conditions tested as races**, under injected async storage latency — not as sequential approximations.

### Honest coverage gaps

| Gap | Severity | Note |
|---|---|---|
| No automated browser/DOM tests | Medium | `forge.js`, `escalation-viz.js`, `text-roster.js` are syntax-checked only. Browser passes are manual and owner-side (§5–6). |
| No accessibility automation | Medium | Recorded as an open release criterion, not silently absent. |
| No cross-tab concurrency test | Medium | Would require a real browser harness; `CAS-1` is the underlying gap. |
| Perf lane is a source assertion | Low | The "no rAF leaks" lane checks source strings, not runtime behavior — and its `prefers-reduced-motion === false` clause is a *negative* assertion that is easy to misread. |
| Supabase routes untested | Low | Env-gated; would need a live instance. |
| `escalation-viz.js` (11,395 B) has no behavioral test | Low | Purely presentational; fails to the text roster. |

## IV.3 Open markers, verified against the current tree

| Marker | Meaning | Status today |
|---|---|---|
| `PIPE-1` | Canonical `pipeline.v1.json` not yet a real file | **OPEN.** Interim object derived from bundled STAGES, tagged `provenance: "interim-pending-PIPE-1"` in `app.js:76`. Zero-code drop-in when the file lands. |
| `ACT-1` | Export-tier actor enforcement | **OPEN.** Kernel accepts free text; `validateUFDM` enforces roster-or-`'human'`. The two tiers disagree by design, and the gap is recorded. |
| `MON-1` | Real gateway decision | **OPEN by intent.** Bridge verifies and records; nothing charges. Bundle exclusion holds. |
| `PROV-2` | Keyed/signed event authenticity | **OPEN.** Current chain is keyless tamper-evidence; scope honestly stated. |
| `TEN-1` | Multi-tenant storage prefixes | **OPEN.** `wfproj:` is one namespace; two orgs on one storage tier would interleave. Mechanical fix, but touches every persisted key → migration decision required. |
| `CAS-1` | Storage-tier compare-and-swap | **OPEN.** Needs a `setIfVersion` the current `window.storage` shim cannot express. Requirement recorded rather than faked. |
| `UFDM2-Q1–Q3` | UFDM v2 open questions | **OPEN.** |
| §5–6 | Browser + a11y release passes | **OPEN**, owner-side. |
| `PROV-1` → D-2026-07-19-05 | | **CLOSED** |
| `SELF-1` → D-2026-07-19-06 | | **CLOSED** |
| `G1` recovery → D-2026-07-19-04 | | **CLOSED** |
| `UI1-K1` | | **BURNED** |

## IV.4 Structural limitations (my independent assessment)

Beyond the tracked markers, six honest limitations:

1. **Single-project ext binding.** The ext binds one project at a time (`bindProject(id)`); the read seams throw on an unbound kernel. Correct and loud, but it means the visual tier is inherently single-project. A portfolio view would need a different shape.

2. **Decision cap of 100 is silent data loss.** `p.decisions.slice(-100)` discards the oldest records with no event, no warning, and no archive. For a system whose product *is* the decision record, this is the one place where history is destroyed quietly. A long-running project with heavy gate traffic will lose its early governance history, and the hash chain covers `decision_log`, not the kernel's capped `decisions` array — so the truncation is not even detectable by `verifyEventChain()`. **This is the sharpest inconsistency I found between the system's stated identity and its behavior.**

3. **CDN dependency for the 3D mode.** Three.js loads from cdnjs. Handled gracefully (8s timeout → text roster), but the "fully offline" claim holds only for the fallback experience.

4. **The FIFO is per-instance, not per-storage-tier.** Two artifacts on one storage tier still race. `CAS-1`, restated at runtime scope.

5. **`work/server-governance.json` writes the whole file on every mutation.** `fs.writeFileSync(file, JSON.stringify(mem))` on every `set`. Fine for a governance ledger with webhook-frequency writes; it is O(n) per write and not crash-atomic (no write-to-temp-then-rename). A crash mid-flush can truncate the ledger — and unlike the browser tier, **the server storage seam is not wrapped by `wf-recovery`.**

6. **Chaos report vs. disk divergence.** `docs/chaos-report_2026-07-19.md` records the artifact at 143,484 B; disk today is 163,940 B (+20,456 B, the MON-1-era visual panel and trust layer). The report's own reduction figure (−78.1% from the 653,674 B monolith) is likewise stale — the branding pipeline currently computes **−74.9%**. Neither is wrong for its date; both are point-in-time. Worth noting that the *generated* collateral is fresh while the *hand-written* report is not, which is an argument for the generated path.

---

# PART V — INTELLECTUAL EXPANSION LAYER

*This section is my own engineering judgment, developed from the review. It is proposal, not record. Nothing here has been ratified, and several items would require decision records before implementation.*

## V.1 The strategic observation

The most valuable thing in this repository is not the pipeline tracker. It is the **governance substrate**: kernel + ext + recovery + event chain + boot self-check + chaos harness, roughly 55 KB of dependency-free JavaScript that provides atomic record-with-mutation, tamper-evident history, self-healing storage, and artifact self-verification, with a documented seam architecture and an honest statement of its own limits.

That substrate has *nothing to do with film production*. The ten stages, three gates, and eight guilds are configuration. Any domain where an irreversible decision needs an attributable, verifiable record has the same shape:

- Clinical trial protocol deviations
- Model-deployment approvals in regulated ML
- Change-advisory boards in regulated infrastructure
- Financial close and journal-entry approvals
- Legal matter management
- Aviation and industrial maintenance sign-offs
- Academic research integrity and provenance
- Supply-chain custody transfers

**Recommendation P0: extract `@worldforge/governance-kernel`.** The seams already exist — pipeline, roster, rules, storage, actor, digest are all injected. Extraction is packaging and documentation, not re-architecture. WorldForge OS then becomes the reference implementation and the flagship demo. This is the single highest-leverage move available, and the codebase has already, perhaps unintentionally, done ninety percent of the work.

## V.2 Closing the tracked gaps — a proposed order

**1. `TEN-1` (multi-tenant) — the commercial unlock.** Nothing enterprise-shaped can ship without it. Design: derive the tenant key at kernel construction (`pipeline.storage.tenantKey`), enforce it at the adapter seam exactly as the `WFKernel` gate is enforced — mechanically, via `build.mjs --gate`. Add a `--tenantcheck` gate that fails on any raw `wfproj:` literal outside the adapter. Migration: a one-time namespace walk mirroring the existing legacy migration, with a decision record.

**2. `CAS-1` (compare-and-swap) — the correctness gap.** Requires `setIfVersion(key, value, expectedVersion)` from the storage tier. Proposal: define it as an **optional capability** the recovery wrapper probes for. When present, the kernel persists with a version counter and retries-with-freshen on conflict; when absent it degrades to today's last-writer-wins and **says so** — expose `kernel.concurrencyMode` as `'cas' | 'lww'` and surface it in the UI. Do not fake the guarantee; make the guarantee legible.

**3. `PROV-2` (keyed authenticity).** The chain already carries a head hash. Add an optional signing seam: `opts.sign(hash) => signature` and `opts.verify(hash, sig)`. In the browser this is Ed25519 via SubtleCrypto; on the server it is an HSM or KMS. Keep the keyless chain as the default and the fallback — the value is that any partial edit is caught, and that value must not regress when no key is configured.

**4. `ACT-1` (actor enforcement).** Add `pipeline.actorPolicy: 'free' | 'roster' | 'roster-or-human'`, defaulting to today's behavior. Enterprises will want `'roster'` wired to SSO; solo users want free text. Configuration, not a fork.

## V.3 New capabilities I would build

### V.3.1 Decision-record archival — fixing the cap-100 data loss

**Priority: high. This is a correctness issue, not a feature.**

Rather than discarding the oldest decisions, roll them into a hash-anchored archive:

```js
{
  archived: [...],           // the evicted records
  archive_anchor: "<sha256>", // chain head at eviction
  archived_at: <ts>,
  archived_count: <n>
}
```

Emit an `archive-rolled` event. The live cap stays 100 (bounded memory, unchanged shape), history stops being destroyed, and `verifyEventChain()` extends across the boundary via the anchor. Roughly 40 lines. It removes the only place in the system where the record is silently made less complete.

### V.3.2 The Audit Bundle — the enterprise deliverable

Today's UFDM export is a data document. An auditor needs a *proof*. Ship a single self-contained HTML file that carries:

- the full decision chain with per-record hashes,
- an **embedded verifier** that recomputes the chain in the browser with no network,
- the exact kernel/ext/artifact hashes the records were written under,
- the pipeline and roster as they stood,
- a plain-language integrity verdict at the top.

This makes governance *portable* and *independently checkable*. It is the natural commercial artifact of this architecture, and it needs no new trust machinery — only presentation over what already exists.

### V.3.3 Server-side recovery parity

`wf-recovery.v1.js` is browser-agnostic — it wraps any `{get,set,delete,list}`. `src/server.js`'s `fileStorage` is currently **unwrapped**, so the server-side governance ledger has strictly weaker durability than the browser's. Two fixes:

- Wrap `fileStorage` with `WFRecovery` (a one-line change plus a CommonJS require path).
- Make `flush()` crash-atomic: write to `<file>.tmp`, `fsync`, then `rename`.

The second is four lines and closes a real truncation window.

### V.3.4 Gate analytics — the governance dashboard

The decision log is a dataset nobody is reading yet. Derived, entirely read-only:

- override rate per gate (a gate overridden 80% of the time is mis-placed, not being violated),
- median time-in-stage and time-to-gate-decision,
- step-back frequency per stage (where work is actually failing),
- reason-length distribution (a proxy for ceremony quality),
- actor concentration (bus-factor on approvals).

**The insight this unlocks:** override rate is a signal about the *gate*, not about the *people*. A system that can distinguish "our team is undisciplined" from "this checkpoint is in the wrong place" is materially more valuable than one that only records violations.

### V.3.5 Rule DSL expansion

Three predicates is a thin policy language. Additions that stay declarative and safe:

- `field_matches(path, regex)`, `field_in(path, [values])`
- `time_since(path, duration)` — e.g. staleness of a fingerprint
- `actor_has_role(role)` — against `authorityRoles` in the roster, which already exists and is currently unused by the evaluator
- `count_gte(path, n)`, `all_of` / `any_of` / `not` composition

Keep the unknown-predicate fail-closed behavior absolutely intact — it is what makes DSL evolution safe.

### V.3.6 Storage adapters as a published set

Ship reference adapters, each conforming to the same four-method contract and each with its own smoke suite: `localStorage`, `IndexedDB` (with real `setIfVersion` → unlocks CAS), Node file (crash-atomic), S3/R2 (conditional PUT → also unlocks CAS), Postgres (row versioning → CAS), and an in-memory test double. Adapters are the adoption surface; a governance kernel that only speaks to one storage tier is a demo.

### V.3.7 Time-travel replay

Because state changes are append-only and hash-chained, the state at any decision index is reconstructible. `kernel.replayTo(seq)` returning a read-only projection would allow "show me the project as it stood when this override was recorded" — a genuinely powerful audit affordance that the data model already supports and nothing currently exposes.

## V.4 Hidden value metrics already latent in the data

Six measurements the system could produce today with no new instrumentation:

1. **Governance density** — recorded decisions per stage transition. Rising density on a stage means the stage is contentious.
2. **Ceremony cost** — median seconds from gate presentation to resolution. The `promoteAsset` code already asserts `clean path < 10s` as a design law; this measures whether reality agrees.
3. **Reversal depth** — how far back step-backs go, and from which stage. Deep reversals from late stages are the expensive failure mode the gates exist to prevent; this measures whether they are working.
4. **Chain integrity uptime** — `verifyEventChain()` result over time, as a monitored series. Tamper evidence is only valuable if someone is looking.
5. **Recovery incidence** — `rolled-back` and `corrupt-primary` event rates. This is a direct measure of storage-tier health that the host itself may not be reporting.
6. **Fingerprint coverage** — proportion of promoted assets with a verified (not `unverifiable`) fingerprint. This is the real "can we diff against canon" number, and GOV-3 currently only warns about it one asset at a time.

## V.5 What I would deliberately *not* do

Discipline is easier to lose than to build, so an explicit anti-roadmap:

- **Do not add a framework.** The zero-dependency constraint is what makes the artifact auditable and offline-capable. Every dependency is a trust delegation.
- **Do not minify.** Already correctly reasoned in the chaos report: byte-shredding via comment-stripping would fight the audit discipline that caught these bugs. The comments in this codebase are load-bearing — several encode invariants that exist nowhere else.
- **Do not make the artifact multi-file.** One file that hashes itself is the trust model.
- **Do not soften the boot self-check.** A developer who forgets `--bundle` and gets a scary red screen is the system working exactly as designed.
- **Do not let the components gain kernel access "just for this one feature."** The moment `--gate` needs an exception list, Ring 2 stops meaning anything.
- **Do not admit real payment processing without ratifying MON-1.** The bundle boundary is a security control, and its value comes entirely from being unconditional.
- **Do not let the honesty contracts erode.** The disclaimers on `agent-matrix-48` and `jarvis-core` are the system applying its own thesis to itself. That consistency is a genuine asset.

## V.6 A closing observation on the architecture

The deepest quality in this codebase is not any single mechanism. It is that **every safety mechanism states its own limits in the same breath as its guarantee**:

- The recovery tier says it is integrity provenance, not cryptographic proof.
- The event chain says it is tamper-evidence, not keyed authenticity.
- The boot self-check says an attacker who rewrites the whole file can rewrite the check too.
- The FIFO says it is in-process only.
- The 48-lane matrix says it is a local job runner, not a distributed system.
- The payment bridge says it moves no money.

This is rarer than it sounds, and it is the actual competitive asset. A security mechanism that overstates itself is worse than no mechanism, because it redirects attention away from the real exposure. Every honest boundary in this tree is a place where someone chose to be less impressive and more correct.

That instinct — not the kernel, not the chain, not the artifact — is the thing worth protecting as this system grows.

---

# APPENDIX A — MEASURED FILE INVENTORY

Excludes `node_modules/`, `__pycache__/`, `.git/`, `.claude/worktrees/`, and `.zip` archives. Measured 2026-07-20.

| Path | Bytes |
|---|---:|
| `worldforge-os_5.html` | 163,940 |
| `worldforge_v6_0.html` | 56,570 |
| `worldforge_v5_2.html` | 43,731 |
| `src/wfkernel-p2-ext.v1.2.js` | 30,066 |
| `lint_worldforge.py` | 20,200 |
| `test/chaos-fuzz.mjs` | 20,488 |
| `agent-roster.v5.2.json` | 17,573 |
| `scripts/agent-matrix-48.mjs` | 12,730 |
| `src/wf-ufdm-components.v1.js` | 12,170 |
| `worldforge-kernel.v1.1.js` | 11,539 |
| `src/components/forge.js` | 11,518 |
| `src/components/escalation-viz.js` | 11,395 |
| `src/guilds-data.js` | 10,996 |
| `scripts/gen-branding-assets.js` | 10,627 |
| `build.mjs` | 10,602 |
| `src/wf-ufdm-visual.v1.js` | 10,130 |
| `asset-library-schema.v3.1.json` | 9,914 |
| `src/server.js` | 9,948 |
| `src/app.js` | 9,938 |
| `src/wf.monetization.v1.js` | 9,926 |
| `test/p2-ext-smoke.mjs` | 9,429 |
| `work/matrix-48-run.json` | 9,467 |
| `src/wf-payment-bridge.v1.js` | 7,788 |
| `src/wf-event-chain.v1.js` | 7,733 |
| `test/payment-bridge-smoke.mjs` | 7,704 |
| `p4-decision-records.json` | 7,564 |
| `gen_rules.py` | 7,065 |
| `scripts/jarvis-core.mjs` | 6,482 |
| `test/kernel-smoke.mjs` | 6,208 |
| `src/wf-gate-override.v1.js` | 6,100 |
| `docs/chaos-report_2026-07-19.md` | 5,802 |
| `docs/backlog-close-handoff_2026-07-18.md` | 5,788 |
| `src/wf-recovery.v1.js` | 5,651 |
| `docs/SYSTEM_IDENTITY.md` | 5,668 |
| `src/components/text-roster.js` | 5,644 |
| `test/event-chain-smoke.mjs` | 5,372 |
| `test/monetization-smoke.mjs` | 5,250 |
| `docs/decision_log.md` | 4,772 |
| `test/recovery-smoke.mjs` | 3,881 |
| `shell.html` | 21,935 |
| `src/wf-ufdm-visual.v1.css` | 3,384 |
| `p4-categorization-map.json` | 3,504 |
| `work/blocks/manifest.json` | 3,504 |
| `work/jarvis-run.json` | 2,138 |
| `scripts/production-deploy.sh` | 2,368 |
| `src/kernel-adapter.js` | 2,431 |
| `src/vendor-loader.js` | 2,244 |
| `rules.v1.json` | 2,212 |
| `src/env-validation.js` | 1,567 |
| `scripts/validate-env.mjs` | 1,545 |
| `work/server-governance.json` | 926 |
| `AGENTS.md` | 758 |
| `package.json` | 331 |
| `vercel.json` | 191 |
| `.env.example` | 95 |
| `.gitignore` | 84 |
| `.env` | 71 |
| `dist/branding/*` (5 files) | 9,827 |
| `docs/*.pdf` (3 files) | 272,826 |

**Note on `.claude/worktrees/`:** two git worktrees (`angry-easley-a69703`, `charming-curie-1fcdd3`) contain a *pre-P4* snapshot — `src/server.js` at 4,618 B versus 9,948 B on `main`, no `src/` module tree, no tests. They are stale scratch copies, not part of the live system, and are excluded from every measurement above.

---

# APPENDIX B — LIVE EXECUTION TRANSCRIPT SUMMARY

All commands run from `D:\worlforge-os` on 2026-07-20.

| Command | Result |
|---|---|
| `node build.mjs --verify` | ✅ bundle fresh |
| `node build.mjs --gate` | ✅ gate clean |
| `node test/kernel-smoke.mjs` | ✅ 30 / 0 |
| `node test/p2-ext-smoke.mjs` | ✅ 31 / 0 |
| `node test/event-chain-smoke.mjs` | ✅ 16 / 0 |
| `node test/monetization-smoke.mjs` | ✅ 20 / 0 |
| `node test/recovery-smoke.mjs` | ✅ 11 / 0 |
| `node test/payment-bridge-smoke.mjs` | ✅ 25 / 0 |
| `node test/chaos-fuzz.mjs` | ✅ no findings — all probes survived |
| `node scripts/agent-matrix-48.mjs` | ✅ 48/48 GREEN · wall 3675ms · speedup 5.62× |
| `python gen_rules.py --check` | ✅ fresh |
| `python lint_worldforge.py --roster --schema --html` | ✅ 0 errors, 0 warnings |
| `node scripts/validate-env.mjs` | ⚠ DEGRADED — roster-api disabled (correct: no Supabase creds locally) |
| `git status --short` | `M work/matrix-48-run.json` only |

**Aggregate: 133 unit assertions, 9 chaos probe families, 48 matrix lanes, 2 build gates, 2 linters. Zero failures.**

---

*Chronicle compiled by independent source-tree archeology and live verification, 2026-07-20. Parts I–IV are derived from and verifiable against the repository as it stands at commit `eb9e87d`. Part V is proposal and engineering opinion, carries no ratification, and should not be read as a record. Decision authority remains the owner's; anything in Part V that would change a frozen invariant requires a new entry in `docs/decision_log.md` before implementation.*
