-- Chog Mischief — Supabase schema
--
-- Design rules that the rest of the app depends on:
--
--  1. GAME STATE KEYS ON token_id, NEVER ON wallet. Selling a Chog must carry
--     its reputation and its grudges with it. There is no wallet column on any
--     gameplay table for exactly this reason.
--  2. Anti-abuse lives in the DATABASE, not in application code: the daily limit
--     is a unique constraint, so a race between two requests cannot produce two
--     pranks. Application-level checks are for nicer error messages only.
--  3. Every prank is a signed, verifiable action. The signature and the typed
--     data are stored so the prank log is public proof, not a database claim.
--  4. RLS is enabled everywhere. All writes go server-side with the service key;
--     the anon role gets read-only access to public tables so the UI can render
--     without a session.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Trait cache (the NFT itself)
-- ---------------------------------------------------------------------------
create table if not exists public.chogs (
  token_id      integer primary key,            -- 1..1969, the player identity
  name          text        not null,            -- "CHOG #954"
  image_url     text,                           -- resolved art (IPFS gateway URL)
  image_gateway text,                           -- which gateway served it
  traits        jsonb       not null default '{}'::jsonb,
  owner_address text,                           -- cached ~60s; NOT authoritative
  owner_checked_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.chogs.owner_address is
  'Cached ownerOf() read, ~60s TTL to stay under public RPC limits. Always re-read on-chain before a signed action.';

create index if not exists chogs_owner_idx on public.chogs (owner_address);
create index if not exists chogs_traits_idx on public.chogs using gin (traits);

-- ---------------------------------------------------------------------------
-- Sign-in nonces (SIWE-style)
-- ---------------------------------------------------------------------------
create table if not exists public.nonces (
  nonce      text primary key,
  address    text        not null,
  expires_at timestamptz not null,             -- 10 minutes
  used_at    timestamptz,                      -- single use
  created_at timestamptz not null default now()
);

create index if not exists nonces_address_idx on public.nonces (address);

-- ---------------------------------------------------------------------------
-- Pranks — a signed action, stored as public verifiable proof
-- ---------------------------------------------------------------------------
create table if not exists public.pranks (
  id            uuid primary key default gen_random_uuid(),
  from_token_id integer     not null references public.chogs (token_id),
  to_token_id   integer     not null references public.chogs (token_id),
  prank_id      text        not null,          -- which prank from the catalogue
  day           date        not null,          -- UTC day; the daily-limit key
  landed        boolean     not null,          -- false = the target dodged
  dodge_roll    numeric(5,4),                 -- the roll vs the dodge chance
  dodge_chance  numeric(5,4),
  points        integer     not null default 0,
  revenge       boolean     not null default false,
  week          date        not null,          -- ISO week start; leaderboard key

  -- signed EIP-712 payload + signature, so the log is verifiable by anyone
  signature     text        not null,
  signer        text        not null,          -- wallet that signed (the owner)
  signed_nonce  text        not null,

  created_at    timestamptz not null default now(),

  constraint pranks_not_self check (from_token_id <> to_token_id)
);

-- THE daily-limit constraint. One prank per (token, day), enforced by Postgres,
-- so two simultaneous requests cannot both succeed.
create unique index if not exists pranks_daily_limit
  on public.pranks (from_token_id, day);

create unique index if not exists pranks_nonce_unique
  on public.pranks (signed_nonce);

create index if not exists pranks_to_idx     on public.pranks (to_token_id, created_at desc);
create index if not exists pranks_from_idx   on public.pranks (from_token_id, created_at desc);
create index if not exists pranks_week_idx   on public.pranks (week);
create index if not exists pranks_created_idx on public.pranks (created_at desc);

-- ---------------------------------------------------------------------------
-- Cleans — removing an overlay. Same shape, its own daily limit.
-- ---------------------------------------------------------------------------
create table if not exists public.cleans (
  id           uuid primary key default gen_random_uuid(),
  token_id     integer     not null references public.chogs (token_id),
  prank_id     uuid        not null references public.pranks (id) on delete cascade,
  day          date        not null,
  week         date        not null,
  signature    text        not null,
  signer       text        not null,
  signed_nonce text        not null,
  created_at   timestamptz not null default now()
);

-- One clean per (token, day), same reasoning as the prank limit.
create unique index if not exists cleans_daily_limit
  on public.cleans (token_id, day);

create unique index if not exists cleans_nonce_unique
  on public.cleans (signed_nonce);

-- ---------------------------------------------------------------------------
-- Active overlays — max 3 per victim; a 4th replaces the oldest
-- ---------------------------------------------------------------------------
create table if not exists public.overlays_active (
  id          uuid primary key default gen_random_uuid(),
  token_id    integer     not null references public.chogs (token_id),
  prank_id    uuid        not null references public.pranks (id) on delete cascade,
  caption     text        not null,            -- "#1049 got slimed by #313"
  created_at  timestamptz not null default now(),
  -- unique per (token, prank) so a landed prank cannot stack twice
  unique (token_id, prank_id)
);

create index if not exists overlays_token_idx
  on public.overlays_active (token_id, created_at);

-- ---------------------------------------------------------------------------
-- Streaks — consecutive prank days, multiplier capped at 3x
-- ---------------------------------------------------------------------------
create table if not exists public.streaks (
  token_id      integer primary key references public.chogs (token_id),
  current_streak integer not null default 0,
  longest_streak  integer not null default 0,
  last_prank_day  date,                          -- for the consecutive-day check
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Badges — First Blood, Payback, Untouchable, Most Wanted
-- ---------------------------------------------------------------------------
create table if not exists public.badges (
  token_id   integer     not null references public.chogs (token_id),
  badge      text        not null,
  earned_at  timestamptz not null default now(),
  primary key (token_id, badge)
);

-- ---------------------------------------------------------------------------
-- Demo mode — guests get a temporary Chog, sandbox only
-- ---------------------------------------------------------------------------
create table if not exists public.demo_sessions (
  id          uuid primary key default gen_random_uuid(),
  demo_token_id integer   not null references public.chogs (token_id),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists demo_sessions_exp_idx
  on public.demo_sessions (expires_at);

-- Guest actions are flagged so they can NEVER touch a real holder's page.
create table if not exists public.demo_actions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid        not null references public.demo_sessions (id) on delete cascade,
  from_token_id integer    not null,
  to_token_id  integer     not null,
  prank_id     text        not null,
  landed       boolean     not null,
  created_at   timestamptz not null default now()
);

create index if not exists demo_actions_session_idx
  on public.demo_actions (session_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chogs_touch on public.chogs;
create trigger chogs_touch before update on public.chogs
  for each row execute function public.touch_updated_at();

drop trigger if exists streaks_touch on public.streaks;
create trigger streaks_touch before update on public.streaks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Leaderboard views
-- ---------------------------------------------------------------------------
create or replace view public.weekly_most_chaotic as
select from_token_id as token_id,
       sum(points)::bigint as points,
       count(*)::bigint as pranks
from public.pranks
where landed
group by from_token_id;

create or replace view public.weekly_most_bullied as
select to_token_id as token_id,
       count(*)::bigint as pranks_received
from public.pranks
where landed
group by to_token_id;

create or replace view public.weekly_best_dodger as
select to_token_id as token_id,
       count(*)::bigint as dodges
from public.pranks
where not landed
group by to_token_id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.chogs            enable row level security;
alter table public.nonces           enable row level security;
alter table public.pranks           enable row level security;
alter table public.cleans           enable row level security;
alter table public.overlays_active  enable row level security;
alter table public.streaks          enable row level security;
alter table public.badges           enable row level security;
alter table public.demo_sessions    enable row level security;
alter table public.demo_actions     enable row level security;

-- Public read: the UI renders Chogs, pranks and boards without a session.
drop policy if exists chogs_read on public.chogs;
create policy chogs_read on public.chogs for select using (true);

drop policy if exists pranks_read on public.pranks;
create policy pranks_read on public.pranks for select using (true);

drop policy if exists cleans_read on public.cleans;
create policy cleans_read on public.cleans for select using (true);

drop policy if exists overlays_read on public.overlays_active;
create policy overlays_read on public.overlays_active for select using (true);

drop policy if exists streaks_read on public.streaks;
create policy streaks_read on public.streaks for select using (true);

drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select using (true);

-- Everything else: NO anon/authenticated access. Writes happen server-side with
-- the service role, which bypasses RLS. Guest demo rows are deliberately not
-- readable by anon, so a guest cannot enumerate the sandbox.