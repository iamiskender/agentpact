import { useState } from 'react';
import { createPublicClient, http } from 'viem';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AGENT_PACT } from '@/contract';
import { NETWORK } from '@/networks';
import { formatUsdc } from '@/utils/format';
import { Search, Award } from 'lucide-react';

const publicClient = createPublicClient({ transport: http(NETWORK.rpcUrl) });

interface ProviderStats {
  completed: bigint;
  disputed: bigint;
  earned: bigint;
}

export function ProviderLookup() {
  const [input, setInput] = useState('');
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState('');

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const val = input.trim();
    if (!val.match(/^0x[0-9a-fA-F]{40}$/)) return;
    setLoading(true);
    setQueried(val);
    try {
      const result = await publicClient.readContract({
        address: AGENT_PACT.address,
        abi: AGENT_PACT.abi,
        functionName: 'getProviderStats',
        args: [val as `0x${string}`],
      }) as readonly [bigint, bigint, bigint];
      setStats({ completed: result[0], disputed: result[1], earned: result[2] });
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Award size={18} color="var(--ink)" />
          <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            Provider Reputation
          </h2>
        </div>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Look up any provider's onchain stats
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={(e) => { void handleSearch(e); }} className="flex gap-2">
          <input
            className="input-field flex-1 text-sm"
            placeholder="0x provider address…"
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <Button type="submit" variant="secondary" size="sm" loading={loading}>
            <Search size={15} />
          </Button>
        </form>

        {queried && !loading && stats && (
          <div className="mt-4 rounded-xl p-4 space-y-3" style={{ background: 'var(--surface-muted)' }}>
            <p className="text-xs font-semibold mono" style={{ color: 'var(--muted)' }}>
              {queried.slice(0, 6)}...{queried.slice(-4)}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="Completed"
                value={stats.completed.toString()}
                color="var(--success)"
              />
              <StatCard
                label="Disputed"
                value={stats.disputed.toString()}
                color="var(--danger)"
              />
              <StatCard
                label="Total Earned"
                value={`${formatUsdc(stats.earned)} USDC`}
                color="var(--accent)"
              />
            </div>
            {stats.completed === 0n && stats.disputed === 0n && (
              <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
                No completed jobs yet.
              </p>
            )}
          </div>
        )}
        {queried && !loading && !stats && (
          <p className="text-sm mt-3 text-center" style={{ color: 'var(--muted)' }}>
            Could not fetch stats for this address.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-strong)' }}>
      <div className="display text-lg font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5 font-medium" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
