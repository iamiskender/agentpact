import { formatUnits, keccak256, toBytes } from 'viem';

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatUsdc(raw: bigint, decimals = 6): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(formatUnits(raw, decimals)));
}

export function formatCountdown(targetTs: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (targetTs <= now) return 'Expired';
  const secs = Number(targetTs - now);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

export function formatDate(ts: bigint): string {
  if (ts === 0n) return '—';
  return new Date(Number(ts) * 1000).toLocaleString();
}

export function hashSpec(text: string): `0x${string}` {
  if (!text.trim()) return '0x0000000000000000000000000000000000000000000000000000000000000000';
  return keccak256(toBytes(text));
}

/** Format a duration in seconds (as bigint) into a human-readable string. */
export function formatReviewPeriod(secs: bigint): string {
  const n = Number(secs);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)} min`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

export function parseUsdcAmount(val: string): bigint {
  const trimmed = val.trim();
  if (!trimmed || isNaN(Number(trimmed))) throw new Error('Invalid amount');
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = frac.slice(0, 6).padEnd(6, '0');
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string; shortMessage?: string })?.shortMessage
    ?? (error as { message?: string })?.message
    ?? String(error);

  const lower = msg.toLowerCase();
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Transaction cancelled.';
  if (lower.includes('zeroamount')) return 'Amount must be greater than 0.';
  if (lower.includes('deadlineinpast')) return 'Delivery deadline must be in the future.';
  if (lower.includes('invalidreviewperiod')) return 'Review period must be between 60 seconds and 30 days.';
  if (lower.includes('sameaddress')) return 'Client, provider, and arbiter must be different addresses.';
  if (lower.includes('zeroaddress')) return 'Arbiter address cannot be zero.';
  if (lower.includes('notprovider')) return 'Only the provider can call this.';
  if (lower.includes('notclient')) return 'Only the client can call this.';
  if (lower.includes('notarbiter')) return 'Only the arbiter can call this.';
  if (lower.includes('wrongstatus')) return 'Job is not in the correct state for this action.';
  if (lower.includes('deadlinepassed')) return 'Delivery deadline has already passed.';
  if (lower.includes('deadlinenotreached')) return 'Deadline has not been reached yet.';
  if (lower.includes('reviewperiodactive')) return 'The review period is still active.';
  if (lower.includes('reviewperiodended')) return 'The review period has ended.';
  if (lower.includes('arbitertimeoutnotreached')) return 'Arbiter timeout has not elapsed yet (7 days).';
  if (lower.includes('invalidbps')) return 'Provider share must be between 0 and 10000 bps.';
  if (lower.includes('insufficient') || lower.includes('exceeds balance')) return 'Insufficient USDC balance.';
  if (lower.includes('allowance')) return 'Insufficient USDC allowance. Please approve first.';
  if (lower.includes('reverted')) return `Transaction reverted: ${msg.slice(0, 120)}`;
  return msg.slice(0, 200) || 'Something went wrong. Please try again.';
}
