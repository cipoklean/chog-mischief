# Chog Mischief

A daily prank war where every Chog Genesis NFT is a player.

Your Chog pranks other Chogs. They prank you back. Every hit, dodge, grudge and
win lives on the token forever, so a Chog's reputation travels with it when it
changes hands.

No gas. No transactions. No approvals. Wallets only sign messages.

## How it works

Every Chog Genesis NFT (Monad mainnet, 1,969 of them) is a persistent player.
Connect the wallet that holds one, pick your Chog, and spend your one daily
prank on a target.

**The NFT is the player.** All game state keys on the token id, not the wallet.
Traits are the gameplay:

- **Tier** decides which prank rarities your Chog can pull
- **Head** and **Accessory** traits unlock one signature prank each, no matter
  the tier
- **Mouth** traits unlock taunt pranks
- **Aura** sets your dodge chance, so a rare target is genuinely harder to hit
- **Eyes** traits lower your target's dodge

The server rolls the dodge, the points and the streak, and re-parses every
number out of the message you signed. The client never decides an outcome.

## What's built

- **Wallet sign-in** - gasless signature only, verified against live Monad
  ownership. A wallet with no Chog gets refused.
- **The prank flow** (`/prank`) - pick a target, pick your weapon from the
  pranks your traits unlock, sign, and watch it land or get dodged. Daily limit
  checked before you sign anything.
- **The guest path** (`/guest`) - a no-wallet visitor gets a temporary Guest
  Chog and pranks practice bots. Zero signatures, nothing touches the real
  leaderboard. This is the demo path.
- **1,969 shareable Chog pages** (`/chog/<id>`) - traits, unlocked pranks, chaos
  history, and a prank button that preselects the target.
- **A public chaos feed** on the landing page - the last 10 real pranks, no
  wallet addresses anywhere in it.
- **Tablet and desktop layouts** - CSS-only breakpoints, phone layout untouched.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind for layout only)
- Monad mainnet RPCs for reads (free public endpoints)
- Supabase (free tier) for game state, protected by row level security
- Reown/AppKit + Wagmi for the wallet connection
- Vercel Hobby for hosting

Nothing here costs money to run or play.

## Running it locally

```bash
npm install

# Harvest the trait cache (network, ~5 min for all 1,969 tokens).
# data/cache/ is gitignored, so every clone re-harvests rather than trusting
# a stale one. The app still runs without it, just with no Chog metadata.
python3 scripts/harvest-traits.py --concurrency 6

# Build the owner index (network, ~40s). Tracked in git, so you can skip this.
npm run harvest:owners

npm run dev
```

Open http://localhost:3000.

Copy `.env.example` to `.env` and fill in the values. You need a free Reown
project id, a Supabase URL with its service key, and a 32-byte
`SESSION_SECRET` (`openssl rand -hex 32`). Nothing secret is committed.

### Applying the database schema

`supabase/schema.sql` creates the tables, the anti-abuse constraints and the
leaderboard views. Run it in the Supabase SQL editor, then apply the public
feed view from `scripts/supabase-recent-chaos-view.sql` (or just run
`node scripts/apply-feed-view.mjs`, which does it for you).

## Tests

```bash
npm run test      # unit: game rules, pranks, powers, signing, ownership
npm run test:ui   # Playwright: design invariants, responsive layouts, the prank flow
npm run build     # production build
```

Live verification scripts (they hit the real chain and the running server,
using throwaway keys, never a real wallet):

```bash
npm run verify:chain    # contract reads against Monad
npm run verify:signin   # the sign-in flow against a running server
npm run verify:prank    # the prank rules against the live database
```

The prank flow's happy path is covered by a Playwright test that mocks the API
routes and uses a test signer, because it needs a signature from the current
on-chain owner of a real Chog, and we will never ask a holder for a private
key. The server still does every real check, so the mock only proves the
client flow.

## Project layout

```
src/app/            routes: landing, /guest, /prank, /pick, /chog/[id], the API
src/components/     the UI kit, ported from the design prototype
src/game/           the pure game logic: powers, rules, the prank catalogue
src/lib/            chain reads, signing, sessions, the Supabase client
design/source/      the original design kit the UI was ported from
scripts/            harvesting, live verification, database setup
supabase/           the schema
data/owners.json    the tracked owner index for all 1,969 Chogs
```

## Notes for judges

- `AGENTS.md` is deliberately **not** in this repo. It's a local working file.
- `data/cache/` is gitignored on purpose: the trait cache is regenerated from
  the chain, never trusted from a commit.
- The five npm audit advisories in the lint toolchain are dev-only and
  unreachable from production code. Details are in the local `AGENTS.md`.

Built for Chogathon 2026.
