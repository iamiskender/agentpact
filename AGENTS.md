# AgentPact

> Built with Arc Studio — USDC escrow for agent-to-agent payments on Arc Testnet

---

## What This App Does

AgentPact is a trustless USDC escrow for agent-to-agent jobs. A client agent locks a USDC budget, a provider delivers a result, and payment is released/refunded/split by an arbiter based on onchain conditions. Includes onchain provider reputation tracking.

## Deployed Contracts

| Contract | Network | Address | Explorer |
|---|---|---|---|
| AgentPact | Arc Testnet | `0x1c107518808eb351a32f02a08c6ecf154db4997e` | [View](https://explorer.testnet.arc.io/address/0x1c107518808eb351a32f02a08c6ecf154db4997e) |

USDC address (Arc Testnet): `0x3600000000000000000000000000000000000000`

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity ^0.8.20 + Foundry, OpenZeppelin SafeERC20 + ReentrancyGuard
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: USDC (6 decimals)
- Toasts: Sonner

## Key Files

- `src/App.tsx` — Main app with tab navigation
- `src/contract.ts` — Contract address, ABI, chain config
- `src/components/CreateJobForm.tsx` — USDC approval + job creation flow
- `src/components/JobCard.tsx` — Per-job view with role-aware action buttons
- `src/components/MyJobs.tsx` — Filtered job list for connected wallet
- `src/components/ProviderLookup.tsx` — Provider reputation lookup
- `src/components/ActivityFeed.tsx` — Recent contract events
- `src/hooks/useAgentPact.ts` — Wagmi hooks for contract reads/writes
- `src/utils/format.ts` — USDC formatting, address shortening, error parsing
- `contracts/AgentPact.sol` — Main escrow contract
- `contracts/test/AgentPact.t.sol` — 59 Foundry tests (all pass)
- `agents/client-agent.js` — Node.js client agent script
- `agents/provider-agent.js` — Node.js provider agent script (watches for jobs)
- `agents/env.example` — Template for agent environment variables

## Contract Status Flow

```
Funded → Submitted → Released   (client approves OR provider claims after review)
       ↘ Refunded               (client refunds after deadline)
         → Disputed → Resolved  (arbiter resolves, or anyone after 7-day timeout)
```

## Constants

- MIN_REVIEW = 60 seconds
- MAX_REVIEW = 30 days
- ARBITER_TIMEOUT = 7 days

## Agent Scripts

```bash
cd agents
cp env.example .env   # fill in PRIVATE_KEY, PROVIDER_ADDRESS, ARBITER_ADDRESS
node client-agent.js  # creates a job, polls for result, approves/rejects
node provider-agent.js # watches for jobs assigned to this wallet, submits results
```

## To Run

```bash
bun install
bun run dev
```

## To Test

```bash
bun run contracts:test
# or
forge test --match-path contracts/test/AgentPact.t.sol -v
```
