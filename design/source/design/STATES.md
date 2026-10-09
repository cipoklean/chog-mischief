# Chog Mischief: real-wallet states (approved by Hark, Oct 8 2026)
Build these with the existing x- classes only (x-card, x-btn, x-pill, x-av, x-cd, x-inc, x-feed, x-steps). No new visual language.

## Decisions
- A NO-WALLET VISITOR IS A FULL PLAYER. They get a temporary Guest Chog, not a demo reel. Guest pranks hit practice rivals (bots), never touch the real Supabase leaderboard, and reset on reload. This is the judge path: the full loop with zero signatures.
- LOADING IS NOT x-cd. x-cd is only for the daily reset and the daily-limit refusal. Loading uses skeletons and a short animated status line (see 6).
- WRONG NETWORK DOES NOT BLOCK page load. Ownership reads go through our own Monad RPC, not the wallet. Sign pranks with EIP-712 using domain chainId 143, so a signature can't be replayed on another chain, and ask for the network switch only at the sign step.

## 1. First run, no wallet (Landing)
- Hero art and h1 "Prank the Chogverse."
- Primary button (x-btn, yellow, full width): "Play now - no wallet". It goes to the Guest Chog screen.
- Secondary button (x-btn--p): "Connect wallet".
- Small text: "Got a Chog? Connect to make your pranks permanent."
- Below: the 3 latest x-feed items (the real feed when available), to show the game is alive.

## 2. Guest Chog / wallet with zero Chogs
- Title "Meet your Guest Chog".
- The card is an x-card with a DASHED 3px outline and a magenta x-pill "GUEST" tag.
- The guest uses one of the bundled Chog images, e.g. "#G-0420 Sir Snorts (Guest)", with traits and 3 unlocked pranks.
- Body: "Fully playable. Guest pranks hit practice rivals and don't count on the real leaderboard."
- Buttons: "Start pranking" (x-btn) and a text link "Get a real Chog".
- When the wallet is connected but holds 0 Chogs, the headline becomes "No Chogs in 0x7a3…c91 - borrow one for now." Use the real short address.
- In guest mode, show a slim sticky banner under the top bar: "Guest mode · progress resets · Own a Chog to keep it".
- Guest loop: about 8s after a guest prank lands, a practice rival pranks back. Show the x-inc Incoming card and the toast "#0311 Mayhem wants revenge!", so a judge sees revenge and clean-up too.

## 3. Wrong network
- Soft version, anywhere in the app: a yellow banner "You're on {chain}. Pranks are signed on Monad." with a [Switch to Monad] button.
- Hard version, only at the sign step: a modal with Chog art, h2 "Wrong chain, prankster.", body "Switch to Monad (chain 143) to sign. Still no gas.", and buttons [Switch network] [Cancel].
- To switch, call wallet_switchEthereumChain. If that fails, call wallet_addEthereumChain with chainId 0x8f, RPC https://rpc.monad.xyz, currency MON.

## 4. Signature refusals: one bottom sheet, 5 variants
| Case | Emoji | Headline | Body | Actions |
|---|---|---|---|---|
| User rejected | 🐔 | Chickened out? | You declined the signature. No gas was ever on the line. | Try again · Back |
| Wrong signer | 🕵️ | Imposter detected. | That signature came from a different wallet than the one connected. | Reconnect wallet |
| Not owner | 📦 | That Chog moved out. | #{id} isn't in this wallet anymore. Its record went with it. | Pick another Chog |
| Nonce replay | 🔁 | Déjà prank. | That prank was already used. Grab a fresh one. | Retry. First retry once silently with a new nonce; show this sheet only if that also fails. |
| Daily limit | ⏰ | #{id} already pranked today. | Big x-cd "Reloads in HH:MM:SS" counting to 00:00 UTC | Prank with another Chog · Back to HQ |

Check the daily limit BEFORE requesting a signature, so this sheet normally appears when the prank is selected, not after signing.

## 5. Empty states (big emoji, Lilita h3 headline, one line, one CTA)
- Inbox: 🫥 "Suspiciously quiet." / "Nobody's touched your Chog... yet." / [Start something] goes to /prank
- Pranks sent (profile history): 😇 "Squeaky clean record." / "Your Chog hasn't pulled a single prank. Shameful." / [Go prank]
- Badges: show the full shelf as grey "?" silhouettes, with "Land your first prank to unlock First Blood."
- Leaderboard: the normal list, plus your row pinned to the bottom with rank "-" and "Unranked · land one prank to get on the board".

## 6. Loading & latency
Timing: under 300ms show nothing; from 300ms to 10s show the state below; after 10s show the slow state.
- Skeletons: sticker-shaped x-card blocks the same size as the real content, with a purple shimmer (#25174F to #33216a). Use them for the Pick grid, leaderboard rows and inbox.
- Ownership check: the Chog card with 🔍 bobbing over it, "Checking #{id} is yours…" and a 3-dot bounce.
- Awaiting signature: 👛 wiggling, "Check your wallet to sign", small "No gas. Just a signature." No timer, and a [Cancel] button.
- Prank resolving: ALWAYS at least 1.2s of suspense, even when the server answers instantly. The target card shakes, "🥁 Rolling for dodge…" shows, and a progress bar sweeps, then the HIT or DODGED result. This is deliberate fun, not latency.
- Slow / timeout (over 10s): 🐌 "Monad's taking a nap." / "The network is slow right now." / [Retry] [Keep waiting]. Before showing it, fall back to rpc1.monad.xyz, then rpc3.monad.xyz.

Respect prefers-reduced-motion everywhere: drop the shake, bob and wiggle, and keep the text.
