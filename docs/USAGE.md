# WorldForge OS — Usage & "why is the API offline?"

## TL;DR — "API server offline / OFFLINE MOCK" is not a crash

The UI badge pings `GET /api/roster` on load. When it can't get a live roster
it shows an amber **`OFFLINE MOCK`** badge and logs *"API server offline"* — and
then **loads a built-in default roster so the whole app keeps working**. Offline
mode is a designed, fully-usable fallback, not a failure.

You see "offline" for one of two normal reasons:

| You're viewing… | `/api/roster` result | Why |
|---|---|---|
| **GitHub Pages** (`*.github.io`) | 404 — no server exists | Pages is static-only; it serves the HTML artifact, there is no Node backend. |
| **Vercel** (`*.vercel.app`) before DB setup | **503 `ENV-01`** | The server is up, but the roster seam is *fail-closed* until `SUPABASE_URL` / `SUPABASE_ANON_KEY` are set. |

> The app is architected **fail-closed**: an unconfigured seam returns `503`
> and disables itself rather than running on undefined credentials. The badge
> going amber is that safety working as intended.

To get the green **`DATABASE CONNECTED`** badge you need the Vercel deployment
(so the API exists) **and** a Supabase database (so the roster is live).

---

## Bring the API online (Vercel + Supabase) — ~5 minutes

1. **Create a Supabase project** at supabase.com → copy, from *Settings → API*:
   - Project URL → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`

2. **Create the tables.** In Supabase → *SQL Editor* → paste
   [`supabase/schema.sql`](../supabase/schema.sql) → **Run**. It creates the
   `guilds` and `agents` tables (columns match the server), opens anon access
   for the demo, and seeds one guild so the roster is non-empty.

3. **Set the env vars on Vercel.** Project → *Settings → Environment Variables*,
   add for **Production**:

   | Key | Value | Enables |
   |---|---|---|
   | `SUPABASE_URL` | your project URL | roster read/write |
   | `SUPABASE_ANON_KEY` | your anon key | roster read/write |
   | `WF_WEBHOOK_SECRET` | any strong random string | payment webhook seam (optional) |

4. **Redeploy** (Vercel → *Deployments → ⋯ → Redeploy*, or push any commit).

5. Reload the site → the badge turns green **`DATABASE CONNECTED`** and edits
   now persist to Supabase.

> **Security note.** `schema.sql` disables row-level security so the browser's
> anon key can read/write the roster — fine for a demo board. For production,
> keep RLS on, move writes behind a server-side `SUPABASE_SERVICE_ROLE_KEY`,
> and add explicit policies.

---

## How to use the app

### The workspace (works right now, online or offline)
Open the site (root URL serves `worldforge_v6_0.html`). You get the immersive
WorldForge OS workspace:
- **Forge canvas** — the guild/agent roster rendered as an interactive node graph.
- **Roster** — each agent has a responsibility, authority, escalation path, and
  memory touchpoints. Edit nodes in the UI.
- **Console** — live system log (`[DB]`, `[SYSTEM]`, `[DB WORKSPACE]` lines).
- **Save** — with the DB connected, *Save* syncs the whole roster to Supabase
  (`POST /api/roster`, atomic per-guild overwrite). Offline, saves stay in
  memory only and the console says so — nothing is lost silently.

### The governance / payment API (independent of the roster DB)
This is the trust core. It needs only `WF_WEBHOOK_SECRET` (no Supabase):

- `POST /api/webhooks/payment` — HMAC-verified (Stripe-scheme) webhook. A valid
  signed event is recorded as a SHA-256 hash-chained `payment-verified` decision.
- `GET /api/payments` — read-back of recorded payments **plus** a live
  `verifyEventChain()` integrity result (`{ ok: true, length, head }`).

Send a signed test event (replace the secret with your `WF_WEBHOOK_SECRET`):

```bash
SECRET="your-webhook-secret"
BODY='{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{"amount":4999,"currency":"usd"}}}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/.*= //')
curl -X POST https://<your-app>.vercel.app/api/webhooks/payment \
  -H "wf-signature: t=$T,v1=$SIG" -H 'Content-Type: application/json' -d "$BODY"
# → {"received":true,"tx_hash":"…","chain_head":"…"}

curl https://<your-app>.vercel.app/api/payments
# → {"chain":{"ok":true,"length":1,"head":"…"},"payments":[…]}
```

Fail-closed responses you may see (all by design): `401 PAY-02` (bad signature),
`401 PAY-03` (replay/expired), `409 PAY-07` (duplicate event), `503 ENV-03`
(secret not set). The gateway is a **mock** — no real money moves.

### Run it locally

```bash
npm ci
npm start                 # http://localhost:5000  (the client auto-targets :5000)
# optional: put SUPABASE_URL / SUPABASE_ANON_KEY / WF_WEBHOOK_SECRET in .env
```

Verify everything: `npm test` (8 suites, 144 assertions) · `npm run test:matrix`
(48 lanes) · `npm run build && npm run verify`.
