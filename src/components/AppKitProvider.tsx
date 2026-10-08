'use client';

/**
 * Chog Mischief — wallet connection (AppKit + wagmi).
 *
 * Costs the user NOTHING: AppKit is asked for `connect` only, never for a
 * transaction, never for a signature we did not ask for. The SIWE sign-in that
 * follows is a plain message signature, which is gasless.
 *
 * Monad needs no custom-chain registration: viem already ships it (id 143,
 * symbol MON), so it is imported straight from @reown/appkit/networks.
 *
 * createAppKit is called ONCE at module scope, not inside a component — the
 * Reown FAQ is explicit that initialising in a component breaks wallet display.
 *
 * THE QUERYCLIENT IS NOT OPTIONAL. Wagmi v2 is built on TanStack Query, so a
 * WagmiProvider without a QueryClientProvider above it throws
 * "No QueryClient set, use QueryClientProvider to set one" at runtime. That is a
 * CLIENT-side crash, so it does not fail `next build` — the pages prerender fine
 * and every one of them white-screens in the browser. Found only by loading
 * /chog/1 in a real browser, after a build that reported 1,980 successful pages.
 */

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { monad } from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit-common';
import type { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { injected, coinbaseWallet } from 'wagmi/connectors';
import { defineChain } from 'viem';

export const CHOG_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Monad is in viem already; this re-declaration only guarantees the explorer
// and RPCs match our own config if AppKit's copy ever drifts.
export const monadChain = defineChain({
  ...monad,
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://monadscan.com' },
  },
});

const networks = [monadChain] as unknown as [AppKitNetwork, ...AppKitNetwork[]];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: CHOG_PROJECT_ID,
  connectors: [injected(), coinbaseWallet({ appName: 'Chog Mischief' })],
});

if (typeof window !== 'undefined' && CHOG_PROJECT_ID) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId: CHOG_PROJECT_ID,
    networks,
    metadata: {
      name: 'Chog Mischief',
      description: 'A daily prank war where every Chog Genesis NFT is a player.',
      url: 'https://chogmischief.xyz',
      icons: ['/icon.png'],
    },
    features: {
      // We do our own SIWE; disabling AppKit's email/social login keeps the
      // sign-in path single and auditable, and stays inside the free plan.
      email: false,
      socials: false,
      analytics: false,
      swaps: false,
      onramp: false,
    },
  });
}

/**
 * One client for the app's lifetime. Created at module scope, not per render:
 * a new QueryClient on every render discards the cache and can re-trigger
 * wallet reads in a loop.
 *
 * No server data is fetched here — this provider exists for Wagmi's own chain
 * reads. Our Chog metadata is baked at build time, so the only network traffic
 * is ownership checks against public Monad RPCs.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Wallet reads are cheap, public and idempotent; a short window keeps the
      // chain tab fresh without hammering a free public RPC.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppKitProvider({ children }: { children: ReactNode }) {
  if (!CHOG_PROJECT_ID) {
    // Fail loudly in development rather than rendering a dead Connect button.
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[chog] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is unset — wallet connect is disabled.',
      );
    }
    // Still mount QueryClient: ConnectWalletBody calls Wagmi hooks the moment it
    // loads, and without a QueryClient that throws rather than degrading.
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>{children}</WagmiProvider>
    </QueryClientProvider>
  );
}

/** True when the Reown project id is configured. */
export const walletConfigured = Boolean(CHOG_PROJECT_ID);
