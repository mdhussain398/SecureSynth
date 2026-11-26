/* Fraud intelligence: an explainable correlation graph built by the backend from investigation records.
 * Hand-rolled SVG force layout (no extra dependency). Correlations are leads, never proof.
 *
 * Performance model: React renders the graph's *structure* (which nodes and edges exist, which are dimmed or selected).
 * Geometry (positions, pan, zoom, label placement) lives in refs and is written straight to the DOM inside one
 * requestAnimationFrame, so dragging, panning, zooming and layout never re-render React. The force layout runs in
 * time-boxed chunks (≤7 ms per frame), so it never blocks the main thread. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as RKE, type PointerEvent as RPE } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { ArrowLeftRight, ArrowUpRight, Expand, Eye, EyeOff, Globe, KeyRound, Landmark, Maximize2, Minus, Plus, RotateCcw, Search, ShieldAlert, Smartphone, User, X, type LucideProps } from 'lucide-react';
import { useGraph, type GraphEdge, type GraphNode } from '../../api/investigation';
import { Badge, Banner, Button, Card, ErrorState, Skeleton, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

type Kind = GraphNode['type'];
type TypeSpec = { key: Kind; label: string; color: string; r: number; Icon: ComponentType<LucideProps> };
/* Identity = colour + glyph, so no type relies on colour alone. Colours validated (validate_palette.js) in light and dark. */
const TYPES: TypeSpec[] = [
  { key: 'incident', label: 'Incident', color: 'var(--g-incident)', r: 14, Icon: ShieldAlert },
  { key: 'customer', label: 'Customer', color: 'var(--g-customer)', r: 13, Icon: User },
  { key: 'ip', label: 'IP address', color: 'var(--g-ip)', r: 11, Icon: Globe },
  { key: 'device', label: 'Registered device', color: 'var(--g-device)', r: 11, Icon: Smartphone },
  { key: 'beneficiary', label: 'Payee reference', color: 'var(--g-payee)', r: 11, Icon: Landmark },
  { key: 'session', label: 'Session', color: 'var(--g-neutral)', r: 9, Icon: KeyRound },
  { key: 'transaction', label: 'Transfer attempt', color: 'var(--g-neutral)', r: 9, Icon: ArrowLeftRight },
];
const T = Object.fromEntries(TYPES.map((t) => [t.key, t])) as Record<Kind, TypeSpec>;
const STRENGTH_W = { weak: 1.5, moderate: 2.5, strong: 3.5 } as const;
const STRENGTH_TONE = { weak: 'neutral', moderate: 'stepup', strong: 'block' } as const;
const K_MIN = 0.2, K_MAX = 4;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ------------------------------------------------------------------ force layout (pure, chunked) */
type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };
type Sim = { list: P[]; links: { a: P; b: P; want: number }[]; total: number; step: number; heat: number };

function makeSim(nodes: GraphNode[], edges: GraphEdge[], pos: Map<string, P>, fresh: boolean): Sim {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => { (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target); (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source); });
  const keep = new Set(nodes.map((n) => n.id));
  for (const id of [...pos.keys()]) if (!keep.has(id)) pos.delete(id);
  nodes.forEach((n, i) => {
    if (pos.has(n.id)) return;
    // New nodes start beside an already-placed neighbour (incremental updates stay calm), else on a ring.
    const anchor = (adj.get(n.id) ?? []).map((id) => pos.get(id)).find(Boolean);
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    pos.set(n.id, anchor ? { x: anchor.x + Math.cos(a) * 40, y: anchor.y + Math.sin(a) * 40, vx: 0, vy: 0 }
      : { x: Math.cos(a) * 240 + (i % 7) * 3, y: Math.sin(a) * 240 + (i % 5) * 3, vx: 0, vy: 0 });
  });
  const links = edges.flatMap((e) => { const a = pos.get(e.source), b = pos.get(e.target); return a && b ? [{ a, b, want: e.kind === 'derived' ? 170 : 72 }] : []; });
  return { list: nodes.map((n) => pos.get(n.id)!), links, total: fresh ? 300 : 120, step: 0, heat: fresh ? 1 : 0.35 };
}

