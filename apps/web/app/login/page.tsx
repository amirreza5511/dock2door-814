"use client";

import { useState, Suspense, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { ArrowRight, Boxes, Truck, Warehouse, Ship, Sparkles } from "lucide-react";
import { LANDING_IMAGES } from "@/components/landing/images";

type Role = "Customer" | "WarehouseProvider" | "ServiceProvider" | "Employer" | "TruckingCompany";

const ROLES: { value: Role; label: string }[] = [
  { value: "Customer", label: "Customer" },
  { value: "WarehouseProvider", label: "Warehouse Provider" },
  { value: "ServiceProvider", label: "Service Provider" },
  { value: "Employer", label: "Employer" },
  { value: "TruckingCompany", label: "Trucking Company" },
];

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
      const count = Math.max(22, Math.min(56, Math.floor((width * height) / 24000)));
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

    const LINK_DIST = 140;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.3;
            ctx.strokeStyle = `rgba(45, 226, 199, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
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
  { icon: Truck, label: "In transit", value: "1,284 loads", className: "left-[6%] top-[20%]", floatClass: "float-slow", depth: 26 },
  { icon: Warehouse, label: "Warehouse space", value: "2.4M sq ft", className: "right-[8%] top-[14%]", floatClass: "float-mid", depth: 40 },
  { icon: Ship, label: "Drayage moves", value: "97% on time", className: "right-[10%] bottom-[22%]", floatClass: "float-fast", depth: 32 },
  { icon: Boxes, label: "Orders fulfilled", value: "312k / mo", className: "left-[9%] bottom-[26%]", floatClass: "float-mid", depth: 20 },
];

/** Left-hand branded visual panel with logistics imagery + 3D depth. */
function VisualPanel() {
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTilt({ x: (e.clientX - rect.left) / rect.width - 0.5, y: (e.clientY - rect.top) / rect.height - 0.5 });
  }, []);
  const onMouseLeave = useCallback(() => setTilt({ x: 0, y: 0 }), []);

  return (
    <div
      className="relative hidden overflow-hidden lg:block"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* imagery collage */}
      <img src={LANDING_IMAGES.port} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-br from-[#04121a]/85 via-[#04121a]/70 to-[#0a1f2e]/90" aria-hidden />

      <NetworkCanvas />

      {/* glow orbs */}
      <div
        className="pointer-events-none absolute -left-24 top-16 h-[26rem] w-[26rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(45,226,199,0.35), transparent 70%)", animation: "glow-breathe 9s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-10 h-[30rem] w-[30rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.3), transparent 70%)", animation: "glow-breathe 11s ease-in-out infinite" }}
        aria-hidden
      />

      {/* perspective grid floor */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] [perspective:520px]" aria-hidden>
        <div className="hero-grid absolute inset-0 origin-bottom [transform:rotateX(74deg)]" />
      </div>

      {/* floating stat cards */}
      {FLOAT_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={`pointer-events-none absolute ${card.className} ${card.floatClass}`}
            style={{ transform: `translate3d(${tilt.x * card.depth}px, ${tilt.y * card.depth}px, 0)`, transition: "transform 0.25s ease-out" }}
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

      {/* headline block */}
      <div
        className="relative z-10 flex h-full flex-col justify-between p-12"
        style={{ transform: `translate3d(${tilt.x * -12}px, ${tilt.y * -8}px, 0)`, transition: "transform 0.3s ease-out" }}
      >
        <a href="/" className="flex w-fit items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">D2</span>
          <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
        </a>

        <div className="max-w-md">
          <span className="reveal inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-md" style={{ animationDelay: "0.05s" }}>
            <Sparkles size={13} className="text-[#2de2c7]" />
            The Dock2Door Operations Console
          </span>
          <h2 className="reveal font-display mt-6 text-4xl font-extrabold leading-[1.02] tracking-tight text-white xl:text-5xl" style={{ animationDelay: "0.15s" }}>
            Move anything.
            <br />
            <span className="gradient-text">Anywhere. On time.</span>
          </h2>
          <p className="reveal mt-5 max-w-sm text-sm leading-relaxed text-white/60" style={{ animationDelay: "0.28s" }}>
            Shippers, warehouses, drayage, trucking and labour — one live network. Sign in to run it all from a single console.
          </p>
        </div>

        <div className="reveal grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6" style={{ animationDelay: "0.4s" }}>
          {[
            { k: "$4.8B+", v: "Freight moved" },
            { k: "12k+", v: "Active carriers" },
            { k: "99.2%", v: "On-time" },
          ].map((s) => (
            <div key={s.v}>
              <p className="font-display text-xl font-bold text-white">{s.k}</p>
              <p className="mt-1 text-[11px] text-white/50">{s.v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [selectedRole, setSelectedRole] = useState<Role>("Customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getBrowserSupabase();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { role: selectedRole } },
        });
        if (error) throw error;
        if (selectedRole !== "Customer") {
          setInfo("Account created. You'll be prompted to set up your company after signing in.");
        } else {
          setInfo("Account created. Check your inbox if email confirmation is required, then sign in.");
        }
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "mt-1.5 flex h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-white/30 shadow-inner outline-none transition focus:border-[#2de2c7]/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-[#2de2c7]/25";

  return (
    <div className="landing-bg grid min-h-screen w-full lg:grid-cols-[1.1fr_minmax(420px,0.9fr)]">
      <VisualPanel />

      {/* form column */}
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
        {/* ambient glow behind card (mobile + fill) */}
        <div className="pointer-events-none absolute inset-0 lg:hidden" aria-hidden>
          <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#2de2c7]/20 blur-3xl" />
          <div className="absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-[#818cf8]/20 blur-3xl" />
        </div>

        <div className="reveal relative w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">D2</span>
            <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1.5 text-sm text-white/50">
            {mode === "signin"
              ? "Sign in to the Dock2Door operations console."
              : "Join the Dock2Door logistics network."}
          </p>

          <form className="mt-7 space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-white/50">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-white/50">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={fieldClass}
              />
            </div>

            {mode === "signup" && (
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Account type</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setSelectedRole(r.value)}
                      className={[
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        selectedRole === r.value
                          ? "border-[#2de2c7] bg-[#2de2c7]/15 text-[#7ff0dd]"
                          : "border-white/12 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white",
                      ].join(" ")}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            {info && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{info}</p>}

            <button
              type="submit"
              disabled={busy}
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2de2c7] to-[#4fd6c0] font-display text-sm font-semibold text-[#04121a] shadow-[0_10px_40px_-8px_rgba(45,226,199,0.7)] transition hover:shadow-[0_14px_50px_-6px_rgba(45,226,199,0.9)] disabled:opacity-60"
            >
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
              {!busy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />}
            </button>

            <button
              type="button"
              className="block w-full text-center text-xs text-white/50 transition hover:text-white"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setInfo(null); }}
            >
              {mode === "signin" ? "No account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="landing-bg grid min-h-screen place-items-center text-sm text-white/60">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
