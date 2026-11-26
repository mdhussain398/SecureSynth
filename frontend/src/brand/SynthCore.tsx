import { useReducedMotion } from 'motion/react';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { webglAvailable } from '../renaissance/orb/types';
import { SynthMark } from './SynthMark';

const SynthCoreScene = lazy(() => import('./SynthCoreScene'));

class GlBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The SVG mark at hero size: shown without WebGL, while the 3D chunk loads, and if WebGL fails. */
function Fallback() {
  return (
    <div className="absolute inset-0 grid place-items-center" data-synth="fallback">
      <div className="absolute inset-[18%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(0,91,255,0.14), rgba(0,91,255,0.06) 60%, transparent)' }} />
      <SynthMark size={512} square className="relative h-[64%] w-[64%]" />
    </div>
  );
}

/**
 * Synth Core hero logo. WebGL sculpture when available, the SVG mark otherwise.
 * - Pauses rendering when offscreen or when the tab is hidden.
 * - Reduced motion: no rotation, float or tilt; renders on demand; the hover change is instant.
 * - Hover or keyboard focus turns the glass ribbons to polished silver.
 * - Writes the measured frame rate to `data-fps` (one-second windows) so it can be read honestly in a real browser.
 */
export function SynthCore({ className = '', metal: forceMetal, maxPixels, still }: { className?: string; metal?: boolean; maxPixels?: number; still?: boolean }) {
  const reduce = !!useReducedMotion();
  const [gl] = useState(webglAvailable);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(false);
  const [onscreen, setOnscreen] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const el = useRef<HTMLDivElement>(null);
  const log = useRef<number[]>([]);

  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOnscreen(e.isIntersecting), { threshold: 0.01 });
    io.observe(node);
    const vis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, []);

  const onFps = (fps: number) => {
    const n = el.current; if (!n) return;
    log.current = [...log.current.slice(-59), Math.round(fps * 10) / 10];
    n.dataset.fps = fps.toFixed(1);
    n.dataset.fpsLog = log.current.join(',');
  };

  return (
    <div ref={el} className={`relative aspect-square w-full ${className}`} data-synth={gl ? 'webgl' : 'fallback'} data-ready={ready || undefined}
      tabIndex={0} role="img" aria-label="SecureSynth logo: two glass ribbons forming an S around a glowing shield"
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: gl && ready ? 0 : 1 }} aria-hidden><Fallback /></div>
      {gl && (
        <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }} aria-hidden>
          <GlBoundary>
            <Suspense fallback={null}>
              <SynthCoreScene metal={forceMetal ?? hover} reduce={reduce} active={onscreen && visible}
                onReady={() => setReady(true)} onFps={onFps} maxPixels={maxPixels} still={still} />
            </Suspense>
          </GlBoundary>
        </div>
      )}
    </div>
  );
}
