/* Investigation workspace for one incident (Ghost Banking or restricted). Every control calls a real endpoint. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Camera, CheckCircle2, ClipboardCopy, Download, FileText, Ghost, ListChecks, ShieldCheck } from 'lucide-react';
import { useIncident } from '../../api/queries';
import { download, protectedObjectUrl, useAct, useCustody, useEvidence, useReport, useReports, useSummary, useTimeline, type EvidenceItem, type Report, type Summary, type VerifyResult } from '../../api/investigation';
import { Badge, Banner, Button, ButtonLink, Card, DataTable, ErrorState, RiskGauge, Skeleton, Timeline, fmtTime, formatPaise } from '../../design/components';
import { PageTitle } from '../../layout/layouts';
import { STATUS, SeverityBadge } from '../soc/IncidentsPage';
import { ConfirmDialog } from './ConfirmDialog';

const TABS = ['overview', 'evidence', 'timeline', 'summary', 'report'] as const;
type Tab = (typeof TABS)[number];
const CHECK_LABEL: Record<string, string> = {
  reviewed_incident: 'I have reviewed the incident information.', evidence_accurate: 'The attached evidence is accurate.',
  synthetic_identified: 'Synthetic (Ghost Banking / Lab) information is clearly identified.', amounts_classified: 'Attempted, prevented and actual loss amounts are correctly classified.',
  no_unverified_accusations: 'The report contains no unverified accusation against any person.', destination_correct: 'The reporting destination is correct.',
  authorised: 'I am authorised to proceed on behalf of the institution.',
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="ml-1.5 inline-flex align-middle text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer" aria-label="Copy"
    onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}>
    {done ? <CheckCircle2 size={13} /> : <ClipboardCopy size={13} />}</button>;
}

function ClassBadge({ c }: { c: string }) {
  return <Badge tone={c === 'synthetic' ? 'stepup' : c === 'derived' ? 'neutral' : 'info'}>{c}</Badge>;
}

export function InvestigationPage() {
  const { id = '' } = useParams();
  const iid = Number(id);
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.includes(sp.get('tab') as Tab) ? sp.get('tab') : 'overview') as Tab;
  const inc = useIncident(iid);
  const reduce = useReducedMotion();
  if (inc.isPending) return <Skeleton lines={8} />;
  if (inc.error) return <ErrorState error={inc.error} title={inc.error.status === 404 ? 'Incident not found' : undefined} />;
  const d = inc.data;
  const i = d.incident;
  return (
    <>
      <PageTitle title={<span className="flex flex-wrap items-center gap-3">Investigation <span className="font-mono text-[0.6em] text-[var(--ink-3)]">{i.ref}</span></span>}
        sub={<>{i.display_name} · customer reference C{String(i.user_id).padStart(4, '0')} · opened {fmtTime(i.created_at, true)} · {elapsed(i.created_at)} ago{i.is_lab && ' · Scenario Lab'}</>}
        actions={<div className="flex flex-wrap gap-2"><ButtonLink variant="secondary" to={`/soc/incidents/${i.id}`}><ListChecks size={18} strokeWidth={1.75} aria-hidden />Decisions</ButtonLink>{i.ghost && <ButtonLink variant="secondary" to={`/soc/ghost/${encodeURIComponent(i.session_id)}`}><Ghost size={18} strokeWidth={1.75} aria-hidden />Ghost monitor</ButtonLink>}</div>} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {i.ghost && <Badge tone="info"><Ghost size={12} aria-hidden />Ghost Banking</Badge>}<SeverityBadge s={i.severity} /><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
        <span className="text-[0.8125rem] text-[var(--ink-3)] ml-2">Assigned analyst: {i.resolved_by ?? 'unassigned (shared queue)'}</span>
      </div>
      <nav role="tablist" aria-label="Investigation sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--hairline)]">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setSp({ tab: t }, { replace: true })}
            className={`relative min-h-11 px-3.5 text-[0.9375rem] capitalize cursor-pointer transition-colors ${tab === t ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)] hover:text-[var(--ink)]'}`}>
            {t}{tab === t && <motion.span layoutId="inv-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--electric)]" transition={reduce ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }} />}
          </button>
        ))}
      </nav>
      <div className="investigation-panel">
        {tab === 'overview' && <Overview iid={iid} />}
        {tab === 'evidence' && <EvidenceTab iid={iid} sessionAlive={d.sessions.some((s) => s.mode !== 'revoked')} />}
        {tab === 'timeline' && <TimelineTab iid={iid} />}
        {tab === 'summary' && <SummaryTab iid={iid} />}
        {tab === 'report' && <ReportTab iid={iid} lab={i.is_lab} refId={i.ref ?? ''} />}
      </div>
    </>
  );
}

function elapsed(ts: string) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 86400)} days`;
}

function Overview({ iid }: { iid: number }) {
  const q = useIncident(iid);
  const ev = useEvidence(iid);
  if (!q.data) return <Skeleton lines={6} />;
  const { incident: i, trigger_assessment: a, transactions, attempts, balance_paise } = q.data;
  const blocked = transactions.filter((t) => t.in_incident && t.status === 'restricted');
  const ghostItem = ev.data?.items.filter((x) => x.kind === 'ghost_activity').at(-1);
  const g = ghostItem?.content as { totals?: { simulated_transfers: number; simulated_value_paise: number; payees_added: number } } | undefined;
  const attemptsCount = new Set(attempts.map((x) => x.assessment_id)).size;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Incident overview">
        <dl className="grid grid-cols-2 gap-4">
          <F l="Risk index (not a probability)"><span className="inline-flex items-center gap-2"><span className="tnum">{i.risk_score?.toFixed(1)}</span><RiskGauge size="sm" value={i.risk_score} thresholds={a?.thresholds} /></span></F>
          <F l="ML anomaly index">{a ? a.ml.index.toFixed(1) : '—'}</F>
          <F l="Containment reason">{i.reason}</F>
          <F l={q.data.sessions.length > 1 ? 'Sessions' : 'Session'}>{q.data.sessions.map((s) => (
            <span key={s.id} className="flex items-center gap-2"><Link className="font-mono text-[0.875rem] underline underline-offset-2" to={`/soc/sessions/${encodeURIComponent(s.id)}`}>{s.id.slice(0, 8)}…</Link>
              <Badge tone={s.mode === 'restricted' || s.mode === 'revoked' ? 'block' : s.mode === 'normal' ? 'allow' : 'stepup'}>{s.mode.replace('_', '-')}</Badge></span>))}</F>
          <F l="Investigation status">{STATUS[i.status].label}{i.verification ? ` · device check ${i.verification}` : ''}</F>
          <F l="Created">{fmtTime(i.created_at, true)}</F>
        </dl>
      </Card>
      <Card title="Financial investigation" description="Real protected activity, prevented exposure and synthetic activity are kept apart.">
        <dl className="grid grid-cols-2 gap-4">
          <F l="Triggering amount">{i.amount_paise != null ? formatPaise(i.amount_paise) : 'None (sign-in)'}</F>
          <F l="Blocked protected attempts">{blocked.length} · {formatPaise(blocked.reduce((s, t) => s + t.amount_paise, 0))}</F>
          <F l="Attempted transfers (assessed)">{attemptsCount}</F>
          <F l="Prevented exposure">{formatPaise(blocked.reduce((s, t) => s + t.amount_paise, 0))}</F>
          <F l="Confirmed financial loss">{formatPaise(0)} <span className="text-[0.75rem] text-[var(--ink-3)] block">no protected funds left by this session</span></F>
          <F l="Protected balance now">{balance_paise != null ? formatPaise(balance_paise) : '—'}</F>
          <F l="Synthetic transfers (Ghost)">{g?.totals ? `${g.totals.simulated_transfers} · ${formatPaise(g.totals.simulated_value_paise)}` : i.ghost ? <Link className="text-[var(--accent)] font-medium" to={`/soc/ghost/${encodeURIComponent(i.session_id)}`}>Open Ghost monitor</Link> : 'Not applicable'}</F>
          <F l="Payees added (synthetic)">{g?.totals ? g.totals.payees_added : i.ghost ? '—' : 'Not applicable'}</F>
        </dl>
      </Card>
    </div>
  );
}

function F({ l, children }: { l: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[0.75rem] text-[var(--ink-3)]">{l}</dt><dd className="mt-0.5 font-medium break-words">{children}</dd></div>;
}

function PhotoPreview({ item }: { item: EvidenceItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { if (!show) return; let u: string | null = null; protectedObjectUrl(`/admin/evidence/${item.id}/content`).then((x) => { u = x; setUrl(x); }).catch((e) => setErr(e.message)); return () => { if (u) URL.revokeObjectURL(u); }; }, [show, item.id]);
  return (
    <div className="space-y-2">
      {!show ? <Button size="sm" variant="secondary" onClick={() => setShow(true)}>Show photograph (access is logged)</Button> : err ? <Banner tone="block" title="Could not load">{err}</Banner> :
        url ? <img src={url} alt="Consented verification photograph (evidence)" className="max-h-64 rounded-[var(--radius-m)] border border-[var(--hairline)]" /> : <Skeleton className="h-40 w-56" />}
      <p className="text-[0.75rem] text-[var(--ink-3)]">Captured {String(item.meta.captured_at ?? '—')} · received {fmtTime(item.collected_at, true)} · consent {item.meta.consent ? 'given' : 'not recorded'} · {item.classification} · SHA-256 {item.sha256.slice(0, 16)}…</p>
      <Button size="sm" variant="ghost" onClick={() => download(`/admin/evidence/${item.id}/content?download=true`, `${item.id}`)}><Download size={14} aria-hidden />Download (logged)</Button>
      <p className="text-[0.75rem] text-[var(--ink-3)]">A verification photograph is not proof of identity and is never used for facial recognition.</p>
    </div>
  );
}

function EvidenceTab({ iid, sessionAlive }: { iid: number; sessionAlive: boolean }) {
  const q = useEvidence(iid);
  const [custody, setCustody] = useState(false);
  const cq = useCustody(iid, custody);
  const verify = useAct<{ incident_id: number }, VerifyResult>('POST', '/admin/evidence/verify', [['admin', 'inv']]);
  const note = useAct<{ text: string }, EvidenceItem>('POST', `/admin/incidents/${iid}/notes`, [['admin', 'inv']]);
  const photo = useAct<{ reason: string }, { id: string; status: string }>('POST', `/admin/incidents/${iid}/photo-request`, [['admin', 'inv']]);
  const [askPhoto, setAskPhoto] = useState(false);
  const [noteText, setNoteText] = useState('');
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorState error={q.error} />;
  const items = q.data.items.filter((x) => !x.deleted_at);
  const net = items.find((x) => x.kind === 'network_observation');
  const dev = items.find((x) => x.kind === 'device_observation');
  const photos = items.filter((x) => x.kind === 'verification_photo');
  const pending = q.data.photo_requests.find((p) => p.status === 'pending');
  const n = (net?.content ?? {}) as Record<string, string>;
  const dv = (dev?.content ?? {}) as Record<string, string | boolean | null>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Network evidence" actions={net && <ClassBadge c={net.classification} />}>
          {!net ? <p className="text-[var(--ink-3)]">No network observation was recorded for this incident.</p> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.875rem]">
              <dt className="text-[var(--ink-3)]">Observed IP</dt><dd className="font-mono">{n.ip ?? '—'}{n.ip && <Copy text={n.ip} />}</dd>
              <dt className="text-[var(--ink-3)]">Classification</dt><dd>{n.version ?? '—'} · {n.scope}</dd>
              <dt className="text-[var(--ink-3)]">Source</dt><dd>{n.source}</dd>
              <dt className="text-[var(--ink-3)]">First / last observed</dt><dd>{n.first_observed ? fmtTime(n.first_observed, true) : '—'} / {n.last_observed ? fmtTime(n.last_observed, true) : '—'}</dd>
              <dt className="text-[var(--ink-3)]">Provenance</dt><dd>{net.provenance}</dd>
              <dd className="col-span-2 text-[0.75rem] text-[var(--ink-3)] mt-1">{n.caveat}</dd>
            </dl>
          )}
        </Card>
        <Card title="Device evidence" actions={dev && <ClassBadge c={dev.classification} />}>
          {!dev ? <p className="text-[var(--ink-3)]">No device observation was recorded.</p> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.875rem]">
              <dt className="text-[var(--ink-3)]">Registered device</dt><dd className="font-mono">{String(dv.registered_device_id ?? '—')}{dv.registered_device_id && <Copy text={String(dv.registered_device_id)} />}</dd>
              <dt className="text-[var(--ink-3)]">Trust status</dt><dd>{String(dv.device_trust)} · {dv.recognised_at_sign_in ? 'recognised at sign-in' : 'not recognised at sign-in'}</dd>
              <dt className="text-[var(--ink-3)]">Browser</dt><dd>{String(dv.browser)} {String(dv.browser_version ?? '')}</dd>
              <dt className="text-[var(--ink-3)]">Operating system</dt><dd>{String(dv.os)} {String(dv.os_version ?? '')}</dd>
              <dt className="text-[var(--ink-3)]">MAC address</dt><dd><Badge tone="neutral">Unavailable</Badge> <span className="text-[0.8125rem] text-[var(--ink-3)]">{String(dv.mac_address_status)}</span></dd>
              <dd className="col-span-2 text-[0.75rem] text-[var(--ink-3)] mt-1">{String(dv.correlation_note)}</dd>
            </dl>
          )}
        </Card>
      </div>
      <Card title={<span className="flex items-center gap-2"><Camera size={16} aria-hidden />Verification photograph</span>}
        description="Optional, only with the session holder's explicit consent in their own browser."
        actions={<Button size="sm" variant="secondary" disabled={!sessionAlive || !!pending} onClick={() => { photo.reset(); setAskPhoto(true); }}>{pending ? 'Request pending…' : 'Request verification photo'}</Button>}>
        {photos.length ? photos.map((p) => <PhotoPreview key={p.id} item={p} />) : (
          <p className="text-[var(--ink-3)] text-[0.875rem]">{pending ? `Requested ${fmtTime(pending.created_at)} — waiting for the session holder (expires ${fmtTime(pending.expires_at)}).` :
            q.data.photo_requests.length ? `Last request: ${q.data.photo_requests[0].status}${q.data.photo_requests[0].consent === false ? ' (consent declined)' : ''}.` :
              !sessionAlive ? 'Unavailable: the session has ended, so there is no screen to ask on.' : 'No photograph requested.'}</p>
        )}
      </Card>
      <Card title="Evidence vault" description={`Manifest SHA-256 ${q.data.manifest.manifest_sha256.slice(0, 24)}… · ${items.length} item(s)`}
        actions={<><Button size="sm" onClick={() => verify.mutate({ incident_id: iid })} loading={verify.isPending}><ShieldCheck size={14} aria-hidden />Verify evidence integrity</Button>
          <Button size="sm" variant="secondary" onClick={() => setCustody((c) => !c)}>{custody ? 'Hide' : 'Show'} chain of custody</Button></>} padded={false}>
        {verify.data && <div className="p-4"><Banner tone={verify.data.status === 'verified' ? 'allow' : 'block'} title={verify.data.status === 'verified' ? 'Verified' : verify.data.status === 'missing' ? 'Missing evidence' : 'Integrity mismatch'}>
          Checked {fmtTime(verify.data.checked_at, true)} · chains {Object.entries(verify.data.chains).map(([k, v]) => `${k}: ${v}`).join(', ')}{verify.data.problems.length ? ' · ' + verify.data.problems.map((p) => p.detail).join('; ') : ''}</Banner></div>}
        {verify.error && <div className="p-4"><Banner tone="block" title="Verification unavailable">{verify.error.message}</Banner></div>}
        {!verify.data && !verify.isPending && <p className="px-5 pt-3 text-[0.8125rem] text-[var(--ink-3)]">Verification pending — run it before export or disclosure.</p>}
        <DataTable caption="Evidence items" minWidth={720} rowKey={(x) => x.id} rows={q.data.items} columns={[
          { key: 'id', header: 'Evidence', cell: (x) => <span className="font-mono text-[0.8125rem]">{x.id}</span> },
          { key: 'k', header: 'Kind', cell: (x) => x.kind.replace(/_/g, ' ') },
          { key: 'c', header: 'Class', cell: (x) => <ClassBadge c={x.classification} /> },
          { key: 's', header: 'Source', cell: (x) => <span className="text-[0.8125rem]">{x.source}</span> },
          { key: 'h', header: 'SHA-256', cell: (x) => <span className="font-mono text-[0.75rem]">{x.sha256.slice(0, 12)}…<Copy text={x.sha256} /></span> },
          { key: 't', header: 'Collected', align: 'right', cell: (x) => <span className="whitespace-nowrap">{x.deleted_at ? 'deleted' : fmtTime(x.collected_at, true)}</span> },
        ]} />
        {q.data.alerts.length > 0 && <div className="p-4"><Banner tone="block" title={`${q.data.alerts.length} integrity alert(s)`}>{q.data.alerts.slice(0, 3).map((a) => a.detail).join(' · ')}</Banner></div>}
      </Card>
      {custody && (
        <Card title="Chain of custody" description="Append-only, hash-chained events. Tamper-evident, not immutable.">
          {!cq.data ? <Skeleton lines={4} /> : <Timeline items={cq.data.events.map((e) => ({ id: `${e.chain}${e.seq}`, time: fmtTime(e.ts, true), title: <span>{e.event_type.replace(/_/g, ' ')} <span className="text-[var(--ink-3)] font-normal">· {e.chain} #{e.seq}</span></span>,
            marker: <span className="text-[0.75rem] text-[var(--ink-3)]">by {e.actor}</span>, body: <span className="font-mono text-[0.75rem]">{e.evidence_id ?? ''} entry {e.entry_hash.slice(0, 16)}… ← {e.prev_hash.slice(0, 10)}…</span> }))} />}
        </Card>
      )}
      <Card title="Investigation notes" description="Notes are evidence: hashed and chained. Avoid unnecessary personal data.">
        <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim().length >= 3) note.mutate({ text: noteText.trim() }, { onSuccess: () => setNoteText('') }); }} className="flex gap-2">
          <textarea className="input flex-1 min-h-[60px]" maxLength={4000} value={noteText} onChange={(e) => setNoteText(e.target.value)} aria-label="New note" />
          <Button type="submit" loading={note.isPending} disabled={noteText.trim().length < 3}>Add note</Button>
        </form>
        {note.error && <p className="mt-2 text-[var(--block)] text-[0.875rem]">{note.error.message}</p>}
        <ul className="mt-3 space-y-2">{items.filter((x) => x.kind === 'investigation_note').map((x) => (
          <li key={x.id} className="text-[0.875rem] border-l-2 border-[var(--hairline-strong)] pl-3"><span className="whitespace-pre-wrap">{String((x.content as { text: string }).text)}</span>
            <span className="block text-[0.75rem] text-[var(--ink-3)]">{x.collected_by} · {fmtTime(x.collected_at, true)} · {x.id}</span></li>))}</ul>
      </Card>
      {askPhoto && <ConfirmDialog title="Request a verification photograph" scope="Consent-based evidence" verb="Send request" pending={photo.isPending} error={photo.error}
        body="The session holder sees an optional request in their own browser. Nothing is captured without their explicit consent and a camera permission they grant. Declining is recorded."
        success={photo.data && <Banner tone="allow" title="Request sent">{photo.data.id} · {photo.data.status}</Banner>}
        onSubmit={(v) => photo.mutate({ reason: v.reason })} onClose={() => setAskPhoto(false)} />}
    </div>
  );
}

function TimelineTab({ iid }: { iid: number }) {
  const q = useTimeline(iid);
  const [src, setSrc] = useState('');
  const events = useMemo(() => [...(q.data?.events ?? [])].reverse().filter((e) => !src || e.source === src), [q.data, src]);
  const sources = [...new Set((q.data?.events ?? []).map((e) => e.source))];
  return (
    <Card title="Unified incident timeline" description="Merged from authentication, risk, audit, Ghost Banking, evidence and reporting records. Refreshes every 5 s."
      actions={<span className="inline-flex items-center gap-2 text-[0.8125rem] text-[var(--ink-3)]"><span className={`h-2 w-2 rounded-full ${q.isError ? 'bg-[var(--block)]' : 'bg-[var(--allow)]'}`} aria-hidden />{q.isError ? 'Disconnected — retrying' : 'Live'}
        <select className="input !w-auto !min-h-11 !py-1" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Filter by source"><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select></span>}>
      {q.isPending ? <Skeleton lines={6} /> : q.error && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : events.length === 0 ? <p className="text-[var(--ink-3)]">No events.</p> :
        <Timeline items={events.map((e, i) => ({ id: i, time: fmtTime(e.ts, true), title: <span>{e.title}{e.synthetic && <Badge tone="stepup" className="ml-2">synthetic</Badge>}</span>,
          marker: <span className="text-[0.75rem] text-[var(--ink-3)]">{e.source}{e.actor ? ` · ${e.actor}` : ''}</span>, body: e.detail || e.ref }))} />}
    </Card>
  );
}

function SummaryTab({ iid }: { iid: number }) {
  const q = useSummary(iid);
  const gen = useAct<{ use_llm: boolean }, Summary>('POST', `/admin/incidents/${iid}/summary`, [['admin', 'inv']]);
  const s = gen.data ?? q.data?.latest ?? null;
  const edit = useAct<{ sections: { key: string; text: string }[] }, Summary>('PUT', `/admin/summaries/${s?.id}`, [['admin', 'inv']]);
  const approve = useAct<Record<string, never>, Summary>('POST', `/admin/summaries/${s?.id}/approve`, [['admin', 'inv']]);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const cur = approve.data ?? edit.data ?? s;
  const err = gen.error ?? edit.error ?? approve.error;
  const plain = cur ? cur.sections.map((x) => `${x.title} (${x.kind})\n${x.text}`).join('\n\n') : '';
  return (
    <div className="space-y-4">
      <Card title="Investigation summary" description="Decision support only. The analyst decides; nothing here accuses a person or changes account state."
        actions={<><Button size="sm" onClick={() => gen.mutate({ use_llm: false })} loading={gen.isPending}>{cur ? 'Regenerate summary' : 'Generate investigation summary'}</Button>
          <Button size="sm" variant="secondary" disabled={!q.data?.llm.available} title={q.data?.llm.detail} onClick={() => gen.mutate({ use_llm: true })}>LLM rewrite</Button></>}>
        <p className="text-[0.8125rem] text-[var(--ink-3)]">{q.data?.llm.detail}</p>
        {q.data && q.data.missing_evidence.length > 0 && <p className="mt-1 text-[0.8125rem] text-[var(--ink-3)]">Missing evidence: {q.data.missing_evidence.join(', ')}</p>}
        {err && <div className="mt-3"><Banner tone="block" title="Not done">{err.message}</Banner></div>}
        {gen.data?.note && <div className="mt-3"><Banner tone="stepup" title="Note">{gen.data.note}</Banner></div>}
      </Card>
      {!cur ? <Card><p className="text-[var(--ink-3)]">No summary yet.</p></Card> : (
        <Card title={`Version ${cur.version}`} description={`${cur.generated_by} · ${fmtTime(cur.created_at, true)} · evidence version ${cur.evidence_version.slice(0, 12)}…`}
          actions={<>{cur.stale && <Badge tone="block">Stale — evidence changed</Badge>}<Badge tone={cur.status === 'approved' ? 'allow' : 'neutral'}>{cur.status === 'approved' ? `Approved by ${cur.approved_by}` : cur.edited ? 'Edited draft' : 'Draft'}</Badge>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(plain)}><ClipboardCopy size={14} aria-hidden />Copy</Button>
            {editing ? <Button size="sm" onClick={() => edit.mutate({ sections: Object.entries(editing).map(([key, text]) => ({ key, text })) }, { onSuccess: () => setEditing(null) })} loading={edit.isPending}>Save edits</Button>
              : <Button size="sm" variant="secondary" onClick={() => setEditing(Object.fromEntries(cur.sections.map((x) => [x.key, x.text])))}>Edit</Button>}
            <Button size="sm" disabled={cur.status === 'approved' || cur.stale || !!editing} loading={approve.isPending} onClick={() => approve.mutate({})}><CheckCircle2 size={14} aria-hidden />Approve</Button></>}>
          <div className="space-y-4">{cur.sections.map((x) => (
            <section key={x.key}>
              <h3 className="text-[0.9375rem] font-semibold flex items-center gap-2">{x.title}<Badge tone={x.kind === 'fact' ? 'info' : x.kind === 'interpretation' ? 'neutral' : 'stepup'}>{x.kind}</Badge></h3>
              {editing ? <textarea className="input mt-1 w-full min-h-[80px]" value={editing[x.key]} onChange={(e) => setEditing((m) => ({ ...m!, [x.key]: e.target.value }))} aria-label={x.title} />
                : <p className="mt-1 text-[0.9375rem] text-[var(--ink-2)] leading-relaxed">{x.text}</p>}
              {x.refs.length > 0 && <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Evidence: <span className="font-mono">{x.refs.join(', ')}</span></p>}
            </section>))}</div>
        </Card>
      )}
    </div>
  );
}

function ReportTab({ iid, lab, refId }: { iid: number; lab: boolean; refId: string }) {
  const [rid, setRid] = useState<string | null>(null);
  const [dest, setDest] = useState<'dummy' | 'official'>('dummy');
  const create = useAct<{ destination: string }, Report>('POST', `/admin/incidents/${iid}/reports`, [['admin']]);
  const rq = useReport(rid ?? create.data?.id ?? null);
  const r = rq.data ?? create.data;
  return (
    <div className="space-y-4">
      {!r ? (
        <Card title={<span className="flex items-center gap-2"><FileText size={16} aria-hidden />Prepare cybercrime report</span>} description="Generates an editable, pre-filled complaint from verified incident records. Nothing is filed automatically.">
          <fieldset className="space-y-2"><legend className="field-label">Reporting destination</legend>
            <label className="flex gap-2.5 cursor-pointer"><input type="radio" checked={dest === 'dummy'} onChange={() => setDest('dummy')} /><span><b>Dummy cybercrime reporting</b> (default) — local simulation, synthetic acknowledgement. <span className="text-[var(--block)] font-medium">No real complaint is filed.</span></span></label>
            <label className="flex gap-2.5 cursor-pointer"><input type="radio" checked={dest === 'official'} onChange={() => setDest('official')} disabled={lab} /><span><b>Official handoff</b> — National Cyber Crime Reporting Portal (cybercrime.gov.in), filed manually by the authorised complainant. {lab ? 'Not available for Scenario Lab incidents.' : 'Disabled unless configured.'}</span></label>
          </fieldset>
          {create.error && <div className="mt-3"><Banner tone="block" title="Not prepared">{create.error.message}</Banner></div>}
          <div className="mt-4"><Button onClick={() => create.mutate({ destination: dest }, { onSuccess: (x) => setRid(x.id) })} loading={create.isPending}>Prepare cybercrime report</Button></div>
          <ExistingReports refId={refId} onOpen={setRid} />
        </Card>
      ) : <ReportEditor r={r} onBack={() => { setRid(null); create.reset(); }} />}
    </div>
  );
}

function ExistingReports({ refId, onOpen }: { refId: string; onOpen: (id: string) => void }) {
  const q = useReports(`q=${encodeURIComponent(refId)}`);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <div className="mt-5"><p className="field-label">Existing reports for this incident</p>
      <ul className="mt-1 space-y-1">{rows.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2 text-[0.875rem]"><span className="font-mono">{x.id}</span><Badge tone="neutral">{x.status_label}</Badge>
          <span className="text-[var(--ink-3)]">{x.destination} · v{x.version}{x.ack_number ? ` · ${x.ack_number}` : ''}</span>
          <Button size="sm" variant="ghost" onClick={() => onOpen(x.id)}>Open</Button></li>))}</ul></div>
  );
}

export function ReportEditor({ r, onBack }: { r: Report; onBack?: () => void }) {
  const [f, setF] = useState(r.fields);
  useEffect(() => setF(r.fields), [r.version, r.fields]);
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<null | 'first' | 'final' | 'ack' | 'cancel'>(null);
  const [firstId, setFirstId] = useState<string | null>(null);
  const save = useAct<{ expected_version: number; fields: typeof f }, Report>('PUT', `/admin/reports/${r.id}`, [['admin', 'report', r.id], ['admin', 'reports']]);
  const review = useAct<Record<string, never>, Report>('POST', `/admin/reports/${r.id}/review`, [['admin', 'report', r.id], ['admin', 'reports']]);
  const first = useAct<Record<string, unknown>, { confirmation_id: string; report: Report }>('POST', `/admin/reports/${r.id}/confirm-first`, [['admin', 'report', r.id]]);
  const final = useAct<Record<string, unknown>, { status: string; ack_number?: string; warning?: string; note?: string; portal?: string; idempotent?: boolean }>('POST', `/admin/reports/${r.id}/confirm-final`, [['admin']]);
  const ack = useAct<Record<string, unknown>, Report>('POST', `/admin/reports/${r.id}/official-ack`, [['admin']]);
  const cancel = useAct<{ reason: string }, Report>('POST', `/admin/reports/${r.id}/cancel`, [['admin']]);
  const demo = useAct<Record<string, never>, { status: string; ack: string }>('POST', `/admin/reports/${r.id}/demo-status`, [['admin']]);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const editable = ['draft', 'awaiting_review', 'awaiting_final_confirmation'].includes(r.status);
  const dirty = JSON.stringify(f) !== JSON.stringify(r.fields);
  const validFirst = r.confirmations.find((c) => c.stage === 'first' && c.valid);
  const upd = (sec: keyof typeof f, key: string, val: string | boolean) => setF((x) => ({ ...x, [sec]: { ...(x[sec] as object), [key]: val } }));
  const dl = (fmt: string) => { setDlErr(null); download(`/admin/reports/${r.id}/export?format=${fmt}`, `${r.id}.${fmt}`).catch((e) => setDlErr(e.message)); };
  return (
    <div className="space-y-4">
      <Banner tone={r.destination === 'dummy' ? 'stepup' : 'block'} title={r.destination === 'dummy' ? 'DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED.' : 'Official destination — manual filing only'}>
        {r.destination === 'dummy' ? 'Acknowledgements from this destination are synthetic (DEMO-CCR-…) and are not official references.' : r.warning}
      </Banner>
      <Card title={<span className="flex items-center gap-2">Report {r.id} <Badge tone="neutral">v{r.version}</Badge><Badge tone={r.status.startsWith('submitted') ? 'allow' : r.status === 'failed' || r.status === 'cancelled' ? 'block' : 'info'}>{r.status_label}</Badge></span>}
        description={`Incident ${r.incident_ref} · destination ${r.destination === 'dummy' ? 'Dummy reporting' : 'Official handoff'} · manifest ${r.manifest_hash.slice(0, 16)}…${r.manifest_matches ? '' : ' (changed)'}`}
        actions={<>{onBack && <Button size="sm" variant="ghost" onClick={onBack}>Back</Button>}
          <Button size="sm" variant="secondary" onClick={() => setPreview((p) => !p)}>{preview ? 'Edit' : 'Preview complaint'}</Button>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(f.description)}><ClipboardCopy size={14} aria-hidden />Copy description</Button></>}>
        {!preview ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-semibold">Complaint details</h3>
              {Object.entries(f.complaint).map(([k, v]) => <Field key={k} label={k} value={String(v ?? '')} disabled={!editable || k === 'incident_ref'} onChange={(x) => upd('complaint', k, x)} />)}
              <h3 className="font-semibold pt-2">Complainant</h3>
              {Object.entries(f.complainant).map(([k, v]) => <Field key={k} label={k} value={String(v ?? '')} disabled={!editable} onChange={(x) => upd('complainant', k, x)} />)}
              <h3 className="font-semibold pt-2">Disclosure</h3>
              {(['include_customer_name', 'include_ip', 'include_photo'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-[0.875rem]"><input type="checkbox" disabled={!editable} checked={f.disclosure[k]} onChange={(e) => upd('disclosure', k, e.target.checked)} />{k.replace(/_/g, ' ')}</label>))}
            </div>
            <div className="space-y-3">
              <label className="block"><span className="field-label">Incident description (editable)</span>
                <textarea className="input mt-1 w-full min-h-[260px]" disabled={!editable} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} /></label>
              <h3 className="font-semibold">Financial details</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.875rem]">{Object.entries(f.financial).map(([k, v]) => <Row key={k} k={k} v={v} />)}</dl>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-[0.9375rem]">
            {(r.disclosed_fields ? [r.disclosed_fields] : [f]).map((d, i) => (
              <div key={i} className="space-y-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{Object.entries(d.complaint).map(([k, v]) => <Row key={k} k={k} v={v} />)}{Object.entries(d.complainant).map(([k, v]) => <Row key={k} k={`complainant ${k}`} v={v} />)}</dl>
                <p className="whitespace-pre-wrap text-[var(--ink-2)]">{d.description}</p>
                <h3 className="font-semibold">Financial</h3><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{Object.entries(d.financial).map(([k, v]) => <Row key={k} k={k} v={v} />)}</dl>
                <h3 className="font-semibold">Digital evidence</h3><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{Object.entries(d.digital_evidence).map(([k, v]) => <Row key={k} k={k} v={v} />)}</dl>
              </div>
            ))}
            <p className="text-[0.8125rem] text-[var(--ink-3)]">Attachments: {r.attachments.map((a) => `${a.id} (${a.kind}, ${a.classification})`).join(', ')}</p>
          </div>
        )}
        {r.missing_fields.length > 0 && <p className="mt-3 text-[0.8125rem] text-[var(--block)]">Required: {r.missing_fields.join(', ')}</p>}
        {(save.error || review.error) && <div className="mt-3"><Banner tone="block" title="Not done">{(save.error ?? review.error)!.message}</Banner></div>}
        <div className="mt-4 flex flex-wrap gap-2">
          {editable && <Button variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ expected_version: r.version, fields: f })}>Save draft</Button>}
          {r.status === 'draft' && <Button disabled={dirty} loading={review.isPending} onClick={() => review.mutate({})}>Submit for review</Button>}
          {r.status === 'awaiting_review' && <Button onClick={() => { first.reset(); setDialog('first'); }}>First confirmation</Button>}
          {r.status === 'awaiting_final_confirmation' && <Button onClick={() => { final.reset(); setDialog('final'); }} disabled={!validFirst && !firstId}>Final confirmation</Button>}
          {['ready_for_official_submission', 'official_submission_unverified'].includes(r.status) && <><a className="rn-btn rn-btn-primary !min-h-11" href="https://cybercrime.gov.in/" target="_blank" rel="noreferrer noopener">Open official portal</a>
            <Button variant="secondary" onClick={() => { ack.reset(); setDialog('ack'); }}>Record genuine acknowledgement</Button></>}
          {r.destination === 'dummy' && r.ack_number && <Button variant="secondary" loading={demo.isPending} onClick={() => demo.mutate({})}>Refresh demo status</Button>}
          {editable && <Button variant="ghost" onClick={() => { cancel.reset(); setDialog('cancel'); }}>Cancel report</Button>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Evidence package" description="Exports are recorded in the chain of custody and carry a SHA-256 manifest.">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => dl('pdf')}><Download size={14} aria-hidden />Incident report PDF</Button>
            <Button size="sm" variant="secondary" onClick={() => dl('json')}><Download size={14} aria-hidden />Structured JSON</Button>
            <Button size="sm" variant="secondary" onClick={() => dl('zip')}><Download size={14} aria-hidden />Evidence package ZIP</Button>
          </div>
          {dlErr && <p className="mt-2 text-[var(--block)] text-[0.875rem]">{dlErr}</p>}
        </Card>
        <Card title="Tracking">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.875rem]">
            <Row k="acknowledgement" v={r.ack_number ? `${r.ack_number}${r.destination === 'dummy' ? ' (synthetic, demo only)' : r.ack_evidence_id ? ' (document on file)' : ' (unverified)'}` : '—'} />
            {r.demo_complaint && <Row k="demo service status" v={r.demo_complaint.status} />}{demo.data && <Row k="latest demo status" v={demo.data.status} />}
            <Row k="approved" v={r.approved_at ? `${r.approved_by}, ${fmtTime(r.approved_at, true)}` : '—'} /><Row k="submitted" v={r.submitted_at ? fmtTime(r.submitted_at, true) : '—'} />
          </dl>
          <ul className="mt-3 space-y-1 text-[0.8125rem] text-[var(--ink-3)]">{[...r.history].reverse().map((h, i) => <li key={i}>{fmtTime(h.at, true)} · {h.event.replace(/_/g, ' ')} · {h.by}{h.detail ? ` — ${h.detail}` : ''}</li>)}</ul>
        </Card>
      </div>
      {dialog === 'first' && <ConfirmDialog title="First confirmation" scope="Stage 3 of 5" reason={false} checklist={r.checklist.map((k) => ({ key: k, label: CHECK_LABEL[k] ?? k }))}
        verb="Confirm" pending={first.isPending} error={first.error} body={`Binds to version ${r.version}, manifest ${r.manifest_hash.slice(0, 16)}… and destination “${r.destination}”. Expires in 10 minutes; any edit invalidates it.`}
        success={first.data && <Banner tone="allow" title="First confirmation recorded">Proceed to the final confirmation.</Banner>}
        onSubmit={(v) => first.mutate({ version: r.version, manifest_hash: r.manifest_hash, destination: r.destination, checklist: v.checklist }, { onSuccess: (x) => setFirstId(x.confirmation_id) })}
        onClose={() => setDialog(null)} />}
      {dialog === 'final' && <ConfirmDialog title={r.destination === 'dummy' ? 'Final confirmation — submit to the DEMO service' : 'Final confirmation — prepare official handoff'} scope="Stage 4 of 5"
        totp phrase={r.phrase} danger={r.destination === 'official'} verb={r.destination === 'dummy' ? 'Submit demo complaint' : 'Prepare for manual filing'} pending={final.isPending} error={final.error}
        warning={<Banner tone={r.destination === 'dummy' ? 'stepup' : 'block'} title={r.destination === 'dummy' ? 'DEMONSTRATION ONLY' : 'Nothing will be filed by SecureSynth'}>{r.warning}</Banner>}
        success={final.data && <Banner tone="allow" title={final.data.status === 'submitted_demo' ? `Demo acknowledgement ${final.data.ack_number}` : 'Ready for official submission'}>{final.data.warning ?? final.data.note}{final.data.idempotent ? ' (already submitted — same acknowledgement returned)' : ''}</Banner>}
        onSubmit={(v) => final.mutate({ confirmation_id: firstId ?? validFirst?.id, version: r.version, manifest_hash: r.manifest_hash, destination: r.destination, phrase: v.phrase, reason: v.reason, totp_code: v.totp_code })}
        onClose={() => setDialog(null)} />}
      {dialog === 'ack' && <AckDialog onClose={() => setDialog(null)} m={ack} />}
      {dialog === 'cancel' && <ConfirmDialog title="Cancel this report" verb="Cancel report" danger pending={cancel.isPending} error={cancel.error}
        success={cancel.data && <Banner tone="allow" title="Cancelled" />} onSubmit={(v) => cancel.mutate({ reason: v.reason })} onClose={() => setDialog(null)} />}
    </div>
  );
}

function AckDialog({ onClose, m }: { onClose: () => void; m: ReturnType<typeof useAct<Record<string, unknown>, Report>> }) {
  const [num, setNum] = useState('');
  const [doc, setDoc] = useState<{ b64: string; mime: string } | null>(null);
  return <ConfirmDialog title="Record the genuine acknowledgement" scope="Stage 5 — official" totp verb="Record" pending={m.isPending} error={m.error}
    body={<div className="space-y-3"><p>Only after the authorised complainant has filed on the portal. Without the acknowledgement document the report stays “Official Submission Unverified”.</p>
      <label className="block"><span className="field-label">Acknowledgement number</span><input className="input mt-1 w-full" value={num} onChange={(e) => setNum(e.target.value)} /></label>
      <label className="block"><span className="field-label">Acknowledgement document (PDF/PNG/JPEG)</span><input type="file" accept="application/pdf,image/png,image/jpeg" className="mt-1 block text-[0.875rem]"
        onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const rd = new FileReader(); rd.onload = () => setDoc({ b64: String(rd.result), mime: file.type }); rd.readAsDataURL(file); }} /></label></div>}
    success={m.data && <Banner tone="allow" title={m.data.status_label}>{m.data.ack_number}</Banner>}
    onSubmit={(v) => m.mutate({ ack_number: num.trim(), reason: v.reason, totp_code: v.totp_code, ...(doc ? { document_base64: doc.b64, document_mime: doc.mime } : {}) })} onClose={onClose} />;
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return <label className="block"><span className="field-label capitalize">{label.replace(/_/g, ' ')}</span><input className="input mt-1 w-full" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Row({ k, v }: { k: string; v: unknown }) {
  return <><dt className="text-[var(--ink-3)] capitalize">{k.replace(/_/g, ' ')}</dt><dd className="break-words">{Array.isArray(v) ? (v.length ? v.join('; ') : '—') : v == null || v === '' ? '—' : String(v)}</dd></>;
}

