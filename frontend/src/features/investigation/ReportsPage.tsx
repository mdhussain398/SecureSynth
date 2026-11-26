/* Cybercrime report tracking: every report, its destination, status and acknowledgement. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useReport, useReports, type ReportRow } from '../../api/investigation';
import { Badge, Banner, Card, DataTable, EmptyState, ErrorState, Skeleton, fmtTime, type Column } from '../../design/components';
import { PageTitle } from '../../layout/layouts';
import { ReportEditor } from './InvestigationPage';

const STATUSES = ['draft', 'awaiting_review', 'awaiting_final_confirmation', 'approved', 'ready_for_official_submission', 'official_submission_unverified', 'submitted_demo', 'submitted_official_confirmed', 'failed', 'cancelled'];

export function ReportsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [dest, setDest] = useState('');
  const [q, setQ] = useState('');
  const [since, setSince] = useState('');
  const params = new URLSearchParams({ ...(status && { status }), ...(dest && { destination: dest }), ...(q && { q }), ...(since && { since: new Date(since).toISOString() }) }).toString();
  const list = useReports(params);
  const one = useReport(id ?? null);
  const cols: Column<ReportRow>[] = [
    { key: 'id', header: 'Report', cell: (r) => <div><span className="font-mono">{r.id}</span><div className="text-[0.75rem] text-[var(--ink-3)]">{r.incident_ref}{r.is_lab && ' · lab'}</div></div> },
    { key: 'd', header: 'Destination', cell: (r) => <Badge tone={r.destination === 'dummy' ? 'stepup' : 'block'}>{r.destination === 'dummy' ? 'Demo' : 'Official handoff'}</Badge> },
    { key: 's', header: 'Status', cell: (r) => <Badge tone={r.status.startsWith('submitted') ? 'allow' : r.status === 'failed' || r.status === 'cancelled' ? 'block' : 'info'}>{r.status_label}</Badge> },
    { key: 'a', header: 'Acknowledgement', cell: (r) => r.ack_number ? <span className="font-mono text-[0.8125rem]">{r.ack_number}</span> : '—' },
    { key: 'r', header: 'Responsible', cell: (r) => r.responsible },
    { key: 'att', header: 'Evidence', align: 'right', cell: (r) => `${r.attachments}${r.manifest_matches ? '' : ' ⚠'}` },
    { key: 't', header: 'Created / approved / submitted', align: 'right', className: 'whitespace-nowrap', cell: (r) => <span className="text-[0.8125rem] text-[var(--ink-2)]">{fmtTime(r.created_at, true)}{r.approved_at && ` · ${fmtTime(r.approved_at)}`}{r.submitted_at && ` · ${fmtTime(r.submitted_at)}`}</span> },
  ];
  return (
    <>
      <PageTitle title="Cybercrime reports" sub="Prepared complaints and their status. Demo acknowledgements are synthetic; official complaints are filed manually on cybercrime.gov.in." />
      {id ? (one.isPending ? <Skeleton lines={8} /> : one.error ? <ErrorState error={one.error} /> : <ReportEditor r={one.data} onBack={() => nav('/soc/reports')} />) : (
        <>
          <Banner tone="stepup" title="DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED from the demo destination." />
          <div className="my-4 flex flex-wrap gap-2 text-[0.8125rem]" role="group" aria-label="Report filters">
            <input className="input !w-56 !min-h-11 !py-1" placeholder="Search report, incident or ack" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reports" />
            <select className="input !w-auto !min-h-11 !py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select>
            <select className="input !w-auto !min-h-11 !py-1" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination"><option value="">All destinations</option><option value="dummy">Demo</option><option value="official">Official handoff</option></select>
            <label className="inline-flex items-center gap-1.5">Since<input type="date" className="input !w-auto !min-h-11 !py-1" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          </div>
          <Card padded={false}>
            {list.isPending ? <div className="p-4"><Skeleton lines={5} /></div> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> :
              list.data.length === 0 ? <EmptyState title="No reports">Prepare one from an investigation’s Report tab.</EmptyState> :
                <DataTable caption="Cybercrime reports" minWidth={860} rows={list.data} rowKey={(r) => r.id} columns={cols} onRowClick={(r) => nav(`/soc/reports/${r.id}`)} />}
          </Card>
        </>
      )}
    </>
  );
}
