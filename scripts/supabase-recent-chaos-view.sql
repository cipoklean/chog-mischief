-- ===========================================================================
-- recent_chaos - the PUBLIC chaos feed view
--
-- Paste this WHOLE FILE into the Supabase dashboard SQL Editor and run it.
-- (Supabase dashboard -> your project -> SQL Editor -> New query -> paste -> Run.)
--
-- WHAT IT DOES: joins pranks to the two Chog names and exposes ONLY the
-- columns the feed is allowed to show. The raw pranks table carries
-- `signer` (a wallet address) and `signature`; neither appears here, so the
-- public feed cannot leak them even if some future query forgets to filter
-- them - the view is the structural guard, and /api/chaos keeps its
-- allow-list as a second guard on top.
--
-- SAFE TO RUN TWICE: `create or replace view` overwrites, `drop policy if
-- exists` guards the policies. No data is touched.
-- ===========================================================================

create or replace view public.recent_chaos as
select
  p.id,
  p.from_token_id,
  -- LEFT JOIN + coalesce: a prank whose chogs row is missing still shows in
  -- the feed with a fallback name, rather than vanishing from the list.
  coalesce(cf.name, 'CHOG #' || p.from_token_id) as from_name,
  p.to_token_id,
  coalesce(ct.name, 'CHOG #' || p.to_token_id)   as to_name,
  p.prank_id,
  p.landed,
  p.revenge,
  p.points,
  p.created_at
from public.pranks p
left join public.chogs cf on cf.token_id = p.from_token_id
left join public.chogs ct on ct.token_id = p.to_token_id;

-- ---------------------------------------------------------------------------
-- Read access for the feed.
--
-- The app reads through the service key (server-side, all writes), but the
-- view is also granted to `anon` so the feed endpoint works for signed-out
-- visitors and the view can be inspected directly from the dashboard. The
-- underlying tables stay service-key-only: granting the view does NOT grant
-- the tables, which is exactly the containment we want.
-- ---------------------------------------------------------------------------
grant select on public.recent_chaos to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Confirm it worked - run this after the view is created:
--
--   select * from public.recent_chaos order by created_at desc limit 5;
--
-- The result must have NO `signer` and NO `signature` column.
-- Then tell Hermes: the next build switches /api/chaos to read the view.
-- ---------------------------------------------------------------------------
