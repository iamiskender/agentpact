/**
 * AgentPact Client Agent
 *
 * Creates a job with a spec, polls for result submission, then approves or rejects
 * based on a configurable check function.
 *
 * Usage:
 *   cd agents && node client-agent.js
 *
 * Reads config from .env (copy .env.example → .env and fill in values).
 */

import 'dotenv/config';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  toBytes,
  erc20Abi,
  parseAbiItem,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────
const NETWORK_DEFAULTS = {
  testnet: { rpc: 'https://rpc.testnet.arc.io', chainId: '5042002', explorer: 'https://explorer.testnet.arc.io' },
  mainnet: { rpc: 'https://rpc.mainnet.arc.io', chainId: '5042',    explorer: 'https://explorer.arc.io' },
};

const networkName = process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const netDefaults = NETWORK_DEFAULTS[networkName];

const {
  RPC_URL = netDefaults.rpc,
  PRIVATE_KEY,
  CONTRACT_ADDRESS,
  USDC_ADDRESS = '0x3600000000000000000000000000000000000000',
  CHAIN_ID = netDefaults.chainId,
  PROVIDER_ADDRESS,
  ARBITER_ADDRESS,
  JOB_AMOUNT_USDC = '5.00',
  DELIVERY_DEADLINE_SECS = '3600',
  REVIEW_PERIOD_SECS = '3600',
  JOB_SPEC = 'Default job spec',
} = process.env;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not set in .env');
if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set in .env');
if (!PROVIDER_ADDRESS) throw new Error('PROVIDER_ADDRESS not set in .env');
if (!ARBITER_ADDRESS) throw new Error('ARBITER_ADDRESS not set in .env');

const arcChain = defineChain({
  id: Number(CHAIN_ID),
  name: networkName === 'mainnet' ? 'Arc Mainnet' : 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: netDefaults.explorer } },
});

const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);

const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: arcChain, transport: http(RPC_URL) });

// Load ABI from compiled artifact
const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(__dirname, '..', 'contracts', 'out', 'AgentPact.sol', 'AgentPact.json');
const { abi } = JSON.parse(readFileSync(artifactPath, 'utf8'));

const contract = { address: CONTRACT_ADDRESS, abi };
const usdc = { address: USDC_ADDRESS, abi: erc20Abi };

function log(msg) {
  console.log(`[client-agent ${new Date().toISOString()}] ${msg}`);
}

// ── Simple result checker ────────────────────────────────────────────────────
// Replace this function with your own logic.
// Returns true to approve, false to reject.
function checkResult(resultHash, specHash) {
  log(`Checking result hash ${resultHash} against spec ${specHash}`);
  // Naive check: result hash is not the zero hash
  const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
  return resultHash !== zeroHash;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`Network: ${networkName} (chainId ${CHAIN_ID})`);
  log(`Client address: ${account.address}`);

  const amount = parseUnits(JOB_AMOUNT_USDC, 6);
  const balance = await publicClient.readContract({ ...usdc, functionName: 'balanceOf', args: [account.address] });
  log(`USDC balance: ${formatUnits(balance, 6)}`);
  if (balance < amount) throw new Error(`Insufficient USDC. Need ${JOB_AMOUNT_USDC}, have ${formatUnits(balance, 6)}`);

  // Approve USDC
  log(`Approving ${JOB_AMOUNT_USDC} USDC to contract…`);
  const approveTx = await walletClient.writeContract({
    ...usdc,
    functionName: 'approve',
    args: [CONTRACT_ADDRESS, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  log(`Approved: ${approveTx}`);

  // Create job
  const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(DELIVERY_DEADLINE_SECS));
  const reviewPeriod = BigInt(REVIEW_PERIOD_SECS);
  const specHash = keccak256(toBytes(JOB_SPEC));

  log(`Creating job — provider: ${PROVIDER_ADDRESS}, arbiter: ${ARBITER_ADDRESS}`);
  const createTx = await walletClient.writeContract({
    ...contract,
    functionName: 'createJob',
    args: [PROVIDER_ADDRESS, ARBITER_ADDRESS, amount, deadline, reviewPeriod, specHash],
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  log(`Job created: ${createTx}`);

  // Parse jobId from logs
  const jobCreatedAbi = parseAbiItem('event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address arbiter, uint256 amount, uint256 deliveryDeadline, uint256 reviewPeriod, bytes32 specHash)');
  const logs = await publicClient.getLogs({
    address: CONTRACT_ADDRESS,
    event: jobCreatedAbi,
    fromBlock: createReceipt.blockNumber,
    toBlock: createReceipt.blockNumber,
  });
  const jobId = logs[0]?.args?.jobId;
  if (!jobId) throw new Error('Could not parse jobId from transaction logs');
  log(`Job ID: ${jobId}`);

  // Poll for result submission
  log(`Polling for result submission (every 30s)…`);
  let job;
  for (let attempt = 0; attempt < 120; attempt++) {
    job = await publicClient.readContract({ ...contract, functionName: 'jobs', args: [jobId] });
    const status = Number(job[10]);
    if (status === 1 /* Submitted */) {
      log(`Result submitted! resultHash: ${job[9]}`);
      break;
    }
    if (status > 1) {
      log(`Job already in terminal/unexpected status: ${status}`);
      return;
    }
    await sleep(30000);
  }

  if (!job || Number(job[10]) !== 1) {
    log('Timed out waiting for result. Checking if deadline passed for refund…');
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= job[4] /* deliveryDeadline */) {
      log('Deadline passed — claiming refund…');
      const refundTx = await walletClient.writeContract({ ...contract, functionName: 'refundExpired', args: [jobId] });
      await publicClient.waitForTransactionReceipt({ hash: refundTx });
      log(`Refund claimed: ${refundTx}`);
    } else {
      log('Deadline not yet passed. Exiting.');
    }
    return;
  }

  // Approve or reject
  const resultHash = job[9];
  const approve = checkResult(resultHash, specHash);

  if (approve) {
    log(`Result looks good — approving payment…`);
    const approveTx2 = await walletClient.writeContract({ ...contract, functionName: 'approve', args: [jobId] });
    await publicClient.waitForTransactionReceipt({ hash: approveTx2 });
    log(`Payment approved: ${approveTx2}`);
  } else {
    log(`Result rejected — opening dispute…`);
    const rejectTx = await walletClient.writeContract({ ...contract, functionName: 'reject', args: [jobId] });
    await publicClient.waitForTransactionReceipt({ hash: rejectTx });
    log(`Dispute opened: ${rejectTx}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => { console.error(err); process.exit(1); });
