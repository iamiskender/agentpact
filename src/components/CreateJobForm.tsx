import { useState, useEffect, useRef } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AGENT_PACT, CHAIN_ID } from '@/contract';
import { NETWORK } from '@/networks';
import { useApproveUsdc, useContractWrite, useUsdcAllowance, useUsdcBalance, parseUsdcInput } from '@/hooks/useAgentPact';
import { hashSpec, formatUsdc, parseOnchainError } from '@/utils/format';

export function CreateJobForm({ onCreated }: { onCreated: () => void }) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [provider, setProvider] = useState('');
  const [arbiter, setArbiter] = useState('');
  const [amount, setAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [reviewMinutes, setReviewMinutes] = useState('5');
  const [spec, setSpec] = useState('');
  const [step, setStep] = useState<'idle' | 'approving' | 'creating' | 'done'>('idle');

  // Capture form values in a ref so the trigger-create useEffect can read them
  const formRef = useRef({ provider, arbiter, amount, deadline, reviewMinutes, spec });
  formRef.current = { provider, arbiter, amount, deadline, reviewMinutes, spec };

  const parsedAmount = (() => {
    try { return amount ? parseUsdcInput(amount) : 0n; } catch { return 0n; }
  })();
  const deadlineTs = deadline ? BigInt(Math.floor(new Date(deadline).getTime() / 1000)) : 0n;
  const specHash = hashSpec(spec);

  const { data: balance } = useUsdcBalance(address);
  const { data: allowance, refetch: refetchAllowance } = useUsdcAllowance(address);

  const approveHook = useApproveUsdc();
  const createHook = useContractWrite();

  const needsApproval = (allowance ?? 0n) < parsedAmount;
  const wrongChain = chainId !== CHAIN_ID;

  // Watch approve success → refetch allowance → move to creating
  useEffect(() => {
    if (approveHook.isSuccess && step === 'approving') {
      void refetchAllowance().then(() => setStep('creating'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveHook.isSuccess, step]);

  // Watch create success → done
  useEffect(() => {
    if (createHook.isSuccess && step === 'creating') {
      setStep('done');
      toast.success('Job created successfully!');
      onCreated();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createHook.isSuccess, step]);

  // When step moves to 'creating' (after approval), fire the createJob tx
  useEffect(() => {
    if (step !== 'creating') return;
    if (createHook.isPending || createHook.hash) return;
    const { provider: p, arbiter: a, amount: amt, deadline: dl, reviewMinutes: rm, spec: sp } = formRef.current;
    try {
      const pAmt = parseUsdcInput(amt);
      const dlTs = BigInt(Math.floor(new Date(dl).getTime() / 1000));
      const revSecs = BigInt(Math.round(Number(rm) * 60));
      const spHash = hashSpec(sp);
      createHook.writeContract({
        address: AGENT_PACT.address,
        abi: AGENT_PACT.abi,
        functionName: 'createJob',
        args: [p as `0x${string}`, a as `0x${string}`, pAmt, dlTs, revSecs, spHash],
        chainId: CHAIN_ID,
      });
    } catch {
      setStep('idle');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Watch errors
  useEffect(() => {
    if (approveHook.error) {
      setStep('idle');
      toast.error(parseOnchainError(approveHook.error));
      approveHook.reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveHook.error]);

  useEffect(() => {
    if (createHook.error) {
      setStep('idle');
      toast.error(parseOnchainError(createHook.error));
      createHook.reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createHook.error]);

  function validate(): string | null {
    if (!address) return 'Connect your wallet first.';
    if (!provider.match(/^0x[0-9a-fA-F]{40}$/)) return 'Invalid provider address.';
    if (!arbiter.match(/^0x[0-9a-fA-F]{40}$/)) return 'Invalid arbiter address.';
    if (parsedAmount <= 0n) return 'Amount must be greater than 0.';
    if (deadlineTs <= BigInt(Math.floor(Date.now() / 1000))) return 'Deadline must be in the future.';
    const rev = Number(reviewMinutes);
    if (isNaN(rev) || !Number.isInteger(rev) || rev < 1 || rev > 43200) return 'Review period must be 1–43,200 minutes (1 min – 30 days).';
    if (provider.toLowerCase() === address.toLowerCase()) return 'Provider cannot be the same as client.';
    if (arbiter.toLowerCase() === address.toLowerCase()) return 'Arbiter cannot be the same as client.';
    if (arbiter.toLowerCase() === provider.toLowerCase()) return 'Arbiter cannot be the same as provider.';
    if ((balance ?? 0n) < parsedAmount) return `Insufficient USDC balance (have ${formatUsdc(balance ?? 0n)}).`;
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return; }
    const err = validate();
    if (err) { toast.error(err); return; }

    if (needsApproval) {
      setStep('approving');
      approveHook.approveUsdc(parsedAmount);
    } else {
      setStep('creating');
      // The useEffect above fires on step → 'creating'
    }
  }

  const isLoading = step === 'approving' || step === 'creating';

  function buttonLabel() {
    if (wrongChain) return `Switch to ${NETWORK.name}`;
    if (step === 'approving' && approveHook.isPending) return 'Confirm approval in wallet…';
    if (step === 'approving' && approveHook.isConfirming) return 'Confirming approval…';
    if (step === 'creating' && createHook.isPending) return 'Confirm job creation in wallet…';
    if (step === 'creating' && createHook.isConfirming) return 'Confirming job…';
    if (needsApproval) return `Approve ${amount} USDC & Create Job`;
    return 'Create Job';
  }

  const minDatetime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);
  const defaultDeadline = new Date(Date.now() + 15 * 60_000).toISOString().slice(0, 16);

  return (
    <Card>
      <CardHeader>
        <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Create Job
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Lock USDC in escrow for an agent-to-agent task
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Provider Address">
              <input
                className="input-field"
                placeholder="0x..."
                value={provider}
                onChange={e => setProvider(e.target.value)}
                required
              />
            </Field>
            <Field label="Arbiter Address">
              <input
                className="input-field"
                placeholder="0x..."
                value={arbiter}
                onChange={e => setArbiter(e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Amount (USDC)" hint={balance !== undefined ? `Balance: ${formatUsdc(balance)} USDC` : undefined}>
              <input
                className="input-field tabular-nums"
                type="number"
                min="0.000001"
                step="0.000001"
                placeholder="100.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Review Period (minutes)" hint="1 – 43,200 (30 days)">
              <input
                className="input-field tabular-nums"
                type="number"
                min="1"
                max="43200"
                step="1"
                placeholder="5"
                value={reviewMinutes}
                onChange={e => setReviewMinutes(e.target.value)}
                required
              />
              {(() => {
                const v = Number(reviewMinutes);
                if (reviewMinutes !== '' && (!Number.isInteger(v) || v < 1 || v > 43200)) {
                  return (
                    <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
                      Must be a whole number between 1 and 43,200.
                    </p>
                  );
                }
                return null;
              })()}
            </Field>
          </div>

          <Field label="Delivery Deadline">
            <input
              className="input-field"
              type="datetime-local"
              min={minDatetime}
              value={deadline || defaultDeadline}
              onChange={e => setDeadline(e.target.value)}
              required
            />
          </Field>

          <Field label="Job Description" hint="Hashed onchain as specHash">
            <textarea
              className="input-field resize-none"
              rows={3}
              placeholder="Describe the deliverable the provider must produce…"
              value={spec}
              onChange={e => setSpec(e.target.value)}
            />
          </Field>

          {spec && (
            <div className="rounded-xl px-3 py-2 text-xs mono" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
              specHash: {specHash}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={isLoading}
            disabled={!address || isLoading}
          >
            {buttonLabel()}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
        {label}
        {hint && <span className="ml-2 font-normal text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}
