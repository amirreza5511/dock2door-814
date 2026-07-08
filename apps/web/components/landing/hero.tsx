"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Boxes, Truck, Warehouse, Ship, Sparkles } from "lucide-react";

/** Animated logistics-network canvas backdrop (no external deps). */
function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;

    type Node = { x: number; y: number; vx: number; vy: number };
    let nodes: Node[] = [];

    type Pulse = { a: number; b: number; t: number; speed: number };
    let pulses: Pulse[] = [];

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const seed = () => {
      const count = Math.max(28, Math.min(70, Math.floor((width * height) / 26000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
      }));
      pulses = Array.from({ length: Math.floor(count / 4) }, () => ({
        a: Math.floor(Math.random() * count),
        b: Math.floor(Math.random() * count),
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.004,
      }));
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const LINK_DIST = 150;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }

      // links
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.32;
            ctx.strokeStyle = `rgba(45, 226, 199, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // traveling shipment pulses
      for (const p of pulses) {
        const a = nodes[p.a];
        const b = nodes[p.b];
        if (!a || !b) continue;
        p.t += p.speed;
        if (p.t >= 1) {
          p.t = 0;
          p.a = Math.floor(Math.random() * nodes.length);
          p.b = Math.floor(Math.random() * nodes.length);
        }
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        ctx.fillStyle = "rgba(129, 140, 248, 0.9)";
        ctx.shadowColor = "rgba(129, 140, 248, 0.9)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // nodes
      for (const n of nodes) {
        ctx.fillStyle = "rgba(45, 226, 199, 0.85)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduceMotion) {
      draw();
      window.cancelAnimationFrame(raf);
    } else {
      raf = window.requestAnimationFrame(draw);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      aria-hidden
    />
  );
}

type FloatCard = {
  icon: typeof Truck;
  label: string;
  value: string;
  className: string;
  floatClass: string;
  depth: number;
};

const FLOAT_CARDS: FloatCard[] = [
  {
    icon: Truck,
    label: "In transit",
    value: "1,284 loads",
    className: "left-[3%] top-[22%]",
    floatClass: "float-slow",
    depth: 26,
  },
  {
    icon: Warehouse,
    label: "Warehouse space",
    value: "2.4M sq ft",
    className: "right-[4%] top-[16%]",
    floatClass: "float-mid",
    depth: 40,
  },
  {
    icon: Ship,
    label: "Drayage moves",
    value: "97% on time",
    className: "right-[8%] bottom-[20%]",
    floatClass: "float-fast",
    depth: 32,
  },
  {
    icon: Boxes,
    label: "Orders fulfilled",
    value: "312k / mo",
    className: "left-[6%] bottom-[24%]",
    floatClass: "float-mid",
    depth: 20,
  },
];

export function Hero() {
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: px, y: py });
  }, []);

  const onMouseLeave = useCallback(() => setTilt({ x: 0, y: 0 }), []);

  return (
    <section
      className="hero-shell relative min-h-screen w-full overflow-hidden"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <NetworkCanvas />

      {/* glow orbs */}
      <div
        className="pointer-events-none absolute -left-32 top-10 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(45,226,199,0.35), transparent 70%)", animation: "glow-breathe 9s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 top-32 h-[32rem] w-[32rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.32), transparent 70%)", animation: "glow-breathe 11s ease-in-out infinite" }}
        aria-hidden
      />

      {/* perspective grid floor */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] [perspective:520px]" aria-hidden>
        <div className="hero-grid absolute inset-0 origin-bottom [transform:rotateX(74deg)]" />
      </div>

      {/* floating stat cards with parallax */}
      {FLOAT_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={`pointer-events-none absolute hidden lg:block ${card.className} ${card.floatClass}`}
            style={{
              transform: `translate3d(${tilt.x * card.depth}px, ${tilt.y * card.depth}px, 0)`,
              transition: "transform 0.25s ease-out",
            }}
          >
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-md shadow-[0_8px_40px_-12px_rgba(45,226,199,0.5)]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] text-[#04121a]">
                <Icon size={20} strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-white/50">{card.label}</p>
                <p className="font-display text-sm font-semibold text-white">{card.value}</p>
              </div>
            </div>
          </div>
        );
      })}

      {/* nav */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">
            D2
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
        </div>
        <a
          href="/login"
          className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition hover:border-white/30 hover:bg-white/10"
        >
          Sign in
        </a>
      </header>

      {/* content */}
      <div
        className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pt-14 text-center md:pt-20"
        style={{
          transform: `translate3d(${tilt.x * -14}px, ${tilt.y * -10}px, 0)`,
          transition: "transform 0.3s ease-out",
        }}
      >
        <span
          className="reveal inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-md"
          style={{ animationDelay: "0.05s" }}
        >
          <Sparkles size={13} className="text-[#2de2c7]" />
          One operating system for the whole supply chain
        </span>

        <h1
          className="reveal font-display mt-7 text-5xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-6xl md:text-7xl"
          style={{ animationDelay: "0.15s" }}
        >
          Move anything.
          <br />
          <span className="gradient-text">Anywhere. On time.</span>
        </h1>

        <p
          className="reveal mt-6 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg"
          style={{ animationDelay: "0.28s" }}
        >
          Dock2Door connects shippers, warehouses, drayage, trucking and labour on a
          single live network — so freight flows without the friction.
        </p>

        <div
          className="reveal mt-9 flex flex-col items-center gap-3 sm:flex-row"
          style={{ animationDelay: "0.4s" }}
        >
          <a
            href="/login"
            className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#2de2c7] to-[#4fd6c0] px-7 py-3.5 font-display text-sm font-semibold text-[#04121a] shadow-[0_10px_40px_-8px_rgba(45,226,199,0.7)] transition hover:shadow-[0_14px_50px_-6px_rgba(45,226,199,0.9)]"
          >
            Open the console
            <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
          </a>
          <a
            href="#how"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-7 py-3.5 text-sm font-medium text-white/90 backdrop-blur-md transition hover:border-white/30 hover:bg-white/10"
          >
            See how it works
          </a>
        </div>

        {/* stats */}
        <div
          className="reveal mt-16 grid w-full max-w-2xl grid-cols-3 gap-4 border-t border-white/10 pt-8"
          style={{ animationDelay: "0.52s" }}
        >
          {[
            { k: "$4.8B+", v: "Freight moved" },
            { k: "12k+", v: "Active carriers" },
            { k: "99.2%", v: "On-time delivery" },
          ].map((s) => (
            <div key={s.v}>
              <p className="font-display text-2xl font-bold text-white sm:text-3xl">{s.k}</p>
              <p className="mt-1 text-xs text-white/50">{s.v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* scroll hint */}
      <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center" aria-hidden>
        <div className="flex h-9 w-6 items-start justify-center rounded-full border border-white/20 p-1.5">
          <span className="h-2 w-1 rounded-full bg-white/70" style={{ animation: "scroll-bob 1.6s ease-in-out infinite" }} />
        </div>
      </div>
    </section>
  );
}
