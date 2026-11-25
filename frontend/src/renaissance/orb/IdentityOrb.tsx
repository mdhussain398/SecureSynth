import { useReducedMotion } from 'motion/react';
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LEVEL_COLOR, STATE_COLOR, spherePoints, webglAvailable, type OrbProps } from './types';

const OrbScene = lazy(() => import('./OrbScene'));

/** Pure CSS/SVG orb: used without WebGL, while the 3D chunk loads, and if WebGL fails at runtime. */
export function OrbFallback({ signals, state, selected, onSelect, hero }: OrbProps) {
  const pts = useMemo(() => spherePoints(Math.max(signals.length, 1), 0.98), [signals.length]);
  const glow = STATE_COLOR[state];
  return (
    <div className="relative aspect-square w-full" data-orb="fallback">
      {/* optical glass in CSS: absorption toward the edge, an electric caustic low-left, softbox highlights */}
      <div className="absolute inset-[13%] rounded-full" style={{
        background: `radial-gradient(circle at 36% 70%, rgba(0,91,255,0.30), rgba(0,91,255,0) 42%), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.75) 0%, rgba(233,239,248,0.7) 58%, rgba(176,188,206,0.75) 92%, rgba(120,134,156,0.7) 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.8), inset -10px -16px 40px rgba(0,61,170,0.22), 0 50px 70px -40px rgba(16,24,40,0.45)`,
      }} />
      <div className="absolute left-[27%] top-[19%] h-[9%] w-[46%] rounded-[50%] opacity-80" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0))', transform: 'rotate(-8deg)' }} />
      <div className="absolute left-[19%] top-[30%] h-[36%] w-[3%] rounded-full opacity-70" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0), #fff, rgba(255,255,255,0))' }} />
      <div className="absolute left-1/2 top-1/2 h-[9%] w-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(circle, ${glow}, ${glow}66 55%, transparent 72%)` }} />
      {!hero && signals.map((s, i) => {
        const [x, y, z] = pts[i];
        const scale = 0.62 + (z + 1) * 0.12;
        return (
          <button key={s.id} type="button" onClick={() => onSelect?.(s.id)} aria-label={s.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125"
            style={{
              left: `${50 + x * 26}%`, top: `${50 - y * 26}%`, width: s.level >= 2 ? 14 : 9, height: s.level >= 2 ? 14 : 9,
              background: LEVEL_COLOR[s.level], opacity: 0.55 + (z + 1) * 0.22, transform: `translate(-50%,-50%) scale(${scale})`,
              outline: selected === s.id ? '2px solid #101828' : undefined, outlineOffset: 3,
            }} />
        );
      })}
    </div>
  );
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The SecureSynth identity orb. In investigation views it visualises backend-derived signals; it is not the model. */
export function IdentityOrb(props: OrbProps) {
  const reduce = !!useReducedMotion();
  const [gl] = useState(webglAvailable);
  const [ready, setReady] = useState(false);
  // Creating the WebGL context and compiling shaders blocks the main thread for ~300 ms. Start it only after the
  // page's entrance (nav pill slide, content fade, ~350 ms) has finished and the browser is idle, so navigating to
  // a page with the orb never stutters. The CSS orb covers the gap and crossfades exactly as before.
  const [mountGl, setMountGl] = useState(false);
  useEffect(() => {
    if (!gl) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle = 0;
    const t = setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => setMountGl(true), { timeout: 600 });
      else setMountGl(true);
    }, 420);
    return () => { clearTimeout(t); if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle); };
  }, [gl]);
  const fb = <OrbFallback {...props} />;
  if (!gl) return fb;
  // The CSS orb stays visible until the WebGL scene has drawn a real frame, then crossfades: never an empty hero.
  return (
    <div className="relative aspect-square w-full" data-orb="webgl" data-ready={ready || undefined}>
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 0 : 1 }} aria-hidden={ready} inert={ready}>{fb}</div>
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }}>
        <GlBoundary fallback={null}>
          <Suspense fallback={null}>
            {mountGl && <OrbScene {...props} reduce={reduce} onReady={() => setReady(true)} />}
          </Suspense>
        </GlBoundary>
      </div>
    </div>
  );
}
