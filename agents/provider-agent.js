/**
 * AgentPact Provider Agent
 *
 * Watches for JobCreated events where this wallet is the provider,
 * produces a result, submits its hash, and calls claimAfterReview
 * if the client stays silent past the review period.
 *
 * Usage:
 *   cd agents && node provider-agent.js
 *
 * Reads config from .env (copy .env.example → .env and fill in values).
 */

import 'dotenv/config';
import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
  isAddress,
  keccak256,
  toBytes,
  parseAbiItem,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
  CHAIN_ID = netDefaults.chainId,
  TRUSTED_ARBITERS = '',
  MAX_REVIEW_SECONDS = '86400',
  MIN_AMOUNT_USDC = '0.01',
  MIN_WORK_SECONDS = '60',
} = process.env;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not set in .env');
if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set in .env');

// Parse and validate job-acceptance policy
const trustedArbiters = TRUSTED_ARBITERS
  .split(',')
  .map(a => a.trim())
  .filter(a => a.length > 0);

if (trustedArbiters.length === 0) {
  console.error(
    'Error: TRUSTED_ARBITERS is empty. Set at least one trusted arbiter address in agents/.env.'
  );
  process.exit(1);
}

for (const raw of trustedArbiters) {
  if (!isAddress(raw)) {
    console.error(
      `Error: TRUSTED_ARBITERS contains an invalid address: "${raw}". ` +
      'Every entry must be a valid checksummed or lowercase 0x Ethereum address.'
    );
    process.exit(1);
  }
}

// Store normalised (lowercase) for case-insensitive comparisons
const trustedArbiterSet = new Set(trustedArbiters.map(a => a.toLowerCase()));

const maxReviewSeconds = BigInt(MAX_REVIEW_SECONDS);
const minAmountRaw = BigInt(Math.round(parseFloat(MIN_AMOUNT_USDC) * 1_000_000)); // 6 decimals
const minWorkSeconds = BigInt(MIN_WORK_SECONDS);

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(__dirname, '..', 'contracts', 'out', 'AgentPact.sol', 'AgentPact.json');
const { abi } = JSON.parse(readFileSync(artifactPath, 'utf8'));

const contract = { address: CONTRACT_ADDRESS, abi };

const JOB_CREATED_ABI = parseAbiItem(
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address arbiter, uint256 amount, uint256 deliveryDeadline, uint256 reviewPeriod, bytes32 specHash)'
);

function log(msg) {
  console.log(`[provider-agent ${new Date().toISOString()}] ${msg}`);
}

// ── Work producer ────────────────────────────────────────────────────────────
// Replace this function with your actual agent work.
// Receives the specHash and returns a result description string.
async function produceResult(specHash, jobId) {
  log(`Producing result for job ${jobId}, spec hash: ${specHash}`);
  // Simulate work
  await sleep(2000);
  const result = `Provider result for job ${jobId}: Completed task per spec ${specHash}. Timestamp: ${Date.now()}`;
  log(`Result produced: ${result.slice(0, 80)}…`);
  return result;
}

