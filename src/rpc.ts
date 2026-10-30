/**
 * Shared RPC transport and publicClient factory.
 * Uses viem fallback() so a blocked primary endpoint automatically
 * retries through the backup list, in order.
 *
 * Import makePublicClient() everywhere a one-off publicClient is needed
 * (MyJobs, ProviderLookup, ActivityFeed, hooks).
 * The wagmi config in config.ts uses the same URL lists.
 */

import { createPublicClient, fallback, http, defineChain } from 'viem';
import type { AbiEvent, Log } from 'viem';
import { NETWORK } from '@/networks';

// ── RPC URL lists ────────────────────────────────────────────────────────────

export const MAINNET_RPC_URLS = [
  'https://rpc.mainnet.arc.io',
  'https://rpc.drpc.mainnet.arc.io',
  'https://rpc.blockdaemon.mainnet.arc.io',
  'https://rpc.quicknode.mainnet.arc.io',
] as const;

export const TESTNET_RPC_URLS = [
  'https://rpc.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.blockdaemon.testnet.arc.io',
] as const;

export const ACTIVE_RPC_URLS: readonly string[] =
  NETWORK.chainId === 5042 ? MAINNET_RPC_URLS : TESTNET_RPC_URLS;

// ── Transport ────────────────────────────────────────────────────────────────

export const arcFallbackTransport = fallback(
  ACTIVE_RPC_URLS.map(url => http(url)),
);

// ── Chain definition ─────────────────────────────────────────────────────────

const arcChain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ACTIVE_RPC_URLS as unknown as string[] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: NETWORK.explorerBase } },
  testnet: NETWORK.chainId !== 5042,
});

// ── Public client factory ────────────────────────────────────────────────────

export type ArcPublicClient = ReturnType<typeof makePublicClient>;

export function makePublicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: arcFallbackTransport,
  });
}

// ── Chunked getLogs helper ───────────────────────────────────────────────────
// Queries in windows of CHUNK_SIZE blocks so large ranges don't exceed
// the RPC node's log-query limit.
// Returns typed Log entries for the given event ABI.

const CHUNK_SIZE = 10_000n;

export async function getLogsChunked<TEvent extends AbiEvent>(
  client: ArcPublicClient,
  params: {
    address: `0x${string}`;
    event: TEvent;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }
): Promise<Log<bigint, number, false, TEvent, undefined, [TEvent], string>[]> {
  type LogEntry = Log<bigint, number, false, TEvent, undefined, [TEvent], string>;
  const results: LogEntry[] = [];
  let from = params.fromBlock;

  while (from <= params.toBlock) {
    const to = from + CHUNK_SIZE - 1n < params.toBlock
      ? from + CHUNK_SIZE - 1n
      : params.toBlock;

    const chunk = await (client.getLogs as (p: unknown) => Promise<unknown[]>)({
      address: params.address,
      event: params.event,
      args: params.args,
      fromBlock: from,
      toBlock: to,
    }) as LogEntry[];

    results.push(...chunk);
    from = to + 1n;
  }

  return results;
}
