# Chog Mischief

A daily prank war where every Chog Genesis NFT is a player.

**Your reputation lives on the token. Signed, verifiable, and it transfers with
the Chog.**

No gas. No transactions. No approvals. Wallets only sign messages.

## How it works

Every Chog Genesis NFT (Monad mainnet, 1,969 of them) is a persistent player.
Connect the wallet that holds one, pick your Chog, and spend your one daily
prank on a target.

**The NFT is the player.** All game state keys on the token id, not the wallet,
so a Chog keeps its points, badges, grudges and chaos history when it changes
hands. Traits are the gameplay:

- **Tier** decides which prank rarities your Chog can pull, and its base points
- **Head** and **Accessory** unlock one signature prank each, whatever the tier
- **Mouth** traits unlock taunt pranks
- **Aura** sets your dodge chance, so a rare target is genuinely harder to hit
- **Eyes** lower your target's dodge, so a good-eyed attacker lands more pranks

Every action is an EIP-712 signature that carries **intent only**: which Chog,
which target, which prank, which day. The signed message contains no outcome,
because there is nothing to forge in it. The server verifies the signature,
consumes a single-use nonce, re-reads ownership live from Monad, and only then
rolls the outcome itself. The client never decides whether a prank landed,
what it scored, or whether revenge applies.

## What's built

Everything here is a route that exists and is tested.

**Play**

- `/` landing page: hero, the live chaos feed, and the three-step explainer
- `/guest` **the demo path.** A no-wallet visitor gets a temporary Guest Chog
  and pranks practice bots. Zero signatures, no database writes, nothing on the
  real leaderboard, resets on reload. Guests never prank real Chogs.
- `/pick` choose which of your Chogs to play as
- `/prank` the core loop: pick a target from all 1,969, pick a weapon from the
  pranks your traits unlock (locked ones say which trait they need), sign, then
  HIT or DODGED. The daily limit is checked **before** you sign anything.
- `/inbox` two queues: **Revenge** (2x points, preselects the attacker as your
  target) and **Clean** (remove an overlay from your Chog's art, once a day)

**Your stuff**

- `/hq` the signed-in dashboard: your Chog's points, streak, badges, today's
  ammo, and recent chaos in both directions
- `/profile/<id>` one Chog's record: points, streak, badges, the overlays on its
  art, who it has a grudge against, and its history
- `/ranks` Weekly (most chaotic, most wanted, best dodger), All-time points,
  and Rivalries head-to-head. Your own Chogs are highlighted.

**Public**

- `/chog/<id>` 1,969 pre-rendered shareable pages with traits, unlocked pranks,
  owner, chaos history, and a prank button that preselects that target
- The chaos feed on the landing page and on `/api/chaos`: token ids and names
  only. It reads a Supabase view that has no signer or signature column, behind
  a code allow-list, and pads with rows labelled as examples until real pranks
  exist.

**Both**

Phone-first layouts throughout, with tablet and desktop treatments: a one-row
icon header at 768px, rails on desktop, and no horizontal overflow at any width.

## The security model

The full version, with the trait tables and the fairness proof, is in
[`DESIGN.md`](DESIGN.md). In short:

1. **The wallet signs intent, never outcomes.** The EIP-712 message has no
   `landed`, `points`, `dodgeRoll` or `revenge` field to set.
2. **The nonce is issued by the server** and bound to the exact action, then
   consumed atomically. Replaying one is refused.
3. **Ownership is re-read from Monad at commit time**, not trusted from
   sign-in, so a token that moved in between is caught.
4. **The roll is derived, not random.** It is an HMAC over the participants and
   the day, decided after verification, so the same target on the same day
   always gives the same result. There is nothing to reroll by rejecting a
   signature and asking again.

Public surfaces never project a wallet address: the feed reads a view that
structurally cannot contain one, and the leaderboards key on token ids.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind for layout only)
- Monad mainnet public RPCs for reads
- Supabase free tier for game state
- Reown/AppKit + Wagmi for the wallet connection
- Vercel Hobby for hosting

Nothing here costs money to run or play.

## Running it locally

