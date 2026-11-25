import { ShieldCheck, Smartphone, Phone } from 'lucide-react';
import { Button } from '../../design/components';

/** Calm, protective notice for restricted sessions. Never shows scores, thresholds or reasons beyond category level. */
export function RestrictedNotice({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  return (
    <section className="rn-glass max-w-xl mx-auto rounded-[var(--radius-l)] p-7 sm:p-11">
      <ShieldCheck size={30} className="text-[var(--accent)]" aria-hidden />
      <h1 className="rn-display text-[clamp(2.5rem,6vw,3.5rem)] mt-4">Your account is protected</h1>
      <p className="text-[1.0625rem] text-[var(--ink-2)] mt-3 leading-relaxed">
        {name.split(' ')[0]}, we noticed activity that did not look like you, so we paused payments and payee changes on this
        sign-in. Your balance and saved payees are safe.
      </p>
      <h2 className="text-[1rem] font-semibold mt-7">What you can do</h2>
      <ul className="mt-3 space-y-3 text-[var(--ink-2)]">
        <li className="flex gap-3"><Smartphone size={18} className="shrink-0 mt-0.5 text-[var(--ink-3)]" aria-hidden />Sign in again from your usual device, and approve any request on your registered phone only if you started it.</li>
        <li className="flex gap-3"><Phone size={18} className="shrink-0 mt-0.5 text-[var(--ink-3)]" aria-hidden />If you did not try to sign in or send money, contact the bank's fraud line (simulated) and change your password.</li>
      </ul>
      <div className="mt-8"><Button variant="secondary" onClick={onSignOut}>Sign out</Button></div>
    </section>
  );
}
