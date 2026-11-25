/* WebGL optical-glass identity sculpture (React Three Fiber + three's physical transmission). Lazy-loaded; only pages
 * that show the orb download it. The orb is a visualisation of backend outputs — it is not the ML model.
 *
 * Optics: a solid glass sphere (real transmission, IOR, dispersion, absorption) refracts what sits inside it (the
 * identity core and the signal inclusions) and a backdrop matched to the page. Reflections come from a procedural
 * studio environment (softbox strips), so edges get crisp highlights instead of a neon rim. No image assets. */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { LEVEL_COLOR, STATE_COLOR, spherePoints, type OrbProps } from './types';

const R = 1.5; // glass radius

/* Studio: a mid-grey room lit by softbox strips and an electric-blue fill from behind. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const env = new THREE.Scene();
    env.background = new THREE.Color('#c3cbd8');
    const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
    const panel = (w: number, h: number, pos: [number, number, number], color: string, k: number) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); owned.push(geo, mat);
    };
    panel(9, 2.4, [0, 6, 1.5], '#ffffff', 6);    // overhead softbox → long top highlight
    panel(1.1, 7, [-6, 0.6, 3.5], '#ffffff', 7.5); // key strip → crisp vertical edge highlight
    panel(0.7, 6, [6, -0.4, 1.5], '#ffffff', 4.5); // rim strip on the right
    panel(7, 7, [-2.5, -0.5, -6], '#005BFF', 3.2); // electric fill behind
    panel(12, 3, [0, -6, 0], '#eef2f8', 1.1);      // floor bounce
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(env, 0.015).texture;
    scene.environment = tex;
    return () => { tex.dispose(); pmrem.dispose(); owned.forEach((o) => o.dispose()); scene.environment = null; };
  }, [gl, scene]);
  return null;
}

/* What the glass refracts: page-matched porcelain with a soft electric glow and faint etched contours. Opaque, so
 * it is part of the transmission pass; the canvas edges are feathered with a CSS mask so it melts into the page. */
