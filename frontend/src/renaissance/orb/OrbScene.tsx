/* WebGL glass identity orb (React Three Fiber + three's physical glass). Lazy-loaded; customers never pay for it
 * unless the orb is on screen. The orb is a visualisation of backend outputs — it is not the ML model. */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LEVEL_COLOR, STATE_COLOR, spherePoints, type OrbProps } from './types';

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { env.dispose(); pmrem.dispose(); scene.environment = null; };
  }, [gl, scene]);
  return null;
}

/* Fresnel rim: light gathers at grazing angles, like the edge of real glass. */
const rimVertex = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const rimFragment = `uniform vec3 uColor; uniform float uPower; uniform float uStrength; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower); gl_FragColor = vec4(uColor, f * uStrength); }`;

function Rim({ color }: { color: string }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: rimVertex, fragmentShader: rimFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 3.6 }, uStrength: { value: 0.42 } },
  }), []);
  useFrame((_, dt) => { (mat.uniforms.uColor.value as THREE.Color).lerp(new THREE.Color(color), Math.min(1, dt * 2.5)); });
  return <mesh renderOrder={4} material={mat}><sphereGeometry args={[1.505, 96, 96]} /></mesh>;
}

/* Soft volumetric-looking glow behind the core, generated procedurally (no image assets). */
function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!; const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
}

function Orb({ signals, state, selected, onSelect, hero, reduce, onReady }: OrbProps & { reduce: boolean; onReady?: () => void }) {
  const announced = useRef(false);
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const edgeMat = useRef<THREE.LineDashedMaterial>(null);
  const target = useMemo(() => new THREE.Color(STATE_COLOR[state]), [state]);
  const glow = useGlowTexture();
  const pts = useMemo(() => spherePoints(Math.max(signals.length, 1), hero ? 0.92 : 0.98), [signals.length, hero]);

  // Each node links to its 3 nearest neighbours; edges touching a deviating signal are "active".
  const { calmGeo, activeGeo } = useMemo(() => {
    const calm: number[] = [], active: number[] = [];
    const seen = new Set<string>();
    pts.forEach((p, i) => {
      const near = pts.map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 }))
        .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 3);
      for (const { j } of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hot = (signals[i]?.level ?? 0) >= 2 || (signals[j]?.level ?? 0) >= 2;
        (hot ? active : calm).push(...p, ...pts[j]);
      }
    });
    const mk = (a: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return g; };
    return { calmGeo: mk(calm), activeGeo: mk(active) };
  }, [pts, signals]);
  const activeLines = useMemo(() => { const l = new THREE.LineSegments(activeGeo); l.computeLineDistances(); return l; }, [activeGeo]);

  const { pointer } = useThree();
  useFrame((st, dt) => {
    const g = group.current;
    if (!g) return;
    if (!announced.current) { announced.current = true; requestAnimationFrame(() => onReady?.()); }
    if (!reduce) {
      g.rotation.y += dt * (hero ? 0.08 : 0.05);
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, pointer.y * 0.25, 2.5, dt);
      g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -pointer.x * 0.12, 2.5, dt);
      if (edgeMat.current) (edgeMat.current as unknown as { dashOffset: number }).dashOffset -= dt * 0.35;
    }
    if (coreMat.current) {
      coreMat.current.emissive.lerp(target, Math.min(1, dt * 2.5));
      const pulse = reduce ? 1 : 1 + Math.sin(st.clock.elapsedTime * (state === 'BLOCK' ? 3 : 1.2)) * 0.08;
      coreMat.current.emissiveIntensity = (state === 'idle' || state === 'ALLOW' ? 2.2 : 3.2) * pulse;
    }
    if (core.current && !reduce) core.current.scale.setScalar(1 + Math.sin(st.clock.elapsedTime * 1.2) * 0.03);
  });

  return (
    <group ref={group}>
      {/* glass shell: thin, clear-coated and reflective (reads as glass on a light page); a faint blue back face adds depth */}
      <mesh renderOrder={1}>
        <sphereGeometry args={[1.5, 128, 128]} />
        <meshPhysicalMaterial side={THREE.BackSide} color="#cfe0ff" transparent opacity={0.22} roughness={0.15} metalness={0}
          envMapIntensity={0.6} depthWrite={false} />
      </mesh>
      <mesh renderOrder={3}>
        <sphereGeometry args={[1.5, 128, 128]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.16} roughness={0.02} metalness={0.05}
          clearcoat={1} clearcoatRoughness={0.02} iridescence={0.7} iridescenceIOR={1.35}
          specularIntensity={1} envMapIntensity={2.2} depthWrite={false} />
      </mesh>
      {/* orbital paths */}
      {[[0.35, 0, 0], [-0.9, 0.4, 0.2], [1.25, -0.3, 0.6]].map((r, i) => (
        <mesh key={i} rotation={r as [number, number, number]}>
          <torusGeometry args={[1.78 + i * 0.09, 0.0035, 8, 220]} />
          <meshStandardMaterial color="#C0C7D1" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <Rim color={STATE_COLOR[state]} />
      <sprite scale={hero ? 2.2 : 1.8} renderOrder={0}>
        <spriteMaterial map={glow} color={STATE_COLOR[state]} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {/* identity core */}
      <mesh ref={core}>
        <icosahedronGeometry args={[hero ? 0.34 : 0.26, 4]} />
        <meshStandardMaterial ref={coreMat} color="#0a1a3a" emissive={STATE_COLOR[state]} emissiveIntensity={2.2} roughness={0.3} />
      </mesh>
      {/* behavioural signal network */}
      <lineSegments geometry={calmGeo}>
        <lineBasicMaterial color="#8FA3C4" transparent opacity={0.45} />
      </lineSegments>
      <primitive object={activeLines}>
        <lineDashedMaterial ref={edgeMat} attach="material" color={STATE_COLOR[state === 'idle' ? 'ALLOW' : state]} dashSize={0.06} gapSize={0.04} transparent opacity={0.95} />
      </primitive>
      {pts.map((p, i) => {
        const s = signals[i];
        if (!s) return null;
        const isSel = selected === s.id;
        return (
          <group key={s.id} position={p}>
            <mesh onClick={hero ? undefined : (e) => { e.stopPropagation(); onSelect?.(s.id); }}
              onPointerOver={hero ? undefined : () => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={hero ? undefined : () => { document.body.style.cursor = ''; }}>
              <sphereGeometry args={[s.level >= 2 ? 0.075 : 0.05, 24, 24]} />
              <meshStandardMaterial color={LEVEL_COLOR[s.level]} emissive={LEVEL_COLOR[s.level]} emissiveIntensity={s.level >= 2 ? 2.4 : 0.6} />
            </mesh>
            {isSel && (
              <mesh>
                <torusGeometry args={[0.13, 0.008, 8, 48]} />
                <meshBasicMaterial color="#101828" />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

export default function OrbScene(props: OrbProps & { reduce: boolean; onReady?: () => void }) {
  return (
    <Canvas dpr={[1, 2]} frameloop={props.reduce ? 'demand' : 'always'} camera={{ position: [0, 0, 5.6], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
      <Environment />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} />
      {/* electric-blue light passing through the glass from behind */}
      <pointLight position={[-1.5, 0.6, -2.5]} intensity={22} distance={9} color="#005BFF" />
      <pointLight position={[2.2, -1.4, -2]} intensity={6} distance={8} color="#9cc0ff" />
      <Orb {...props} />
    </Canvas>
  );
}
