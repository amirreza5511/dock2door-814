"use client";

import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, ContactShadows, RoundedBox, Html } from "@react-three/drei";
import * as THREE from "three";

/* --------------------------------------------------------------------- */
/* Palette — bright, saturated logistics look                            */
/* --------------------------------------------------------------------- */
const C = {
  teal: "#2de2c7",
  tealDeep: "#12b8a0",
  violet: "#818cf8",
  amber: "#fbbf24",
  coral: "#fb7185",
  sky: "#38bdf8",
  slate: "#475569",
  containerA: "#0ea5e9",
  containerB: "#f97316",
  containerC: "#22c55e",
  containerD: "#e11d48",
};

/* --------------------------------------------------------------------- */
/* A single shipping container                                           */
/* --------------------------------------------------------------------- */
function Container({
  position,
  color,
  rotation = 0,
}: {
  position: [number, number, number];
  color: string;
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <RoundedBox args={[2.1, 1, 1]} radius={0.06} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.45} />
      </RoundedBox>
      {/* ridges */}
      {[-0.7, -0.35, 0, 0.35, 0.7].map((x) => (
        <mesh key={x} position={[x, 0, 0.505]}>
          <boxGeometry args={[0.06, 0.9, 0.02]} />
          <meshStandardMaterial color="#000" opacity={0.12} transparent />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------- */
/* Stylized delivery truck driving in a circle                           */
/* --------------------------------------------------------------------- */
function Truck({ radius, speed, offset, color }: { radius: number; speed: number; offset: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed + offset;
    const g = ref.current;
    if (!g) return;
    g.position.x = Math.cos(t) * radius;
    g.position.z = Math.sin(t) * radius;
    g.rotation.y = -t + Math.PI / 2;
  });
  return (
    <group ref={ref} position={[radius, 0.42, 0]}>
      {/* trailer */}
      <RoundedBox args={[1.7, 0.85, 0.85]} radius={0.08} smoothness={3} position={[-0.55, 0.1, 0]} castShadow>
        <meshStandardMaterial color="#f8fafc" metalness={0.2} roughness={0.5} />
      </RoundedBox>
      {/* cab */}
      <RoundedBox args={[0.7, 0.7, 0.82]} radius={0.1} smoothness={3} position={[0.75, 0, 0]} castShadow>
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.3} />
      </RoundedBox>
      {/* windshield */}
      <mesh position={[1.05, 0.12, 0]}>
        <boxGeometry args={[0.06, 0.32, 0.6]} />
        <meshStandardMaterial color={C.sky} metalness={0.9} roughness={0.1} emissive={C.sky} emissiveIntensity={0.2} />
      </mesh>
      {/* wheels */}
      {[[-1, -0.42, 0.45], [-1, -0.42, -0.45], [0.75, -0.42, 0.45], [0.75, -0.42, -0.45], [0, -0.42, 0.45], [0, -0.42, -0.45]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.12, 16]} />
          <meshStandardMaterial color="#111827" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------- */
/* Warehouse building at the center                                      */
/* --------------------------------------------------------------------- */
function Warehouse() {
  return (
    <group position={[0, 0, 0]}>
      <RoundedBox args={[3.4, 1.8, 2.6]} radius={0.1} smoothness={3} position={[0, 0.9, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e2e8f0" metalness={0.2} roughness={0.6} />
      </RoundedBox>
      {/* roof strip */}
      <mesh position={[0, 1.82, 0]}>
        <boxGeometry args={[3.5, 0.1, 2.7]} />
        <meshStandardMaterial color={C.teal} emissive={C.teal} emissiveIntensity={0.5} metalness={0.5} roughness={0.3} />
      </mesh>
      {/* dock doors */}
      {[-1, 0, 1].map((x) => (
        <mesh key={x} position={[x, 0.55, 1.31]}>
          <boxGeometry args={[0.8, 1, 0.04]} />
          <meshStandardMaterial color={C.slate} metalness={0.3} roughness={0.6} />
        </mesh>
      ))}
      {/* glowing sign */}
      <mesh position={[0, 1.35, 1.32]}>
        <boxGeometry args={[1.6, 0.32, 0.05]} />
        <meshStandardMaterial color={C.violet} emissive={C.violet} emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

/* --------------------------------------------------------------------- */
/* Floating package with subtle bob                                      */
/* --------------------------------------------------------------------- */
function Package({ position, color, scale = 1 }: { position: [number, number, number]; color: string; scale?: number }) {
  return (
    <Float speed={2} rotationIntensity={1.2} floatIntensity={1.4}>
      <RoundedBox args={[0.6 * scale, 0.6 * scale, 0.6 * scale]} radius={0.08} smoothness={3} position={position} castShadow>
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} emissive={color} emissiveIntensity={0.12} />
      </RoundedBox>
    </Float>
  );
}

/* --------------------------------------------------------------------- */
/* Orbiting delivery drone carrying a package                            */
/* --------------------------------------------------------------------- */
function Drone({ radius, height, speed }: { radius: number; height: number; speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed;
    const g = ref.current;
    if (!g) return;
    g.position.x = Math.cos(t) * radius;
    g.position.z = Math.sin(t) * radius;
    g.position.y = height + Math.sin(t * 3) * 0.15;
    g.rotation.y = -t;
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[0.5, 0.14, 0.5]} />
        <meshStandardMaterial color={C.teal} metalness={0.6} roughness={0.3} emissive={C.teal} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, -0.18, 0]}>
        <boxGeometry args={[0.24, 0.24, 0.24]} />
        <meshStandardMaterial color={C.amber} />
      </mesh>
    </group>
  );
}

/* --------------------------------------------------------------------- */
/* The whole rotating rig                                                */
/* --------------------------------------------------------------------- */
function Rig() {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.35;
  });

  const containers = useMemo(
    () => [
      { p: [-3.4, 0.5, 2.2], c: C.containerA, r: 0.3 },
      { p: [-3.4, 1.5, 2.2], c: C.containerB, r: 0.3 },
      { p: [3.3, 0.5, -2.4], c: C.containerC, r: -0.4 },
      { p: [3.3, 1.5, -2.4], c: C.containerD, r: -0.4 },
      { p: [3.5, 0.5, 2.6], c: C.containerB, r: 0.5 },
      { p: [-3.6, 0.5, -2.0], c: C.containerC, r: -0.2 },
    ],
    []
  );

  return (
    <group ref={ref}>
      <Warehouse />
      {containers.map((c, i) => (
        <Container key={i} position={c.p as [number, number, number]} color={c.c} rotation={c.r} />
      ))}
      <Truck radius={5} speed={0.4} offset={0} color={C.teal} />
      <Truck radius={5.8} speed={-0.32} offset={2} color={C.coral} />
      <Drone radius={3.6} height={3.2} speed={0.6} />
      <Package position={[-2, 2.8, -1]} color={C.amber} />
      <Package position={[2.2, 3.1, 1.4]} color={C.violet} scale={0.8} />
      <Package position={[0.4, 3.6, -2]} color={C.teal} scale={0.9} />
      <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={18} blur={2.4} far={6} color="#0b1e3a" />
    </group>
  );
}

function SceneLoader() {
  return (
    <Html center>
      <div className="text-xs font-medium text-white/60">Loading 3D scene…</div>
    </Html>
  );
}

export default function LogisticsScene({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas
        shadows
        dpr={[1, 1.8]}
        camera={{ position: [8, 6, 9], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#071a2e"]} />
        <fog attach="fog" args={["#0a2038", 14, 30]} />
        <hemisphereLight args={["#bde9ff", "#0a1f33", 1.1]} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[6, 10, 6]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          color="#ffffff"
        />
        <pointLight position={[-6, 4, -4]} intensity={40} color={C.teal} distance={20} />
        <pointLight position={[6, 3, 6]} intensity={30} color={C.violet} distance={20} />
        <Suspense fallback={<SceneLoader />}>
          <Rig />
        </Suspense>
      </Canvas>
    </div>
  );
}
