import { useReducedMotion } from 'motion/react';
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { LEVEL_COLOR, STATE_COLOR, spherePoints, webglAvailable, type OrbProps } from './types';

const OrbScene = lazy(() => import('./OrbScene'));

/** Pure CSS/SVG orb: used without WebGL, while the 3D chunk loads, and if WebGL fails at runtime. */
export function OrbFallback({ signals, state, selected, onSelect, hero }: OrbProps) {
  const pts = useMemo(() => spherePoints(Math.max(signals.length, 1), 0.98), [signals.length]);
  const glow = STATE_COLOR[state];
  return (
    <div className="relative aspect-square w-full" data-orb="fallback">
      <div className="absolute inset-[9%] rounded-full" style={{
        background: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.98), rgba(255,255,255,0.55) 22%, rgba(214,228,255,0.35) 48%, rgba(192,199,209,0.25) 70%, rgba(255,255,255,0.6) 100%)`,
        boxShadow: `inset -18px -26px 60px rgba(0,91,255,0.16), inset 10px 14px 30px rgba(255,255,255,0.9), 0 40px 80px -30px rgba(0,61,170,0.35)`,
      }} />
      <div className="absolute left-1/2 top-1/2 h-[14%] w-[14%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(circle, ${glow}, ${glow}55 60%, transparent 72%)`, filter: 'blur(2px)' }} />
      {[0, 1].map((i) => (
        <div key={i} className="absolute inset-[3%] rounded-full border border-[color:var(--silver)]"
          style={{ transform: `rotateX(72deg) rotateZ(${i * 38 - 18}deg)` }} />
      ))}
      {!hero && signals.map((s, i) => {
        const [x, y, z] = pts[i];
        const scale = 0.62 + (z + 1) * 0.12;
        return (
          <button key={s.id} type="button" onClick={() => onSelect?.(s.id)} aria-label={s.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125"
            style={{
              left: `${50 + x * 30}%`, top: `${50 - y * 30}%`, width: s.level >= 2 ? 14 : 9, height: s.level >= 2 ? 14 : 9,
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
  const fb = <OrbFallback {...props} />;
  if (!gl) return fb;
  // The CSS orb stays visible until the WebGL scene has drawn a real frame, then crossfades: never an empty hero.
  return (
    <div className="relative aspect-square w-full" data-orb="webgl" data-ready={ready || undefined}>
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 0 : 1 }} aria-hidden={ready} inert={ready}>{fb}</div>
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }}>
        <GlBoundary fallback={null}>
          <Suspense fallback={null}>
            <OrbScene {...props} reduce={reduce} onReady={() => setReady(true)} />
          </Suspense>
        </GlBoundary>
      </div>
    </div>
  );
}