// ── Handle a single job ──────────────────────────────────────────────────────
async function handleJob(jobId, specHash, deliveryDeadline, reviewPeriod) {
  log(`Handling job ${jobId}`);

  // Check current status first
  const job = await publicClient.readContract({ ...contract, functionName: 'jobs', args: [jobId] });
  const status = Number(job[10]);
  if (status !== 0 /* Funded */) {
    log(`Job ${jobId} is already in status ${status}, skipping`);
    return;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= deliveryDeadline) {
    log(`Job ${jobId} deadline already passed, skipping`);
    return;
  }

  // Produce and submit result
  const resultText = await produceResult(specHash, jobId);
  const resultHash = keccak256(toBytes(resultText));

  log(`Submitting result hash: ${resultHash}`);
  const submitTx = await walletClient.writeContract({
    ...contract,
    functionName: 'submitResult',
    args: [jobId, resultHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: submitTx });
  log(`Result submitted: ${submitTx}`);

  // Wait for client action or review period expiry
  log(`Waiting for client action on job ${jobId}…`);

  let claimed = false;
  while (true) {
    await sleep(30000);
    const updatedJob = await publicClient.readContract({ ...contract, functionName: 'jobs', args: [jobId] });
    const updatedStatus = Number(updatedJob[10]);

    if (updatedStatus === 2 /* Released */) {
      log(`Job ${jobId} approved by client — payment released!`);
      const stats = await publicClient.readContract({
        ...contract,
        functionName: 'getProviderStats',
        args: [account.address],
      });
      log(`Provider stats — completed: ${stats[0]}, disputed: ${stats[1]}, earned: ${formatUnits(stats[2], 6)} USDC`);
      claimed = true;
      break;
    }
    if (updatedStatus === 4 /* Disputed */) {
      log(`Job ${jobId} disputed — waiting for arbiter resolution`);
      break;
    }
    if (updatedStatus >= 2) {
      log(`Job ${jobId} ended with status ${updatedStatus}`);
      break;
    }

    // Check if we can claimAfterReview
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const actualSubmittedAt = updatedJob[6]; // submittedAt from contract
    const contractReviewPeriod = updatedJob[5]; // reviewPeriod from contract
    if (nowTs >= actualSubmittedAt + contractReviewPeriod && !claimed) {
      log(`Review period ended — claiming payment for job ${jobId}…`);
      try {
        const claimTx = await walletClient.writeContract({
          ...contract,
          functionName: 'claimAfterReview',
          args: [jobId],
        });
        await publicClient.waitForTransactionReceipt({ hash: claimTx });
        log(`Payment claimed: ${claimTx}`);
        claimed = true;
        break;
      } catch (err) {
        log(`Claim failed: ${err.message}`);
        break;
      }
    }

    log(`Job ${jobId} still Submitted, checking again in 30s…`);
  }
}

// ── Main watch loop ──────────────────────────────────────────────────────────
async function main() {
  log(`Network: ${networkName} (chainId ${CHAIN_ID})`);
  log(`Provider address: ${account.address}`);
  log(`Watching for JobCreated events on ${CONTRACT_ADDRESS}…`);

  const knownJobs = new Set();
  let lastBlock = await publicClient.getBlockNumber();

  while (true) {
    try {
      const latest = await publicClient.getBlockNumber();
      if (latest > lastBlock) {
        const logs = await publicClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: JOB_CREATED_ABI,
          fromBlock: lastBlock + 1n,
          toBlock: latest,
        });

        for (const entry of logs) {
          const { jobId, provider, arbiter, deliveryDeadline, reviewPeriod, amount, specHash } = entry.args;
          if (provider.toLowerCase() !== account.address.toLowerCase()) continue;
          if (knownJobs.has(String(jobId))) continue;
          knownJobs.add(String(jobId));

          log(`Found job ${jobId} for me — validating terms…`);

          // ── Job-acceptance validation ──────────────────────────────────────
          const skipReasons = [];

          // 1. Arbiter must be in TRUSTED_ARBITERS (fails closed — list is always non-empty)
          if (!trustedArbiterSet.has(arbiter.toLowerCase())) {
            skipReasons.push(`arbiter ${arbiter} is not in TRUSTED_ARBITERS`);
          }

          // 2. reviewPeriod must be <= MAX_REVIEW_SECONDS
          if (reviewPeriod > maxReviewSeconds) {
            skipReasons.push(`reviewPeriod ${reviewPeriod}s exceeds MAX_REVIEW_SECONDS (${maxReviewSeconds}s)`);
          }

          // 3. amount must be >= MIN_AMOUNT_USDC (converted to 6-decimal raw units)
          if (amount < minAmountRaw) {
            skipReasons.push(`amount ${formatUnits(amount, 6)} USDC is below MIN_AMOUNT_USDC (${MIN_AMOUNT_USDC})`);
          }

          // 4. deliveryDeadline must leave at least MIN_WORK_SECONDS from now
          const nowSecs = BigInt(Math.floor(Date.now() / 1000));
          const timeLeft = deliveryDeadline > nowSecs ? deliveryDeadline - nowSecs : 0n;
          if (timeLeft < minWorkSeconds) {
            skipReasons.push(`only ${timeLeft}s left before deadline — need at least MIN_WORK_SECONDS (${minWorkSeconds}s)`);
          }

          if (skipReasons.length > 0) {
            log(`Skipping job ${jobId}: ${skipReasons.join('; ')}`);
            continue;
          }

          log(`Job ${jobId} accepted — starting work`);
          // Handle in background (don't await — watch for more jobs)
          handleJob(jobId, specHash, deliveryDeadline, reviewPeriod).catch(err =>
            console.error(`[job ${jobId}] error:`, err)
          );
        }

        lastBlock = latest;
      }
    } catch (err) {
      console.error('Watch loop error:', err.message);
    }

    await sleep(15000);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => { console.error(err); process.exit(1); });
