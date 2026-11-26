/* Fraud intelligence: an explainable correlation graph built by the backend from investigation records.
 * Hand-rolled SVG force layout (no extra dependency). Correlations are leads, never proof. */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type WheelEvent as RWE } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Expand, Eye, EyeOff, Maximize2, RotateCcw, Search } from 'lucide-react';
import { useGraph, type GraphEdge, type GraphNode } from '../../api/investigation';
import { Badge, Banner, Button, Card, ErrorState, Skeleton, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

const TYPES: { key: GraphNode['type']; label: string; color: string; r: number }[] = [
  { key: 'incident', label: 'Incident', color: 'var(--block)', r: 11 }, { key: 'customer', label: 'Customer', color: 'var(--series-1)', r: 9 },
  { key: 'session', label: 'Session', color: 'var(--ink-3)', r: 6 }, { key: 'ip', label: 'IP address', color: 'var(--series-aqua)', r: 8 },
  { key: 'device', label: 'Registered device', color: 'var(--stepup)', r: 8 }, { key: 'beneficiary', label: 'Payee reference', color: 'var(--electric-ink)', r: 8 },
  { key: 'transaction', label: 'Transfer attempt', color: 'var(--ink-2)', r: 6 },
];
const T = Object.fromEntries(TYPES.map((t) => [t.key, t]));
const STRENGTH_W = { weak: 1.2, moderate: 2.2, strong: 3.4 } as const;

type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };

function layout(nodes: GraphNode[], edges: GraphEdge[], prev: Map<string, P>, steps: number): Map<string, P> {
  const pos = new Map<string, P>();
  nodes.forEach((n, i) => {
    const old = prev.get(n.id);
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    pos.set(n.id, old ? { ...old } : { x: Math.cos(a) * 220 + (i % 7) * 3, y: Math.sin(a) * 220 + (i % 5) * 3, vx: 0, vy: 0 });
  });
  const list = [...pos.entries()];
  for (let s = 0; s < steps; s++) {
    const alpha = 1 - s / steps;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i][1], b = list[j][1];
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 25), f = (1800 / d2) * alpha;
      const d = Math.sqrt(d2); dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const e of edges) {
      const a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1);
      const want = e.kind === 'derived' ? 170 : 70, f = ((d - want) / d) * 0.06 * alpha;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const [, p] of list) {
      p.vx -= p.x * 0.004 * alpha; p.vy -= p.y * 0.004 * alpha;
      if (!p.fixed) { p.x += Math.max(-20, Math.min(20, p.vx)); p.y += Math.max(-20, Math.min(20, p.vy)); }
      p.vx *= 0.55; p.vy *= 0.55;
    }
  }
  return pos;
}

