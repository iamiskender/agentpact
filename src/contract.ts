/**
 * Contract constants — all network-aware values come from @/networks.
 * Import from here (not directly from @/networks) so the rest of the app
 * has a single stable import point.
 */

export {
  AGENT_PACT,
  USDC_ADDRESS,
  CHAIN_ID,
  DEPLOY_BLOCK,
  EXPLORER_BASE,
  explorerTx,
  explorerAddr,
  IS_MAINNET,
  ACTIVE_NETWORK,
  NETWORK,
} from '@/networks';

import { NETWORK } from '@/networks';

export type JobStatus =
  | 'Funded'
  | 'Submitted'
  | 'Released'
  | 'Refunded'
  | 'Disputed'
  | 'Resolved';

export const STATUS_LABELS: Record<number, JobStatus> = {
  0: 'Funded',
  1: 'Submitted',
  2: 'Released',
  3: 'Refunded',
  4: 'Disputed',
  5: 'Resolved',
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  Funded: 'bg-blue-100 text-blue-700',
  Submitted: 'bg-amber-100 text-amber-700',
  Released: 'bg-green-100 text-green-700',
  Refunded: 'bg-slate-100 text-slate-700',
  Disputed: 'bg-red-100 text-red-700',
  Resolved: 'bg-purple-100 text-purple-700',
};

// Keep CHAIN_FACT shape for any component that reads .name or .explorerBase
export const CHAIN_FACT = {
  name: NETWORK.name,
  explorerBase: NETWORK.explorerBase,
};

// Keep USDC_FACT shape for hooks that read .address
export const USDC_FACT = {
  address: NETWORK.usdcAddress,
};

export interface JobData {
  id: bigint;
  client: `0x${string}`;
  provider: `0x${string}`;
  arbiter: `0x${string}`;
  amount: bigint;
  deliveryDeadline: bigint;
  reviewPeriod: bigint;
  submittedAt: bigint;
  disputedAt: bigint;
  specHash: `0x${string}`;
  resultHash: `0x${string}`;
  status: number;
}
