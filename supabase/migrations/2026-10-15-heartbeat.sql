-- =============================================================================
-- 2026-10-15 - heartbeat: a row we WRITE, so the keep-awake actually registers
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is additive and safe to run twice.
--
-- WHY
--
-- Supabase pauses a Free project after a week of low activity, and a paused
-- project refuses every query - which would take the game down mid-judging.
--
-- The keep-awake cron has been hitting /api/health every day, and /api/health
-- does real reads. That was supposed to be enough, and on paper it is: the docs
-- say a few daily requests to the database is all it takes. It was not enough
-- here, for a reason worth writing down so nobody rebuilds it the same way.
--
-- THE ACTUAL FAILURE, and it was neither "the cron never fires" nor "reads do
-- not count". The auth gate at the top of the route returns BEFORE any database
-- call:
--
--     no CRON_SECRET  -> 503, and no query is ever sent
--     wrong bearer    -> 401, and no query is ever sent
--     correct bearer  -> only now does it fetch /api/health and read
--
-- Between the cron being scheduled and the secret being set in Vercel, every
-- invocation bailed at that gate. The route was firing daily and touching
-- nothing, which is indistinguishable from being off - and the deployment
-- looked perfectly healthy the whole time, because a keep-awake that does not
-- keep anything awake reports no error.
--
-- So the fix is not "ping more often". It is to make the keep-awake WRITE
-- something, and to record WHEN it last did, so the next silent failure is
-- visible in /api/health instead of arriving as an email from Supabase.
--
-- A single-row table: `check (id = 1)` means the upsert always lands on the same
-- row rather than appending a log, so the table stays one row forever however
-- often it is beaten.
--
-- ACCESS
--
-- RLS is enabled with NO policies. That is deliberate and it is the whole
-- access model: the anon key can neither read nor write this table, and the
-- service role bypasses RLS so the app can do both. Adding a policy here would
-- be the mistake - there is no client that should ever see this row, and an
-- insert policy would let anyone holding the (public) anon key write it.
-- =============================================================================

create table if not exists public.heartbeat (
  id int primary key default 1 check (id = 1),
  beat_at timestamptz not null default now(),
  source text
);

-- The row must EXIST for a read to report a time, and an upsert is the only
-- thing that creates it. Seed it so a fresh project has something to update and
-- /api/health has something to read before the first real beat.
insert into public.heartbeat (id, beat_at, source)
values (1, now(), 'migration')
on conflict (id) do nothing;

alter table public.heartbeat enable row level security;

-- Assert the access model rather than trusting it: no policies at all, so only
-- the service role reaches the table. Modelled on the daily_commits migration,
-- because the same mistake is available here - a permissive policy added later
-- "to make the dashboard work" would quietly make this writable by anyone.
do $$
declare
  policy_count int;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'heartbeat';

  if policy_count <> 0 then
    raise exception
      'heartbeat has % policy(ies); it must have none so only the service role can reach it',
      policy_count;
  end if;
end $$;