export function FraudIntel() {
  const [hours, setHours] = useState(720);
  const [lab, setLab] = useState(true);
  const [minStrength, setMinStrength] = useState('weak');
  const [severity, setSeverity] = useState('');
  const [reveal, setReveal] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const params = `hours=${hours}&include_lab=${lab}&min_strength=${minStrength}${severity ? `&severity=${severity}` : ''}${reveal ? '&reveal=true' : ''}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;
  const q = useGraph(params);
  const reduce = useReducedMotion();
  const posRef = useRef(new Map<string, P>());
  const [, force] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const nodes = useMemo(() => (q.data?.nodes ?? []).filter((n) => !hidden.has(n.type)), [q.data, hidden]);
  const ids = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(() => (q.data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)), [q.data, ids]);
  const sig = nodes.map((n) => n.id).join('|');
  useEffect(() => { posRef.current = layout(nodes, edges, posRef.current, reduce ? 200 : 260); force((x) => x + 1); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    const pts = [...posRef.current.values()];
    const el = svgRef.current;
    if (!pts.length || !el) return setView({ x: 0, y: 0, k: 1 });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 120, h = Math.max(...ys) - Math.min(...ys) + 120;
    const k = Math.min(el.clientWidth / w, el.clientHeight / h, 2.5);
    setView({ k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k });
  };
  useEffect(() => { const t = setTimeout(fit, 30); return () => clearTimeout(t); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = nodes.find((n) => n.id === sel) ?? null;
  const neighbours = useMemo(() => {
    const s = new Set<string>();
    if (sel) edges.forEach((e) => { if (e.source === sel) s.add(e.target); if (e.target === sel) s.add(e.source); });
    return s;
  }, [sel, edges]);
  const matches = query.trim() ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()) || n.id.toLowerCase().includes(query.toLowerCase())).map((n) => n.id)) : null;
  const relEdges = sel ? edges.filter((e) => e.source === sel || e.target === sel) : [];

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - r.width / 2 - view.x) / view.k, y: (cy - r.top - r.height / 2 - view.y) / view.k };
  };
  const onDown = (e: RPE, id?: string) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = id ? posRef.current.get(id) : undefined;
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: p ? p.x : view.x, oy: p ? p.y : view.y };
    if (id) { setSel(id); if (p) p.fixed = true; }
    e.stopPropagation();
  };
  const onMove = (e: RPE) => {
    const d = drag.current;
    if (!d) return;
    if (d.id) { const w = toWorld(e.clientX, e.clientY); const p = posRef.current.get(d.id); if (p) { p.x = w.x; p.y = w.y; force((x) => x + 1); } }
    else setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: RWE) => { const k = Math.min(4, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 0.89))); setView((v) => ({ ...v, k })); };

  return (
    <>
      <PageTitle title="Fraud intelligence" sub="Relationships between investigation records. A correlation is an investigative lead, not proof of coordination or identity." />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.8125rem]" role="group" aria-label="Graph filters">
        <label className="inline-flex items-center gap-1.5">Window<select className="input !w-auto !min-h-11 !py-1" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option><option value={2160}>90 days</option></select></label>
        <label className="inline-flex items-center gap-1.5">Min. strength<select className="input !w-auto !min-h-11 !py-1" value={minStrength} onChange={(e) => setMinStrength(e.target.value)}>
          <option value="weak">Weak</option><option value="moderate">Moderate</option><option value="strong">Strong</option></select></label>
        <label className="inline-flex items-center gap-1.5">Severity<select className="input !w-auto !min-h-11 !py-1" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={lab} onChange={(e) => setLab(e.target.checked)} />Scenario Lab data</label>
        <span className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" aria-hidden />
          <input className="input !min-h-11 !py-1 !pl-8 !w-52" placeholder="Search nodes" aria-label="Search nodes" value={query} onChange={(e) => setQuery(e.target.value)} /></span>
        <Button size="sm" variant="secondary" onClick={() => setReveal((r) => !r)} title="Revealing identifiers is recorded in the audit log">{reveal ? <><EyeOff size={14} aria-hidden />Mask identifiers</> : <><Eye size={14} aria-hidden />Reveal identifiers</>}</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Node types">
        {TYPES.map((t) => (
          <button key={t.key} type="button" aria-pressed={!hidden.has(t.key)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8125rem] cursor-pointer ${hidden.has(t.key) ? 'border-[var(--hairline)] text-[var(--ink-3)] line-through' : 'border-[var(--hairline-strong)]'}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} aria-hidden />{t.label}</button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card padded={false} className="relative overflow-hidden">
          <div className="absolute right-3 top-3 z-10 flex gap-1">
            <Button size="sm" variant="secondary" onClick={fit} aria-label="Fit to view"><Maximize2 size={14} /></Button>
            <Button size="sm" variant="secondary" onClick={() => { posRef.current = layout(nodes, edges, new Map(), 260); force((x) => x + 1); setTimeout(fit, 20); }} aria-label="Reset layout"><RotateCcw size={14} /></Button>
            {focus && <Button size="sm" variant="secondary" onClick={() => setFocus(null)}>Show all</Button>}
          </div>
          {q.isPending ? <div className="p-6"><Skeleton lines={8} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : nodes.length === 0 ? (
            <div className="p-10 text-center text-[var(--ink-3)]">No investigation records in this window. Restricted or contained sessions appear here.</div>
          ) : (
            <svg ref={svgRef} className="block h-[min(70vh,620px)] w-full touch-none select-none bg-[var(--chart-surface)]" role="img"
              aria-label={`Correlation graph with ${nodes.length} nodes and ${edges.length} relationships`}
              onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onWheel={onWheel}>
              <g transform={`translate(${(svgRef.current?.clientWidth ?? 800) / 2 + view.x} ${(svgRef.current?.clientHeight ?? 600) / 2 + view.y}) scale(${view.k})`}>
                {edges.map((e, i) => {
                  const a = posRef.current.get(e.source), b = posRef.current.get(e.target);
                  if (!a || !b) return null;
                  const on = sel && (e.source === sel || e.target === sel);
                  return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeLinecap="round"
                    stroke={e.kind === 'derived' ? 'var(--block)' : 'var(--chart-axis)'} strokeDasharray={e.synthetic ? '5 4' : undefined}
                    strokeWidth={(e.kind === 'derived' ? STRENGTH_W[e.strength ?? 'weak'] : 1) / Math.sqrt(view.k)}
                    opacity={sel ? (on ? 1 : 0.15) : e.kind === 'derived' ? 0.9 : 0.6} />;
                })}
                {nodes.map((n) => {
                  const p = posRef.current.get(n.id);
                  if (!p) return null;
                  const t = T[n.type];
                  const dim = (sel && n.id !== sel && !neighbours.has(n.id)) || (matches && !matches.has(n.id));
                  return (
                    <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.2 : 1} onPointerDown={(e) => onDown(e, n.id)} className="cursor-pointer"
                      role="button" aria-label={`${t.label} ${n.label}`} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(n.id); }}>
                      <circle r={t.r + 8} fill="transparent" />
                      <circle r={t.r} fill={t.color} stroke="var(--chart-surface)" strokeWidth={2} strokeDasharray={n.synthetic ? '2 2' : undefined} />
                      {n.id === sel && <circle r={t.r + 4} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
                      {(n.type === 'incident' || n.type === 'customer' || n.id === sel || matches?.has(n.id) || n.type === 'ip') && (
                        <text y={t.r + 12} textAnchor="middle" fontSize={12 / Math.sqrt(view.k)} fill="var(--ink-2)" style={{ paintOrder: 'stroke', stroke: 'var(--chart-surface)', strokeWidth: 3 }}>{n.label}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          <p className="px-4 py-2 text-[0.75rem] text-[var(--ink-3)] border-t border-[var(--hairline)]">
            Drag to pan, scroll to zoom, drag nodes to arrange. Red lines are derived correlations (thicker = stronger); dashed = synthetic (Scenario Lab / Ghost Banking).
            {q.data?.truncated && ' Graph truncated at the size limit — narrow the filters.'}{q.data?.masked && ' Identifiers masked.'}
          </p>
        </Card>
        <div className="space-y-4 min-w-0">
          <Card title={selected ? `${T[selected.type].label}` : 'Select a node'}>
            {!selected ? <p className="text-[var(--ink-3)] text-[0.875rem]">Select a node to see its incidents, timestamps and how it relates to others.</p> : (
              <div className="space-y-3 text-[0.875rem]">
                <p className="font-mono break-all">{selected.label}</p>
                <div className="flex flex-wrap gap-1.5">{selected.synthetic && <Badge tone="stepup">Synthetic</Badge>}{selected.type === 'incident' && <Badge tone="block">{String(selected.severity)}</Badge>}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-[var(--ink-3)]">First seen</dt><dd>{selected.first_seen ? fmtTime(selected.first_seen, true) : '—'}</dd>
                  <dt className="text-[var(--ink-3)]">Last seen</dt><dd>{selected.last_seen ? fmtTime(selected.last_seen, true) : '—'}</dd>
                  <dt className="text-[var(--ink-3)]">Incidents</dt><dd>{selected.incidents.join(', ') || '—'}</dd>
                  {selected.type === 'ip' && <><dt className="text-[var(--ink-3)]">Address</dt><dd>{String(selected.version ?? '')} {String(selected.scope ?? '')}</dd></>}
                </dl>
                {selected.type === 'incident' && typeof selected.incident_id === 'number' && <Link className="font-medium underline underline-offset-4" to={`/soc/investigations/${selected.incident_id}`}>Open investigation</Link>}
                <Button size="sm" variant="secondary" onClick={() => setFocus(selected.id)}><Expand size={14} aria-hidden />Expand related (2 hops)</Button>
                <div>
                  <p className="font-medium">Relationships</p>
                  <ul className="mt-1 space-y-2">{relEdges.map((e, i) => (
                    <li key={i} className="border-l-2 pl-2" style={{ borderColor: e.kind === 'derived' ? 'var(--block)' : 'var(--hairline-strong)' }}>
                      <span className="font-medium">{e.relation.replace(/_/g, ' ')}</span>{e.strength && <> · <b>{e.strength}</b></>}{e.synthetic && ' · synthetic'}
                      <span className="block text-[var(--ink-2)]">{e.explanation}</span><span className="block text-[0.75rem] text-[var(--ink-3)]">Provenance: {e.provenance}</span>
                    </li>))}</ul>
                </div>
              </div>
            )}
          </Card>
          <Banner tone="info" title="Correlation limitations">{q.data?.caveat ?? 'Correlations are leads, not proof.'} Nothing here blocks a user, blacklists a payee or files a report.</Banner>
          {q.data && <Card title="Documented rules"><ul className="space-y-1.5 text-[0.8125rem] text-[var(--ink-2)]">{Object.entries(q.data.rules).map(([k, v]) => <li key={k}><b>{k}</b> — {v}</li>)}</ul></Card>}
        </div>
      </div>
    </>
  );
}
