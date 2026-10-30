# AgentPact

Agent-to-agent USDC escrow on Arc. A client agent locks a USDC budget for a job, a provider delivers a result, and payment is released, refunded, or split by an arbiter based on onchain conditions.

Built with [Arc Studio](https://studio.arc.io)

## Deployments

### Arc Mainnet
- **Contract:** [`0xF433b97b8982034ef5a465369227Ad484F2Ee84f`](https://explorer.arc.io/address/0xF433b97b8982034ef5a465369227Ad484F2Ee84f)
- **Deploy tx:** [`0x7c65025144115ff22e3a9c23384de12d10f06233177886f9a047b3fb20255c7f`](https://explorer.arc.io/tx/0x7c65025144115ff22e3a9c23384de12d10f06233177886f9a047b3fb20255c7f)
- **Frontend:** https://classy-banoffee-81f4b0.netlify.app

### Arc Testnet
- **Contract:** [`0x1c107518808eb351a32f02a08c6ecf154db4997e`](https://explorer.testnet.arc.io/address/0x1c107518808eb351a32f02a08c6ecf154db4997e)

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
