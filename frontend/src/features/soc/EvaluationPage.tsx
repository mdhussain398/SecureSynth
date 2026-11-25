import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ApproachResult, DetectionMetrics } from '../../api/types';
import { useEvaluation } from '../../api/queries';
import { Badge, Card, DataTable, ErrorState, Money, Skeleton, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

// Categorical slots 1–3 of the validated dataviz palette (all-pairs safe for three series).
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

type Basis = 'intervention' | 'block_only';

function MetricBars({ approaches, basis }: { approaches: ApproachResult[]; basis: Basis }) {
  const metrics: Array<{ key: keyof DetectionMetrics; label: string }> = [
    { key: 'precision', label: 'Precision' }, { key: 'recall', label: 'Recall' }, { key: 'fpr', label: 'False positive rate' },
  ];
  const data = metrics.map((m) => {
    const row: Record<string, string | number> = { metric: m.label };
    approaches.forEach((a) => { row[a.name] = (a[basis][m.key] as number) * 100; });
    return row;
  });
  return (
    <>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-[0.8125rem] text-[var(--ink-2)]" aria-label="Legend">
        {approaches.map((a, i) => <li key={a.name} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: SERIES[i] }} aria-hidden />{a.label}</li>)}
      </ul>
      <div className="h-[260px]" role="img" aria-label={`Grouped bars of precision, recall and false positive rate for ${approaches.map((a) => a.label).join(', ')}. Exact values are in the table below.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="metric" tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload, label }) => active && payload?.length ? (
              <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-s)] px-3 py-2 text-[0.8125rem] tnum">
                <div className="text-[var(--ink-3)] mb-1">{label}</div>
                {payload.map((p) => {
                  const a = approaches.find((x) => x.name === p.dataKey);
                  return <div key={String(p.dataKey)} className="flex items-center gap-2"><span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} aria-hidden />{a?.label}<span className="ml-auto pl-3 font-semibold">{(p.value as number).toFixed(1)}%</span></div>;
                })}
              </div>) : null} />
            {approaches.map((a, i) => <Bar key={a.name} dataKey={a.name} name={a.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function EvaluationPage() {
  const q = useEvaluation();
  const [basis, setBasis] = useState<Basis>('intervention');
  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-72" /><Skeleton className="h-40" /></div>;
  if (q.error) return <ErrorState error={q.error} title={q.error.status === 404 ? 'No evaluation report yet' : undefined} onRetry={() => q.refetch()} />;
  const r = q.data;
  const families = Object.keys(r.approaches[0]?.per_family_recall ?? {}).sort();

  return (
    <>
      <PageTitle title="Evaluation" sub={`Three approaches on the identical held-out test window · ${r.dataset.sessions_test.toLocaleString('en-IN')} sessions, ${r.dataset.attacks_test} attacks · ${r.dataset.customers} synthetic customers · seed ${r.dataset.seed}`}
        actions={<span className="text-[0.8125rem] text-[var(--ink-3)]">Model {r.model_version} · generated {fmtTime(r.generated_at, true)}</span>} />
      <div className="space-y-4">
        <Card title="Detection" description={basis === 'intervention' ? 'Positive = STEP-UP or BLOCK' : 'Positive = BLOCK only'}
          actions={<div role="group" aria-label="Positive class" className="flex gap-1">
            {(['intervention', 'block_only'] as Basis[]).map((b) => (
              <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}
                className={`px-2 py-1 rounded-[var(--radius-s)] text-[0.8125rem] border cursor-pointer ${basis === b ? 'bg-[var(--accent-tint)] border-[var(--accent)]' : 'border-[var(--hairline)] text-[var(--ink-2)]'}`}>{b === 'intervention' ? 'Any intervention' : 'Block only'}</button>
            ))}
          </div>}>
          <MetricBars approaches={r.approaches} basis={basis} />
          <div className="mt-4 border-t border-[var(--hairline)]">
            <DataTable caption="Detection metrics" rows={r.approaches} rowKey={(a) => a.name} columns={[
              { key: 'n', header: 'Approach', cell: (a) => <span className="font-medium">{a.label}</span> },
              { key: 'p', header: 'Precision', align: 'right', cell: (a) => pct(a[basis].precision) },
              { key: 'r', header: 'Recall', align: 'right', cell: (a) => pct(a[basis].recall) },
              { key: 'f1', header: 'F1', align: 'right', cell: (a) => a[basis].f1.toFixed(3) },
              { key: 'fpr', header: 'FPR', align: 'right', cell: (a) => pct(a[basis].fpr) },
              { key: 'cm', header: 'TP / FP / TN / FN', align: 'right', cell: (a) => <span className="text-[var(--ink-2)]">{a[basis].tp} / {a[basis].fp} / {a[basis].tn} / {a[basis].fn}</span> },
              { key: 'tr', header: 'Traveller restriction', align: 'right', cell: (a) => pct(a.traveller_restriction_rate) },
              { key: 'lat', header: 'Latency p50 / p95', align: 'right', cell: (a) => `${a.latency_ms.p50.toFixed(1)} / ${a.latency_ms.p95.toFixed(1)} ms` },
            ]} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card padded={false} title="Prevention (simulated value)" description="Reported separately from detection. Assumes the attacker fails trusted-device verification and the customer passes it.">
            <DataTable caption="Prevention metrics" rows={r.approaches} rowKey={(a) => a.name} columns={[
              { key: 'n', header: 'Approach', cell: (a) => <span className="font-medium">{a.label}</span> },
              { key: 'at', header: 'Attack value attempted', align: 'right', cell: (a) => <Money paise={a.prevention.attack_value_attempted_paise} whole /> },
              { key: 'pr', header: 'Prevented', align: 'right', cell: (a) => <Money paise={a.prevention.attack_value_prevented_paise} whole className="font-medium" /> },
              { key: 'co', header: 'Completed by attacker', align: 'right', cell: (a) => <Money paise={a.prevention.attack_value_completed_paise} whole /> },
              { key: 'lg', header: 'Legitimate value delayed', align: 'right', cell: (a) => <Money paise={a.prevention.legit_value_delayed_paise} whole /> },
            ]} />
          </Card>
          <Card padded={false} title="Recall by attack family" description={`Family ${r.dataset.held_out_family} was held out from all tuning`}>
            <DataTable caption="Per-family recall" rows={families} rowKey={(f) => f} columns={[
              { key: 'f', header: 'Family', cell: (f) => <span className="font-medium">{f}{f === r.dataset.held_out_family && <span className="ml-2"><Badge tone="info">held out</Badge></span>}</span> },
              ...r.approaches.map((a) => ({ key: a.name, header: a.label, align: 'right' as const, cell: (f: string) => pct(a.per_family_recall[f] ?? 0) })),
            ]} />
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Assumptions"><ul className="list-disc pl-5 space-y-1.5 text-[var(--ink-2)]">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Card>
          <Card title="Limitations"><ul className="list-disc pl-5 space-y-1.5 text-[var(--ink-2)]">{r.limitations.map((a) => <li key={a}>{a}</li>)}</ul></Card>
        </div>
      </div>
    </>
  );
}
