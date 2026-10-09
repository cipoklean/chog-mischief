-- =============================================================================
-- 2026-10-09 - store each day's fairness commitment
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is additive and safe to run twice.
--
-- WHY
--
-- /api/fairness used to recompute sha256(seed) from SESSION_SECRET on every
-- request. That hash is not a commitment at all: rotating SESSION_SECRET
-- silently rewrites every published hash and every seed, and nothing records
-- what was promised yesterday. A commitment that can be rewritten after the
-- fact is not one.
--
-- This table makes it durable. A day's hash is written ONCE, on first write,
-- and never updated or deleted. If the secret is ever rotated, the stored hash
-- for every past day stays exactly as it was, so yesterday's rolls remain
-- verifiable against the value that was actually published - and /api/fairness
-- refuses to serve a day whose derived hash disagrees with the stored one,
-- rather than quietly serving the new one.
--
-- FIRST WRITE WINS: the insert has an ON CONFLICT DO NOTHING, so two servers
-- racing on the same day cannot produce two different commitments.
-- =============================================================================

create table if not exists public.daily_commits (
  day        date primary key,
  commit_hash text        not null,
  created_at  timestamptz not null default now()
);

comment on table public.daily_commits is
  'One fairness commitment per UTC day, written once and never modified. '
  'Serves /api/fairness and lets a past day stay verifiable after a secret '
  'rotation.';

comment on column public.daily_commits.commit_hash is
  'sha256(seed) for that day, hex. Immutable once written: this is the value a '
  'player stores and later checks the revealed seed against.';

-- Insert-only, enforced by the database rather than by convention.
--
-- There is no UPDATE or DELETE policy, so with RLS enabled the anon and
-- authenticated roles cannot rewrite a published commitment even if a future
-- route were to try. All legitimate writes go through the service role, which
-- bypasses RLS, and the application never issues an UPDATE or DELETE against
-- this table anyway.
alter table public.daily_commits enable row level security;

drop policy if exists daily_commits_read on public.daily_commits;
create policy daily_commits_read on public.daily_commits for select using (true);

drop policy if exists daily_commits_insert on public.daily_commits;
create policy daily_commits_insert on public.daily_commits
  for insert with check (true);

-- No update policy and no delete policy: the rows are append-only by design.