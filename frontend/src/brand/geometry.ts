/* Synth Core: one geometry for every logo variant (SVG nav mark, static exports, the WebGL sculpture).
 *
 * Two optical ribbons form an S. Each ribbon is a 250° arc of radius 13 in a 64-unit box; they meet at the centre,
 * where the luminous shield floats in front of them. The SVG masks the ribbons out around the shield; the 3D version
 * dips them behind it. */

export const VIEW = 64;
export const C = 32;
export const ARC_R = 13;
/** Upper ribbon: from the upper-right terminal, over the top, down to the centre (counter-clockwise on screen). */
export const UPPER_PATH = 'M44.2 14.55 A13 13 0 1 0 32 32';
/** Lower ribbon: from the centre, round the right side and bottom, to the lower-left terminal (clockwise on screen). */
export const LOWER_PATH = 'M32 32 A13 13 0 1 1 19.8 49.45';
/** Heater shield centred on (32, 32). */
export const SHIELD_PATH = 'M32 22.2 L40.6 25.4 V31.2 C40.6 36.6 37 40.6 32 42.6 C27 40.6 23.4 36.6 23.4 31.2 V25.4 Z';
/** Inner facet of the shield: the bright core. */
export const SHIELD_CORE_PATH = 'M32 25.6 L37.4 27.6 V31.4 C37.4 34.9 35.1 37.6 32 39 C28.9 37.6 26.6 34.9 26.6 31.4 V27.6 Z';

/** Sample a ribbon in SVG space (y down). Angles in visual degrees (y up), stepping from a0 to a1. */
function arc(cx: number, cy: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + ARC_R * Math.cos(a), cy - ARC_R * Math.sin(a)]);
  }
  return out;
}
/** Upper ribbon samples: 20° → 270° (counter-clockwise). */
export const upperSamples = (n = 64) => arc(C, C - ARC_R, 20, 270, n);
/** Lower ribbon samples: 90° → −160° (clockwise). */
export const lowerSamples = (n = 64) => arc(C, C + ARC_R, 90, -160, n);

/** Shield outline as polygon points in SVG space, for the 3D extrusion. */
export function shieldOutline(): [number, number][] {
  const pts: [number, number][] = [[32, 22.2], [40.6, 25.4], [40.6, 31.2]];
  const bez = (p0: number[], p1: number[], p2: number[], p3: number[]) => {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  };
  bez([40.6, 31.2], [40.6, 36.6], [37, 40.6], [32, 42.6]);
  bez([32, 42.6], [27, 40.6], [23.4, 36.6], [23.4, 31.2]);
  pts.push([23.4, 25.4]);
  return pts;
}

export const BRAND = {
  electric: '#005BFF',
  electricSoft: '#5B8CFF',
  core: '#EAF2FF',
  graphite: '#101828',
  silver: '#C0C7D1',
  porcelain: '#F5F7FA',
} as const;
