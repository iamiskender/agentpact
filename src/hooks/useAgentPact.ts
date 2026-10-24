import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { erc20Abi, parseUnits, parseAbiItem } from 'viem';
import { AGENT_PACT, USDC_FACT, CHAIN_ID } from '@/contract';
import type { JobData } from '@/contract';
import { useState, useEffect } from 'react';

export function useJob(jobId: bigint | undefined) {
  return useReadContract({
    address: AGENT_PACT.address,
    abi: AGENT_PACT.abi,
    functionName: 'jobs',
    args: jobId !== undefined ? [jobId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: jobId !== undefined },
  });
}

export function useJobCount() {
  return useReadContract({
    address: AGENT_PACT.address,
    abi: AGENT_PACT.abi,
    functionName: 'jobCount',
    chainId: CHAIN_ID,
  });
}

export function useProviderStats(address: `0x${string}` | undefined) {
  return useReadContract({
    address: AGENT_PACT.address,
    abi: AGENT_PACT.abi,
    functionName: 'getProviderStats',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
}

export function useUsdcBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: USDC_FACT.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
}

export function useUsdcAllowance(owner: `0x${string}` | undefined) {
  return useReadContract({
    address: USDC_FACT.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner ? [owner, AGENT_PACT.address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!owner },
  });
}

export function useContractWrite() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  return { writeContract, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  return {
    approveUsdc: (amount: bigint) =>
      writeContract({
        address: USDC_FACT.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [AGENT_PACT.address, amount],
        chainId: CHAIN_ID,
      }),
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

// Parse a raw tuple from the jobs() mapping into a typed JobData
export function parseJobTuple(raw: readonly unknown[] | undefined): JobData | undefined {
  if (!raw || !Array.isArray(raw) || raw.length < 11) return undefined;
  return {
    client: raw[0] as `0x${string}`,
    provider: raw[1] as `0x${string}`,
    arbiter: raw[2] as `0x${string}`,
    amount: raw[3] as bigint,
    deliveryDeadline: raw[4] as bigint,
    reviewPeriod: raw[5] as bigint,
    submittedAt: raw[6] as bigint,
    disputedAt: raw[7] as bigint,
    specHash: raw[8] as `0x${string}`,
    resultHash: raw[9] as `0x${string}`,
    status: raw[10] as number,
    id: 0n,
  };
}

// Convenience: parse USDC amount string to bigint (6 decimals)
export function parseUsdcInput(val: string): bigint {
  return parseUnits(val.trim() || '0', 6);
}

// Fetch the JobResolved event for a specific jobId to get the exact split amounts.
// Returns { providerAmount, clientAmount } or null if not yet found.
export function useJobResolvedAmounts(
  jobId: bigint | undefined,
  enabled: boolean,
): { providerAmount: bigint; clientAmount: bigint } | null {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const [amounts, setAmounts] = useState<{ providerAmount: bigint; clientAmount: bigint } | null>(null);

  useEffect(() => {
    if (!enabled || jobId === undefined || !publicClient) return;
    let cancelled = false;

    const JOB_RESOLVED_EVENT = parseAbiItem(
      'event JobResolved(uint256 indexed jobId, uint256 providerBps, uint256 providerAmount, uint256 clientAmount)'
    );

    publicClient
      .getLogs({
        address: AGENT_PACT.address,
        event: JOB_RESOLVED_EVENT,
        args: { jobId },
        fromBlock: 0n,
        toBlock: 'latest',
      })
      .then(logs => {
        if (cancelled) return;
        const last = logs.length > 0 ? logs[logs.length - 1] : undefined;
        const pa = last?.args?.providerAmount;
        const ca = last?.args?.clientAmount;
        if (pa !== undefined && ca !== undefined) {
          setAmounts({ providerAmount: pa, clientAmount: ca });
        }
      })
      .catch(() => { /* silently ignore — falls back to "Split by arbiter" */ });

    return () => { cancelled = true; };
  }, [jobId, enabled, publicClient]);

  return amounts;
}
