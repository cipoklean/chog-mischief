-- =============================================================================
-- 2026-10-09 - remove the insert policy on daily_commits
--
-- Run this in the Supabase SQL editor AFTER 2026-10-09-daily-commits.sql.
-- It is idempotent and safe to run more than once.
--
-- WHY
--
-- The original migration granted `for insert with check (true)` so a row could
-- be written without the service role. That was wrong for two reasons:
--
--   1. The anon key is designed to be public. Supabase ships it in every
--      client bundle by definition, so "our anon key is not in the bundle" is
--      not a property anyone can rely on. Anyone holding it could insert a row
--      for a future day.
--   2. First write wins. A single pre-inserted hash for tomorrow would make
--      the server's derived hash disagree with the stored one, and
--      assertCommitment responds to a disagreement by refusing to roll - so one
--      anonymous INSERT would freeze every prank for that day.
--
-- The server writes with the service role, which bypasses RLS entirely, so it
-- needs no insert policy at all. Removing this one closes the vector without
-- affecting the application.
--
-- Public SELECT stays: /api/fairness serves the stored hash and that endpoint
-- is meant to be readable by anyone holding the value.
-- =============================================================================

drop policy if exists daily_commits_insert on public.daily_commits;

-- Guard: if any UPDATE or DELETE policy ever appears, this fails loudly rather
-- than leaving the table rewriteable.
do $$
declare
  writable text;
begin
  select string_agg(policyname, ', ')
    into writable
    from pg_policies
   where tablename = 'daily_commits'
     and policyname not in ('daily_commits_read');

  if writable is not null then
    raise exception 'daily_commits must be append-only, but these write policies exist: %', writable;
  end if;
end $$;