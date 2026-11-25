/* Judge Mode: a full-screen presentation of one real Scenario Lab run.
 * "Run live" calls the real API (same admin + loopback + Origin + CSRF protections as the Lab). The recorded steps
 * are then revealed one at a time so the audience can follow them; nothing is simulated in the browser. The orb
 * shows the backend assessment that matches the latest revealed risk checkpoint. */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Maximize2, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import { useMe, useRunScenario, useScenarios, useSessionDetail } from '../api/queries';
import type { Decision } from '../api/types';
import { BrandMark } from '../layout/layouts';
import './rn.css';
import { IdentityOrb } from './orb/IdentityOrb';
import { AnimatedNumber, Contours } from './primitives';
import { DECISION_WORD, RunOutcome, RunSequence, StageRail, stageReached } from './RunSequence';
import { signalsOf } from './signals';

const STEP_MS = 1300;

export function JudgeMode() {
  const me = useMe();
  const nav = useNavigate();
  const scenarios = useScenarios();
  const [sid, setSid] = useState<string | null>(null);
  const current = scenarios.data?.find((s) => s.id === sid) ?? scenarios.data?.[0];
  const run = useRunScenario(current?.id ?? '');
  const [revealed, setRevealed] = useState(0);
  const [reduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const data = run.data;
  const total = data?.steps.length ?? 0;
  const detail = useSessionDetail(data?.session_id ?? '');

  // Reveal the recorded steps one by one (all at once under reduced motion).
  useEffect(() => {
    if (!data) return;
    if (reduce) { setRevealed(data.steps.length); return; }
    setRevealed(1);
    const t = setInterval(() => setRevealed((r) => { if (r >= data.steps.length) { clearInterval(t); return r; } return r + 1; }), STEP_MS);
    return () => clearInterval(t);
  }, [data, reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape' && !document.fullscreenElement) nav('/soc/intelligence');
      if (e.key.toLowerCase() === 'r' && current && !run.isPending) run.mutate(Object.fromEntries(current.params.map((p) => [p.key, p.value])));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, current, run]);

    const shown = data?.steps.slice(0, revealed) ?? [];
  const scored = shown.filter((s) => s.risk_score != null);
  const latest = scored[scored.length - 1];
  const assessments = detail.data?.assessments ?? [];
  // Match the revealed checkpoint to the session's assessment with the same backend score (latest such one).
  const assessment = latest?.risk_score != null
    ? [...assessments].reverse().find((x) => Math.abs(x.risk_score - (latest.risk_score as number)) < 0.05)
    : undefined;
  const signals = useMemo(() => signalsOf(assessment), [assessment]);
  const state: 'idle' | Decision = latest?.decision ?? 'idle';
  const done = !!data && revealed >= total;

  if (me.isError) return <Navigate to="/login" replace />;
  if (me.data && me.data.role !== 'admin') return <Navigate to="/bank" replace />;

  const start = () => current && run.mutate(Object.fromEntries(current.params.map((p) => [p.key, p.value])));
  const fullscreen = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined); else document.exitFullscreen?.(); };

  return (
    <main className="rn relative isolate flex min-h-[100dvh] flex-col overflow-x-hidden lg:h-[100dvh] lg:overflow-hidden">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-35" seed={2.3} clearAt={[72, 46]} />
      <header className="flex flex-wrap items-center gap-x-3 gap-y-3 px-5 py-4 sm:px-10">
        <span className="basis-auto flex items-center gap-2.5 font-semibold"><BrandMark />SecureSynth<span className="font-normal text-[color:var(--graphite-3)]">Judge mode</span></span>
        <div role="group" aria-label="Scenario" className="rn-glass order-last mx-auto flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]">
          {(scenarios.data ?? []).map((s) => {
            const on = s.id === current?.id;
            return (
              <button key={s.id} type="button" aria-pressed={on} disabled={run.isPending}
                onClick={() => { setSid(s.id); run.reset(); setRevealed(0); }}
                className={`relative min-h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[0.9375rem] ${on ? 'rn-lens font-semibold text-[color:var(--graphite)]' : 'text-[color:var(--graphite-2)] hover:text-[color:var(--graphite)]'}`}>
                {s.title}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={fullscreen} className="rn-btn rn-btn-ghost min-h-10" aria-label="Toggle full screen"><Maximize2 size={17} aria-hidden /></button>
          <Link to="/soc/intelligence" className="rn-btn rn-btn-ghost min-h-10" aria-label="Exit Judge mode (Esc)"><X size={18} aria-hidden /></Link>
        </div>
      </header>

      {scenarios.isError ? (
        <p className="px-10 pt-20 text-[color:var(--graphite-2)]">The Scenario Lab is not available. It runs only in demo mode, on this machine.</p>
      ) : !current ? (
        <p className="px-10 pt-20 text-[color:var(--graphite-3)]" aria-busy="true">Loading scenarios</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-8 px-5 pb-4 sm:px-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-12">
          <section aria-labelledby="sc-title" className="flex min-h-0 min-w-0 flex-col">
            <h1 id="sc-title" className="rn-display text-[clamp(2.5rem,4.6vw,4.25rem)]">{current.title}</h1>
            <p className="mt-5 max-w-[60ch] text-[1.1875rem] leading-snug text-[color:var(--graphite-2)]">{current.narrative}</p>
            <p className="mt-3 max-w-[60ch] text-[1rem] text-[color:var(--graphite-3)]">Expected: {current.expected}</p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button type="button" className="rn-btn rn-btn-primary" onClick={start} disabled={run.isPending}>
                {data ? <RotateCcw size={17} aria-hidden /> : <Play size={17} aria-hidden />}{run.isPending ? 'Running against the API' : data ? 'Run again' : 'Run live'}
              </button>
              {data && !done && <button type="button" className="rn-btn rn-btn-ghost" onClick={() => setRevealed(total)}><SkipForward size={17} aria-hidden />Show all steps</button>}
              <span className="text-[0.875rem] text-[color:var(--graphite-3)]">Keys: R runs, Esc exits</span>
            </div>
            {run.error && <p role="alert" className="mt-4 text-[color:var(--block)]">Run failed: {run.error.message}</p>}
            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-2">
              {data ? <RunSequence run={data} revealed={revealed} large /> : (
                <p className="text-[1.0625rem] text-[color:var(--graphite-3)]">Each step of the run appears here as the real API responds: who acted, the request, the risk index and the decision.</p>
              )}
            </div>
          </section>

          <section aria-label="Live assessment" className="flex min-h-0 min-w-0 flex-col items-center justify-center">
            <div className="w-full max-w-[min(460px,44vh)]"><IdentityOrb signals={signals} state={state} hero={!assessment} /></div>
            <div className="mt-2 flex items-end gap-5">
              {latest?.risk_score != null && <span className="rn-display text-[clamp(4rem,7vw,6.5rem)] leading-[0.8]"><AnimatedNumber value={latest.risk_score} /></span>}
              <div className="pb-1">
                {latest?.decision ? <p className="rn-state text-[1.5rem]" data-d={latest.decision}>{DECISION_WORD[latest.decision]}</p> : <p className="text-[1.125rem] text-[color:var(--graphite-3)]">Waiting for a risk checkpoint</p>}
                <p className="text-[0.9375rem] text-[color:var(--graphite-3)]">risk index (0–100, not a probability)</p>
              </div>
            </div>
            {done && data && <div className="rn-glass mt-5 w-full rounded-[var(--radius-l)] p-6"><RunOutcome run={data} large /></div>}
          </section>
        </div>
      )}

      <footer className="px-5 pb-5 pt-2 sm:px-10">
        <StageRail reached={data ? stageReached(data, revealed) : -1} large />
        <p className="mt-3 text-[0.875rem] text-[color:var(--graphite-3)]">Synthetic data, real API. Steps are revealed one at a time from the recorded run; the orb visualises the engine’s output and is not the model.</p>
      </footer>
    </main>
  );
}
