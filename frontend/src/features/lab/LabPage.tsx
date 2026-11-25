import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, FastForward, Loader2, Play, RotateCcw } from 'lucide-react';
import type { Decision, Scenario, ScenarioRun, ScenarioStep } from '../../api/types';
import { useAdvanceClock, useClock, useReset, useRunScenario, useScenarios } from '../../api/queries';
import { Badge, Banner, Button, Card, DecisionPill, EmptyState, ErrorState, Money, Skeleton, fmtTime, parseTs } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

const ACTOR: Record<ScenarioStep['actor'], string> = { customer: 'Customer', attacker: 'Attacker', trusted_device: 'Trusted device', system: 'System' };

function ResetBar() {
  const clock = useClock();
  const advance = useAdvanceClock();
  const reset = useReset();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] px-4 py-2.5 mb-4">
      <span className="flex items-center gap-2 text-[var(--ink-2)]"><Clock size={15} aria-hidden />Simulated clock</span>
      <span className="tnum font-medium">{clock.isPending ? '…' : clock.data ? parseTs(clock.data.now).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'unavailable'}</span>
      <Button size="sm" variant="secondary" loading={advance.isPending} onClick={() => advance.mutate(24)}><FastForward size={14} aria-hidden />Advance 24 h</Button>
      <span className="flex-1" />
      {reset.isSuccess && <span className="text-[0.8125rem] text-[var(--ink-3)]">Reset · seed {reset.data.seed_hash}</span>}
      {(reset.error || advance.error) && <span className="text-[0.8125rem] text-[var(--block)]">{(reset.error ?? advance.error)?.message}</span>}
      {confirm ? (
        <span className="inline-flex gap-1"><Button size="sm" variant="danger" loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSettled: () => setConfirm(false) })}>Confirm reset</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></span>
      ) : <Button size="sm" variant="danger" onClick={() => setConfirm(true)}><RotateCcw size={14} aria-hidden />Reset demo</Button>}
    </div>
  );
}

function ScenarioCard({ s }: { s: Scenario }) {
  const run = useRunScenario(s.id);
  const [params, setParams] = useState<Record<string, number | string>>(() => Object.fromEntries(s.params.map((p) => [p.key, p.value])));
  return (
    <Card title={s.title} description={s.narrative}>
      <p className="text-[0.8125rem] text-[var(--ink-2)]"><span className="text-[var(--ink-3)]">Expected:</span> {s.expected}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(params); }}>
        {s.params.map((p) => (
          <div key={p.key} className="min-w-[150px] flex-1">
            <label className="field-label" htmlFor={`${s.id}-${p.key}`}>{p.label}</label>
            {p.type === 'select' ? (
              <select id={`${s.id}-${p.key}`} className="input" value={String(params[p.key])} onChange={(e) => setParams((v) => ({ ...v, [p.key]: e.target.value }))}>
                {(p.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <>
                <input id={`${s.id}-${p.key}`} className="input tnum" type="number" min={p.min} max={p.max} value={params[p.key]} onChange={(e) => setParams((v) => ({ ...v, [p.key]: e.target.value === '' ? '' : Number(e.target.value) }))} />
                {p.key.endsWith('_paise') && typeof params[p.key] === 'number' && <p className="text-[0.75rem] text-[var(--ink-3)] mt-0.5 tnum">= <Money paise={params[p.key] as number} whole /></p>}
              </>
            )}
          </div>
        ))}
        <Button type="submit" loading={run.isPending} aria-label={`Run scenario: ${s.title}`}><Play size={14} aria-hidden />{run.isPending ? 'Running…' : run.data ? 'Run again' : 'Run'}</Button>
      </form>
      {run.isPending && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-3" role="status">
          <p className="flex items-center gap-2 text-[var(--ink-2)]"><Loader2 size={15} className="motion-safe:animate-spin" aria-hidden />Running scenario against the API…</p>
          <div className="mt-3 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        </div>
      )}
      {run.error && <div className="mt-3"><Banner tone="block" title="Run failed">{run.error.message}</Banner></div>}
      {run.data && !run.isPending && <RunResult run={run.data} />}
    </Card>
  );
}

const OUTCOME: Record<Decision, { title: string; box: string }> = {
  ALLOW: { title: 'Allowed', box: 'bg-[var(--allow-tint)] border-[var(--allow-line)]' },
  STEP_UP: { title: 'Held for trusted-device approval', box: 'bg-[var(--stepup-tint)] border-[var(--stepup-line)]' },
  BLOCK: { title: 'Blocked, session restricted', box: 'bg-[var(--block-tint)] border-[var(--block-line)]' },
};

