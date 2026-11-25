/* Synth Core in WebGL (React Three Fiber). Lazy-loaded; only the brand hero downloads it.
 *
 * Two optical-glass ribbons (real transmission, IOR, dispersion) form the S and dip behind a luminous blue-white
 * shield that turns once every ten seconds. On hover the ribbons are polished into silver: transmission falls away
 * and metalness rises, damped so the change reads as a material transformation rather than a switch.
 * Reflections come from the same procedural studio as the identity orb; no image assets. */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { StudioEnvironment } from '../renaissance/orb/OrbScene';
import { lowerSamples, shieldOutline, upperSamples } from './geometry';

const S = 3 / 52;                // SVG units → world units (the S is about 3 units tall)
const TUBE = 2.75 * S;           // ribbon half-width in the plane of the S
const FLAT = 0.66;               // ribbon depth relative to its width: a band, not a pipe
const TURN = (Math.PI * 2) / 10; // shield: one turn every 10 s

export interface SynthCoreSceneProps {
  metal: boolean;
  reduce: boolean;
  active: boolean;
  onReady?: () => void;
  onFps?: (fps: number) => void;
  /** Longest canvas side in device pixels. Transmission is fill-rate bound; this keeps large heroes at 60 FPS. */
  maxPixels?: number;
  /** Static export: no motion, shield held in a three-quarter pose. */
  still?: boolean;
}

const toWorld = ([x, y]: [number, number], z: number) => new THREE.Vector3((x - 32) * S, -(y - 32) * S, z / FLAT);

