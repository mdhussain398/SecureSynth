import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import './rn.css';
import { IdentityOrb } from './orb/IdentityOrb';
import type { OrbSignal } from './orb/types';
import { Contours, CursorLight, GlassNav } from './primitives';

/* Illustrative only: the categories the engine watches. The hero orb shows no customer data. */
const WATCHED: OrbSignal[] = [
  'Browser', 'Time of day', 'Location', 'Distance from home', 'Travel speed', 'Amount', 'Frequency',
  'New payee', 'Payee age', 'Speed to act', 'Action sequence', 'Failed sign-ins',
].map((label, i) => ({ id: `w${i}`, label, level: 0 }));

function EngineStatus() {
  const q = useQuery({
    queryKey: ['health'], refetchInterval: 15_000, retry: false,
    queryFn: async () => { const r = await fetch('/api/health'); if (!r.ok) throw new Error(); return r.json(); },
  });
  const ok = q.isSuccess;
  return (
    <p className="flex items-center gap-2 text-[length:var(--t-sm)] text-[color:var(--graphite-2)]" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-[var(--electric)]' : 'bg-[var(--silver)]'}`} />
      {q.isPending ? 'Checking the risk engine' : ok ? 'Risk engine online on this machine' : 'Risk engine offline. Start it with make dev-backend.'}
    </p>
  );
}

export function Landing() {
  const reduce = useReducedMotion();
  const rise = (d: number) => (reduce ? {} : {
    initial: { opacity: 0, y: '0.35em', filter: 'blur(8px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: 1.1, delay: d, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <main className="rn relative isolate h-[100dvh] min-h-[640px] overflow-hidden">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-70" seed={0.9} />
      <CursorLight />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
        <Link to="/" className="flex items-center gap-2.5" aria-label="SecureSynth home">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
            <circle cx="15" cy="15" r="13.5" fill="none" stroke="#101828" strokeWidth="1.5" />
            <circle cx="15" cy="15" r="4.5" fill="#005BFF" />
            <ellipse cx="15" cy="15" rx="13.5" ry="5" fill="none" stroke="#C0C7D1" strokeWidth="1" transform="rotate(-24 15 15)" />
          </svg>
          <span className="font-semibold tracking-[-0.01em]">SecureSynth</span>
        </Link>
        <div className="hidden md:block">
          <GlassNav label="Main" items={[
            { to: '/login', label: 'Bank' }, { to: '/soc/intelligence', label: 'Command Centre' }, { to: '/lab', label: 'Scenario Lab' },
          ]} />
        </div>
        <Link to="/login" className="rn-glass rounded-full px-4 py-2 text-[length:var(--t-sm)] font-medium md:hidden">Sign in</Link>
      </header>

      {/* The one focal subject. */}
      <motion.div aria-hidden
        className="absolute left-1/2 top-[8%] z-0 w-[min(118vw,560px)] -translate-x-1/2 md:left-auto md:right-[-2vw] md:top-[44%] md:w-[min(54vw,84vh)] md:-translate-x-0 md:-translate-y-1/2"
        initial={reduce ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}>
        <IdentityOrb hero signals={WATCHED} state="idle" />
      </motion.div>

      <section className="absolute inset-x-0 bottom-0 z-10 px-5 pb-6 sm:px-8 sm:pb-9">
        <h1 className="rn-display text-[length:var(--t-hero)] text-[color:var(--graphite)]">
          <span className="block overflow-hidden pb-[0.04em]"><motion.span className="block" {...rise(0.15)}>Your identity.</motion.span></span>
          <span className="block overflow-hidden pb-[0.06em]"><motion.span className="block" {...rise(0.27)}>Beyond passwords.</motion.span></span>
        </h1>
        <motion.div className="mt-6 flex flex-col gap-6 md:mt-8 md:flex-row md:items-end md:justify-between"
          initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.6 }}>
          <div className="max-w-[34rem]">
            <p className="text-[length:var(--t-lg)] leading-snug text-[color:var(--graphite-2)]">Adaptive intelligence for a safer financial world.</p>
            <p className="mt-2 max-w-[30rem] text-[length:var(--t-base)] text-[color:var(--graphite-3)]">
              A correct password and one-time code are not proof that the customer is present. SecureSynth keeps checking, explains every decision, and asks the real customer when it is unsure.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/login" className="rn-btn rn-btn-primary">Sign in to your bank</Link>
            <Link to="/soc/intelligence" className="rn-btn rn-btn-ghost">Open the Command Centre</Link>
          </div>
        </motion.div>
        <div className="mt-6 flex flex-col gap-1 border-t border-[color:var(--silver-2)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <EngineStatus />
          <p className="text-[length:var(--t-xs)] text-[color:var(--graphite-3)]">Prototype on synthetic data for AVISHKAR’26, problem 24. Not a real bank.</p>
        </div>
      </section>
    </main>
  );
}
