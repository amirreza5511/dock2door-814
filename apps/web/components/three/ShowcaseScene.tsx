"use client";

import { useRef, useMemo, Suspense, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment, ContactShadows, Float, Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * Landing "Showcase" 3D diorama: a real generated delivery truck and shipping
 * container arranged on a soft turntable, replacing the old toy-cube scene.
 */

type Axis =
  | "positiveX"
  | "negativeX"
  | "positiveY"
  | "negativeY"
  | "positiveZ"
  | "negativeZ";

export type GeneratedOrientation = {
  hasIntrinsicFront: boolean;
  localFrontAxis: Axis;
  localUpAxis: Axis;
};

const AXIS_VECTORS: Record<Axis, THREE.Vector3> = {
  positiveX: new THREE.Vector3(1, 0, 0),
  negativeX: new THREE.Vector3(-1, 0, 0),
  positiveY: new THREE.Vector3(0, 1, 0),
  negativeY: new THREE.Vector3(0, -1, 0),
  positiveZ: new THREE.Vector3(0, 0, 1),
  negativeZ: new THREE.Vector3(0, 0, -1),
};

function basisQuaternion(front: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = front.clone().normalize();
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}

function orientationCorrection(
  o: GeneratedOrientation,
  desiredWorldForward: THREE.Vector3,
): THREE.Quaternion {
  if (!o.hasIntrinsicFront) return new THREE.Quaternion();
  const localBasis = basisQuaternion(AXIS_VECTORS[o.localFrontAxis], AXIS_VECTORS[o.localUpAxis]);
  const worldBasis = basisQuaternion(desiredWorldForward, new THREE.Vector3(0, 1, 0));
  return worldBasis.multiply(localBasis.invert());
}

function GeneratedProp({
  url,
  orientation,
  targetSize,
  desiredForward,
  position,
}: {
  url: string;
  orientation: GeneratedOrientation;
  targetSize: number;
  desiredForward: THREE.Vector3;
  position: [number, number, number];
}) {
  const gltf = useGLTF(url);

  const object = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    const q = orientationCorrection(orientation, desiredForward);

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    clone.scale.setScalar(targetSize / longest);
    clone.quaternion.premultiply(q);

    const box2 = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box2.min.y;

    return clone;
  }, [gltf.scene, orientation, targetSize, desiredForward]);

  return (
    <group position={position}>
      <primitive object={object} />
    </group>
  );
}

function Turntable({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.28;
  });
  return <group ref={ref}>{children}</group>;
}

function Loader() {
  return (
    <Html center>
      <div className="text-xs font-medium text-white/60">Loading 3D scene…</div>
    </Html>
  );
}

export type ShowcaseSceneProps = {
  truck: { url: string; orientation: GeneratedOrientation };
  container?: { url: string; orientation: GeneratedOrientation } | null;
  className?: string;
};

export default function ShowcaseScene({ truck, container, className }: ShowcaseSceneProps) {
  useEffect(() => {
    useGLTF.preload(truck.url);
    if (container) useGLTF.preload(container.url);
  }, [truck.url, container]);

  return (
    <div className={className}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [7, 4, 8], fov: 36 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[7, 10, 6]}
          intensity={2.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
        />
        <pointLight position={[-7, 3, -5]} intensity={34} color="#2de2c7" distance={26} />
        <pointLight position={[6, 2, 7]} intensity={26} color="#818cf8" distance={26} />
        <Suspense fallback={<Loader />}>
          <Float speed={1.2} rotationIntensity={0.1} floatIntensity={0.4}>
            <Turntable>
              <GeneratedProp
                url={truck.url}
                orientation={truck.orientation}
                targetSize={5}
                desiredForward={new THREE.Vector3(1, 0, 0.35).normalize()}
                position={[-0.6, 0, 0]}
              />
              {container && (
                <GeneratedProp
                  url={container.url}
                  orientation={container.orientation}
                  targetSize={2.6}
                  desiredForward={new THREE.Vector3(1, 0, -0.5).normalize()}
                  position={[3.1, 0, -2.4]}
                />
              )}
            </Turntable>
          </Float>
          <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={20} blur={2.8} far={8} color="#04121a" />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}