function useBackdropTexture() {
  return useMemo(() => {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = '#F2F5F9'; g.fillRect(0, 0, S, S);
    const glow = g.createRadialGradient(S * 0.36, S * 0.62, 0, S * 0.36, S * 0.62, S * 0.36);
    glow.addColorStop(0, 'rgba(0,91,255,0.5)'); glow.addColorStop(0.45, 'rgba(0,91,255,0.14)'); glow.addColorStop(1, 'rgba(0,91,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(16,24,40,0.09)'; g.lineWidth = 1.1;
    for (let i = 1; i <= 9; i++) {
      g.beginPath();
      g.ellipse(S * 0.62 - i * 6, S * 0.36 + i * 5, i * 17, i * 12, 0.5, 0, Math.PI * 2);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
}

function Sculpture({ signals, state, selected, onSelect, hero, reduce, onReady }: OrbProps & { reduce: boolean; onReady?: () => void }) {
  const announced = useRef(false);
  const inner = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const haloMat = useRef<THREE.SpriteMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState<string | null>(null);
  const target = useMemo(() => new THREE.Color(STATE_COLOR[state]), [state]);
  const backdrop = useBackdropTexture();
  const glowTex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!; const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  // Inclusions sit inside the glass, so the sphere refracts and magnifies them.
  const pts = useMemo(() => spherePoints(Math.max(signals.length, 1), hero ? 0.9 : 0.72), [signals.length, hero]);
  // A hairline of light runs from each deviating signal into the identity core: "this signal fed the decision".
  const conduits = useMemo(() => {
    const a: number[] = [];
    pts.forEach((p, i) => { if ((signals[i]?.level ?? 0) >= 2) a.push(...p, 0, 0, 0); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return geo;
  }, [pts, signals]);
  const selIdx = signals.findIndex((s) => s.id === selected);

  const { pointer, camera } = useThree();
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame((st, dt) => {
    if (!announced.current) { announced.current = true; requestAnimationFrame(() => onReady?.()); }
    const t = st.clock.elapsedTime;
    if (!reduce) {
      if (inner.current) inner.current.rotation.y += dt * (hero ? 0.05 : 0.035);
      if (tilt.current) {
        tilt.current.rotation.x = THREE.MathUtils.damp(tilt.current.rotation.x, -pointer.y * 0.16, 1.6, dt);
        tilt.current.rotation.y = THREE.MathUtils.damp(tilt.current.rotation.y, pointer.x * 0.22, 1.6, dt);
      }
    }
    if (coreMat.current) {
      coreMat.current.emissive.lerp(target, Math.min(1, dt * 2));
      const fast = state === 'BLOCK';
      const breathe = reduce ? 1 : 1 + Math.sin(t * (fast ? 2.4 : 0.9)) * (fast ? 0.1 : 0.06);
      coreMat.current.emissiveIntensity = (state === 'idle' || state === 'ALLOW' ? 2.2 : 2.8) * breathe;
    }
    if (haloMat.current) haloMat.current.color.lerp(target, Math.min(1, dt * 2));
    // The selection ring always faces the viewer, whatever the inner rotation.
    if (ring.current?.parent) {
      ring.current.parent.getWorldQuaternion(q).invert().multiply(camera.quaternion);
      ring.current.quaternion.copy(q);
    }
  });

  return (
    <>
      <mesh position={[0, 0, -2.4]}>
        <planeGeometry args={[7.5, 7.5]} />
        <meshBasicMaterial map={backdrop} toneMapped={false} />
      </mesh>
      <group ref={tilt}>
        {/* solid optical glass */}
        <mesh renderOrder={2}>
          <sphereGeometry args={[R, 160, 160]} />
          <meshPhysicalMaterial color="#ffffff" transmission={1} thickness={1.25} ior={1.32} dispersion={0.35}
            roughness={0.035} attenuationColor="#e6eeff" attenuationDistance={9}
            clearcoat={1} clearcoatRoughness={0.02} specularIntensity={1} envMapIntensity={1.15} />
        </mesh>
        <group ref={inner}>
          {/* identity core: restrained internal light, coloured by the backend decision */}
          <mesh>
            <sphereGeometry args={[hero ? 0.15 : 0.13, 64, 64]} />
            <meshStandardMaterial ref={coreMat} color="#0b1730" emissive={STATE_COLOR[state]} emissiveIntensity={1.5} roughness={0.25} metalness={0.1} />
          </mesh>
          <lineSegments geometry={conduits}>
            <lineBasicMaterial color={STATE_COLOR[state === 'idle' ? 'ALLOW' : state]} />
          </lineSegments>
          {pts.map((p, i) => {
            const s = signals[i];
            if (!s) return null;
            const hot = s.level >= 2;
            const big = hover === s.id || selected === s.id;
            return (
              <group key={s.id} position={p}>
                <mesh scale={big ? 1.35 : 1}>
                  <sphereGeometry args={[hot ? 0.058 : s.level === 1 ? 0.042 : 0.032, 24, 24]} />
                  <meshStandardMaterial color={LEVEL_COLOR[s.level]} emissive={LEVEL_COLOR[s.level]}
                    emissiveIntensity={hot ? 1.8 : s.level === 1 ? 0.8 : 0.35} roughness={0.3} metalness={0} />
                </mesh>
                {!hero && (
                  /* generous invisible hit target */
                  <mesh visible={false} onClick={(e) => { e.stopPropagation(); onSelect?.(s.id); }}
                    onPointerOver={(e) => { e.stopPropagation(); setHover(s.id); document.body.style.cursor = 'pointer'; }}
                    onPointerOut={() => { setHover((h) => (h === s.id ? null : h)); document.body.style.cursor = ''; }}>
                    <sphereGeometry args={[0.16, 8, 8]} />
                  </mesh>
                )}
                {i === selIdx && (
                  <mesh ref={ring}>
                    <torusGeometry args={[0.12, 0.005, 8, 64]} />
                    <meshBasicMaterial color="#101828" />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
        {/* soft internal halo, drawn over the glass so it reads as light inside it */}
        <sprite scale={hero ? 1.1 : 0.95} renderOrder={5}>
          <spriteMaterial ref={haloMat} map={glowTex} color={STATE_COLOR[state]} transparent opacity={0.28} depthTest={false} depthWrite={false} />
        </sprite>
      </group>
    </>
  );
}

export default function OrbScene(props: OrbProps & { reduce: boolean; onReady?: () => void }) {
  // Feather the square canvas into the page: the sculpture (radius ≈ 74% of half-width) stays fully opaque.
  const mask = 'radial-gradient(closest-side, #000 79%, transparent 99%)';
  return (
    <Canvas dpr={[1, 2]} frameloop={props.reduce ? 'demand' : 'always'} camera={{ position: [0, 0, 6.2], fov: 36 }}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1.0; }}>
      <StudioEnvironment />
      <ambientLight intensity={0.25} />
      <directionalLight position={[-3, 4, 5]} intensity={1.2} />
      <Sculpture {...props} />
    </Canvas>
  );
}
