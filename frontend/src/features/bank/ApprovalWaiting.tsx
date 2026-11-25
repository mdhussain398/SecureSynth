import { useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import type { ChallengeRef, ChallengeStatus } from '../../api/types';
import { useChallengeStatus } from '../../api/queries';
import { parseTs } from '../../design/components';

const OPERATION_TEXT: Record<ChallengeRef['operation'], string> = {
  login: 'this sign-in',
  beneficiary_add: 'adding this payee',
  transfer: 'this transfer',
};

/** Shows the number to match on the trusted device and polls the challenge every 1.5 s. */
export function ApprovalWaiting({ challenge, message, onDone }:
  { challenge: ChallengeRef; message?: string; onDone: (status: ChallengeStatus) => void }) {
  const q = useChallengeStatus(challenge.id);
  const status = q.data?.status ?? 'pending';
  useEffect(() => { if (status !== 'pending') onDone(status); }, [status, onDone]);
  return (
    <section aria-live="polite" className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-l)] p-6 sm:p-10 text-center max-w-md mx-auto w-full">
      <Smartphone size={26} className="mx-auto text-[var(--accent)]" aria-hidden />
      <h1 className="serif text-[1.625rem] font-semibold mt-3 leading-tight">Approve on your registered device</h1>
      <p className="text-[var(--ink-2)] mt-2">{message || `We sent a request to confirm ${OPERATION_TEXT[challenge.operation]}.`}</p>
      <p className="text-[0.875rem] text-[var(--ink-3)] mt-6">Choose this number on your device</p>
      <p className="serif tnum text-[5.5rem] leading-none font-semibold tracking-tight mt-2 text-[var(--ink)]" aria-label={`Number to match: ${challenge.number_match}`}>{challenge.number_match}</p>
      <p className="text-[0.875rem] text-[var(--ink-3)] mt-6 flex items-center justify-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--stepup)] motion-safe:animate-pulse" aria-hidden />
        {q.isError ? 'Checking status… (retrying)' : 'Waiting for approval'}
      </p>
      <p className="text-[0.8125rem] text-[var(--ink-3)] mt-1">Request expires at {parseTs(challenge.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}. If you did not start this, deny it on your device.</p>
    </section>
  );
}
