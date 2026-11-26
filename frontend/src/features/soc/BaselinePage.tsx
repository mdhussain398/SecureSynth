import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CandidateItem } from '../../api/types';
import { useBaseline, useRollback, useUsers } from '../../api/queries';
import { Badge, Banner, Button, Card, DataTable, EmptyState, ErrorState, Money, Skeleton, Stat, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

const CAND_TONE: Record<CandidateItem['status'], 'neutral' | 'allow' | 'stepup' | 'block' | 'info'> = { pending: 'neutral', promoted: 'allow', rejected: 'block', travel_window: 'info' };
const CAND_LABEL: Record<CandidateItem['status'], string> = { pending: 'Pending', promoted: 'Promoted', rejected: 'Rejected', travel_window: 'Travel window' };

function HourProfile({ profile }: { profile: number[] }) {
  const data = profile.map((p, h) => ({ h: String(h).padStart(2, '0'), pct: p * 100 }));
  const peak = data.reduce((a, b) => (b.pct > a.pct ? b : a), data[0]);
  return (
    <div className="h-[180px]" role="img" aria-label={`Hour-of-day activity profile, 24 bars. Peak at ${peak?.h}:00 with ${peak?.pct.toFixed(1)}% of activity.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="h" tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} interval={2} />
          <YAxis tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => active && payload?.length ? (
            <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-s)] px-2.5 py-1.5 text-[0.8125rem] tnum">{(payload[0].payload as { h: string }).h}:00 · {(payload[0].value as number).toFixed(1)}%</div>) : null} />
          <Bar dataKey="pct" fill="var(--series-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[var(--ink-3)]">{empty}</p>;
  return <ul className="space-y-1">{items.map((i) => <li key={i} className="font-mono text-[0.8125rem]">{i}</li>)}</ul>;
}

export function BaselinePage() {
  const { id = '1' } = useParams();
  const nav = useNavigate();
  const users = useUsers();
  const q = useBaseline(id);
  const rollback = useRollback(id);
  const [confirm, setConfirm] = useState<number | null>(null);

  const user = users.data?.find((u) => String(u.id) === id);
  return (
    <>
      <PageTitle title="Behavioural baseline" sub={user ? `${user.display_name} · ${user.persona} · home ${user.home_city}` : 'Trusted baseline is used for scoring; candidate items wait for independent verification.'}
        actions={users.data && users.data.length > 0 && (
          <label className="flex items-center gap-2 text-[var(--ink-2)]">Customer
            <select className="input !w-auto" value={id} onChange={(e) => nav(`/soc/users/${e.target.value}/baseline`)}>
              {users.data.filter((u) => u.role === 'customer').map((u) => <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>)}
            </select>
          </label>
        )} />
      {q.isPending ? <Skeleton lines={8} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          {rollback.error && <Banner tone="block" title="Rollback failed">{rollback.error.message}</Banner>}
          {rollback.isSuccess && <Banner tone="allow" title={`Baseline now at version ${rollback.data.version}`}>The rollback is recorded in version history and the audit log.</Banner>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Trusted · version ${q.data.version}`} description="Used for scoring. Changes only through verified promotion.">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div><dt className="text-[0.8125rem] text-[var(--ink-3)] mb-1">Devices</dt><dd><List items={q.data.trusted.devices} empty="None" /></dd></div>
                <div><dt className="text-[0.8125rem] text-[var(--ink-3)] mb-1">Cities</dt><dd><List items={q.data.trusted.cities} empty="None" /></dd></div>
                <div><dt className="text-[0.8125rem] text-[var(--ink-3)] mb-1">Travel windows</dt><dd><List items={q.data.trusted.travel_windows.map((t) => `${t.city} until ${fmtTime(t.until, true)}`)} empty="None active" /></dd></div>
                <div><dt className="text-[0.8125rem] text-[var(--ink-3)] mb-1">Payees</dt><dd><List items={q.data.trusted.beneficiaries} empty="None" /></dd></div>
                <Stat label="Median transfer" value={<Money paise={q.data.trusted.amount_median_paise} whole />} />
                <Stat label="Spread (MAD)" value={<Money paise={q.data.trusted.amount_mad_paise} whole />} />
              </dl>
              <h3 className="text-[0.8125rem] text-[var(--ink-3)] mt-5 mb-1 font-normal">Share of activity by hour of day</h3>
              <HourProfile profile={q.data.trusted.hour_profile} />
            </Card>
            <Card padded={false} title="Candidate" description={`Observed but not yet trusted · ${q.data.rejected_count} candidate changes rejected`}>
              {q.data.candidate.length === 0 ? <EmptyState title="No candidate changes">New devices, cities or payees seen in clean sessions will appear here.</EmptyState> : (
                <DataTable caption="Candidate items" rows={q.data.candidate} rowKey={(c) => `${c.kind}-${c.value}`} columns={[
                  { key: 'k', header: 'Item', cell: (c) => <div><div className="font-medium">{c.value}</div><div className="text-[0.75rem] text-[var(--ink-3)]">{c.kind} · first seen {fmtTime(c.first_seen, true)}</div></div> },
                  { key: 'v', header: 'Verified', cell: (c) => c.verified_by ? <span className="font-mono text-[0.75rem]">{c.verified_by}</span> : <span className="text-[var(--ink-3)]">No</span> },
                  { key: 'n', header: 'Clean', align: 'right', cell: (c) => c.clean_sessions },
                  { key: 's', header: 'Status', cell: (c) => <div><Badge tone={CAND_TONE[c.status]}>{CAND_LABEL[c.status]}</Badge><div className="text-[0.75rem] text-[var(--ink-3)] mt-0.5 max-w-[26ch]">{c.reason}</div></div> },
                ]} />
              )}
            </Card>
          </div>
          <Card padded={false} title="Version history" description="Every promotion and rollback is versioned">
            {q.data.versions.length === 0 ? <EmptyState title="No versions yet" /> : (
              <DataTable caption="Baseline versions" rows={q.data.versions} rowKey={(v) => v.version} columns={[
                { key: 'v', header: 'Version', cell: (v) => <span className="font-medium">v{v.version}{v.version === q.data.version && <span className="ml-2"><Badge tone="info">current</Badge></span>}</span> },
                { key: 't', header: 'When', cell: (v) => fmtTime(v.ts, true) },
                { key: 'r', header: 'Reason', cell: (v) => v.reason },
                { key: 'd', header: 'Change', cell: (v) => <span className="font-mono text-[0.75rem] text-[var(--ink-2)]">{JSON.stringify(v.diff)}</span> },
                { key: 'a', header: '', align: 'right', cell: (v) => v.rolled_back ? <Badge>rolled back</Badge> : v.version < q.data.version ? (
                  confirm === v.version ? <span className="inline-flex gap-1"><Button size="sm" variant="danger" loading={rollback.isPending} onClick={() => rollback.mutate(v.version, { onSettled: () => setConfirm(null) })}>Confirm</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></span>
                    : <Button size="sm" variant="secondary" onClick={() => setConfirm(v.version)}>Roll back to v{v.version}</Button>) : null },
              ]} />
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/** /soc/users → first customer's baseline (user ids are backend-assigned). */
export function BaselineIndex() {
  const users = useUsers();
  if (users.isPending) return <Skeleton lines={4} />;
  if (users.error) return <ErrorState error={users.error} onRetry={() => users.refetch()} />;
  const first = users.data.find((u) => u.role === 'customer');
  if (!first) return <EmptyState title="No customers yet" />;
  return <Navigate to={`/soc/users/${first.id}/baseline`} replace />;
}
