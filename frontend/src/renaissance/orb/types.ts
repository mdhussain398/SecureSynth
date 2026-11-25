import type { Decision } from '../../api/types';

/** 0 calm · 1 low · 2 medium (amber) · 3 high (red). Always derived from backend deviations, never invented. */
export type SignalLevel = 0 | 1 | 2 | 3;
export interface OrbSignal { id: string; label: string; level: SignalLevel }
export type OrbState = 'idle' | Decision;

export interface OrbProps {
  signals: OrbSignal[];
  state: OrbState;
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** landing hero: larger, no interaction with signals */
  hero?: boolean;
}

export const STATE_COLOR: Record<OrbState, string> = {
  idle: '#005BFF', ALLOW: '#005BFF', STEP_UP: '#F79009', BLOCK: '#F04438',
};
export const LEVEL_COLOR: Record<SignalLevel, string> = { 0: '#9AA6B8', 1: '#5B8CFF', 2: '#F79009', 3: '#F04438' };

export function webglAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('gl') === '0') return false; // manual fallback check
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Fibonacci sphere: even, deterministic node placement. */
export function spherePoints(n: number, r: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2, rad = Math.sqrt(1 - y * y), t = g * i;
    out.push([Math.cos(t) * rad * r, y * r, Math.sin(t) * rad * r]);
  }
  return out;
}
