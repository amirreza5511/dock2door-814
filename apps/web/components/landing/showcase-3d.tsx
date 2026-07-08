"use client";

import { useEffect, useRef, useState } from "react";
import { Package, Truck, Warehouse, Users, Ship, ClipboardCheck } from "lucide-react";

type Face = {
  icon: typeof Truck;
  label: string;
  transform: string;
};

const CUBE_FACES: Face[] = [
  { icon: Truck, label: "Trucking", transform: "rotateY(0deg) translateZ(110px)" },
  { icon: Warehouse, label: "Warehouse", transform: "rotateY(90deg) translateZ(110px)" },
  { icon: Ship, label: "Drayage", transform: "rotateY(180deg) translateZ(110px)" },
  { icon: Users, label: "Labour", transform: "rotateY(-90deg) translateZ(110px)" },
  { icon: Package, label: "Fulfillment", transform: "rotateX(90deg) translateZ(110px)" },
  { icon: ClipboardCheck, label: "Orders", transform: "rotateX(-90deg) translateZ(110px)" },
];

/** Interactive drag-to-rotate 3D cube representing the connected supply chain. */
export function Showcase3D() {
  const [rot, setRot] = useState<{ x: number; y: number }>({ x: -18, y: 24 });
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoRef = useRef<number>(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const tick = () => {
      if (!dragging.current) {
        setRot((r) => ({ ...r, y: r.y + 0.25 }));
      }
      autoRef.current = window.requestAnimationFrame(tick);
    };
    autoRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(autoRef.current);
  }, []);

  const onDown = (clientX: number, clientY: number) => {
    dragging.current = true;
    last.current = { x: clientX, y: clientY };
  };
  const onMove = (clientX: number, clientY: number) => {
    if (!dragging.current) return;
    const dx = clientX - last.current.x;
    const dy = clientY - last.current.y;
    last.current = { x: clientX, y: clientY };
    setRot((r) => ({ x: Math.max(-80, Math.min(80, r.x - dy * 0.4)), y: r.y + dx * 0.4 }));
  };
  const onUp = () => {
    dragging.current = false;
  };

  return (
    <section className="relative overflow-hidden bg-[#04121a] py-24">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(45,226,199,0.18), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            One connected network
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            Every side of the supply chain,{" "}
            <span className="gradient-text">on one platform.</span>
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60">
            Warehousing, drayage, trucking, fulfillment and on-demand labour all talk to
            each other in real time. Drag the cube to explore the modules — the same ones you
            get in the mobile app.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-3">
            {CUBE_FACES.map((f) => {
              const Icon = f.icon;
              return (
                <li
                  key={f.label}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7]/20 to-[#818cf8]/20 text-[#2de2c7]">
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className="text-sm font-medium text-white/85">{f.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          className="flex min-h-[360px] cursor-grab items-center justify-center active:cursor-grabbing [perspective:1100px]"
          onMouseDown={(e) => onDown(e.clientX, e.clientY)}
          onMouseMove={(e) => onMove(e.clientX, e.clientY)}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onTouchStart={(e) => onDown(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={onUp}
        >
          <div
            className="relative h-[220px] w-[220px] [transform-style:preserve-3d]"
            style={{ transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}
          >
            {CUBE_FACES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.label}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border border-[#2de2c7]/30 bg-[#0a2230]/70 backdrop-blur-sm"
                  style={{
                    transform: f.transform,
                    boxShadow: "inset 0 0 60px rgba(45,226,199,0.12), 0 0 40px -10px rgba(45,226,199,0.4)",
                  }}
                >
                  <Icon size={46} strokeWidth={1.6} className="text-[#2de2c7]" />
                  <span className="font-display text-base font-semibold text-white">{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