function tick(sim: Sim) {
  const { list, links } = sim;
  const alpha = sim.heat * (1 - sim.step / sim.total);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 25), f = (2000 / d2) * alpha, d = Math.sqrt(d2);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
  }
  for (const { a, b, want } of links) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1), f = ((d - want) / d) * 0.06 * alpha;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  for (const p of list) {
    p.vx -= p.x * 0.004 * alpha; p.vy -= p.y * 0.004 * alpha;
    if (!p.fixed) { p.x += clamp(p.vx, -20, 20); p.y += clamp(p.vy, -20, 20); }
    p.vx *= 0.55; p.vy *= 0.55;
  }
  sim.step++;
}

/* ------------------------------------------------------------------ node + label marks (memoised; geometry set imperatively) */
const NodeMark = memo(function NodeMark({ n, dim, selected, focusable, onRef }: { n: GraphNode; dim: boolean; selected: boolean; focusable: boolean; onRef: (id: string, el: SVGGElement | null) => void }) {
  const t = T[n.type];
  const g = Math.round(t.r * 1.15);
  return (
    <g ref={(el) => onRef(n.id, el)} data-node={n.id} visibility="hidden" role="button" tabIndex={focusable ? 0 : -1} aria-pressed={selected}
      aria-label={`${t.label} ${n.label}${n.synthetic ? ', synthetic' : ''}`} className="ss-node cursor-pointer outline-none"
      style={{ opacity: dim ? 0.18 : 1, transition: 'opacity 180ms ease' }}>
      <circle r={t.r + 10} fill="transparent" />
      {selected && <circle r={t.r + 5} fill="none" stroke={t.color} strokeWidth={2} opacity={0.45} />}
      <circle className="ss-node-focus" r={t.r + 5} fill="none" stroke="var(--focus)" strokeWidth={2} />
      {n.synthetic
        ? <circle r={t.r - 1} fill="var(--chart-surface)" stroke={t.color} strokeWidth={2} />
        : <circle r={t.r} fill={t.color} stroke="var(--chart-surface)" strokeWidth={1.5} />}
      <t.Icon x={-g / 2} y={-g / 2} size={g} strokeWidth={2} color={n.synthetic ? t.color : '#fff'} aria-hidden focusable={false} pointerEvents="none" />
    </g>
  );
});

