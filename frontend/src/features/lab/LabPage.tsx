import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, FastForward, Play, RotateCcw } from 'lucide-react';
import type { Scenario, ScenarioStep } from '../../api/types';
import { useAdvanceClock, useClock, useReset, useRunScenario, useScenarios } from '../../api/queries';
import { Badge, Banner, Button, Card, DataTable, DecisionPill, EmptyState, ErrorState, Money, Skeleton, fmtTime, parseTs } from '../../design/components';
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
              <input id={`${s.id}-${p.key}`} className="input tnum" type="number" min={p.min} max={p.max} value={params[p.key]} onChange={(e) => setParams((v) => ({ ...v, [p.key]: e.target.value === '' ? '' : Number(e.target.value) }))} />
            )}
          </div>
        ))}
        <Button type="submit" loading={run.isPending}><Play size={14} aria-hidden />{run.isPending ? 'Running…' : 'Run'}</Button>
      </form>
      {run.error && <div className="mt-3"><Banner tone="block" title="Run failed">{run.error.message}</Banner></div>}
      {run.data && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-2">
            <span className="flex items-center gap-2 text-[var(--ink-2)]">Final <DecisionPill decision={run.data.final_decision} /></span>
            <span className="text-[var(--ink-2)]">Protected balance <Money paise={run.data.protected_balance_before_paise} whole /> → <Money paise={run.data.protected_balance_after_paise} whole className="font-semibold text-[var(--ink)]" /></span>
            {run.data.session_id && <Link to={`/soc/sessions/${encodeURIComponent(run.data.session_id)}`} className="text-[var(--accent)] font-medium">Open in Command Centre</Link>}
          </div>
          <DataTable caption="Scenario steps" rows={run.data.steps} rowKey={(st) => st.n} columns={[
            { key: 'n', header: 'Step', cell: (st) => st.n },
            { key: 'a', header: 'Actor', cell: (st) => <Badge tone={st.actor === 'attacker' ? 'block' : st.actor === 'trusted_device' ? 'info' : 'neutral'}>{ACTOR[st.actor]}</Badge> },
            { key: 'x', header: 'Action', cell: (st) => <div><div>{st.action}</div><div className="text-[0.75rem] text-[var(--ink-3)] font-mono">{st.http.method} {st.http.path}</div></div> },
            { key: 'h', header: 'HTTP', align: 'right', cell: (st) => <span className={st.http.status >= 400 ? 'text-[var(--block)] font-medium' : ''}>{st.http.status}</span> },
            { key: 'd', header: 'Decision', cell: (st) => <DecisionPill decision={st.decision} /> },
            { key: 'r', header: 'Risk', align: 'right', cell: (st) => st.risk_score?.toFixed(1) ?? '—' },
            { key: 'o', header: 'Note', cell: (st) => <span className="text-[var(--ink-2)]">{st.note}</span> },
          ]} />
          <p className="text-[0.75rem] text-[var(--ink-3)] mt-2">Run by {run.data.username} · {fmtTime(new Date().toISOString())}</p>
        </div>
      )}
    </Card>
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
            <div className="grid gap-4 xl:grid-cols-2">{q.data.map((s) => <ScenarioCard key={s.id} s={s} />)}</div>}
    </>
  );
}
