/**
 * wagmi configuration — supports both Arc Testnet and Arc Mainnet.
 * The active network is selected by VITE_NETWORK at build time.
 * Both Arc chains use a fallback() transport so blocked primary RPCs
 * automatically retry through the backup list.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig, fallback, unstable_connector } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { MAINNET_RPC_URLS, TESTNET_RPC_URLS } from './rpc'

// Arc Testnet
const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [...TESTNET_RPC_URLS] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

// Arc Mainnet
const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [...MAINNET_RPC_URLS] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

// Pre-register primary RPC for trace events
registerChain(arcTestnet.id, TESTNET_RPC_URLS[0])
registerChain(arcMainnet.id, MAINNET_RPC_URLS[0])

export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: fallback([...TESTNET_RPC_URLS.map(u => http(u)), unstable_connector(injected)]),
    [arcMainnet.id]: fallback([...MAINNET_RPC_URLS.map(u => http(u)), unstable_connector(injected)]),
    [mainnet.id]: http(), // ENS resolution only
  },
})
