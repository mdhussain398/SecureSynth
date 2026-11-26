/* Consent-based verification photograph. Shown only when the bank's analyst asked THIS session for one.
 * Explicit consent first; the camera starts only after the user asks for it and the browser grants permission; nothing is
 * captured in the background; the stream is stopped on capture, cancel, close and unmount. No facial recognition. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Camera, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { api, request } from '../../api/client';
import { Banner, Button } from '../../design/components';

type Req = { id: string; reason: string; expires_at: string };

export function PhotoRequestBanner() {
  const q = useQuery({ queryKey: ['me', 'photo-request'], queryFn: () => api.get<{ request: Req | null }>('/auth/photo-request'), refetchInterval: 5000, retry: false });
  const [open, setOpen] = useState(false);
  const r = q.data?.request;
  if (!r) return null;
  return (
    <>
      <div className="mb-4 rn-glass rounded-[var(--radius-l)] p-5 flex flex-wrap items-center justify-between gap-4" role="status">
        <div className="flex items-start gap-3"><Camera size={20} className="mt-0.5 text-[var(--stepup)]" aria-hidden />
          <div><p className="font-semibold">Verification photograph requested</p><p className="text-[0.9375rem] text-[var(--ink-2)]">{r.reason}</p></div></div>
        <Button onClick={() => setOpen(true)}>Review request</Button>
      </div>
      <AnimatePresence>{open && <PhotoDialog req={r} onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function PhotoDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const [stage, setStage] = useState<'consent' | 'camera' | 'review' | 'done' | 'declined'>('consent');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => stop(), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { stop(); onClose(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onClose]);

  const start = async () => {
    setErr(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setErr('The camera is unavailable here: it needs a secure (https or localhost) page and a browser with camera support.'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      setStage('camera');
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
    } catch (e) {
      const name = (e as DOMException).name;
      setErr(name === 'NotAllowedError' ? 'Camera permission was denied. You can allow it in your browser settings, or decline the request.' :
        name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found on this device.' : 'The camera could not be started.');
    }
  };
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    const scale = Math.min(1, 640 / v.videoWidth);
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL('image/jpeg', 0.85));
    stop();
    setStage('review');
  };
  const submit = async () => {
    if (!shot) return;
    setBusy(true); setErr(null);
    try {
      await request('POST', `/auth/photo-request/${req.id}/submit`, { body: { consent: true, image_base64: shot.split(',')[1], mime: 'image/jpeg', captured_at: new Date().toISOString() } });
      setShot(null); setStage('done'); qc.invalidateQueries({ queryKey: ['me', 'photo-request'] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const decline = async () => {
    setBusy(true); stop();
    try { await request('POST', `/auth/photo-request/${req.id}/decline`); setStage('declined'); qc.invalidateQueries({ queryKey: ['me', 'photo-request'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const close = () => { stop(); setShot(null); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pv-title">
      <motion.button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(16,24,40,0.45)] cursor-default" onClick={() => !busy && close()} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} />
      <motion.div className="relative w-full max-w-[520px] rounded-[var(--radius-l)] bg-[var(--surface)] border border-[color:var(--hairline)] p-6 shadow-[0_30px_80px_-30px_rgba(16,24,40,0.5)]"
        initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="pv-title" className="text-[1.25rem] font-semibold">Verification photograph</h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close" disabled={busy}><X size={16} /></Button>
        </div>
        {stage === 'consent' && (
          <div className="mt-3 space-y-4 text-[0.9375rem]">
            <p className="text-[var(--ink-2)]">Your bank's security team asks for one photograph to help confirm that you are the person using this sign-in. It is <b>optional</b>.</p>
            <ul className="list-disc pl-5 text-[var(--ink-2)] space-y-1">
              <li>Your camera starts only after you press “Open camera” and your browser asks for permission.</li>
              <li>You see the photo before sending it, can retake it, and nothing is sent until you press “Confirm and submit”.</li>
              <li>It is stored as protected evidence for this security check only and seen only by authorised analysts. No facial recognition is used.</li>
            </ul>
            <label className="flex items-start gap-2.5 cursor-pointer"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I consent to taking and sending one verification photograph for this security check.</label>
            {err && <Banner tone="block" title="Camera">{err}</Banner>}
            <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={decline} loading={busy}>Decline</Button><Button disabled={!agree} onClick={start}><Camera size={16} aria-hidden />Open camera</Button></div>
          </div>
        )}
        {stage === 'camera' && (
          <div className="mt-3 space-y-3">
            <video ref={video} playsInline muted className="w-full rounded-[var(--radius-m)] bg-black aspect-[4/3] object-cover -scale-x-100" aria-label="Live camera preview" />
            <p className="text-[0.8125rem] text-[var(--ink-3)]">Live preview — nothing is recorded or sent.</p>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={capture}><Camera size={16} aria-hidden />Capture photo</Button></div>
          </div>
        )}
        {stage === 'review' && shot && (
          <div className="mt-3 space-y-3">
            <img src={shot} alt="Your captured photograph (not sent yet)" className="w-full rounded-[var(--radius-m)] -scale-x-100" />
            {err && <Banner tone="block" title="Not sent">{err}</Banner>}
            <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => { setShot(null); void start(); }} disabled={busy}><RotateCcw size={16} aria-hidden />Retake</Button>
              <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy}><ShieldCheck size={16} aria-hidden />Confirm and submit</Button></div>
          </div>
        )}
        {stage === 'done' && <div className="mt-4 space-y-4"><Banner tone="allow" title="Photograph sent">The security team will review it. The camera is off.</Banner><div className="flex justify-end"><Button onClick={close}>Close</Button></div></div>}
        {stage === 'declined' && <div className="mt-4 space-y-4"><Banner tone="info" title="Request declined">Nothing was captured. The bank may contact you another way.</Banner><div className="flex justify-end"><Button onClick={close}>Close</Button></div></div>}
      </motion.div>
    </div>
  );
}
