import { useId } from 'react';
import { LOWER_PATH, SHIELD_CORE_PATH, SHIELD_PATH, UPPER_PATH, VIEW } from './geometry';

export type MarkTone = 'light' | 'dark';

/**
 * Synth Core as flat SVG: no WebGL, safe in navigation at any size.
 * `tone="light"` is for porcelain and crystal backgrounds; `tone="dark"` for graphite.
 * Ribbons read as optical glass (dark lensing edge, bright inner caustic); the shield carries the blue-white light.
 */
/** The artwork occupies x 16–48, y 5.4–58 of the 64-unit square. Inline marks are framed tightly around it, so the
 *  visible S aligns with the text column and fills the slot height (optical alignment); `square` keeps the full frame
 *  for app icons and centred hero placements. */
const TIGHT = { x: 13, y: 3, w: 38, h: 58 };

export function SynthMark({ size = 28, tone = 'light', title, className, square = false }: { size?: number; tone?: MarkTone; title?: string; className?: string; square?: boolean }) {
  const id = useId().replace(/:/g, '');
  const detail = size >= 24; // inner highlights only where they resolve
  const edge = tone === 'light' ? ['#3A4A66', '#101828'] : ['#E8EEF7', '#AEB8C8'];
  const caustic = tone === 'light' ? '#FFFFFF' : '#FFFFFF';
  return (
    <svg width={square ? size : Math.round((size * TIGHT.w) / TIGHT.h)} height={size}
      viewBox={square ? `0 0 ${VIEW} ${VIEW}` : `${TIGHT.x} ${TIGHT.y} ${TIGHT.w} ${TIGHT.h}`} className={className}
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`${id}r`} x1="12" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={edge[0]} />
          <stop offset="0.55" stopColor={tone === 'light' ? '#6E7E99' : '#C9D3E2'} />
          <stop offset="1" stopColor={edge[1]} />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="32" cy="29" r="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#9CC0FF" />
          <stop offset="1" stopColor="#005BFF" />
        </radialGradient>
        <radialGradient id={`${id}g`} cx="32" cy="32" r="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B8CFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5B8CFF" stopOpacity="0" />
        </radialGradient>
        {/* the ribbons pass behind the shield: knock them out around its silhouette */}
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW} height={VIEW}>
          <rect width={VIEW} height={VIEW} fill="#fff" />
          <path d={SHIELD_PATH} fill="#000" stroke="#000" strokeWidth="5.5" strokeLinejoin="round" />
        </mask>
      </defs>
      {detail && <circle cx="32" cy="32" r="16" fill={`url(#${id}g)`} />}
      <g mask={`url(#${id}m)`} fill="none" strokeLinecap="round">
        <path d={UPPER_PATH} stroke={`url(#${id}r)`} strokeWidth="6.2" />
        <path d={LOWER_PATH} stroke={`url(#${id}r)`} strokeWidth="6.2" />
        {detail && <>
          <path d={UPPER_PATH} stroke={caustic} strokeOpacity="0.75" strokeWidth="1.5" transform="translate(-0.6 -0.6)" />
          <path d={LOWER_PATH} stroke={caustic} strokeOpacity="0.75" strokeWidth="1.5" transform="translate(-0.6 -0.6)" />
        </>}
      </g>
      <path d={SHIELD_PATH} fill={`url(#${id}s)`} stroke={tone === 'light' ? '#0047CC' : '#9CC0FF'} strokeWidth="1" strokeLinejoin="round" />
      {detail && <path d={SHIELD_CORE_PATH} fill="#FFFFFF" fillOpacity="0.55" />}
    </svg>
  );
}
