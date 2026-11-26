/* Motion + layout primitives for the Renaissance design system. One animation library: `motion`. */
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export const spring = { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 } as const;

/** Counts to a real value with a spring; reduced motion shows the final value immediately. */
export function AnimatedNumber({ value, decimals = 1, className }: { value: number; decimals?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const c = animate(from.current, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span className={`rn-num ${className ?? ''}`} aria-label={value.toFixed(decimals)}>{shown.toFixed(decimals)}</span>;
}

/** A single orchestrated entrance for a group; children rise once, in order. */
export function Stagger({ children, delay = 0, className }: { children: ReactNode[]; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      {children.map((c, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 28, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, delay: delay + i * 0.09, ease: [0.22, 1, 0.36, 1] }}>
          {c}
        </motion.div>
      ))}
    </div>
  );
}

/** Pointer position normalised to −1..1 over the window, spring-smoothed (for lighting and tilt). */
export function usePointerField() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 60, damping: 18 });
  const sy = useSpring(y, { stiffness: 60, damping: 18 });
  useEffect(() => {
    const on = (e: PointerEvent) => { x.set((e.clientX / window.innerWidth) * 2 - 1); y.set((e.clientY / window.innerHeight) * 2 - 1); };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, [x, y]);
  return { x: sx, y: sy };
}

/** Soft cursor-responsive light that sits behind the hero. */
export function CursorLight() {
  const reduce = useReducedMotion();
  const { x, y } = usePointerField();
  const left = useTransform(x, (v) => `${50 + v * 18}%`);
  const top = useTransform(y, (v) => `${45 + v * 14}%`);
  if (reduce) return null;
  return (
    <motion.div aria-hidden style={{ left, top }}
      className="pointer-events-none absolute h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6 }}>
      <div className="h-full w-full rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(0,91,255,0.08), rgba(0,91,255,0.04) 55%, transparent)' }} />
    </motion.div>
  );
}

/**
 * Scroll-responsive chrome: true while the reader is scrolling down past `offset`, false when they scroll up
 * or return near the top. Reads the document's real scrolling element (the page scrolls the document, not an
 * inner container) once per animation frame, and ignores jitter below `tolerance` px so trackpad noise and
 * small corrections never toggle it.
 */
export function useHideOnScroll({ offset = 72, tolerance = 14 }: { offset?: number; tolerance?: number } = {}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = () => document.scrollingElement ?? document.documentElement;
    let last = el().scrollTop, anchor = last, frame = 0, state = false;
    const apply = (v: boolean) => { if (v !== state) { state = v; setHidden(v); } };
    const read = () => {
      frame = 0;
      const y = Math.max(0, el().scrollTop);
      if (y <= offset) { anchor = y; last = y; apply(false); return; }
      if ((y > last) !== (anchor < last)) anchor = last; // direction changed: measure travel from here
      if (y - anchor > tolerance) apply(true);
      else if (anchor - y > tolerance) apply(false);
      last = y;
    };
    const on = () => { if (!frame) frame = requestAnimationFrame(read); };
    window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); if (frame) cancelAnimationFrame(frame); };
  }, [offset, tolerance]);
  return hidden;
}

/** Wraps a header's brand: fades and lifts away on downward scroll, returns on upward scroll. Its box keeps its
 * size, so nothing around it shifts. Reduced motion swaps instantly. */
