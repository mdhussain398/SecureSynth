import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, FastForward, Loader2, MonitorPlay, Play, RotateCcw } from 'lucide-react';
import type { Scenario, ScenarioRun } from '../../api/types';
import { useAdvanceClock, useClock, useReset, useRunScenario, useScenarios } from '../../api/queries';
import { Banner, Button, ButtonLink, Card, EmptyState, ErrorState, Money, Skeleton, fmtTime, parseTs } from '../../design/components';
import { RunOutcome, RunSequence, StageRail, stageReached } from '../../renaissance/RunSequence';
import { PageTitle } from '../../layout/layouts';


function ResetBar() {
  const clock = useClock();
  const advance = useAdvanceClock();
  const reset = useReset();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rn-glass flex flex-wrap items-center gap-3 rounded-full pl-5 pr-2 py-2 mb-6">
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

function RunResult({ run }: { run: ScenarioRun }) {
  return (
    <div className="mt-5 border-t border-[color:var(--hairline)] pt-5" aria-live="polite">
      <StageRail reached={stageReached(run, run.steps.length)} />
      <div className="mt-5"><RunSequence run={run} /></div>
      <div className="mt-4 rounded-[var(--radius-m)] bg-[var(--surface-2)] p-5"><RunOutcome run={run} /></div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-[0.875rem]">
        <span className="text-[color:var(--ink-3)]">Run as {run.username}, {fmtTime(new Date().toISOString())}</span>
        {run.session_id && <Link to={`/soc/sessions/${encodeURIComponent(run.session_id)}`} className="font-medium text-[color:var(--accent)]">Open this session in the Command Centre</Link>}
      </div>
    </div>
  );
}

export function LabPage() {
  const q = useScenarios();
  return (
    <>
      <PageTitle title="Scenario Lab" sub="Drive scripted attacks and genuine customers through the real API, and watch each step move through the pipeline. Demo mode only; every run is recorded as a lab session."
        actions={<ButtonLink to="/judge" variant="secondary"><MonitorPlay size={16} aria-hidden />Present in Judge mode</ButtonLink>} />
      <ResetBar />
      {q.isPending ? <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div> :
        q.error ? <ErrorState error={q.error} title={q.error.status === 404 ? 'Scenario Lab is not available' : undefined} onRetry={() => q.refetch()} /> :
          q.data.length === 0 ? <EmptyState title="No scenarios defined" /> :
            <div className="grid gap-5 xl:grid-cols-2 items-start">{q.data.map((s) => <ScenarioCard key={s.id} s={s} />)}</div>}
    </>
  );
}
