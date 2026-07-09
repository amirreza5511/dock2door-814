"use client";

import { Package, Truck, Warehouse, Users, Ship, ClipboardCheck } from "lucide-react";
import { REAL_IMAGES } from "@/components/landing/images";

type Module = { icon: typeof Truck; label: string };

const MODULES: Module[] = [
  { icon: Truck, label: "Trucking" },
  { icon: Warehouse, label: "Warehouse" },
  { icon: Ship, label: "Drayage" },
  { icon: Users, label: "Labour" },
  { icon: Package, label: "Fulfillment" },
  { icon: ClipboardCheck, label: "Orders" },
];

/** Real WebGL logistics diorama + real logistics photography — the connected supply chain. */
export function Showcase3D() {
  return (
    <section className="relative overflow-hidden py-24">
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
            each other in real time — a live view of the same modules you get in the
            mobile app.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-3">
            {MODULES.map((f) => {
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

        <div className="relative">
          {/* premium real-photography mosaic */}
          <div className="grid grid-cols-2 grid-rows-[220px_150px] gap-4">
            <div className="group relative col-span-2 overflow-hidden rounded-3xl border border-white/10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
              <img
                src={REAL_IMAGES.fleet}
                alt="Fleet of delivery trucks"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#2de2c7]" />
                <span className="text-[13px] font-semibold text-white">Live logistics network · real-time</span>
              </div>
            </div>
            {[
              { src: REAL_IMAGES.warehouse, label: "Warehousing" },
              { src: REAL_IMAGES.port, label: "Drayage & port" },
            ].map((p) => (
              <div
                key={p.label}
                className="group relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.9)]"
              >
                <img
                  src={p.src}
                  alt={p.label}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                <span className="absolute bottom-2.5 left-3 text-[12px] font-semibold text-white">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
