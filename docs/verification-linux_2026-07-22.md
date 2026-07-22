# Independent Verification Pass — Linux / Node 22 · 2026-07-22

**Scope:** bring the full WorldForge OS tree into the repository, run every
suite by hand on a POSIX machine (Linux, Node v22.22.2, Python 3.11), find and
fix any real defect, and prove the server runs live. Every result below was
physically executed at the time of writing — not copied from prior telemetry.
Where a prior "green" claim depended on the original Windows machine, this pass
calls out the divergence and the disk wins.

## Headline finding — a real portability bug (FIXED)

`test/chaos-fuzz.mjs` computed the repo root like this:

```js
const ROOT = new URL("..", import.meta.url).href.replace("file:///", "") + "/";
```

On Windows this yields a valid `D:/worlforge-os/` path, so the archived
telemetry (produced on `D:\worlforge-os`) reported the chaos harness green.
On **any POSIX machine it is broken two ways**:

1. `.replace("file:///", "")` strips the leading `/` from an absolute path —
   `file:///tmp/...` becomes `tmp/...` (relative, unresolvable).
2. `new URL("..", …)` already ends in `/`, so `+ "/"` produces a double slash.

Result: `Cannot find module 'tmp/.../zipout//worldforge-kernel.v1.1.js'` — the
entire chaos harness **and matrix lane N13** hard-crash on Linux/macOS. A Linux
CI run of the archived tree would have gone red on first push.

**Fix** (`test/chaos-fuzz.mjs`): use `fileURLToPath`, which returns a correct
absolute path with a trailing separator on both Windows drive-letter and POSIX
layouts:

```js
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
```

After the fix the harness runs green on Linux (`no findings — all probes
survived`) and the 48-lane matrix reaches 48/48.

## Full transcript (all green after the fix)

| Check | Command | Result |
|-------|---------|--------|
| Kernel contract | `node test/kernel-smoke.mjs` | 30 passed, 0 failed |
| Ext v1.2.1 + FIFO | `node test/p2-ext-smoke.mjs` | 31 passed, 0 failed |
| Billing contract | `node test/monetization-smoke.mjs` | 20 passed, 0 failed |
| Recovery / rollback | `node test/recovery-smoke.mjs` | 11 passed, 0 failed |
| SHA-256 event chain (G2) | `node test/event-chain-smoke.mjs` | 16 passed, 0 failed |
| Payment bridge (MON-1) | `node test/payment-bridge-smoke.mjs` | 25 passed, 0 failed |
| Chaos harness | `node test/chaos-fuzz.mjs` | no findings (fixed) |
| **Aggregate** | `npm test` | **7/7 suites · 133 assertions · GREEN** |
| Notary bundle | `node build.mjs --bundle` | sha256 `529777fc753…` |
| Freshness | `node build.mjs --verify` | bundle fresh |
| Global-scope gate | `node build.mjs --gate` | clean |
| Rules matrix | `python3 gen_rules.py --check` | fresh |
| Full lint | `python3 lint_worldforge.py …` | 0 errors, 0 warnings |
| 48-lane matrix | `npm run test:matrix` | **48/48 GREEN · 6.9× speedup** |

The `529777fc` bundle hash matches matrix lane N05's recorded tail — the
deterministic build reproduces byte-for-byte.

## Secondary findings (robustness gaps, non-blocking)

1. **HTTP-coupled suites need `npm ci` first.** `payment-bridge-smoke` and
   `chaos-fuzz` do a live HTTP round-trip through the real Express app, so they
   require `express`. Without `node_modules` they fail with a raw
   `MODULE_NOT_FOUND`. Mitigated: `scripts/test-all.mjs` preflights for
   `node_modules/express` and prints a clear hint; CI runs `npm ci` first.
2. **Lint had one soft warning** — `jsonschema not installed — compile check
   skipped`. Resolved by installing `jsonschema` (now in the CI step); lint is
   0/0 with it present.
3. **Server-side recovery parity** (already noted in the chronicle, V.3.3):
   `src/server.js`'s `fileStorage` is not wrapped by `WFRecovery`, so the
   server ledger has weaker durability than the browser. Left as-is (a
   ratified design change, not a bug); flagged for a future decision record.

## Live server proof (end-to-end HTTP)

Booted `npm start` with `WF_WEBHOOK_SECRET` set; drove real requests:

| # | Request | Response |
|---|---------|----------|
| 1 | `GET /` | `200` (serves built artifact) |
| 2 | `GET /api/roster` (Supabase unset) | `503 ENV-01` — fail-closed |
| 3 | `POST /api/webhooks/payment` no signature | `401 PAY-02` — malformed sig refused |
| 4 | `POST /api/webhooks/payment` valid HMAC | `200` — `tx_hash` + `chain_head` returned |
| 5 | replay same event id | `409 PAY-07` — idempotent, ledger untouched |

The verified payment persisted as a `payment-verified` record with
`cost: 49.99` (never `amount`), `_chain: { seq: 0, prev: 0…0, hash: b6fc3d… }`.
`GET /api/payments` read it back with `chain: { ok: true, length: 1 }` — the
event chain verifies live.

## What changed in this pass

- **Fixed:** `test/chaos-fuzz.mjs` cross-platform repo-root resolution.
- **Added:** `scripts/test-all.mjs` (portable aggregate runner), `npm`
  scripts (`test`, `test:matrix`, `build`, `verify`, `lint`),
  `.github/workflows/ci.yml` (ubuntu matrix), `README.md`, this report.
- **Imported:** the full runnable tree (kernel, ext, trust + commercial
  layers, tests, build notary, linters, scripts) into the repo, which
  previously held only a minimal server stub.

Nothing in `docs/decision_log.md` was altered — ratification authority is
Irfan's, and the chaos-fuzz fix is an engineering correction pending a
ratified record if desired.
