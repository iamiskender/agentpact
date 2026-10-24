import { useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { CreateJobForm } from '@/components/CreateJobForm';
import { MyJobs } from '@/components/MyJobs';
import { ProviderLookup } from '@/components/ProviderLookup';
import { ActivityFeed } from '@/components/ActivityFeed';
import { useUsdcBalance } from '@/hooks/useAgentPact';
import { formatUsdc } from '@/utils/format';
import { CHAIN_ID, CHAIN_FACT, IS_MAINNET, NETWORK, explorerAddr } from '@/contract';
import { TokenUSDC } from '@web3icons/react';
import { Briefcase, Plus, Search, Activity, AlertTriangle } from 'lucide-react';

type Tab = 'jobs' | 'create' | 'lookup' | 'feed';

export default function App() {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useUsdcBalance(address);
  const [activeTab, setActiveTab] = useState<Tab>('jobs');
  const [refreshTick, setRefreshTick] = useState(0);

  const wrongChain = address && chainId !== CHAIN_ID;

  function handleJobCreated() {
    setRefreshTick(t => t + 1);
    setActiveTab('jobs');
  }

  const tabs: { id: Tab; label: string; Icon: typeof Briefcase }[] = [
    { id: 'jobs', label: 'My Jobs', Icon: Briefcase },
    { id: 'create', label: 'Create Job', Icon: Plus },
    { id: 'lookup', label: 'Provider Stats', Icon: Search },
    { id: 'feed', label: 'Activity', Icon: Activity },
  ];

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="border-b backdrop-blur-sm sticky top-0 z-20" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.8)' }}>
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent)' }}
            >
              <Briefcase size={15} color="white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="display font-semibold text-base leading-tight" style={{ color: 'var(--ink)' }}>
                  AgentPact
                </span>
                {/* Network badge */}
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-semibold"
                  style={
                    IS_MAINNET
                      ? { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }
                      : { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }
                  }
                >
                  {IS_MAINNET ? 'Mainnet' : 'Testnet'}
                </span>
              </div>
              <div className="text-xs leading-tight" style={{ color: 'var(--muted)' }}>
                USDC Escrow for Agents
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {address && balance !== undefined && (
              <div
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold tabular-nums"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
              >
                <TokenUSDC variant="branded" size={16} />
                {formatUsdc(balance)}
              </div>
            )}
            <ConnectKitButton />
          </div>
        </div>
      </header>

      {/* Mainnet notice */}
      {IS_MAINNET && (
        <div
          className="px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium"
          style={{ background: '#fef2f2', color: '#991b1b', borderBottom: '1px solid #fecaca' }}
        >
          <AlertTriangle size={14} />
          Mainnet. Real USDC. Unaudited contract, use small amounts.
        </div>
      )}

      {/* Wrong chain banner */}
      {wrongChain && (
        <div
          className="px-4 py-2.5 text-center text-sm font-medium"
          style={{ background: '#fef3cd', color: '#92400e' }}
        >
          You are connected to the wrong network.{' '}
          <button
            className="underline font-semibold"
            onClick={() => switchChain({ chainId: CHAIN_ID })}
          >
            Switch to {CHAIN_FACT.name}
          </button>
        </div>
      )}

      {/* Tab nav */}
      <div className="max-w-3xl mx-auto px-4 pt-5">
        <div
          className="flex items-center gap-1 p-1 rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid var(--border)' }}
        >
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-150 min-h-[44px]"
              style={
                activeTab === id
                  ? { background: 'var(--accent)', color: 'white' }
                  : { color: 'var(--muted)' }
              }
              onClick={() => setActiveTab(id)}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-5 pb-16 space-y-5">
        {activeTab === 'jobs' && <MyJobs refreshTick={refreshTick} />}
        {activeTab === 'create' && <CreateJobForm onCreated={handleJobCreated} />}
        {activeTab === 'lookup' && <ProviderLookup />}
        {activeTab === 'feed' && <ActivityFeed refreshTick={refreshTick} />}
      </main>

      {/* Contract info footer */}
      <div className="fixed bottom-0 left-0 right-0 px-4 py-2 text-center text-xs" style={{ color: 'var(--muted)', background: 'rgba(255,255,255,0.8)', borderTop: '1px solid var(--border)' }}>
        AgentPact contract:{' '}
        <a
          href={explorerAddr(NETWORK.contractAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono hover:underline"
        >
          {NETWORK.contractAddress || '(not configured)'}
        </a>
        {' · '}{CHAIN_FACT.name}
      </div>
    </div>
  );
}