function RunResult({ run }: { run: ScenarioRun }) {
  const delta = run.protected_balance_after_paise - run.protected_balance_before_paise;
  const o = run.final_decision ? OUTCOME[run.final_decision] : null;
  return (
    <div className="mt-4 border-t border-[var(--hairline)] pt-4" aria-live="polite">
      <div className={`grid gap-3 sm:grid-cols-2 rounded-[var(--radius-m)] border p-3.5 ${o ? o.box : 'border-[var(--hairline)]'}`}>
        <div>
          <p className="text-[0.75rem] text-[var(--ink-3)]">Final decision</p>
          <div className="flex flex-wrap items-center gap-2 mt-1"><DecisionPill decision={run.final_decision} className="text-[0.875rem] py-0.5" />{o && <span className="font-semibold">{o.title}</span>}</div>
        </div>
        <div>
          <p className="text-[0.75rem] text-[var(--ink-3)]">Protected balance ({run.username})</p>
          <p className="tnum mt-1 flex flex-wrap items-baseline gap-x-2">
            <Money paise={run.protected_balance_before_paise} whole className="text-[var(--ink-2)]" />
            <span aria-hidden className="text-[var(--ink-3)]">→</span><span className="sr-only">to</span>
            <Money paise={run.protected_balance_after_paise} whole className="text-[1.125rem] font-semibold" />
            <span className={`text-[0.8125rem] ${delta < 0 ? 'text-[var(--block)]' : 'text-[var(--ink-3)]'}`}>{delta === 0 ? 'unchanged' : <>{delta < 0 ? '−' : '+'}<Money paise={Math.abs(delta)} whole /></>}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1">
        <h3 className="text-[0.875rem] font-semibold">Step log</h3>
        {run.session_id && <Link to={`/soc/sessions/${encodeURIComponent(run.session_id)}`} className="text-[0.875rem] text-[var(--accent)] font-medium">Open session in Command Centre</Link>}
      </div>
      <ol className="relative">
        {run.steps.map((st) => st.http.status === 0 ? (
          <li key={st.n} className="flex items-center gap-2 py-2 text-[0.8125rem] text-[var(--ink-3)]">
            <span className="h-px flex-1 border-t border-dashed border-[var(--hairline-strong)]" aria-hidden />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-0.5"><Clock size={12} aria-hidden /><span className="sr-only">Simulated time: </span>{st.action}{st.note && <span className="text-[var(--ink-3)]"> · {st.note}</span>}</span>
            <span className="h-px flex-1 border-t border-dashed border-[var(--hairline-strong)]" aria-hidden />
          </li>
        ) : (
          <li key={st.n} className="grid grid-cols-[28px_1fr] gap-x-2 py-2.5 border-b border-[var(--hairline)] last:border-b-0">
            <span className="tnum text-[0.75rem] text-[var(--ink-3)] pt-0.5">{st.n}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge tone={st.actor === 'attacker' ? 'block' : st.actor === 'trusted_device' ? 'info' : 'neutral'}>{ACTOR[st.actor]}</Badge>
                <span className="font-medium">{st.action}</span>
                <span className="ml-auto flex items-center gap-2">
                  {st.risk_score != null && <span className="tnum text-[0.8125rem] text-[var(--ink-2)]">risk {st.risk_score.toFixed(1)}</span>}
                  {st.decision && <DecisionPill decision={st.decision} />}
                </span>
              </div>
              <p className="text-[0.75rem] text-[var(--ink-3)] mt-1 break-all">
                <span className="font-mono">{st.http.method} {st.http.path}</span>{' '}
                <span className={`tnum font-medium ${st.http.status >= 400 ? 'text-[var(--block)]' : 'text-[var(--ink-2)]'}`}>→ {st.http.status}</span>
              </p>
              {st.note && <p className="text-[0.8125rem] text-[var(--ink-2)] mt-0.5">{st.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[0.75rem] text-[var(--ink-3)] mt-2">Run as {run.username} · {fmtTime(new Date().toISOString())}</p>
    </div>
  );
}

export function LabPage() {
  const q = useScenarios();
  return (
    <>
      <PageTitle title="Scenario Lab" sub="Drive scripted scenarios through the real API. Demo mode only; every run is recorded as a lab session." />
      <ResetBar />
      {q.isPending ? <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div> :
        q.error ? <ErrorState error={q.error} title={q.error.status === 404 ? 'Scenario Lab is not available' : undefined} onRetry={() => q.refetch()} /> :
          q.data.length === 0 ? <EmptyState title="No scenarios defined" /> :
            <div className="grid gap-4 xl:grid-cols-2 items-start">{q.data.map((s) => <ScenarioCard key={s.id} s={s} />)}</div>}
    </>
  );
}
