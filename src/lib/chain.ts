/**
 * Chog Mischief — chain config.
 *
 * Single source of truth for the contract and the RPCs, read from env so no
 * address is ever hardcoded in two places.
 *
 * Monad is already in viem's chain directory (verified: id 143, symbol MON,
 * 18 decimals, monadscan explorer), so AppKit needs no custom-chain
 * registration and no dashboard chain entry.
 */

export const CHOG_CONTRACT =
  (process.env.NEXT_PUBLIC_CHOG_CONTRACT as `0x${string}` | undefined) ??
  '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

export const MONAD_CHAIN_ID = 143;

export const MONAD_RPCS = [
  process.env.NEXT_PUBLIC_MONAD_RPC ?? 'https://rpc.monad.xyz',
  'https://rpc1.monad.xyz',
  'https://rpc3.monad.xyz',
].filter(Boolean);

/** Free public RPCs are shared infrastructure: cache ownerOf reads ~60s. */
export const OWNER_CACHE_TTL_MS = 60_000;

/** totalSupply() of Chog Genesis, verified on-chain. */
export const CHOG_TOTAL_SUPPLY = 1969;

/** ERC-721 ownerOf selector. */
export const OWNER_OF_SELECTOR = '0x6352211e';

/** ERC-721 balanceOf selector. */
export const BALANCE_OF_SELECTOR = '0x70a08231';