/* ------------------------------------------------------------------ page */
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
  const [arranging, setArranging] = useState(false);
  const params = `hours=${hours}&include_lab=${lab}&min_strength=${minStrength}${severity ? `&severity=${severity}` : ''}${reveal ? '&reveal=true' : ''}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;
  const q = useGraph(params);
  const reduce = !!useReducedMotion();

  const nodes = useMemo(() => (q.data?.nodes ?? []).filter((n) => !hidden.has(n.type)), [q.data, hidden]);
  const ids = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(() => (q.data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)), [q.data, ids]);
  const sig = useMemo(() => nodes.map((n) => n.id).join('|') + '#' + edges.length, [nodes, edges.length]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selected = (sel && byId.get(sel)) || null;
  const neighbours = useMemo(() => {
    const s = new Set<string>();
    if (sel) edges.forEach((e) => { if (e.source === sel) s.add(e.target); if (e.target === sel) s.add(e.source); });
    return s;
  }, [sel, edges]);
  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(t) || n.id.toLowerCase().includes(t)).map((n) => n.id)) : null;
  }, [query, nodes]);
  const relEdges = useMemo(() => (sel ? edges.filter((e) => e.source === sel || e.target === sel) : []), [sel, edges]);

  /* ---------- imperative geometry */
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(new Map<string, P>());
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 800, h: 600 });
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const labelEls = useRef(new Map<string, SVGTextElement>());
  const edgeEls = useRef<(SVGLineElement | null)[]>([]);
  const live = useRef({ nodes, edges, sel, neighbours, matches, hover: null as string | null });
  live.current = { ...live.current, nodes, edges, sel, neighbours, matches };
  const frame = useRef(0);
  const simFrame = useRef(0);
  const viewAnim = useRef(0);
  const autoFit = useRef(true);

  const onNodeRef = useCallback((id: string, el: SVGGElement | null) => { if (el) nodeEls.current.set(id, el); else nodeEls.current.delete(id); }, []);

  const applyNow = useCallback(() => {
    frame.current = 0;
    const { w, h } = sizeRef.current, v = viewRef.current, pos = posRef.current;
    const ox = w / 2 + v.x, oy = h / 2 + v.y, s = clamp(Math.sqrt(v.k), 0.7, 1.3);
    const L = live.current;
    for (const n of L.nodes) {
      const p = pos.get(n.id), el = nodeEls.current.get(n.id);
      if (!p || !el) continue;
      el.setAttribute('transform', `translate(${(ox + p.x * v.k).toFixed(1)} ${(oy + p.y * v.k).toFixed(1)}) scale(${s.toFixed(3)})`);
      if (el.getAttribute('visibility') !== 'visible') el.setAttribute('visibility', 'visible');
    }
    L.edges.forEach((e, i) => {
      const el = edgeEls.current[i], a = pos.get(e.source), b = pos.get(e.target);
      if (!el || !a || !b) return;
      el.setAttribute('x1', (ox + a.x * v.k).toFixed(1)); el.setAttribute('y1', (oy + a.y * v.k).toFixed(1));
      el.setAttribute('x2', (ox + b.x * v.k).toFixed(1)); el.setAttribute('y2', (oy + b.y * v.k).toFixed(1));
      if (el.getAttribute('visibility') !== 'visible') el.setAttribute('visibility', 'visible');
    });
    // Labels: priority order, greedy collision avoidance; hidden labels never overlap visible ones.
    const want: { id: string; pri: number }[] = [];
    for (const n of L.nodes) {
      const pri = n.id === L.sel ? 6 : n.id === L.hover ? 5 : L.matches?.has(n.id) ? 4 : L.neighbours.has(n.id) ? 3 : n.type === 'incident' ? 2 : v.k > 1.5 && (n.type === 'customer' || n.type === 'ip') ? 1 : 0;
      if (pri && (!L.matches || L.matches.has(n.id) || pri >= 5)) want.push({ id: n.id, pri });
    }
    want.sort((a, b) => b.pri - a.pri);
    const placed: [number, number, number, number][] = [];
    const show = new Set<string>();
    for (const { id, pri } of want) {
      const p = pos.get(id), el = labelEls.current.get(id), n = L.nodes.find((x) => x.id === id);
      if (!p || !el || !n) continue;
      const x = ox + p.x * v.k, y = oy + p.y * v.k + T[n.type].r * s + 16;
      const half = (el.textContent?.length ?? 0) * 3.4 + 4;
      const box: [number, number, number, number] = [x - half, y - 12, x + half, y + 4];
      if (pri < 5 && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      if (x + half < 0 || x - half > w || y < 0 || y - 12 > h) continue;
      placed.push(box); show.add(id);
      el.setAttribute('x', x.toFixed(1)); el.setAttribute('y', y.toFixed(1));
    }
    labelEls.current.forEach((el, id) => { const vis = show.has(id) ? 'visible' : 'hidden'; if (el.getAttribute('visibility') !== vis) el.setAttribute('visibility', vis); });
  }, []);
  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(applyNow); }, [applyNow]);
  useLayoutEffect(() => { edgeEls.current.length = edges.length; applyNow(); });

  const fitTarget = useCallback(() => {
    const pts = live.current.nodes.map((n) => posRef.current.get(n.id)).filter(Boolean) as P[];
    const { w, h } = sizeRef.current;
    if (!pts.length) return { x: 0, y: 0, k: 1 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const k = clamp(Math.min((w - 96) / Math.max(x1 - x0, 1), (h - 96) / Math.max(y1 - y0, 1)), K_MIN, 1.6);
    return { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
  }, []);
  const animateView = useCallback((to: { x: number; y: number; k: number }, animate = !reduce) => {
    cancelAnimationFrame(viewAnim.current);
    if (!animate) { viewRef.current = to; schedule(); return; }
    const from = { ...viewRef.current }, t0 = performance.now(), dur = 280;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      viewRef.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      applyNow();
      if (t < 1) viewAnim.current = requestAnimationFrame(step);
    };
    viewAnim.current = requestAnimationFrame(step);
  }, [applyNow, reduce, schedule]);
  const fit = useCallback(() => { autoFit.current = true; animateView(fitTarget()); }, [animateView, fitTarget]);
  const zoomAt = useCallback((mx: number, my: number, k: number) => {
    // (mx, my) relative to the canvas centre; keeps the world point under the cursor fixed.
    const v = viewRef.current, nk = clamp(k, K_MIN, K_MAX);
    viewRef.current = { k: nk, x: mx - ((mx - v.x) / v.k) * nk, y: my - ((my - v.y) / v.k) * nk };
    autoFit.current = false;
    schedule();
  }, [schedule]);
  const zoomBy = (f: number) => { autoFit.current = false; const v = viewRef.current, nk = clamp(v.k * f, K_MIN, K_MAX); animateView({ k: nk, x: v.x * (nk / v.k), y: v.y * (nk / v.k) }); };

  const runLayout = useCallback((reset: boolean) => {
    cancelAnimationFrame(simFrame.current);
    const L = live.current;
    if (reset) posRef.current = new Map();
    const known = L.nodes.filter((n) => posRef.current.has(n.id)).length;
    const fresh = reset || known < L.nodes.length * 0.5;
    const sim = makeSim(L.nodes, L.edges, posRef.current, fresh);
    if (fresh) setArranging(true);
    const run = () => {
      const t0 = performance.now();
      while (sim.step < sim.total && performance.now() - t0 < 7) tick(sim);
      if (!fresh && !reduce) schedule();
      if (sim.step < sim.total) { simFrame.current = requestAnimationFrame(run); return; }
      simFrame.current = 0;
      if (fresh || autoFit.current) animateView(fitTarget(), !fresh && !reduce);
      else schedule();
      setArranging(false);
    };
    simFrame.current = requestAnimationFrame(run);
  }, [animateView, fitTarget, reduce, schedule]);

  useEffect(() => { if (nodes.length) runLayout(false); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { cancelAnimationFrame(simFrame.current); cancelAnimationFrame(frame.current); cancelAnimationFrame(viewAnim.current); }, []);

  /* ---------- size + native wheel/gesture listeners (non-passive, so the page does not scroll under the graph) */
  const hasSvg = !q.isPending && !q.error && nodes.length > 0;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([e]) => { sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height }; if (autoFit.current && !simFrame.current) viewRef.current = fitTarget(); schedule(); });
    ro.observe(svg);
    const rel = (cx: number, cy: number) => { const r = svg.getBoundingClientRect(); return [cx - r.left - r.width / 2, cy - r.top - r.height / 2] as const; };
    let gesture: { k: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sizeRef.current.h : 1;
      const [mx, my] = rel(e.clientX, e.clientY);
      zoomAt(mx, my, viewRef.current.k * Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)));
    };
    // Safari trackpad pinch arrives as non-standard gesture events.
    type GE = Event & { scale: number; clientX: number; clientY: number };
    const gs = (e: Event) => { e.preventDefault(); gesture = { k: viewRef.current.k }; };
    const gc = (e: Event) => { e.preventDefault(); if (!gesture) return; const g = e as GE; const [mx, my] = rel(g.clientX, g.clientY); zoomAt(mx, my, gesture.k * g.scale); };
    const ge = (e: Event) => { e.preventDefault(); gesture = null; };
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', gs); svg.addEventListener('gesturechange', gc); svg.addEventListener('gestureend', ge);
    return () => { ro.disconnect(); svg.removeEventListener('wheel', onWheel); svg.removeEventListener('gesturestart', gs); svg.removeEventListener('gesturechange', gc); svg.removeEventListener('gestureend', ge); };
  }, [hasSvg, fitTarget, schedule, zoomAt]);

  /* ---------- pointer: pan, node drag, two-finger pinch; a press without movement selects */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<{ mode: 'pan' | 'node' | 'pinch'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; d0?: number; k0?: number } | null>(null);
  const onDown = (e: RPE<SVGSVGElement>) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnimationFrame(viewAnim.current);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gest.current = { mode: 'pinch', sx: 0, sy: 0, ox: 0, oy: 0, moved: true, d0: Math.hypot(a.x - b.x, a.y - b.y), k0: viewRef.current.k };
      return;
    }
    const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? undefined;
    const p = id ? posRef.current.get(id) : undefined;
    gest.current = { mode: id ? 'node' : 'pan', id, sx: e.clientX, sy: e.clientY, ox: p ? p.x : viewRef.current.x, oy: p ? p.y : viewRef.current.y, moved: false };
  };
  const onMove = (e: RPE<SVGSVGElement>) => {
    const g = gest.current;
    if (!pointers.current.has(e.pointerId)) {
      // Hover (mouse only): reveal that node's label without a React render.
      const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
      if (id !== live.current.hover) { live.current.hover = id; schedule(); }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) return;
    if (g.mode === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      const r = e.currentTarget.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - r.left - r.width / 2, (a.y + b.y) / 2 - r.top - r.height / 2, g.k0! * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0!));
      return;
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved) { g.moved = true; e.currentTarget.classList.add('is-dragging'); }
    autoFit.current = false;
    if (g.mode === 'node' && g.id) {
      const p = posRef.current.get(g.id);
      if (p) { p.x = g.ox + dx / viewRef.current.k; p.y = g.oy + dy / viewRef.current.k; p.fixed = true; }
    } else viewRef.current = { ...viewRef.current, x: g.ox + dx, y: g.oy + dy };
    schedule();
  };
  const onUp = (e: RPE<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    e.currentTarget.classList.remove('is-dragging');
    const g = gest.current;
    if (g && !g.moved && g.mode !== 'pinch') setSel(g.mode === 'node' ? g.id ?? null : null);
    gest.current = null;
    if (pointers.current.size === 1 && g?.mode === 'pinch') {
      // One finger left after a pinch: continue as a pan from here.
      const [[, pt]] = [...pointers.current.entries()];
      gest.current = { mode: 'pan', sx: pt.x, sy: pt.y, ox: viewRef.current.x, oy: viewRef.current.y, moved: true };
    }
  };
  const onKey = (e: RKE<SVGSVGElement>) => {
    const id = (e.target as Element).closest?.('[data-node]')?.getAttribute('data-node');
    if (id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(id); return; }
    const v = viewRef.current;
    const pan = (dx: number, dy: number) => { e.preventDefault(); autoFit.current = false; animateView({ ...v, x: v.x + dx, y: v.y + dy }); };
    if (e.key === 'Escape') setSel(null);
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(0.8); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === 'ArrowLeft') pan(60, 0); else if (e.key === 'ArrowRight') pan(-60, 0);
    else if (e.key === 'ArrowUp') pan(0, 60); else if (e.key === 'ArrowDown') pan(0, -60);
  };

  const toggleType = (k: Kind) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const counts = useMemo(() => { const c: Partial<Record<Kind, number>> = {}; (q.data?.nodes ?? []).forEach((n) => { c[n.type] = (c[n.type] ?? 0) + 1; }); return c; }, [q.data]);

  return (
    <>
      <PageTitle title="Fraud intelligence" sub="Relationships between investigation records. A correlation is an investigative lead, not proof of coordination or identity." />

      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2 text-[0.8125rem]" role="group" aria-label="Graph filters">
        <Field label="Window"><select className="input !w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option><option value={2160}>90 days</option></select></Field>
        <Field label="Minimum strength"><select className="input !w-auto" value={minStrength} onChange={(e) => setMinStrength(e.target.value)}>
          <option value="weak">Weak</option><option value="moderate">Moderate</option><option value="strong">Strong</option></select></Field>
        <Field label="Severity"><select className="input !w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All</option><option value="high">High</option><option value="critical">Critical</option></select></Field>
        <label className="inline-flex min-h-11 items-center gap-2 cursor-pointer select-none"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={lab} onChange={(e) => setLab(e.target.checked)} />Scenario Lab data</label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="relative">
            <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" aria-hidden />
            <input type="search" className="input !pl-9 !pr-9 !w-56" placeholder="Search nodes" aria-label="Search nodes" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches?.size) { setSel([...matches][0]); } }} />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"><X size={16} strokeWidth={1.75} aria-hidden /></button>}
          </span>
          <Button variant="secondary" onClick={() => setReveal((r) => !r)} title="Revealing identifiers is recorded in the audit log" aria-pressed={reveal}>
            {reveal ? <EyeOff size={18} strokeWidth={1.75} aria-hidden /> : <Eye size={18} strokeWidth={1.75} aria-hidden />}{reveal ? 'Mask identifiers' : 'Reveal identifiers'}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show or hide node types">
        {TYPES.map((t) => {
          const on = !hidden.has(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on} onClick={() => toggleType(t.key)}
              className={`relative inline-flex min-h-9 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[0.8125rem] cursor-pointer transition-[background-color,border-color,color,opacity] duration-150 before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] ${on ? 'border-[var(--hairline-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]' : 'border-dashed border-[var(--hairline-strong)] text-[var(--ink-3)] hover:text-[var(--ink-2)]'}`}>
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full transition-colors" style={on ? { background: t.color, color: '#fff' } : { boxShadow: `inset 0 0 0 1.5px ${t.color}`, color: t.color }}>
                <t.Icon size={15} strokeWidth={2} />
              </span>
              {t.label}<span className="tnum text-[var(--ink-3)]">{counts[t.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card padded={false} className="relative overflow-hidden">
          {q.isPending ? <div className="p-6"><Skeleton lines={8} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : nodes.length === 0 ? (
            <div className="p-10 text-center text-[var(--ink-3)]">No investigation records in this window. Restricted or contained sessions appear here.</div>
          ) : (
            <div className="relative">
              <svg ref={svgRef} className="ss-graph block h-[clamp(340px,min(72vh,115vw),640px)] w-full touch-none select-none bg-[var(--chart-surface)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
                role="group" tabIndex={0} aria-roledescription="correlation graph" aria-describedby="graph-help"
                aria-label={`Correlation graph: ${nodes.length} nodes, ${edges.length} relationships`}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onPointerLeave={() => { if (live.current.hover) { live.current.hover = null; schedule(); } }} onKeyDown={onKey}>
                <g ref={sceneRef} style={{ opacity: arranging ? 0 : 1, transition: reduce ? undefined : 'opacity 220ms ease' }}>
                  <g aria-hidden>
                    {edges.map((e, i) => {
                      const on = !!sel && (e.source === sel || e.target === sel);
                      const derived = e.kind === 'derived';
                      return <line key={`${e.source}>${e.target}>${e.relation}>${i}`} ref={(el) => { edgeEls.current[i] = el; }} visibility="hidden" strokeLinecap="round"
                        stroke={derived ? 'var(--g-incident)' : on ? 'var(--ink-2)' : 'var(--chart-axis)'} strokeDasharray={e.synthetic ? '6 5' : undefined}
                        strokeWidth={derived ? STRENGTH_W[e.strength ?? 'weak'] : on ? 1.75 : 1.25}
                        style={{ opacity: sel ? (on ? 1 : 0.1) : matches ? 0.25 : derived ? 0.85 : 0.75, transition: 'opacity 180ms ease' }} />;
                    })}
                  </g>
                  <g>
                    {nodes.map((n) => (
                      <NodeMark key={n.id} n={n} onRef={onNodeRef} selected={n.id === sel} focusable={n.type === 'incident'}
                        dim={(!!sel && n.id !== sel && !neighbours.has(n.id)) || (!!matches && !matches.has(n.id))} />
                    ))}
                  </g>
                  <g aria-hidden className="pointer-events-none">
                    {nodes.map((n) => (
                      <text key={n.id} ref={(el) => { if (el) labelEls.current.set(n.id, el); else labelEls.current.delete(n.id); }} visibility="hidden" textAnchor="middle"
                        fontSize={12} fontWeight={n.id === sel ? 600 : 500} fill="var(--ink)" stroke="var(--chart-surface)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">{short(n.label)}</text>
                    ))}
                  </g>
                </g>
              </svg>
              {arranging && <div className="pointer-events-none absolute inset-0 grid place-items-center text-[0.875rem] text-[var(--ink-3)]" role="status">Arranging {nodes.length} nodes…</div>}

              {selected && (
                <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-[14px] rn-glass py-1.5 pl-3 pr-1.5 xl:hidden">
                  <span className="min-w-0 flex-1 truncate text-[0.875rem]"><span className="text-[var(--ink-3)]">{T[selected.type].label} · </span><span className="font-mono">{selected.label}</span></span>
                  <button type="button" onClick={() => detailRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })} className="min-h-11 shrink-0 rounded-[10px] px-3 text-[0.875rem] font-medium text-[var(--accent)] hover:bg-[var(--surface-2)] cursor-pointer">Details</button>
                </div>
              )}
              {focus && (
                <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full rn-glass py-1 pl-3 pr-1 text-[0.8125rem]">
                  <span>Two hops around <b className="font-medium">{short(byId.get(focus)?.label ?? 'selection', 22)}</b></span>
                  <button type="button" onClick={() => setFocus(null)} className="min-h-9 rounded-full px-3 font-medium text-[var(--accent)] hover:bg-[var(--surface-2)] cursor-pointer">Show all</button>
                </div>
              )}

              <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-[12px] rn-glass" role="toolbar" aria-label="Graph view" aria-orientation="vertical">
                <ToolButton label="Zoom in" onClick={() => zoomBy(1.3)}><Plus /></ToolButton>
                <ToolButton label="Zoom out" onClick={() => zoomBy(1 / 1.3)}><Minus /></ToolButton>
                <span className="mx-2 h-px bg-[var(--hairline)]" aria-hidden />
                <ToolButton label="Fit graph to view" onClick={fit}><Maximize2 /></ToolButton>
                <ToolButton label="Re-arrange layout" onClick={() => { autoFit.current = true; runLayout(true); }}><RotateCcw /></ToolButton>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--hairline)] px-4 py-2.5 text-[0.75rem] text-[var(--ink-3)]">
            <LegendLine color="var(--g-incident)" width={3}>Derived correlation (thicker = stronger)</LegendLine>
            <LegendLine color="var(--chart-axis)" width={1.5}>Direct link</LegendLine>
            <LegendLine color="var(--ink-3)" width={1.5} dash>Synthetic link</LegendLine>
            <span className="inline-flex items-center gap-1.5"><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" /></svg>Hollow node = synthetic (Scenario Lab / Ghost Banking)</span>
            <span id="graph-help" className="w-full">Drag to pan, scroll or pinch to zoom, drag a node to move it. With the graph focused: arrow keys pan, + and − zoom, 0 fits, Esc clears the selection.
              {q.data?.truncated && ' Graph truncated at the size limit; narrow the filters.'}{q.data?.masked && ' Identifiers masked.'}</span>
          </div>
        </Card>

        <div ref={detailRef} className="min-w-0 scroll-mt-[88px] space-y-4 xl:sticky xl:top-[88px] xl:self-start">
          <Card>
            {!selected ? (
              <div className="py-2">
                <p className="font-semibold">No node selected</p>
                <p className="mt-1 text-[0.875rem] text-[var(--ink-3)]">Select a node to see its incidents, when it was seen and how it relates to the others.</p>
              </div>
            ) : <NodeDetail n={selected} rel={relEdges} byId={byId} onSelect={setSel} onExpand={() => setFocus(selected.id)} onClose={() => setSel(null)} />}
          </Card>
          <Banner tone="info" title="Correlation limitations">{q.data?.caveat ?? 'Correlations are leads, not proof.'} Nothing here blocks a user, blacklists a payee or files a report.</Banner>
          {q.data && (
            <Card title="Documented rules">
              <ul className="space-y-2.5 text-[0.8125rem] text-[var(--ink-2)]">{Object.entries(q.data.rules).map(([k, v]) => (
                <li key={k} className="flex gap-2.5"><span className="mt-px inline-grid h-5 min-w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-2)] px-1.5 text-[0.6875rem] font-semibold text-[var(--ink)]">{k.length > 3 ? 'R1–3' : k}</span>
                  <span>{k.length > 3 && <b className="font-semibold text-[var(--ink)] first-letter:uppercase">{k} · </b>}{v}</span></li>))}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="inline-flex flex-col gap-1"><span className="text-[0.75rem] text-[var(--ink-3)]">{label}</span>{children}</label>;
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactElement<LucideProps> }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid h-11 w-11 place-items-center text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--hairline)] cursor-pointer">
      {{ ...children, props: { ...children.props, size: 18, strokeWidth: 1.75, 'aria-hidden': true } }}
    </button>
  );
}

function LegendLine({ color, width, dash, children }: { color: string; width: number; dash?: boolean; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash ? '4 3' : undefined} /></svg>{children}</span>;
}

function NodeDetail({ n, rel, byId, onSelect, onExpand, onClose }: { n: GraphNode; rel: GraphEdge[]; byId: Map<string, GraphNode>; onSelect: (id: string) => void; onExpand: () => void; onClose: () => void }) {
  const t = T[n.type];
  return (
    <div className="space-y-4 text-[0.875rem]">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px]" style={n.synthetic ? { boxShadow: `inset 0 0 0 2px ${t.color}`, color: t.color } : { background: t.color, color: '#fff' }}>
          <t.Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.75rem] text-[var(--ink-3)]">{t.label}</p>
          <p className="font-mono text-[0.875rem] font-medium break-all leading-snug">{n.label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Clear selection" className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] cursor-pointer"><X size={18} strokeWidth={1.75} aria-hidden /></button>
      </div>
      {(n.synthetic || n.type === 'incident') && (
        <div className="flex flex-wrap gap-1.5">{n.synthetic && <Badge tone="stepup">Synthetic</Badge>}{n.type === 'incident' && n.severity != null && <Badge tone="block">{String(n.severity) === 'critical' ? 'Critical' : 'High'}</Badge>}</div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-[var(--ink-3)]">First seen</dt><dd className="tnum">{n.first_seen ? fmtTime(n.first_seen, true) : '—'}</dd>
        <dt className="text-[var(--ink-3)]">Last seen</dt><dd className="tnum">{n.last_seen ? fmtTime(n.last_seen, true) : '—'}</dd>
        <dt className="text-[var(--ink-3)]">Incidents</dt><dd className="break-words">{n.incidents.join(', ') || '—'}</dd>
        {n.type === 'ip' && <><dt className="text-[var(--ink-3)]">Address</dt><dd>{[n.version, n.scope].filter(Boolean).map(String).join(' · ') || '—'}</dd></>}
      </dl>
      <div className="flex flex-wrap gap-2">
        {n.type === 'incident' && typeof n.incident_id === 'number' && (
          <Link to={`/soc/investigations/${n.incident_id}`} className="rn-btn rn-btn-primary !min-h-11 !px-4 text-[0.875rem]">Open investigation<ArrowUpRight size={18} strokeWidth={1.75} aria-hidden /></Link>
        )}
        <Button variant="secondary" onClick={onExpand}><Expand size={18} strokeWidth={1.75} aria-hidden />Expand two hops</Button>
      </div>
      <div>
        <p className="font-semibold">Relationships <span className="font-normal text-[var(--ink-3)] tnum">{rel.length}</span></p>
        {rel.length === 0 ? <p className="mt-1 text-[var(--ink-3)]">None in the current filters.</p> : (
          <ul className="mt-2 divide-y divide-[var(--hairline)] rounded-[12px] border border-[var(--hairline)]">
            {rel.map((e, i) => {
              const other = byId.get(e.source === n.id ? e.target : e.source);
              const ot = other ? T[other.type] : null;
              return (
                <li key={i}>
                  <button type="button" onClick={() => other && onSelect(other.id)} className="w-full px-3 py-2.5 text-left hover:bg-[var(--surface-2)] cursor-pointer">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium first-letter:uppercase">{e.relation.replace(/_/g, ' ')}</span>
                      {e.strength && <Badge tone={STRENGTH_TONE[e.strength]}>{e.strength}</Badge>}
                      {e.synthetic && <Badge tone="neutral">synthetic</Badge>}
                    </span>
                    {other && ot && <span className="mt-1 flex items-center gap-1.5 text-[var(--ink-2)]"><ot.Icon size={14} strokeWidth={1.75} style={{ color: ot.color }} aria-hidden /><span className="truncate font-mono text-[0.8125rem]">{other.label}</span></span>}
                    <span className="mt-1 block text-[var(--ink-2)]">{e.explanation}</span>
                    <span className="mt-0.5 block text-[0.75rem] text-[var(--ink-3)]">Provenance: {e.provenance}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
