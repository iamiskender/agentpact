import { useEffect, useState } from 'react';
import { parseAbiItem } from 'viem';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { AGENT_PACT, DEPLOY_BLOCK, explorerTx } from '@/contract';
import { NETWORK } from '@/networks';
import { makePublicClient, getLogsChunked } from '@/rpc';
import { formatAddress } from '@/utils/format';
import { ExternalLink, Activity, Loader2 } from 'lucide-react';

const publicClient = makePublicClient();

const EVENT_ABIS = [
  parseAbiItem('event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address arbiter, uint256 amount, uint256 deliveryDeadline, uint256 reviewPeriod, bytes32 specHash)'),
  parseAbiItem('event ResultSubmitted(uint256 indexed jobId, bytes32 resultHash)'),
  parseAbiItem('event JobReleased(uint256 indexed jobId, address indexed provider, uint256 amount)'),
  parseAbiItem('event JobRefunded(uint256 indexed jobId, address indexed client, uint256 amount)'),
  parseAbiItem('event JobDisputed(uint256 indexed jobId, address indexed client, uint256 disputedAt)'),
  parseAbiItem('event JobResolved(uint256 indexed jobId, uint256 providerBps, uint256 providerAmount, uint256 clientAmount)'),
];

interface FeedEvent {
  txHash: string;
  blockNumber: bigint;
  name: string;
  jobId: string;
  detail: string;
}

function eventLabel(name: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    JobCreated: { label: 'Job Created', color: 'text-blue-600 bg-blue-50' },
    ResultSubmitted: { label: 'Result Submitted', color: 'text-amber-600 bg-amber-50' },
    JobReleased: { label: 'Payment Released', color: 'text-green-600 bg-green-50' },
    JobRefunded: { label: 'Refunded', color: 'text-slate-600 bg-slate-100' },
    JobDisputed: { label: 'Disputed', color: 'text-red-600 bg-red-50' },
    JobResolved: { label: 'Resolved', color: 'text-purple-600 bg-purple-50' },
  };
  return map[name] ?? { label: name, color: 'text-gray-600 bg-gray-50' };
}

function parseEventDetail(name: string, args: Record<string, unknown>): string {
  if (name === 'JobCreated') return `Client: ${formatAddress(String(args.client))} → Provider: ${formatAddress(String(args.provider))}`;
  if (name === 'ResultSubmitted') return `Result hash submitted`;
  if (name === 'JobReleased') return `Provider ${formatAddress(String(args.provider))} paid`;
  if (name === 'JobRefunded') return `Client ${formatAddress(String(args.client))} refunded`;
  if (name === 'JobDisputed') return `Disputed by client ${formatAddress(String(args.client))}`;
  if (name === 'JobResolved') return `Split: ${Number(args.providerBps) / 100}% to provider`;
  return '';
}

export function ActivityFeed({ refreshTick }: { refreshTick: number }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const toBlock = await publicClient.getBlockNumber();

        const logs = await Promise.all(
          EVENT_ABIS.map(abi =>
            getLogsChunked(publicClient, {
              address: AGENT_PACT.address,
              event: abi,
              fromBlock: DEPLOY_BLOCK,
              toBlock,
            }).catch(() => [] as [])
          )
        );

        const flat: FeedEvent[] = (logs.flat() as unknown as Array<{
          transactionHash: string | null;
          blockNumber: bigint | null;
          eventName?: string;
          args: Record<string, unknown>;
        }>).map(entry => {
          const args = entry.args;
          const rawJobId = args?.jobId;
          const jobId = typeof rawJobId === 'bigint'
            ? rawJobId.toString()
            : typeof rawJobId === 'number' || typeof rawJobId === 'string'
              ? String(rawJobId)
              : '?';
          return {
            txHash: entry.transactionHash ?? '',
            blockNumber: entry.blockNumber ?? 0n,
            name: entry.eventName ?? '',
            jobId,
            detail: parseEventDetail(entry.eventName ?? '', args),
          };
        });

        flat.sort((a, b) => Number(b.blockNumber - a.blockNumber));

        if (!cancelled) {
          setEvents(flat.slice(0, 30));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Could not fetch events. RPC may be rate-limited.');
          setLoading(false);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity size={18} color="var(--ink)" />
          <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            Recent Activity
          </h2>
        </div>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Since deployment · {NETWORK.name}
        </p>
      </CardHeader>
      <CardBody>
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 size={20} className="animate-spin" color="var(--muted)" />
          </div>
        )}
        {error && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--danger)' }}>{error}</p>
        )}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>
            No activity yet.
          </p>
        )}
        {!loading && events.length > 0 && (
          <div className="space-y-2">
            {events.map((ev, i) => {
              const { label, color } = eventLabel(ev.name);
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold flex-shrink-0 ${color}`}>
                      {label}
                    </span>
                    <span className="text-xs truncate" style={{ color: 'var(--ink-2)' }}>
                      Job #{ev.jobId} — {ev.detail}
                    </span>
                  </div>
                  {ev.txHash && (
                    <a
                      href={explorerTx(ev.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 hover:opacity-70 transition-opacity"
                    >
                      <ExternalLink size={13} color="var(--muted)" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