export function ScrollBrand({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div aria-hidden={hidden || undefined} style={{ pointerEvents: hidden ? 'none' : undefined }}
      initial={false} animate={hidden ? { opacity: 0, y: -10, filter: 'blur(4px)' } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={reduce ? { duration: 0 } : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Floating glass navigation with a fluid active indicator. */
export function GlassNav({ items, label, className }: { items: { to: string; label: string; end?: boolean; match?: string }[]; label: string; className?: string }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label={label} className={`rn-glass flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none] ${className ?? ''}`}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          className="relative flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[0.875rem] sm:px-3 2xl:px-4 sm:text-[length:var(--t-sm)] font-medium text-[color:var(--graphite-2)] transition-colors hover:text-[color:var(--graphite)] aria-[current=page]:text-[color:var(--graphite)]">
          {({ isActive: exact }) => { const isActive = exact || (!!it.match && pathname.startsWith(it.match)); return (
            <>
              {isActive && <motion.span layoutId={`${label}-pill`} transition={spring} className="rn-lens absolute inset-0 rounded-full" />}
              <span className={`relative ${isActive ? 'font-semibold' : ''}`}>{it.label}</span>
            </>
          ); }}
        </NavLink>
      ))}
    </nav>
  );
}

/* ---------- Behavioural topography ----------
 * Contour lines of a scalar field. On the landing page the field is an illustration; in the Command Centre
 * it is built from the customer's real 24-hour activity profile (the "terrain" of their normal behaviour). */
function fieldFrom(hourProfile: number[] | null, seed: number) {
  const peaks = hourProfile
    ? hourProfile.map((p, h) => ({ a: (h / 24) * Math.PI * 2, w: p })).filter((p) => p.w > 0.02)
    : Array.from({ length: 5 }, (_, i) => ({ a: seed + i * 1.37, w: 0.12 + ((i * 7919) % 13) / 60 }));
  return (x: number, y: number) => {
    let v = 0;
    for (const p of peaks) {
      const cx = 0.5 + Math.cos(p.a) * 0.26, cy = 0.5 + Math.sin(p.a) * 0.26;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      v += p.w * Math.exp(-d2 / 0.03) * 6;
    }
    return v + 0.35 * Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.09);
  };
}

/** Marching squares → SVG paths. Deterministic, computed once. */
export function Contours({ hourProfile = null, levels = 14, seed = 0.6, className, stroke = 'var(--silver)', clearAt }:
  { hourProfile?: number[] | null; levels?: number; seed?: number; className?: string; stroke?: string;
    /** fade the lines out around this point (percent x/y) so they never compete with the focal subject */
    clearAt?: [number, number] }) {
  const d = useMemo(() => {
    const N = 72, f = fieldFrom(hourProfile, seed);
    const g: number[][] = [];
    let max = 0;
    for (let j = 0; j <= N; j++) { g[j] = []; for (let i = 0; i <= N; i++) { const v = f(i / N, j / N); g[j][i] = v; max = Math.max(max, v); } }
    const paths: string[] = [];
    for (let l = 1; l <= levels; l++) {
      const t = (max * l) / (levels + 1);
      let p = '';
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = g[j][i], b = g[j][i + 1], c = g[j + 1][i + 1], e = g[j + 1][i];
        const k = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (e > t ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const lerp = (u: number, v: number) => (t - u) / (v - u || 1e-9);
        const T: [number, number] = [i + lerp(a, b), j], R: [number, number] = [i + 1, j + lerp(b, c)];
        const B: [number, number] = [i + lerp(e, c), j + 1], L: [number, number] = [i, j + lerp(a, e)];
        const segs: [number, number][][] = ({
          1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
          8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
        } as Record<number, [number, number][][]>)[k];
        for (const [u, v] of segs) p += `M${(u[0] / N * 100).toFixed(2)} ${(u[1] / N * 100).toFixed(2)}L${(v[0] / N * 100).toFixed(2)} ${(v[1] / N * 100).toFixed(2)}`;
      }
      paths.push(p);
    }
    return paths;
  }, [hourProfile, levels, seed]);
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className}
      style={clearAt ? (() => { const m = `radial-gradient(60vmin 60vmin at ${clearAt[0]}% ${clearAt[1]}%, transparent 35%, #000 100%)`; return { maskImage: m, WebkitMaskImage: m }; })() : undefined}>
      {d.map((p, i) => <path key={i} d={p} fill="none" stroke={stroke} strokeWidth={i % 4 === 3 ? 0.9 : 0.5} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
