import { useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Smartphone } from 'lucide-react';
import type { ChallengeRef, ChallengeStatus } from '../../api/types';
import { useChallengeStatus } from '../../api/queries';
import { parseTs } from '../../design/components';

const OPERATION_TEXT: Record<ChallengeRef['operation'], string> = {
  login: 'this sign-in',
  beneficiary_add: 'adding this payee',
  transfer: 'this transfer',
};

/** Step-up focus experience: everything else recedes behind glass; the one number to match is the subject.
 *  Polls the challenge every 1.5 s. The number and expiry come from the backend challenge. */
export function ApprovalWaiting({ challenge, message, onDone }:
  { challenge: ChallengeRef; message?: string; onDone: (status: ChallengeStatus) => void }) {
  const q = useChallengeStatus(challenge.id);
  const reduce = useReducedMotion();
  const status = q.data?.status ?? 'pending';
  useEffect(() => { if (status !== 'pending') onDone(status); }, [status, onDone]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto px-4 py-10 bg-[rgba(233,237,244,0.72)] backdrop-blur-[18px]">
      <motion.section aria-live="polite" aria-labelledby="approve-title"
        initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="rn-glass relative w-full max-w-[520px] rounded-[var(--radius-l)] px-6 py-9 sm:px-12 sm:py-12 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--graphite)] text-white shadow-[0_10px_24px_-10px_rgba(0,61,170,0.6)]">
          <Smartphone size={22} aria-hidden />
        </span>
        <h1 id="approve-title" className="rn-display mt-5 text-[clamp(2.25rem,6vw,3rem)]">Approve on your registered device</h1>
        <p className="mx-auto mt-3 max-w-[38ch] text-[color:var(--ink-2)]">{message || `We sent a request to confirm ${OPERATION_TEXT[challenge.operation]}.`}</p>
        <p className="mt-8 text-[0.9375rem] text-[color:var(--ink-3)]">Choose this number on your device</p>
        <div className="relative mx-auto mt-3 grid h-48 w-48 place-items-center">
          {/* waiting halo: a slow ring of light around the number (static under reduced motion) */}
          <svg aria-hidden viewBox="0 0 100 100" className={`absolute inset-0 h-full w-full ${reduce ? '' : 'motion-safe:animate-[spin_6s_linear_infinite]'}`}>
            <defs><linearGradient id="halo" x1="0" x2="1"><stop offset="0" stopColor="#005BFF" stopOpacity="0" /><stop offset="1" stopColor="#005BFF" /></linearGradient></defs>
            <circle cx="50" cy="50" r="46" fill="none" stroke="var(--silver-2)" strokeWidth="1.2" />
            <circle cx="50" cy="50" r="46" fill="none" stroke="url(#halo)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="72 217" />
          </svg>
          <p className="rn-display rn-num text-[6.5rem] leading-none" aria-label={`Number to match: ${challenge.number_match}`}>{challenge.number_match}</p>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-[0.9375rem] text-[color:var(--ink-2)]">
          <span className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-[var(--stepup)] motion-safe:animate-pulse" aria-hidden />
          {q.isError ? 'Checking status (retrying)' : 'Waiting for your approval'}
        </p>
        <p className="mt-2 text-[0.875rem] text-[color:var(--ink-3)]">
          Request expires at {parseTs(challenge.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}. If you did not start this, deny it on your device.
        </p>
      </motion.section>
    </div>
  );
}
