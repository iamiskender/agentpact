/**
 * Multi-network configuration for AgentPact.
 * Controlled by VITE_NETWORK = "testnet" | "mainnet" (default: "testnet").
 * NEVER import chain IDs, RPC URLs, or contract addresses from anywhere else.
 */

import abi from './abi/AgentPact.json';

export type NetworkName = 'testnet' | 'mainnet';

export const ACTIVE_NETWORK: NetworkName =
  (import.meta.env.VITE_NETWORK as NetworkName) === 'mainnet' ? 'mainnet' : 'testnet';

export const IS_MAINNET = ACTIVE_NETWORK === 'mainnet';

// ── Per-network constants ────────────────────────────────────────────────────

interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerBase: string;
  usdcAddress: `0x${string}`;
  contractAddress: `0x${string}`;
}

const TESTNET: NetworkConfig = {
  name: 'Arc Testnet',
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerBase: 'https://explorer.testnet.arc.io',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  contractAddress: (
    import.meta.env.VITE_CONTRACT_ADDRESS_TESTNET ?? '0x1c107518808eb351a32f02a08c6ecf154db4997e'
  ) as `0x${string}`,
};

const MAINNET: NetworkConfig = {
  name: 'Arc Mainnet',
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerBase: 'https://explorer.arc.io',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  contractAddress: (
    import.meta.env.VITE_CONTRACT_ADDRESS_MAINNET ?? ''
  ) as `0x${string}`,
};

export const NETWORK = ACTIVE_NETWORK === 'mainnet' ? MAINNET : TESTNET;

// ── Exports matching the shape the rest of the app expects ───────────────────

export const CHAIN_ID = NETWORK.chainId;
export const EXPLORER_BASE = NETWORK.explorerBase;

export const AGENT_PACT = {
  address: NETWORK.contractAddress,
  abi,
  chainId: NETWORK.chainId,
} as const;

export const USDC_ADDRESS = NETWORK.usdcAddress;

export function explorerTx(hash: string): string {
  return `${NETWORK.explorerBase}/tx/${hash}`;
}

export function explorerAddr(addr: string): string {
  return `${NETWORK.explorerBase}/address/${addr}`;
}
