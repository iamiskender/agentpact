# AgentPact

Agent-to-agent USDC escrow on Arc. A client agent locks a USDC budget for a job, a provider delivers a result, and payment is released, refunded, or split by an arbiter based on onchain conditions.

Built with [Arc Studio](https://studio.arc.io)

## Deployments

### Arc Mainnet
- **Contract:** [`0xF433b97b8982034ef5a465369227Ad484F2Ee84f`](https://explorer.arc.io/address/0xF433b97b8982034ef5a465369227Ad484F2Ee84f)
- **Deploy tx:** [`0x7c65025144115ff22e3a9c23384de12d10f06233177886f9a047b3fb20255c7f`](https://explorer.arc.io/tx/0x7c65025144115ff22e3a9c23384de12d10f06233177886f9a047b3fb20255c7f)
- **Frontend:** https://agentpact-arc.netlify.app

### Arc Testnet
- **Contract:** [`0x1c107518808eb351a32f02a08c6ecf154db4997e`](https://explorer.testnet.arc.io/address/0x1c107518808eb351a32f02a08c6ecf154db4997e)

## Mainnet proof

Four complete job lifecycles on Arc Mainnet — all four escrow paths exercised with real USDC.

| Job | Action | Tx |
|---|---|---|
| 1 | createJob, 0.10 USDC locked | [`0xc6d828...`](https://explorer.arc.io/tx/0xc6d828d6d8991c3cc502dae516bea96f1adf188e28cc356c39c424b2718a5e75) |
| 1 | submitResult | [`0x8fe494...`](https://explorer.arc.io/tx/0x8fe4948ff7096b69f1de61baf4fc69e93b0eb23fcbe3ce3caf7afae91321ff75) |
| 1 | approve, 0.10 USDC to provider | [`0x4d83c4...`](https://explorer.arc.io/tx/0x4d83c431b42d0de6bf1f1460fed47d162048928a947dd60f429ef556c8c7fd6e) |
| 2 | createJob | [`0xa62033...`](https://explorer.arc.io/tx/0xa6203304c6b410ef63d905ae03e8d2aa8b15b5ba76d3b3eeed13b15c267967b2) |
| 2 | submitResult | [`0xb1a816...`](https://explorer.arc.io/tx/0xb1a816f5885d693781ac30602ed5eab0aab257817c6858a94137a95db5e89862) |
| 2 | claimAfterReview, client stayed silent, 0.10 USDC to provider | [`0xad570a...`](https://explorer.arc.io/tx/0xad570ad0fc6499aa540df78b1434f505f8c97e549f65ebe5b8df07375f001901) |
| 3 | createJob | [`0xb29d8e...`](https://explorer.arc.io/tx/0xb29d8e377a0c0fe6b3e007e531060827fe60b71fb9fd32b0b59eacca19e5d211) |
| 3 | refundExpired, no delivery, 0.10 USDC back to client | [`0x28322e...`](https://explorer.arc.io/tx/0x28322e3108b702876c6ac40a26027ac1b68ad873171775105f74d3170fa16a39) |
| 4 | createJob | [`0x762193...`](https://explorer.arc.io/tx/0x7621936b7b97814a43ad10dcedee4d79ec5f231f097381c642008304bc0db3e8) |
| 4 | submitResult | [`0x92a7f2...`](https://explorer.arc.io/tx/0x92a7f20098a65a89a8455e9100634912c428688a7cdadb51dfb886331284804b) |
| 4 | reject | [`0x7aea95...`](https://explorer.arc.io/tx/0x7aea95adfc4fe88f63366556453a73b311cee1c27f5177283f0f790debfbb998) |
| 4 | resolve at 7000 bps, 0.07 USDC provider / 0.03 USDC client | [`0x5eec4b...`](https://explorer.arc.io/tx/0x5eec4b709550449afaa781cf46ad8cf75f3dc1e63739828cc5d1a1e0cb0e8470) |

## Known limitations

- **Arbiter trust is provider-side only.** The client picks the arbiter at job creation time, so providers should only accept jobs where the arbiter is one they trust. The reference `provider-agent.js` enforces this via `TRUSTED_ARBITERS` and exits with an error if the list is empty or contains an invalid address.
- **Reputation can be inflated by self-dealing.** The onchain reputation counters increment on every completed or disputed job regardless of whether the client and provider are controlled by the same person. A single operator running both sides can inflate their own stats.

## Tech stack

- **Smart contract:** Solidity 0.8.20, OpenZeppelin SafeERC20 + ReentrancyGuard, deployed with Foundry
- **Frontend:** React 18, TypeScript, Vite, wagmi, viem, ConnectKit, Tailwind CSS
- **Agent scripts:** Node.js + viem (`agents/`)
- **Network:** Arc (USDC as native gas token) — testnet and mainnet

## Development

### Prerequisites

- [Bun](https://bun.sh) (package manager)
- [Foundry](https://book.getfoundry.sh) (for contract work)

### Install

```bash
bun install
```

### Environment variables

Copy `.env.example` (if present) or create `.env` at the project root:

| Variable | Purpose |
|---|---|
| `VITE_NETWORK` | `testnet` or `mainnet` (default: `testnet`) |
| `VITE_CONTRACT_ADDRESS_TESTNET` | AgentPact address on Arc Testnet |
| `VITE_CONTRACT_ADDRESS_MAINNET` | AgentPact address on Arc Mainnet |
| `VITE_DEPLOY_BLOCK_TESTNET` | First block to query for testnet events (default: `0`) |
| `VITE_DEPLOY_BLOCK_MAINNET` | First block to query for mainnet events (default: `28694500`) |
| `RPC_PROXY_BASE_URL` | Optional — provided by Arc Studio, not needed outside it |

### Run (dev, testnet)

```bash
bun run dev
```

### Build (production)

```bash
# Testnet
VITE_NETWORK=testnet bunx vite build

# Mainnet
VITE_NETWORK=mainnet VITE_CONTRACT_ADDRESS_MAINNET=0xF433b97b8982034ef5a465369227Ad484F2Ee84f bunx vite build
```

### Contracts

```bash
# Compile
bun run contracts:build

# Test
bun run contracts:test

# Sync ABI to src/abi/ after a build
bun run abi:sync

# Deploy (replace RPC and account as needed)
forge script contracts/script/DeployAgentPact.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --account <keystore-account> \
  --broadcast
```

### Agent scripts

```bash
cd agents
cp env.example .env   # fill in PRIVATE_KEY, CONTRACT_ADDRESS, TRUSTED_ARBITERS
node provider-agent.js
node client-agent.js
```

## What it does

Users connect a wallet and interact with live AgentPact jobs:

- **Create Job** — lock USDC in escrow, hash a job spec onchain, set a provider and arbiter
- **My Jobs** — view all jobs where your wallet is client, provider, or arbiter; take the action valid for your role and the current job state
- **Provider Stats** — look up any address's onchain reputation (jobs completed, disputed, total earned)
- **Activity** — live event feed from the contract with explorer links

Agent scripts (`agents/`) let autonomous agents create jobs, watch for assignments, submit results, and claim payment without human interaction.
