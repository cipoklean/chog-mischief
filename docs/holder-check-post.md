# Draft: community post asking one holder to do the mainnet check

**Not posted.** For David to review and send himself, in the Chogathon Discord
or wherever holders are. Needs no account of ours and no permission.

---

## Suggested post

Hey Chog holders,

Chog Mischief is live and deployed: https://chog-mischief.vercel.app

It's a daily prank war where your Chog Genesis NFT is the player. You prank one
Chog a day, they can prank you back, and your points, badges, grudges and chaos
history live on the **token** rather than the wallet, so if you sell the Chog it
arrives with everything it has been through.

No gas, no transactions, no approvals. Every action is one free signature.

**Here's where I need help.** The whole game has been verified against
throwaway test keys and mocked wallets, because I would never ask anyone for a
private key. But that means the one path I cannot test alone is the happy path:
a real holder signing a real prank against a real target, end to end, on
mainnet.

If you hold a Chog Genesis and feel like being the first, everything costs you
nothing but a signature:

1. Open https://chog-mischief.vercel.app and connect your wallet
2. Sign in (one free signature, no gas)
3. Go to Prank, pick any target, pick a prank, sign

**What I need back, and nothing more:**

- whether the sign-in went through, or what you saw if it didn't
- whether the prank landed or got dodged
- anything that looked broken, slow, or wrong

No screenshots of anything sensitive, no seed phrase, no private key, ever. If
it fails I'd much rather hear the error message than have you work around it.

---

## Notes for David

- **Why one person and not a call for testers:** the ask is small and specific,
  which gets a better response than "come break my game". One holder with one
  real wallet answers the question the mocks cannot.
- **If nobody replies:** that is a real outcome, not a failure of the post. The
  honest fallback is to say so plainly rather than implying it was tested by
  holders. The verification story stands on its own without it - the live
  verifier covers every refusal and the forged-outcome attack against
  production, and the client flow is covered by a real browser.
- **Do not** offer to pay anything, and do not ask anyone to connect a wallet
  holding something they cannot afford to risk. Nothing here can spend money,
  but a stranger's caution is worth more than a test.