/** One ribbon: samples dip behind the shield near the centre; `lift` tilts the terminal forward or back (the weave). */
function ribbonCurve(samples: [number, number][], lift: number) {
  const n = samples.length - 1;
  const pts = samples.map((p, i) => {
    const d = Math.hypot(p[0] - 32, p[1] - 32);
    const dip = -0.42 * Math.exp(-((d / 8) ** 2));
    const weave = lift * Math.sin((i / n) * Math.PI) * 0.5;
    return toWorld(p, dip + weave);
  });
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

function useBackdrop() {
  return useMemo(() => {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d')!;
    g.fillStyle = '#F2F5F9'; g.fillRect(0, 0, N, N);
    const glow = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.4);
    glow.addColorStop(0, 'rgba(0,91,255,0.42)'); glow.addColorStop(0.5, 'rgba(0,91,255,0.12)'); glow.addColorStop(1, 'rgba(0,91,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, N, N);
    g.strokeStyle = 'rgba(16,24,40,0.08)'; g.lineWidth = 1.1;
    for (let i = 1; i <= 10; i++) { g.beginPath(); g.ellipse(N * 0.5 + i * 2, N * 0.5 - i * 1.5, i * 22, i * 18, 0.4, 0, Math.PI * 2); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
}

function useGlow() {
  return useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!; const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.28, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
}

const GLASS = new THREE.Color('#ffffff');
const SILVER = new THREE.Color('#d7dce3');

function Sculpture({ metal, reduce: reduceMotion, still, onReady, onFps }: SynthCoreSceneProps) {
  const reduce = reduceMotion || !!still;
  const announced = useRef(false);
  const tilt = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Group>(null);
  // One material for both ribbons and their end caps, so the hover polishes the whole S at once.
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#ffffff', transmission: 1, thickness: 1.1, ior: 1.5, dispersion: 0.5, roughness: 0.02,
    attenuationColor: new THREE.Color('#CDE6FF'), attenuationDistance: 5, clearcoat: 1, clearcoatRoughness: 0.02,
    specularIntensity: 1, envMapIntensity: 2.3, iridescence: 0.25, iridescenceIOR: 1.3,
  }), []);
  const mix = useRef(0);
  const fps = useRef({ frames: 0, since: 0 });
  const backdrop = useBackdrop();
  const glow = useGlow();

  const { upper, lower, caps } = useMemo(() => {
    const u = ribbonCurve(upperSamples(72), 1), l = ribbonCurve(lowerSamples(72), -1);
    return {
      upper: new THREE.TubeGeometry(u, 220, TUBE, 28, false),
      lower: new THREE.TubeGeometry(l, 220, TUBE, 28, false),
      caps: [u.getPoint(0), u.getPoint(1), l.getPoint(0), l.getPoint(1)],
    };
  }, []);
  const shieldGeo = useMemo(() => {
    const shape = new THREE.Shape(shieldOutline().map(([x, y]) => new THREE.Vector2((x - 32) * S, -(y - 32) * S)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 24 });
    g.center(); return g;
  }, []);
  const coreGeo = useMemo(() => {
    const pts = shieldOutline().map(([x, y]) => new THREE.Vector2((x - 32) * S * 0.56, -(y - 32) * S * 0.56));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.2, bevelEnabled: false }); g.center(); return g;
  }, []);

  const { pointer, invalidate } = useThree();
  // On-demand rendering (reduced motion) still has to show the hover change: request a frame when it flips.
  useEffect(() => { invalidate(); }, [metal, invalidate]);
  useFrame((st, dt) => {
    if (!announced.current) { announced.current = true; requestAnimationFrame(() => onReady?.()); }
    // FPS: frames counted over one-second windows of wall-clock time
    const f = fps.current; f.frames++;
    const now = performance.now();
    if (!f.since) f.since = now;
    else if (now - f.since >= 1000) { onFps?.((f.frames * 1000) / (now - f.since)); f.frames = 0; f.since = now; }

    const t = st.clock.elapsedTime;
    mix.current = reduce ? (metal ? 1 : 0) : THREE.MathUtils.damp(mix.current, metal ? 1 : 0, 3.2, dt);
    const m = mix.current, g = glass;
    {
      g.transmission = 1 - 0.97 * m;
      g.metalness = m;
      g.roughness = 0.035 + 0.11 * m;
      g.envMapIntensity = 2.3 + 0.2 * m;
      g.iridescence = 0.25 * (1 - m);
      g.color.copy(GLASS).lerp(SILVER, m);
    }
    if (!reduce) {
      if (shield.current) {
        shield.current.rotation.y += dt * TURN;
        shield.current.position.y = Math.sin(t * 0.7) * 0.035; // restrained float
      }
      if (tilt.current) {
        tilt.current.rotation.x = THREE.MathUtils.damp(tilt.current.rotation.x, -pointer.y * 0.14 + Math.sin(t * 0.45) * 0.03, 1.8, dt);
        tilt.current.rotation.y = THREE.MathUtils.damp(tilt.current.rotation.y, pointer.x * 0.2, 1.8, dt);
      }
    }
  });

  return (
    <>
      <mesh position={[0, 0, -2.2]}>
        <planeGeometry args={[7, 7]} />
        <meshBasicMaterial map={backdrop} toneMapped={false} />
      </mesh>
      <group ref={tilt}>
        <group scale={[1, 1, FLAT]}>
          {[upper, lower].map((geo, i) => <mesh key={i} geometry={geo} material={glass} renderOrder={2} />)}
          {caps.map((p, i) => (
            <mesh key={i} position={p} material={glass} renderOrder={2}>
              <sphereGeometry args={[TUBE, 28, 20]} />
            </mesh>
          ))}
        </group>
        {/* the shield: bright core inside a blue-white crystal body */}
        <sprite scale={2.3} renderOrder={1}>
          <spriteMaterial map={glow} color="#6FB2FF" transparent opacity={0.5} depthWrite={false} />
        </sprite>
        <pointLight color="#4FA8FF" intensity={3.2} distance={3.2} decay={1.6} />
        <group ref={shield} position={[0, 0, 0.12]} rotation={[0, still ? -0.38 : 0, 0]}>
          <mesh geometry={shieldGeo}>
            <meshPhysicalMaterial color="#E8F5FF" emissive="#1C8CFF" emissiveIntensity={0.42} roughness={0.08}
              metalness={0} clearcoat={1} clearcoatRoughness={0.04} envMapIntensity={1.3} />
          </mesh>
          <mesh geometry={coreGeo}>
            <meshStandardMaterial color="#ffffff" emissive="#F2F7FF" emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </>
  );
}

export default function SynthCoreScene(props: SynthCoreSceneProps) {
  // Adaptive pixel ratio: never above 1.75 and never more than `maxPixels` device pixels across.
  const box = useRef<HTMLDivElement>(null);
  const [dpr, setDpr] = useState(1);
  const maxPixels = props.maxPixels ?? 1100;
  useEffect(() => {
    const n = box.current; if (!n) return;
    const fit = () => setDpr(Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.75, maxPixels / Math.max(n.clientWidth, 1))));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(n);
    return () => ro.disconnect();
  }, [maxPixels]);
  const mask = 'radial-gradient(closest-side, #000 72%, transparent 99%)';
  return (
    <div ref={box} className="h-full w-full">
    <Canvas dpr={dpr} frameloop={props.reduce || props.still ? 'demand' : props.active ? 'always' : 'never'}
      camera={{ position: [0, 0, 6], fov: 34 }} style={{ maskImage: mask, WebkitMaskImage: mask }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1 }}>
      <StudioEnvironment />
      <ambientLight intensity={0.3} />
      <directionalLight position={[-3, 4, 5]} intensity={1.1} />
      <Sculpture {...props} />
    </Canvas>
    </div>
  );
}
