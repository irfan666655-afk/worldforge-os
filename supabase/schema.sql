-- WorldForge OS — Supabase schema for the roster-api seam.
--
-- Run this in your Supabase project (SQL Editor → New query → Run) to create
-- the two tables the server's /api/roster endpoint reads and writes. Once the
-- tables exist AND the SUPABASE_URL / SUPABASE_ANON_KEY env vars are set on
-- the deployment, the UI badge flips from "OFFLINE MOCK" to "DATABASE CONNECTED".
--
-- Column names below match src/server.js exactly (guilds.key/name, agents.
-- responsibility/authority/escalation_targets/memory_touchpoints, agents.guild_id
-- → guilds.id). Do not rename them without also updating the server.

create table if not exists public.guilds (
  id          bigint generated always as identity primary key,
  key         text unique not null,
  name        text not null,
  description text
);

create table if not exists public.agents (
  id                 bigint generated always as identity primary key,
  guild_id           bigint not null references public.guilds(id) on delete cascade,
  name               text not null,
  responsibility     text,
  authority          text,
  escalation_targets text[] default '{}',
  memory_touchpoints text
);

create index if not exists agents_guild_id_idx on public.agents(guild_id);

-- ---------------------------------------------------------------------------
-- Access. The app talks to Supabase with the ANON key (client-visible), and
-- POST /api/roster performs inserts/deletes, so the anon role needs write
-- access. The simplest way to get the demo running is to DISABLE row-level
-- security on these two tables:
--
--   ⚠️  This makes guilds/agents publicly readable AND writable via the anon
--       key. That is fine for a demo/roster board. For production, instead
--       keep RLS enabled, move writes to a server-side SERVICE_ROLE key, and
--       write explicit policies. See docs/USAGE.md.
alter table public.guilds disable row level security;
alter table public.agents disable row level security;

-- ---------------------------------------------------------------------------
-- Optional seed so the roster is non-empty on first load (the UI shows
-- "DATABASE CONNECTED" only when at least one guild is returned). Safe to
-- re-run: the ON CONFLICT clause makes the guild insert idempotent.
insert into public.guilds (key, name, description)
values ('dev', 'Creative Guild', 'Seed guild for first-run connectivity')
on conflict (key) do nothing;

insert into public.agents (guild_id, name, responsibility, authority, escalation_targets, memory_touchpoints)
select g.id, 'Creative Director',
       'Formulates visual style schemes and layout specifications.',
       'May authorize UI upgrades and deployment schemas.',
       array['Project Manager'],
       'Local aesthetic asset configuration vectors.'
from public.guilds g
where g.key = 'dev'
  and not exists (select 1 from public.agents a where a.guild_id = g.id and a.name = 'Creative Director');
