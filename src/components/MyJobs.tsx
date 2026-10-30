import { useCallback, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { JobCard } from '@/components/JobCard';
import { AGENT_PACT } from '@/contract';
import { makePublicClient } from '@/rpc';
import { parseJobTuple } from '@/hooks/useAgentPact';
import type { JobData } from '@/contract';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

const publicClient = makePublicClient();

interface Props {
  refreshTick: number;
}

export function MyJobs({ refreshTick }: Props) {
  const { address } = useAccount();
  const [allJobs, setAllJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const jobCount = await publicClient.readContract({
        address: AGENT_PACT.address,
        abi: AGENT_PACT.abi,
        functionName: 'jobCount',
      }) as bigint;

      const count = Number(jobCount);
      if (count === 0) {
        setAllJobs([]);
        return;
      }

      const results = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          publicClient.readContract({
            address: AGENT_PACT.address,
            abi: AGENT_PACT.abi,
            functionName: 'jobs',
            args: [BigInt(i + 1)],
          })
        )
      );

      const parsed: JobData[] = results
        .map((r, i) => {
          const j = parseJobTuple(r as readonly unknown[]);
          if (!j) return null;
          return { ...j, id: BigInt(i + 1) };
        })
        .filter((x): x is JobData => x !== null);

      setAllJobs(parsed);
    } catch {
      setAllJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger fetch on address change or refresh
  useEffect(() => {
    void (async () => { await fetchJobs(); })();
  }, [address, refreshTick, fetchJobs]);

  // Filter during render (no setState in effect)
  const jobs = useMemo(() => {
    if (!address) return [];
    const addr = address.toLowerCase();
    return allJobs.filter(j =>
      j.client.toLowerCase() === addr ||
      j.provider.toLowerCase() === addr ||
      j.arbiter.toLowerCase() === addr
    );
  }, [allJobs, address]);

  if (!address) {
    return <EmptyState message="Connect your wallet to see your jobs." />;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={24} className="animate-spin" color="var(--muted)" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return <EmptyState message="No jobs found for your wallet. Create one above." />;
  }

  return (
    <div className="space-y-3">
      {jobs.map(job => (
        <JobCard key={job.id.toString()} job={job} onUpdate={() => { void fetchJobs(); }} />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-2xl border px-6 py-12 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <p className="text-sm" style={{ color: 'var(--muted)' }}>{message}</p>
    </div>
  );
}
