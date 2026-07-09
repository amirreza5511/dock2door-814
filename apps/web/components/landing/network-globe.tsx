"use client";

import { useEffect, useRef } from "react";
import { Globe2, Radio, Route } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";

type Vec3 = { x: number; y: number; z: number };

/** Points roughly on a sphere representing major trade hubs. */
const HUBS: { lat: number; lon: number }[] = [
  { lat: 40, lon: -74 }, // New York
  { lat: 34, lon: -118 }, // LA
  { lat: 51, lon: 0 }, // London
  { lat: 1, lon: 104 }, // Singapore
  { lat: 31, lon: 121 }, // Shanghai
  { lat: 25, lon: 55 }, // Dubai
  { lat: -34, lon: 151 }, // Sydney
  { lat: 19, lon: 73 }, // Mumbai
  { lat: -23, lon: -46 }, // São Paulo
  { lat: 35, lon: 139 }, // Tokyo
  { lat: 52, lon: 13 }, // Berlin
  { lat: -26, lon: 28 }, // Johannesburg
  { lat: 30, lon: -95 }, // Houston
  { lat: 22, lon: 114 }, // Hong Kong
];

const ROUTES: [number, number][] = [
  [0, 2],
  [1, 4],
  [2, 3],
  [3, 4],
  [5, 2],
  [7, 5],
  [9, 4],
  [8, 0],
  [12, 1],
  [6, 3],
  [10, 2],
  [11, 5],
  [13, 3],
  [0, 5],
];

function toSphere(lat: number, lon: number, r: number): Vec3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return {
    x: -r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

/** A unique canvas-rendered rotating 3D globe of live trade routes. */
export function NetworkGlobe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let angle = 0;
    let dpr = 1;
    let size = 0;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      size = canvas.clientWidth;
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rotY = (v: Vec3, a: number): Vec3 => ({
      x: v.x * Math.cos(a) + v.z * Math.sin(a),
      y: v.y,
      z: -v.x * Math.sin(a) + v.z * Math.cos(a),
    });

    const project = (v: Vec3, cx: number, cy: number) => {
      const perspective = 620 / (620 + v.z);
      return { sx: cx + v.x * perspective, sy: cy - v.y * perspective, scale: perspective, z: v.z };
    };

    const draw = () => {
      const cx = size / 2;
      const cy = size / 2;
      const r = size * 0.34;
      ctx.clearRect(0, 0, size, size);

      // globe wireframe (latitude / longitude arcs)
      ctx.lineWidth = 1;
      for (let latI = -60; latI <= 60; latI += 30) {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = project(rotY(toSphere(latI, lon, r), angle), cx, cy);
          if (lon === -180) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.strokeStyle = "rgba(45,226,199,0.10)";
        ctx.stroke();
      }
      for (let lonI = -180; lonI < 180; lonI += 30) {
        ctx.beginPath();
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = project(rotY(toSphere(lat, lonI, r), angle), cx, cy);
          if (lat === -90) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.strokeStyle = "rgba(129,140,248,0.08)";
        ctx.stroke();
      }

      // routes as arcs that lift off the surface
      for (const [a, b] of ROUTES) {
        const va = rotY(toSphere(HUBS[a].lat, HUBS[a].lon, r), angle);
        const vb = rotY(toSphere(HUBS[b].lat, HUBS[b].lon, r), angle);
        const steps = 24;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const lift = 1 + Math.sin(Math.PI * t) * 0.22;
          const mid: Vec3 = {
            x: (va.x + (vb.x - va.x) * t) * lift,
            y: (va.y + (vb.y - va.y) * t) * lift,
            z: (va.z + (vb.z - va.z) * t) * lift,
          };
          const p = project(mid, cx, cy);
          if (i === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.strokeStyle = "rgba(45,226,199,0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // moving shipment dot along the arc
        const t = (angle * 0.5 + a * 0.13 + b * 0.07) % 1;
        const lift = 1 + Math.sin(Math.PI * t) * 0.22;
        const mv: Vec3 = {
          x: (va.x + (vb.x - va.x) * t) * lift,
          y: (va.y + (vb.y - va.y) * t) * lift,
          z: (va.z + (vb.z - va.z) * t) * lift,
        };
        const mp = project(mv, cx, cy);
        ctx.fillStyle = "rgba(167,139,250,0.95)";
        ctx.shadowColor = "rgba(167,139,250,0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(mp.sx, mp.sy, 2.2 * mp.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // hub nodes
      for (const h of HUBS) {
        const p = project(rotY(toSphere(h.lat, h.lon, r), angle), cx, cy);
        const front = p.z > -r * 0.2;
        ctx.fillStyle = front ? "rgba(45,226,199,0.95)" : "rgba(45,226,199,0.28)";
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, (front ? 3 : 1.8) * p.scale, 0, Math.PI * 2);
        ctx.fill();
        if (front) {
          ctx.strokeStyle = "rgba(45,226,199,0.3)";
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, 6 * p.scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (!reduceMotion) angle += 0.0026;
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const FEATURES = [
    { icon: Globe2, title: "Global reach", body: "One network spanning 48 countries and every major port, lane and hub." },
    { icon: Route, title: "Smart routing", body: "Freight is matched to the fastest, cheapest lane in real time." },
    { icon: Radio, title: "Live telemetry", body: "Every container, truck and shift streams status to one console." },
  ];

  return (
    <section className="relative overflow-hidden py-24">
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-2">
        <div className="relative order-2 lg:order-1">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
              Live global network
            </span>
            <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
              Your freight, moving on a{" "}
              <span className="gradient-text">living map.</span>
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60">
              Watch shipments travel between hubs in real time. Dock2Door connects every
              node of the supply chain into one continuously updating network.
            </p>
          </Reveal>
          <div className="mt-8 space-y-3">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <Reveal
                  key={f.title}
                  delay={i * 90}
                  className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] text-[#04121a]">
                    <Icon size={20} strokeWidth={2.2} />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold text-white">{f.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/55">{f.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>

        <div className="relative order-1 flex items-center justify-center lg:order-2">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(45,226,199,0.20), transparent 70%)" }}
            aria-hidden
          />
          <canvas
            ref={canvasRef}
            className="relative aspect-square w-full max-w-[460px]"
            aria-hidden
          />
        </div>
      </div>
    </section>
  );
}
