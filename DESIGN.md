# Chog Mischief: design

The rules, the security model and the fairness proof, in one place. This is the
document a reader wants when they have finished the README and want to know
whether the game is actually fair or merely claims to be.

Everything here is enforced in code, in pure functions, and covered by tests.
Where a number appears it is the number the code uses.

---

## 1. The idea

Every Chog Genesis NFT is a player. Your Chog pranks another Chog once a day;
that Chog's owner can prank you back or clean the mess. Points, badges,
grudges and chaos history accumulate on the **token**, not the wallet, so a
Chog that is sold arrives with everything it has been through.

Take the NFT out and the game stops existing: there is no identity to prank, no
traits to grant powers, and no reputation to carry.

### The collection

Chog Genesis is an ERC-721 on Monad mainnet, 1,969 tokens, contract
`0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`. Tiers: Common 1,279, Uncommon
590, Rare 60, Epic 30, Legendary 10.

---

## 2. Traits are the rules

Every power a Chog has is derived from its on-chain traits. There is no
separate stat to upgrade and nothing to buy: if you hold a different Chog, you
play differently.

| Trait | What it does |
|---|---|
| **Tier** | Which prank rarities the Chog can pull, and its base points |
| **Aura** | Dodge chance, 5% floor to 45% cap |
| **Eyes** | Accuracy, up to 0.20, which lowers the target's dodge |
| **Mouth** | Unlocks taunt pranks |
| **Head** | Unlocks one signature prank |
| **Accessory** | Unlocks one signature prank |
| **Rare trait values** | Unlocks the weekly legendary prank |

The trait tables were built by counting the real harvested values, not by
guessing. The rare-value lists carry their measured token counts in comments,
and a coverage test asserts the resulting distribution against the real
collection so an edit that hands a rare unlock to a third of the holders fails
the build.

### Resolving an attempt

```
effectiveDodge = clamp(target.dodgeChance - attackerAccuracy, 0.05, 0.45)
landed         = roll >= effectiveDodge
```

Both sides matter. The floor means **no Chog is ever undodgeable**, however good
the attacker's eyes are; the cap means the best Auras in the collection reach
their real value instead of being silently clipped.

### Points

```
points = round(basePoints * streakMultiplier * revengeMultiplier * targetMultiplier)

streakMultiplier   = min(1 + 0.25 * (streak - 1), 3)     # 1x, 1.25x, 1.5x ... 3x at streak 9
revengeMultiplier = 2 if this is revenge for an attack within 24h, else 1
targetMultiplier   = 1 + targetBonus, where targetBonus is:
                      +25%  the target's Tier is higher than the attacker's
                      +25%  the target is on a streak of 3+ days
                      capped at +50%
```

Base points are 10 / 12 / 15 / 18 / 22 by tier. The spread is deliberately
narrow: rarity already pays through which pranks you can pull, and stacking a
large points multiplier on top of that turned two players doing the same thing
into a 36x difference.

Picking your target is a real decision. Without the target bonus, farming the
nearest Common Chog paid exactly as much as picking a fight with a Legendary,
and a Chog on a hot streak was worth no more to attack than one sitting idle.

### Limits

- One prank per token per UTC day, enforced by a unique index, not by a check.
- One clean per token per UTC day, same.
- A Chog cannot prank itself, or a Chog in the same wallet.
- Max three active overlays per victim; a fourth replaces the oldest.
- Badges: First Blood, Payback, Untouchable (three dodges in a row), Most
  Wanted (ten distinct attackers). Badges are permanent: a later hit resets the
  dodge counter but never revokes one.

---

## 3. Security model

The design principle is that **the client proposes and the server disposes**.
The wallet's signature is proof of intent and of nothing else.

### What gets signed

Every state-changing action is an EIP-712 typed-data signature over **intent
only**:

```
domain:  Chog Mischief / version 1 / chainId 143 / the Chog Genesis contract
Prank:   kind, fromTokenId, toTokenId, prankId, day, nonce, issuedAt
Clean:   kind, fromTokenId, toTokenId, prankId, day, nonce, issuedAt
```

There is deliberately **no `landed`, `points`, `dodgeRoll` or `revenge` field**.
An earlier version put the outcome in the signed message, which meant a holder
could build their own typed data with `landed: true`, sign it with their own
wallet, and get a guaranteed hit at 2x. There is nothing to set now because the
field does not exist.

The domain binds every signature to this app, this version, Monad, and this
collection, so a signature obtained for another purpose cannot be replayed here.

### What the server does, in order

