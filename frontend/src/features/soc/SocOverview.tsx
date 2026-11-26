import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AdminSessionRow, Decision } from '../../api/types';
import { useSessions } from '../../api/queries';
import { Badge, Card, DataTable, DecisionPill, EmptyState, ErrorState, RiskGauge, Skeleton, fmtTime, type Column } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

const DECISIONS: Decision[] = ['ALLOW', 'STEP_UP', 'BLOCK'];
const SEG: Record<Decision, string> = { ALLOW: 'var(--allow)', STEP_UP: 'var(--stepup)', BLOCK: 'var(--block)' };

function DecisionMix({ rows }: { rows: AdminSessionRow[] }) {
  const counts = DECISIONS.map((d) => ({ d, n: rows.filter((r) => r.latest_decision === d).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] rounded-full overflow-hidden bg-[var(--surface-2)]" role="img"
        aria-label={`Decision mix: ${counts.map((c) => `${c.n} ${c.d}`).join(', ')}`}>
        {total > 0 && counts.filter((c) => c.n > 0).map((c) => <span key={c.d} style={{ width: `${(c.n / total) * 100}%`, background: SEG[c.d] }} title={`${c.d}: ${c.n}`} />)}
      </div>
      <dl className="grid grid-cols-3 gap-3 mt-3">
        {counts.map((c) => (
          <div key={c.d}>
            <dt><DecisionPill decision={c.d} /></dt>
            <dd className="tnum text-[1.375rem] font-semibold mt-1 leading-none">{c.n}<span className="text-[0.8125rem] font-normal text-[var(--ink-3)]"> · {total ? Math.round((c.n / total) * 100) : 0}%</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SocOverview() {
  const [filter, setFilter] = useState<Decision | ''>('');
  const q = useSessions();
  const nav = useNavigate();
  const rows = useMemo(() => (q.data ?? []).filter((r) => !filter || r.latest_decision === filter), [q.data, filter]);

  const cols: Column<AdminSessionRow>[] = [
    { key: 'user', header: 'Customer', cell: (r) => <div><Link to={`/soc/sessions/${encodeURIComponent(r.id)}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--ink)] hover:underline">{r.display_name}</Link><div className="text-[0.75rem] text-[var(--ink-3)]">{r.username}{r.is_lab && ' · lab'}</div></div> },
    { key: 'ctx', header: 'Context', cell: (r) => <div><div>{r.city}</div><div className="text-[0.75rem] text-[var(--ink-3)]">{r.device_recognised ? 'Device recognised' : 'Device not recognised'}</div></div> },
    { key: 'score', header: 'Risk index', align: 'right', cell: (r) => <div className="flex items-center justify-end gap-2"><span className="font-medium">{r.latest_score?.toFixed(1) ?? '—'}</span><RiskGauge size="sm" value={r.latest_score} /></div> },
    { key: 'dec', header: 'Decision', cell: (r) => <DecisionPill decision={r.latest_decision} /> },
    { key: 'mode', header: 'Session mode', cell: (r) => <Badge tone={r.mode === 'restricted' || r.mode === 'revoked' ? 'block' : r.mode === 'step_up' ? 'stepup' : 'neutral'}>{r.mode.replace('_', '-')}</Badge> },
    { key: 'n', header: 'Checks', align: 'right', cell: (r) => r.assessments_count },
    { key: 'seen', header: 'Last seen', align: 'right', className: 'whitespace-nowrap', cell: (r) => <span className="text-[var(--ink-2)]">{fmtTime(r.last_seen)}</span> },
  ];

  return (
    <>
      <PageTitle title="Live sessions" sub="Every authenticated session with its latest risk checkpoint. Refreshes every 3 seconds."
        actions={<span className="inline-flex items-center gap-2 text-[0.8125rem] text-[var(--ink-3)]"><span className={`h-2 w-2 rounded-full ${q.isError ? 'bg-[var(--block)]' : 'bg-[var(--allow)]'}`} aria-hidden />{q.isError ? 'Feed interrupted' : 'Live'}</span>} />
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card title="Decision mix" description="Latest decision per session" className="self-start xl:sticky xl:top-[76px]">
          {q.isPending ? <Skeleton lines={3} /> : q.data ? <DecisionMix rows={q.data} /> : <ErrorState error={q.error} />}
        </Card>
        <Card padded={false} title="Sessions" actions={
          <div role="group" aria-label="Filter by decision" className="flex gap-1">
            {(['', ...DECISIONS] as const).map((d) => (
              <button key={d || 'all'} type="button" aria-pressed={filter === d} onClick={() => setFilter(d)}
                className={`px-2 py-1 rounded-[var(--radius-s)] text-[0.8125rem] cursor-pointer border ${filter === d ? 'bg-[var(--accent-tint)] border-[var(--accent)] text-[var(--ink)]' : 'border-[var(--hairline)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]'}`}>
                {d === '' ? 'All' : d === 'STEP_UP' ? 'Step-up' : d[0] + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        }>
          {q.isPending ? <div className="p-4"><Skeleton lines={6} /></div> : q.error && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
            rows.length === 0 ? <EmptyState title={filter ? 'No sessions with this decision' : 'No active sessions'}>{filter ? 'Clear the filter to see all sessions.' : 'Sign in as a customer or run a Lab scenario to create one.'}</EmptyState> :
              <DataTable caption="Live sessions" minWidth={760} columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/soc/sessions/${encodeURIComponent(r.id)}`)} />}
        </Card>
      </div>
    </>
  );
}
