import { Link, useSearchParams } from 'react-router-dom';
import '../renaissance/rn.css';
import { Contours } from '../renaissance/primitives';
import { SynthCore } from './SynthCore';
import { SynthMark } from './SynthMark';

/**
 * Brand sheet: the Synth Core hero, the navigation mark and the static variants.
 * Query parameters for exports and checks: `?still=1` (hero only, no chrome), `&metal=1` (silver state), `&hq=1` (full resolution for exports), `?gl=0` (no WebGL).
 */
export function BrandPage() {
  const [q] = useSearchParams();
  const metal = q.get('metal') === '1' ? true : undefined;
  if (q.get('still') === '1') {
    return (
      <main className="rn grid h-[100dvh] place-items-center" style={{ background: '#F2F5F9' }}>
        <div className="w-[min(100vw,100vh)]"><SynthCore metal={metal} maxPixels={q.get('hq') === '1' ? 2400 : undefined} still={q.get('hq') === '1'} /></div>
      </main>
    );
  }
  return (
    <main className="rn relative isolate min-h-[100dvh] overflow-x-clip">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-40" seed={2.3} clearAt={[50, 38]} />
      <header className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
        <Link to="/" className="flex items-center gap-2.5" aria-label="SecureSynth home">
          <SynthMark size={30} /><span className="font-semibold tracking-[-0.01em]">SecureSynth</span>
        </Link>
        <span className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Brand · Synth Core</span>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-6 px-5 pt-6 sm:px-8 md:grid-cols-[1.15fr_1fr]">
        <div className="mx-auto w-full max-w-[560px]"><SynthCore metal={metal} /></div>
        <div>
          <h1 className="rn-display text-[clamp(3rem,7vw,6rem)] text-[color:var(--graphite)]">Synth Core</h1>
          <p className="mt-4 max-w-[34rem] text-[length:var(--t-lg)] leading-snug text-[color:var(--graphite-2)]">
            Two optical-glass ribbons form the S of SecureSynth and pass behind a luminous shield.
          </p>
          <p className="mt-3 max-w-[34rem] text-[length:var(--t-base)] text-[color:var(--graphite-3)]">
            The ribbons are the two signals we join: who the customer says they are, and how they behave. The shield turns once every ten seconds. Hover or focus the sculpture and the glass is polished into silver.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-10 grid max-w-6xl gap-4 px-5 pb-12 sm:grid-cols-3 sm:px-8">
        <figure className="flex flex-col items-center gap-4 rounded-[28px] bg-[var(--crystal)] p-8 shadow-[0_20px_50px_-30px_rgba(16,24,40,0.35)]">
          <SynthMark size={128} square title="Synth Core, light" />
          <figcaption className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Static mark · light</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-4 rounded-[28px] p-8" style={{ background: '#101828' }}>
          <SynthMark size={128} square tone="dark" title="Synth Core, dark" />
          <figcaption className="text-[length:var(--t-sm)] text-[#BAC2CE]">Static mark · dark</figcaption>
        </figure>
        <figure className="flex flex-col items-center justify-center gap-5 rounded-[28px] bg-[var(--crystal)] p-8 shadow-[0_20px_50px_-30px_rgba(16,24,40,0.35)]">
          <div className="flex items-end gap-5">
            <SynthMark size={16} /><SynthMark size={24} /><SynthMark size={32} /><SynthMark size={48} />
          </div>
          <span className="flex items-center gap-2.5 font-semibold"><SynthMark size={28} />SecureSynth</span>
          <figcaption className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Navigation mark · 16–48 px, no WebGL</figcaption>
        </figure>
      </section>
    </main>
  );
}