1. **Parse the intent out of what was signed**, not out of the request body.
2. **Check the shape**: the domain and the type list must be exactly the ones
   this server issues. A client that adds a field changes the type hash and is
   refused.
3. **Verify the nonce.** It is issued by the server, bound to the exact action
   by an HMAC, stored, and consumed with a single conditional update. Unknown,
   expired, used or mismatched all map to the same refusal.
4. **Recover the signer** against the canonical re-derivation of the intent, and
   require it to be the session wallet.
5. **Re-read ownership live** from Monad. The session was verified at sign-in
   and a token can move in between.
6. **Only then** decide the outcome and write.

Consuming the nonce before verifying the signature means a forged signature has
already burned its nonce, so it cannot be retried into something valid.

### Why the outcome cannot be forged or rerolled

The roll is derived, not random:

```
seed = HMAC-SHA256(sessionSecret, "chog-fairness|" + day)
roll = HMAC-SHA256(seed, fromTokenId + "|" + toTokenId + "|" + day), first 16 hex chars / 2^64
```

Same participants, same day, same roll. A player who rejects a signature and
asks again gets the identical number, so there is nothing to reroll by
disliking a result. Revenge is recomputed from stored pranks rather than read
from a message.

### Privacy

Public surfaces never project a wallet address. The chaos feed reads a
Postgres view that has no `signer` or `signature` column at all, behind a code
allow-list that names every column it will return, so a column added to the
view later cannot leak either. Leaderboards key on token ids.

### Cost

Nothing here costs money to run or play. Wallets only sign messages: no
transaction is ever sent, no gas is ever spent, and no contract is deployed by
this project.

---

## 4. Fairness

An unpredictable roll and a checkable roll are normally a trade-off. This design
gets both by publishing a **commitment** to the day's seed and revealing the
seed afterwards.

**During the day.** `GET /api/fairness` returns `sha256(seed)` for the current
UTC day. Nobody can recover the seed from its hash, so nobody can precompute
which targets will dodge, or shop for a favourable one.

**After the day ends.** The seed is revealed, along with the previous seven
days. From that moment anyone can recompute every roll of that day:

```js
const hex = createHmac('sha256', seed)
  .update(`${fromTokenId}|${toTokenId}|${day}`)
  .digest('hex').slice(0, 16);
const roll = Number(BigInt(`0x${hex}`)) / 2 ** 64;
const landed = roll >= effectiveDodge(targetDodge, attackerAccuracy);
```

The endpoint publishes the whole rule, so a verifier never has to read this
project's source to check it. `sha256(seed)` is recomputable and is checked
against the commitment that was published before any prank landed, so a server
that rolled with one seed and revealed another would fail on the first
verification.

The window between hidden and checkable is 30 minutes plus the rest of the day,
and it closes on its own: the reveal is a property of the calendar, not a timer
that can fail to fire.

**What this does and does not claim.** It claims that a day's rolls are
verifiable after that day ends, for as long as the commitment and the seed are
both available. It does not claim the outcome was decided in advance, that it is
verifiable during the day, or that it survives a rotation of the session secret
- a rotation invalidates past days, and the commit route stops rather than
producing rolls nobody could check.

The commitment itself is stored once per day in an append-only table with no
update or delete policy, so it cannot be quietly rewritten. If the session
secret is rotated, the stored hash and the freshly derived one disagree, and the
commit route refuses to roll instead of producing an unverifiable result.

---

## 5. Things that are deliberately not here

- **No $CHOG.** No token integration, no price, no market mechanics.
- **No transactions.** The app never asks a wallet to send anything.
- **No paid services.** Public RPCs, free tiers only.
- **No raw trait slurs.** 24 of the 1,969 Chogs carry an offensive value as a
  trait. It grants no power, unlocks no prank, and renders as `[hidden]`
  everywhere. The NFT's own artwork is not altered.

---

## 6. Where to look in the code

| Concern | File |
|---|---|
| Trait to power mapping | `src/game/powers.ts` |
| Rules, points, badges, limits | `src/game/rules.ts` |
| The prank catalogue | `src/game/pranks.ts` |
| Typed data, nonces, roll derivation | `src/lib/action-signing.ts` |
| Commit-reveal fairness | `src/lib/fairness.ts` |
| Prank commit route | `src/app/api/prank/commit/route.ts` |
| Trait masking | `src/lib/traits.ts` |
| Database schema | `supabase/schema.sql` |

`npm run sim:balance` rolls the real rule functions over all 1,969 Chogs and
prints the hit rate, the points distribution by tier and the leaderboard mix.
It is how the numbers above were checked rather than guessed.
