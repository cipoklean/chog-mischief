You are building CHOG MISCHIEF for Chogathon 2026 (https://chogathon.chog.xyz). Read this whole brief before writing code. Save it in the repo root as SPEC.md and treat it as the source of truth.

== 0. FIRST: AGENTS.md (standing rule, effective now) ==
1. Create the project root folder `chog-mischief/` and `git init` it.
2. Create AGENTS.md in the root. It is your working memory: anyone reading only AGENTS.md must know what this is, where the build stands, how to run it, and what to do next.
3. Add AGENTS.md to .gitignore right away, before the first commit. It stays local and must NEVER be committed or pushed. Also gitignore: .env, .env.local, node_modules, .next, .vercel, data/cache/.
4. Run `git check-ignore AGENTS.md` and confirm it prints AGENTS.md. If AGENTS.md was ever staged, run `git rm --cached AGENTS.md`.

AGENTS.md sections, in this order:
1. PROJECT SNAPSHOT (rewrite in place): what Chog Mischief is in 3 sentences, the hackathon, the dates, the deliverables, and a pointer to SPEC.md.
2. CURRENT STATUS (rewrite in place): the current phase and % done, what works (and how it was verified), what is broken, blockers and what David must do to clear them, and NEXT STEPS (the 3 to 5 next concrete tasks).
3. HOW TO RUN (rewrite in place): copy-paste commands to install, run locally, seed the trait cache, run tests and deploy. Every env var by NAME only, with its purpose. Never write a value.
4. ARCHITECTURE MAP (rewrite in place): a folder tree with one line per important file, the DB tables, the API routes and the game rules as implemented.
5. DECISIONS LOG (append only): date, decision, why, and the alternatives rejected.
6. GOTCHAS (append only): anything that cost you more than 10 minutes (Monad RPC limits, metadata/IPFS issues, wallet quirks, Supabase/Vercel errors).
7. ACTIVITY LOG (append only, newest at the bottom), one entry per session:
   ### YYYY-MM-DD HH:MM WAT - title
   - Did / Files / Commands + results / Result (works, partial or failed) / Next
Rules: read AGENTS.md before every session and continue from NEXT STEPS. Update it after every phase, failed attempt or decision, at least every 30 minutes, and ALWAYS before you report back to David. Never put secrets, keys or private keys in it. If the activity log passes ~400 lines, move older entries to AGENTS_ARCHIVE.md (also gitignored).

== 1. THE HACKATHON (constraints) ==
- Chogathon 2026: 14 days to build, from about Oct 8 2026, 5 PM WAT. Treat Oct 21 as our internal finish and the submission deadline as about Oct 22 (confirm the exact deadline on the site/Discord and log it).
- Hard rule: the Chog NFT must be essential. If you removed the NFT, the experience must break.
- Judging: Novelty 30%, Fun 20%, Retention 20%, Clarity 15%, Execution 15%, plus an optional $CHOG bonus (SKIP it, see budget).
- Submission needs: project name, team, Discord/X handles, what it does and why it's new, why Chog is essential, a working demo URL, a demo video of 3 minutes or less, simple testing instructions, the repo, the tech stack, any pre-existing work, user feedback/usage, and what's next.

== 2. BUDGET: ZERO. NOTHING MAY COST MONEY ==
David has no funds. Hard rules:
- No paid APIs, no paid hosting, no smart contract deployments on mainnet, no transactions that need MON gas, no $CHOG integration.
- Wallets only SIGN messages (free, gasless). Reads come from free public Monad RPCs.
- Free tiers only: Vercel Hobby, Supabase Free, WalletConnect/Reown free project ID.
- If something would cost money, stop, log it in AGENTS.md and ask David.

== 3. THE PRODUCT ==
One line: a daily prank war where every Chog Genesis NFT is a mischievous player. You prank other Chogs, they prank back, and every Chog carries its chaos history forever.

Core loop:
1. Connect a wallet and sign in with a gasless signed message (SIWE-style nonce).
2. The app reads which Chog Genesis tokens the wallet holds. Pick your Chog.
3. Your Chog gets 1 PRANK per day (resets 00:00 UTC). Pick a target Chog by token ID, from the feed or from "Rivals", and pick a prank from the pranks your Chog's traits unlock.
4. The prank lands, unless the target DODGES based on its traits. It shows as an overlay on the victim's Chog everywhere in the app: a mustache, slime, a cone of shame, a fake "FOR SALE" sign, googly eyes, a toilet-paper wrap, etc.
5. The victim's owner gets 1 CLEAN per day to remove an overlay, OR can REVENGE prank. Revenge within 24h gets 2x chaos points and a "Payback" badge.
6. Chaos points feed the leaderboards: Most Chaotic (points dealt), Most Bullied (pranks received), Best Dodger, and Longest Streak. They reset weekly, with an all-time Hall of Fame.
7. Streaks: prank on consecutive days to build a streak multiplier (cap 3x).

Why the NFT is essential (put this in the README and the submission):
- The token IS the player. All game state (pranks dealt and received, grudges, streak, badges) is keyed to the TOKEN ID, not the wallet. Sell the Chog and its whole reputation and its grudges go with it.
- Traits ARE the gameplay. Each Chog's traits decide which pranks it can pull, its accuracy and its dodge chance, so no two Chogs play the same.
- The victim is someone's specific NFT and its actual art. Take the NFT out and there's no player, no target, no powers and no rivalry.

Trait → power mapping:
- Collection: Chog Genesis, 1,969 tokens, ERC-721 on Monad mainnet, contract 0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763 (from OpenSea; verify on monadscan.com and log it).
- Trait categories seen on OpenSea: Accessory, Aura, Background, Base, Body, Eyes, Form, Head, Mouth, Naked, Side, Skin, Tier.
- Step 1: write scripts/seed-traits.ts. It reads tokenURI for all 1,969 tokens through the public RPC (respect the rate limits: batch it, throttle, retry), fetches the metadata (handle IPFS through public gateways with fallbacks), and caches it to Supabase (table chogs) plus data/cache/. Log every unique trait value and its count.
- Step 2: build a deterministic mapping in src/game/powers.ts, then document it in AGENTS.md and on an in-app "How it works" page:
  - Tier → prank power level (which prank rarities it can use) and base points.
  - Aura → dodge chance (from 5% to a cap of 35%).
  - Eyes → accuracy (it lowers the target's dodge).
  - Mouth → unlocks "taunt" pranks.
  - Head and Accessory → each unlocks one signature prank themed on that trait.
  - Rare trait values (lowest counts) → a bonus legendary prank once per week.
  Keep it simple, fun and explainable in one screen. Balance it so no Chog is useless.

Pranks: at least 10 at launch, in 3 rarities (Common, Rare, Legendary). Each one is a transparent PNG/SVG overlay layered on the Chog's real image, with a funny one-line caption ("#1049 got slimed by #313"). Draw them as simple SVG yourself; no paid assets.

Screens (mobile-first, because most players are on phones):
- Home: the live Prank Feed, with your Chog's daily prank/clean status and a countdown.
- Chog page /chog/[id]: the Chog's art with its current overlays stacked, stats from traits, a prank history, its top rivals (the Chogs it has the most back-and-forth with) and badges. Every Chog has one, even unclaimed ones.
- Prank flow: target search by ID, prank picker, confirmation and the result animation (landed or dodged).
- Leaderboards: weekly and all-time.
- Share card: a dynamic OG image per prank and per Chog (@vercel/og) and a "Share on X" button with prefilled text. This is the growth loop.
- How it works: the rules and the trait → power table.
- DEMO MODE (critical for judges, who likely don't hold a Chog): a "Try as a guest" button gives a temporary demo Chog (a random real Chog shown as "Demo") in a sandbox. Guest pranks are labeled DEMO, and they only show in the sandbox feed, never on real holders' Chogs.

Retention mechanics: the daily reset, revenge windows, streaks, the weekly boards, the "you got pranked" inbox on your Chog page and badges (First Blood, Payback, Untouchable after 5 dodges in a row, Most Wanted after being pranked by 10 different Chogs).

== 4. TECH STACK ==
- Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel Hobby.
- wagmi + viem + RainbowKit (or Reown AppKit) for wallet connect; Monad mainnet chain ID 143, RPC https://rpc.monad.xyz, with fallbacks https://rpc1.monad.xyz and https://rpc3.monad.xyz. Explorer: monadscan.com / monadvision.com.
- Sign-in: SIWE-style nonce + signature, verified server-side with viem verifyMessage, then a session cookie.
- Every prank and clean is signed by the wallet (EIP-712 typed data: action, fromTokenId, toTokenId, prankId, day, nonce). The server verifies the signature AND re-checks ownerOf(fromTokenId) on-chain at action time before saving. Keep the signatures as a public, verifiable prank log.
- Supabase (Postgres) for chogs (trait cache), pranks, cleans, overlays_active, streaks, badges, nonces and demo_sessions. Turn on Row Level Security and do all writes server-side with the service key (an env var, never committed).
- Cache ownerOf reads briefly (about 60s) to stay under the RPC rate limits.
- Tests: vitest for the game rules (daily limits, dodge math, revenge window, streaks, transfer behaviour), plus a Playwright smoke test of the demo mode.

== 5. ANTI-ABUSE ==
- 1 prank and 1 clean per TOKEN per UTC day, enforced in the DB (unique constraint on token_id + day + action).
- A Chog can't prank itself, or a Chog held in the same wallet.
- Max 3 active overlays per victim. A 4th replaces the oldest.
- Nonces are single-use and expire after 10 minutes.
- Rate limit the API routes per wallet and per IP.

== 6. TIMELINE (14 days) ==
- Days 1 to 2: repo, AGENTS.md, .gitignore, Next.js scaffold, Supabase schema, seed-traits script, trait report in AGENTS.md.
- Days 3 to 4: wallet connect, SIWE sign-in, holdings lookup, Chog pages with real art and stats.
- Days 5 to 7: the prank engine (signed actions, ownership checks, dodge/accuracy, overlays, daily limits, cleans, revenge) with tests.
- Days 8 to 9: the feed, leaderboards, streaks, badges and inbox.
- Days 10 to 11: share cards and X sharing, demo mode, the How It Works page, mobile polish, sound/animation juice.
- Day 12: deploy to production on Vercel, get real Chog holders playing (post in discord.gg/chog) and collect feedback and usage numbers.
- Day 13: fix bugs, write the README (what it is, why Chog is essential, the rules, the stack, how to test in demo mode, any pre-existing work: none) and the submission text.
- Day 14: record the 3-minute demo video, plus a final check that the live URL and demo mode work in a fresh incognito window.

== 7. DEFINITION OF DONE ==
- The live Vercel URL works on mobile; a judge with no wallet can play demo mode in under 60 seconds.
- A real holder can sign in, prank, get pranked, clean, revenge and see it on the leaderboards, all without spending any MON.
- Every Chog has a shareable page and an OG image.
- The tests pass, and the README covers testing in 3 steps.
- The repo is public with an MIT license, and AGENTS.md is NOT in it (verify with `git ls-files | grep -i agents` returning nothing).
- The submission text and the video are ready.

== 8. HOW TO WORK WITH DAVID ==
- He's often on his phone with limited data. Keep reports short: what you did, what works, what's blocked, the next steps.
- Ask him only for things you can't do yourself (his X/Discord handles, creating free accounts that need his login, the Vercel/Supabase project links). Never ask for or store private keys.
- Report back after each phase, after AGENTS.md is updated.

Start now: do Section 0, then Days 1 to 2. Then reply with the trait report summary and your NEXT STEPS.
