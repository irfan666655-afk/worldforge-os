# WorldForge OS

> A governance engine wearing a creative-pipeline UI. Its real product is an
> **unfakeable decision record**; every architectural choice exists to keep
> that record trustworthy on hostile ground — a browser, someone else's
> storage tier, an offline `file://` double-click, a spoofed payment webhook.

Read the repository as syntax and you see a project tracker (stages, gates,
budgets, assets). Read it as **structure** and you see four nested trust
boundaries, each less trusted than the one it wraps.

## Architecture — four nested trust boundaries

| # | Boundary | File | Owns |
|---|----------|------|------|
| 1 | **Kernel** | `worldforge-kernel.v1.1.js` | Mutation truth. `freshen → mutate → ONE persist`; a decision record lands in the same write as the change it justifies. |
| 2 | **Ext** | `src/wfkernel-p2-ext.v1.2.js` | Governance vocabulary + the in-process **mutation FIFO** (serialises 12 state-replacing ops). Additive mixin — never edits the kernel. |
| 3 | **Components** | `src/components/`, `src/wf-ufdm-*` | Presentation. Deliberately powerless; reach the kernel only through the adapter (`build.mjs --gate` enforces it mechanically). |
| 4 | **Notary (build)** | `build.mjs` | Not a compiler. Deterministic concat, embedded content hash, per-block SHA-256 boot self-check. The artifact can prove what it is. |

**Trust layer** (`src/wf-recovery.v1.js`, `src/wf-event-chain.v1.js`):
self-healing storage (hash-stamped shadow rollback) and tamper-evident
history (SHA-256 hash-chained decisions, `verifyEventChain()`).

**Commercial layer** (`src/wf.monetization.v1.js`, `src/wf-payment-bridge.v1.js`):
frozen billing contract on the `cost` vocabulary and a server-side webhook
provenance bridge. The default gateway is a **mock** — no real payment
processing exists in this codebase; charging is gated behind marker `MON-1`.

## The two-law discipline

- **Fail-closed** everywhere money or governance is involved: corrupt rows
  abort billing; unrecordable overrides do not happen; an ambiguous gateway
  response is *unpaid*, never assumed paid.
- **Fail-loud** everywhere recovery is possible: corrupt entries skip with
  events and console noise, never silently.

## Quick start

```bash
npm ci                 # install deps (express/cors/dotenv/supabase)
npm test               # 7 suites · 133 unit assertions + chaos harness
npm run build          # deterministic notary bundle → worldforge-os_5.html
npm run verify         # freshness (embedded hash) + global-scope gate
npm run lint           # roster + schema linters + rules-matrix freshness (needs Python)
npm run test:matrix    # full 48-lane local verification matrix
```

### Running the server

```bash
npm start              # boots src/server.js on $PORT (default 3000)
```

Seams are **fail-closed on unset env** (the server still boots for what it
can do):

| Env var | Seam | Disabled behavior |
|---------|------|-------------------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | roster-api | `503 ENV-01/02` |
| `WF_WEBHOOK_SECRET` | payment-webhook | `503 ENV-03` |

A green **`DATABASE CONNECTED`** badge needs both a Vercel deployment (so the
API exists) and Supabase env vars set — otherwise the UI shows an amber
**`OFFLINE MOCK`** badge and runs on a built-in roster (fully usable, by
design). Full walkthrough + Supabase schema: **[`docs/USAGE.md`](docs/USAGE.md)**
and [`supabase/schema.sql`](supabase/schema.sql).

See `.env.example`. The governance ledger is file-backed
(`work/server-governance.json`, git-ignored) and survives restarts; verified
payments land as SHA-256 hash-chained `payment-verified` records.

#### Endpoints

| Method | Path | Notes |
|--------|------|-------|
| `GET`  | `/` | Serves the built UI artifact |
| `GET`  | `/api/roster` | Roster read (Supabase seam) |
| `POST` | `/api/roster` | Bulk atomic roster sync |
| `POST` | `/api/agents` | Create agent |
| `POST` | `/api/webhooks/payment` | HMAC-verified webhook → hash-chained record |
| `GET`  | `/api/payments` | Read-back with live `verifyEventChain()` result |

## Verification

Every suite runs green on Linux/Node 22 — see
[`docs/verification-linux_2026-07-22.md`](docs/verification-linux_2026-07-22.md)
for the full independently-reproduced transcript, including the one
portability bug found and fixed in this pass.

- **144/144** unit assertions across 7 suites (kernel 30 · ext 31 ·
  billing 20 · recovery 11 · event-chain 16 · payment-bridge 25 ·
  server storage 11)
- Chaos harness: **no findings** — all probes survived
- **48/48** matrix lanes GREEN
- Live server: signed webhook recorded + chain verifies end-to-end, with
  server-side recovery parity (shadow rollback) and crash-atomic flush

> **Honesty note.** The 48 "lanes" are a local parallel job runner on one
> machine (real subprocesses, real exit codes) — not a distributed system.
> The event chain is keyless tamper-*evidence*, not signed authenticity
> (marker `PROV-2`). This README repeats those limits rather than overstating
> them, per the system's own identity discipline.

## Documentation

- `docs/SYSTEM_IDENTITY.md` — structural thesis, frozen invariants, gap analysis
- `docs/decision_log.md` — append-only ratified decision records
- `docs/chaos-report_2026-07-19.md` — chaos-engineering findings & immunities
- `docs/WORLD_FORGE_MASTER_CHRONICLE.md` — full architectural chronicle
- `docs/WorldForge_OS_Master_Manual.pdf` — corporate manual (generated by `scripts/generate-master-manual.py`)
