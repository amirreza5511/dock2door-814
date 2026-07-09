"use client";

import { useRef, useMemo, Suspense, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment, ContactShadows, Float, Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * Real generated 3D truck model, normalized and slowly rotating on a turntable.
 * The GLB URL + orientation metadata are supplied once the asset finishes generating.
 */

type Axis =
  | "positiveX"
  | "negativeX"
  | "positiveY"
  | "negativeY"
  | "positiveZ"
  | "negativeZ";

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
  localFrontAxis: Axis,
  localUpAxis: Axis,
  desiredWorldForward: THREE.Vector3,
): THREE.Quaternion {
  const localBasis = basisQuaternion(AXIS_VECTORS[localFrontAxis], AXIS_VECTORS[localUpAxis]);
  const worldBasis = basisQuaternion(desiredWorldForward, new THREE.Vector3(0, 1, 0));
  return worldBasis.multiply(localBasis.invert());
}

export type TruckOrientation = {
  hasIntrinsicFront: boolean;
  localFrontAxis: Axis;
  localUpAxis: Axis;
};

function TruckModel({
  url,
  orientation,
  targetSize = 4.4,
}: {
  url: string;
  orientation: TruckOrientation;
  targetSize?: number;
}) {
  const gltf = useGLTF(url);

  const { object, correction } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    const q = orientation.hasIntrinsicFront
      ? orientationCorrection(
          orientation.localFrontAxis,
          orientation.localUpAxis,
          new THREE.Vector3(1, 0, 0.35).normalize(),
        )
      : new THREE.Quaternion();

    // measure, scale to target longest axis, center + ground
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / longest;

    clone.scale.setScalar(scale);
    clone.quaternion.premultiply(q);

    const box2 = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box2.min.y;

    return { object: clone, correction: q };
  }, [gltf.scene, orientation, targetSize]);

  void correction;

  return <primitive object={object} />;
}

function Turntable({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.35;
    void state;
  });
  return <group ref={ref}>{children}</group>;
}

function Loader() {
  return (
    <Html center>
      <div className="text-xs font-medium text-white/60">Loading model…</div>
    </Html>
  );
}

export default function TruckScene({
  url,
  orientation,
  className,
}: {
  url: string;
  orientation: TruckOrientation;
  className?: string;
}) {
  useEffect(() => {
    useGLTF.preload(url);
  }, [url]);

  return (
    <div className={className}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [6, 3.4, 7], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[6, 9, 5]}
          intensity={2.4}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <pointLight position={[-6, 3, -4]} intensity={30} color="#2de2c7" distance={22} />
        <pointLight position={[5, 2, 6]} intensity={22} color="#818cf8" distance={22} />
        <Suspense fallback={<Loader />}>
          <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.5}>
            <Turntable>
              <TruckModel url={url} orientation={orientation} />
            </Turntable>
          </Float>
          <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={16} blur={2.6} far={7} color="#04121a" />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}