```bash
npm install
cp .env.example .env    # then fill in the values, see below

npm run test            # unit tests
npm run dev             # http://localhost:3000
```

A fresh clone works without any network step: `data/snapshot/chogs.json` carries
public metadata (token id, name, traits, image URL) for all 1,969 Chogs and is
used whenever the live cache is absent. To refresh it from chain:

```bash
python3 scripts/harvest-traits.py --concurrency 6
npm run snapshot:chogs
```

You need a free Reown project id, a Supabase URL with its secret key, a 32-byte
`SESSION_SECRET` (`openssl rand -hex 32`) and a `CRON_SECRET` (same generator)
which Vercel sends when it fires the daily keep-awake cron. The four server
values must NOT have a `NEXT_PUBLIC_` prefix. No secret is committed to this
repo.

### Applying the database schema

`supabase/schema.sql` creates the tables, the anti-abuse constraints and the
leaderboard views. Run it in the Supabase SQL editor, then apply the public feed
view from `scripts/supabase-recent-chaos-view.sql` (or run
`node scripts/apply-feed-view.mjs`, which does it for you).

### Checking a deployment is wired up

```bash
curl https://your-deployment.vercel.app/api/health
```

Returns booleans only, never a value: `supabaseOk`, `viewOk`, `rpcOk`,
`sessionSecretSet`. `viewOk: true` with `chaosRowsSampled: 0` means "wired
correctly, nobody has pranked yet"; `viewOk: false` means it is silently reading
the base tables.

## Tests

```bash
npm run test      # 344 unit: rules, powers, pranks, signing, feed, snapshots
npm run test:ui   # 71 Playwright: design invariants, responsive, every screen
npm run build     # production build
npm run sim:balance # roll the real rules over all 1,969 Chogs, print the numbers
```

Live verification scripts hit the real chain and a running server using
throwaway keys, never a real wallet:

```bash
npm run verify:chain          # contract reads against Monad
npm run verify:signin         # the sign-in flow
npm run verify:nonces         # nonce issue/consume against Supabase
npm run verify:prank          # the prank rules against the live database
npm run verify:prank:forgery  # the forged-outcome and reroll attacks
```

The prank flow's happy path is covered by a Playwright test that mocks the API
routes and uses a test signer, because it needs a signature from the current
on-chain owner of a real Chog, and we will never ask a holder for a private key.
The server still runs every real check, so the mock only proves the client flow.

The Playwright setup fails the whole run if the served CSS does not match the
current build, because an unstyled page passes every DOM assertion while
looking completely broken.

## Project layout

```
src/app/            routes: landing, /guest, /pick, /prank, /hq, /inbox,
                    /ranks, /profile/[id], /chog/[id], and the API
src/components/     the UI kit, ported from the design prototype
src/game/           the pure game logic: powers, rules, the prank catalogue
src/lib/            chain reads, signing, sessions, the Supabase client
src/middleware.ts   /profile redirect to the active Chog
design/source/      the original design kit the UI was ported from
scripts/            harvesting, live verification, balance sim, database setup
supabase/           the schema
data/snapshot/      tracked public Chog metadata for fresh clones
data/owners.json    the tracked owner index for all 1,969 Chogs
```

## Notes for judges

- `AGENTS.md` is deliberately **not** in this repo. It is a local working file
  that records build history and decisions, and it is excluded so the
  repository contains only what the project needs.
- `data/cache/` is gitignored on purpose: the trait cache is regenerated from
  the chain rather than trusted from a commit. `data/snapshot/chogs.json` is the
  committed fallback, and it holds public metadata only - never an owner or a
  wallet address.
- `npm audit` reports 5 high-severity advisories. Every one of them is in the
  lint toolchain: the chain runs `eslint-config-next` to
  `@next/eslint-plugin-next`, `braces`, `fast-glob` and `micromatch`, and all
  five are devDependencies. Nothing in `dependencies` is affected, and lint
  runs on a developer machine and ships no code.
  `npm audit fix --force` is deliberately not run: it downgrades packages to
  versions that break the Next.js build, trading a real dependency for a
  warning about code that never executes in production.

## License

MIT, (c) 2026 cipoklean. See `LICENSE`.

Built for Chogathon 2026.
