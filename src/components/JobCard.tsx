import { useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { keccak256, toBytes } from 'viem';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AGENT_PACT, CHAIN_ID, STATUS_LABELS, explorerAddr } from '@/contract';
import type { JobData } from '@/contract';
import { useContractWrite, useJobResolvedAmounts } from '@/hooks/useAgentPact';
import { formatAddress, formatUsdc, formatCountdown, formatDate, formatReviewPeriod, parseOnchainError } from '@/utils/format';
import { ExternalLink, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  job: JobData;
  onUpdate: () => void;
}

export function JobCard({ job, onUpdate }: Props) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [expanded, setExpanded] = useState(false);
  const [resultInput, setResultInput] = useState('');
  const [bpsInput, setBpsInput] = useState('5000');
  const writeHook = useContractWrite();

  const wrongChain = chainId !== CHAIN_ID;
  // Snapshot time at mount; passed as prop from parent which re-renders periodically
  const [now] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  const isClient = address?.toLowerCase() === job.client.toLowerCase();
  const isProvider = address?.toLowerCase() === job.provider.toLowerCase();
  const isArbiter = address?.toLowerCase() === job.arbiter.toLowerCase();

  const status = STATUS_LABELS[job.status] ?? 'Unknown';

  const resolvedAmounts = useJobResolvedAmounts(job.id, status === 'Resolved' && expanded);

  // Compute what's available
  const deadlinePassed = now >= job.deliveryDeadline;
  const reviewEnded = job.submittedAt > 0n && now >= job.submittedAt + job.reviewPeriod;
  const arbiterTimeoutPassed = job.disputedAt > 0n && now >= job.disputedAt + 7n * 86400n;

  const actions: { label: string; fn: () => void; variant?: 'primary' | 'secondary' | 'danger' }[] = [];

  function doWrite(functionName: string, args: unknown[]) {
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    try {
      writeHook.writeContract({
        address: AGENT_PACT.address,
        abi: AGENT_PACT.abi,
        functionName: functionName,
        args: args,
        chainId: CHAIN_ID,
      });
      writeHook.reset();
      // poll for update
      setTimeout(onUpdate, 5000);
    } catch (err) {
      toast.error(parseOnchainError(err));
    }
  }

  // Provider: submit result
  if (isProvider && status === 'Funded' && !deadlinePassed) {
    actions.push({
      label: 'Submit Result',
      fn: () => {
        if (!resultInput.trim()) { toast.error('Enter result description.'); return; }
        const h = keccak256(toBytes(resultInput));
        doWrite('submitResult', [job.id, h]);
      },
    });
  }

  // Client: approve
  if (isClient && status === 'Submitted') {
    actions.push({ label: 'Approve & Release Payment', fn: () => doWrite('approve', [job.id]) });
  }

  // Client: reject (within review)
  if (isClient && status === 'Submitted' && !reviewEnded) {
    actions.push({ label: 'Reject & Dispute', variant: 'danger', fn: () => doWrite('reject', [job.id]) });
  }

  // Provider: claim after review
  if (isProvider && status === 'Submitted' && reviewEnded) {
    actions.push({ label: 'Claim (Review Period Ended)', fn: () => doWrite('claimAfterReview', [job.id]) });
  }

  // Client: refund expired
  if (isClient && status === 'Funded' && deadlinePassed) {
    actions.push({ label: 'Claim Refund', fn: () => doWrite('refundExpired', [job.id]) });
  }

  // Arbiter: resolve
  if (isArbiter && status === 'Disputed') {
    actions.push({
      label: `Resolve (${bpsInput} bps to provider)`,
      fn: () => doWrite('resolve', [job.id, BigInt(bpsInput)]),
    });
  }

  // Anyone: resolve timeout
  if (status === 'Disputed' && arbiterTimeoutPassed) {
    actions.push({ label: 'Resolve 50/50 (Arbiter Timeout)', fn: () => doWrite('resolveTimeout', [job.id]) });
  }

  const isLoading = writeHook.isPending || writeHook.isConfirming;

  if (writeHook.error) {
    toast.error(parseOnchainError(writeHook.error));
    writeHook.reset();
  }

  if (writeHook.isSuccess) {
    toast.success('Transaction confirmed!');
    onUpdate();
  }

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-white/60 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <span className="display text-base font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
            Job #{job.id.toString()}
          </span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums font-semibold text-sm" style={{ color: 'var(--ink)' }}>
            {formatUsdc(job.amount)} USDC
          </span>
          {expanded ? <ChevronUp size={16} color="var(--muted)" /> : <ChevronDown size={16} color="var(--muted)" />}
        </div>
      </div>

      {expanded && (
        <CardBody className="pt-0 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="space-y-3 mt-4">
            <InfoRow label="Client">
              <AddressLink addr={job.client} highlight={isClient} />
            </InfoRow>
            <InfoRow label="Provider">
              <AddressLink addr={job.provider} highlight={isProvider} />
            </InfoRow>
            <InfoRow label="Arbiter">
              <AddressLink addr={job.arbiter} highlight={isArbiter} />
            </InfoRow>
            <InfoRow label="Amount">
              <span className="tabular-nums font-semibold">{formatUsdc(job.amount)} USDC</span>
            </InfoRow>

            {/* Timers — hidden in terminal states */}
            {status !== 'Released' && status !== 'Refunded' && status !== 'Resolved' && (
              <InfoRow label="Delivery Deadline">
                <span className="flex items-center gap-1.5 tabular-nums text-sm">
                  <Clock size={13} color="var(--muted)" />
                  {deadlinePassed ? (
                    <span style={{ color: 'var(--danger)' }}>Passed</span>
                  ) : (
                    <span style={{ color: 'var(--ink-2)' }}>{formatCountdown(job.deliveryDeadline)}</span>
                  )}
                  <span className="text-xs ml-1" style={{ color: 'var(--muted)' }}>
                    ({formatDate(job.deliveryDeadline)})
                  </span>
                </span>
              </InfoRow>
            )}

            {/* Review window countdown — only while Submitted */}
            {status === 'Submitted' && (
              <InfoRow label="Review Window">
                <span className="flex items-center gap-1.5 tabular-nums text-sm">
                  <Clock size={13} color="var(--muted)" />
                  {reviewEnded ? (
                    <span style={{ color: 'var(--danger)' }}>Ended</span>
                  ) : (
                    <span style={{ color: 'var(--success)' }}>
                      {formatCountdown(job.submittedAt + job.reviewPeriod)}
                    </span>
                  )}
                </span>
              </InfoRow>
            )}

            {/* Arbiter timeout countdown — only while Disputed */}
            {status === 'Disputed' && (
              <InfoRow label="Arbiter Timeout">
                <span className="flex items-center gap-1.5 tabular-nums text-sm">
                  <Clock size={13} color="var(--muted)" />
                  {arbiterTimeoutPassed ? (
                    <span style={{ color: 'var(--danger)' }}>Timed out</span>
                  ) : (
                    <span style={{ color: 'var(--ink-2)' }}>
                      {formatCountdown(job.disputedAt + 7n * 86400n)}
                    </span>
                  )}
                </span>
              </InfoRow>
            )}

            {/* Final-state outcome rows */}
            {status === 'Released' && (
              <InfoRow label="Outcome">
                <span className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                  Paid to provider — {formatUsdc(job.amount)} USDC
                </span>
              </InfoRow>
            )}
            {status === 'Refunded' && (
              <InfoRow label="Outcome">
                <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                  Refunded to client — {formatUsdc(job.amount)} USDC
                </span>
              </InfoRow>
            )}
            {status === 'Resolved' && (
              <InfoRow label="Outcome">
                <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                  {resolvedAmounts
                    ? `Split by arbiter: provider ${formatUsdc(resolvedAmounts.providerAmount)} USDC, client ${formatUsdc(resolvedAmounts.clientAmount)} USDC`
                    : 'Split by arbiter'}
                </span>
              </InfoRow>
            )}

            <InfoRow label="Spec Hash">
              <span className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{job.specHash}</span>
            </InfoRow>
            {job.resultHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
              <InfoRow label="Result Hash">
                <span className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{job.resultHash}</span>
              </InfoRow>
            )}

            {/* Actions */}
            {actions.length > 0 && (
              <div className="pt-3 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
                {isProvider && status === 'Funded' && !deadlinePassed && (
                  <>
                    {/* Trust summary — shown to provider before they commit to work */}
                    <div
                      className="rounded-xl px-4 py-3 space-y-2"
                      style={{ background: 'rgba(18,45,69,0.05)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.07em', color: 'var(--muted)' }}>
                          Arbiter
                        </span>
                        <a
                          href={explorerAddr(job.arbiter)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 mono text-xs hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--ink-2)' }}
                        >
                          {job.arbiter}
                          <ExternalLink size={10} />
                        </a>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.07em', color: 'var(--muted)' }}>
                          Review Period
                        </span>
                        <span className="text-xs tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>
                          {formatReviewPeriod(job.reviewPeriod)}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed pt-0.5" style={{ color: 'var(--subtle)' }}>
                        The arbiter decides disputes. Only accept jobs with an arbiter you trust.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                        Result Description (hashed to resultHash)
                      </label>
                      <textarea
                        className="input-field text-sm resize-none"
                        rows={2}
                        placeholder="Describe the result you delivered…"
                        value={resultInput}
                        onChange={e => setResultInput(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {isArbiter && status === 'Disputed' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                      Provider share (bps, 0–10000 = 0–100%)
                    </label>
                    <input
                      className="input-field tabular-nums text-sm"
                      type="number"
                      min="0"
                      max="10000"
                      value={bpsInput}
                      onChange={e => setBpsInput(e.target.value)}
                    />
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      Provider: {formatUsdc(job.amount * BigInt(bpsInput || '0') / 10000n)} USDC &nbsp;
                      Client: {formatUsdc(job.amount - job.amount * BigInt(bpsInput || '0') / 10000n)} USDC
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => (
                    <Button
                      key={i}
                      variant={a.variant ?? 'primary'}
                      size="sm"
                      onClick={a.fn}
                      loading={isLoading}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardBody>
      )}
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm flex-shrink-0 font-medium" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-sm text-right" style={{ color: 'var(--ink-2)' }}>{children}</span>
    </div>
  );
}

function AddressLink({ addr, highlight }: { addr: string; highlight?: boolean }) {
  return (
    <a
      href={explorerAddr(addr)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 hover:opacity-70 transition-opacity mono text-xs"
      style={{ color: highlight ? 'var(--accent)' : 'var(--ink-2)' }}
    >
      {formatAddress(addr)}
      {highlight && <span className="text-xs font-semibold ml-0.5">(you)</span>}
      <ExternalLink size={10} />
    </a>
  );
}
