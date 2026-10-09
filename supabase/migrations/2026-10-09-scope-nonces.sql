-- =============================================================================
-- 2026-10-09 - scope nonces to the action they were issued for
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is additive and safe to run twice.
--
-- WHY
--
-- The outstanding-nonce cap in /api/prank/prepare needs to ask "how many unused
-- nonces does this ADDRESS have for this TOKEN on this DAY". Without the two
-- columns below it could only ask per address, so a wallet holding four Chogs
-- would be blocked from preparing with one of them because it had prepared with
-- another.
--
-- These columns are NOT a security control. A nonce's HMAC already binds the
-- address, both token ids, the prank and the day, and /commit re-derives and
-- checks that binding. These exist purely so the cap can be scoped the way its
-- comment claims.
--
-- Existing rows keep NULL for both columns. They are already consumed or
-- expired and are ignored by the cap, which only counts unused, unexpired rows.
-- =============================================================================

alter table public.nonces
  add column if not exists from_token_id integer,
  add column if not exists day date;

-- Partial index: the cap only ever reads unused rows, and there are far fewer
-- of those than nonces in total.
create index if not exists nonces_outstanding_idx
  on public.nonces (address, from_token_id, day)
  where used_at is null;

comment on column public.nonces.from_token_id is
  'Token the nonce was issued for. Scopes the outstanding-nonce cap per Chog '
  'rather than per wallet. Not a security control: the nonce HMAC already binds '
  'the action.';

comment on column public.nonces.day is
  'UTC day the nonce was issued for. Same purpose as from_token_id: scoping, '
  'not security.';