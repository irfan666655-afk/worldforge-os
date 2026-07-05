# Publishing WorldForge OS to GitHub (Zero-Terminal)

Your local repo is already initialized and committed (`Initial commit: Integrated WorldForge OS v5.2 Frontend and Backend`). This guide covers publishing it using GitHub Desktop, then wiring up the deployments described in `blueprint_v2_integration.md`.

## 1. Publish with GitHub Desktop

1. Open **GitHub Desktop** and sign in with your GitHub account.
2. Click **File > Add local repository**.
3. Browse to `D:\worlforge-os` and select it. GitHub Desktop will detect the existing commit history.
4. Click **Publish repository** in the top bar.
5. Name it `worldforge-os`, choose Public or Private, and confirm. Leave "Keep this code private" checked unless you want it public.
6. Once published, the repo is live at `https://github.com/<your-username>/worldforge-os`.

## 2. What's in the repo

| Path | Purpose |
|---|---|
| `worldforge_v5_2.html` | Frontend UI, integrated with live API calls |
| `src/server.js` | Express backend (`/api/roster`, `/api/agents`) |
| `package.json` | Backend dependencies (`express`, `cors`, `@supabase/supabase-js`, `dotenv`) |
| `.env.example` | Template for required environment variables — copy to `.env` locally, never commit `.env` itself |
| `docs/` | Spec PDFs (Operating Manual, Phase 1 & 2 blueprints) |

`node_modules/`, `.env`, and `.claude/` are excluded via `.gitignore` and were never committed.

## 3. Next steps after publishing

Once the repo is on GitHub, follow the **Zero-Terminal Cloud Deployment Checklist**:

1. **Supabase** — create the project, run the SQL schema from `Blueprint_ Phase 1 Agent Foundry.pdf` Section 2 in the SQL Editor, and copy the Project URL + anon key.
2. **Render** — connect the new GitHub repo, set Build Command `npm install` and Start Command `node src/server.js`, and add `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `PORT` as environment variables.
3. **Frontend** — once Render gives you a live URL, replace the placeholder in the `API_BASE` block near the top of `worldforge_v5_2.html`'s `<script>` tag, commit, and push. If the HTML is also connected to Vercel, it will auto-redeploy.
