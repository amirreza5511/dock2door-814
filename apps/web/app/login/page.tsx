"use client";

import { useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REAL_IMAGES } from "@/components/landing/images";
import { ArrowRight, Boxes, Truck, Warehouse, Ship, Sparkles, Check, ShieldCheck, FileText, X } from "lucide-react";
import { TERMS_AND_CONDITIONS, NDA_AGREEMENT, TERMS_VERSION, NDA_VERSION, type LegalDoc } from "@/lib/legal";

type Role =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "Worker"
  | "EmploymentAgency"
  | "GateStaff"
  | "Shipper"
  | "Driver"
  | "TruckingCompany"
  | "FreightForwarder"
  | "DrayageCompany"
  | "CustomsBroker"
  | "EquipmentRentalCompany"
  | "MobileRepairProvider"
  | "CargoInsurer"
  | "MarketplaceBuyer"
  | "SalesAgent"
  | "Guest";

type RoleOption = { id: string; role: Role; label: string; desc: string };

/** Same worlds + roles as the mobile app signup — keep both in sync. */
const ROLE_WORLDS: { world: string; roles: RoleOption[] }[] = [
  {
    world: "Labour",
    roles: [
      { id: "Employer", role: "Employer", label: "Employer", desc: "Post and manage work shifts" },
      { id: "Worker", role: "Worker", label: "Worker", desc: "Find and apply for shifts" },
      { id: "EmploymentAgency", role: "EmploymentAgency", label: "Employment Agency", desc: "Bring your own workers & clients — book shifts, coordinate and invoice through Dock2Door" },
    ],
  },
  {
    world: "Logistics & Warehousing",
    roles: [
      { id: "Customer", role: "Customer", label: "Customer", desc: "Book warehouse space & services" },
      { id: "WarehouseProvider", role: "WarehouseProvider", label: "Warehouse Provider", desc: "List and manage storage space" },
      { id: "ServiceProvider", role: "ServiceProvider", label: "Service Provider", desc: "Offer industrial services" },
      { id: "GateStaff", role: "GateStaff", label: "Gate Staff", desc: "Run dock and gate check-ins" },
    ],
  },
  {
    world: "Freight & Delivery",
    roles: [
      { id: "Shipper", role: "Shipper", label: "Shipper", desc: "Post deliveries — parcel to full load" },
      { id: "Driver", role: "Driver", label: "Owner-Operator", desc: "Own one truck — accept & deliver loads yourself" },
      { id: "TruckingCompany", role: "TruckingCompany", label: "Fleet / Carrier Company", desc: "Run a fleet — accept loads & dispatch your drivers" },
    ],
  },
  {
    world: "Container Drayage",
    roles: [
      { id: "FreightForwarder", role: "FreightForwarder", label: "Importer / Exporter / Freight Forwarder", desc: "Post import & export container orders and track them live" },
      { id: "DrayageCompany", role: "DrayageCompany", label: "Drayage Company", desc: "Claim container orders, dispatch drivers & track live" },
      { id: "DrayageDriver", role: "Driver", label: "Drayage Driver", desc: "Drive container moves — enter your drayage company's fleet code" },
      { id: "CustomsBroker", role: "CustomsBroker", label: "Customs Broker", desc: "Receive clearance requests & documents, quote and clear shipments" },
    ],
  },
  {
    world: "Rentals & Services",
    roles: [
      { id: "EquipmentRentalCompany", role: "EquipmentRentalCompany", label: "Equipment / Crane Rental Co.", desc: "Rent out forklifts, cranes, hoists & heavy machinery" },
      { id: "MobileRepairProvider", role: "MobileRepairProvider", label: "Mobile Repair & Services", desc: "Dispatch technicians & work crews on-site" },
      { id: "CargoInsurer", role: "CargoInsurer", label: "Cargo Insurer", desc: "Insure freight & shipments by cargo value" },
      { id: "MarketplaceBuyer", role: "MarketplaceBuyer", label: "Marketplace Buyer", desc: "Rent gear, book repairs & insure cargo — no other world needed" },
    ],
  },
  {
    world: "Sales, Partnerships & Guests",
    roles: [
      { id: "SalesAgent", role: "SalesAgent", label: "Sales Agent", desc: "Onboard warehouses, drivers, employers & more — earn commission from Dock2Door" },
      { id: "Guest", role: "Guest", label: "Guest", desc: "No business account — order drayage, customs clearance, rentals & more. Prepaid, with a small guest surcharge" },
    ],
  },
];

const ALL_ROLE_OPTIONS: RoleOption[] = ROLE_WORLDS.flatMap((w) => w.roles);

/** Roles that sign up as individuals — no company name needed. */
const NO_COMPANY_ROLES: Role[] = ["Worker", "Driver", "SalesAgent", "Guest"];

type FloatCard = {
  icon: typeof Truck;
  label: string;
  value: string;
  className: string;
  floatClass: string;
  depth: number;
};

const FLOAT_CARDS: FloatCard[] = [
  { icon: Truck, label: "In transit", value: "1,284 loads", className: "left-[5%] top-[15%]", floatClass: "float-slow", depth: 26 },
  { icon: Warehouse, label: "Warehouse space", value: "2.4M sq ft", className: "right-[6%] top-[11%]", floatClass: "float-mid", depth: 40 },
  { icon: Ship, label: "Drayage moves", value: "97% on time", className: "right-[7%] bottom-[30%]", floatClass: "float-fast", depth: 32 },
  { icon: Boxes, label: "Orders fulfilled", value: "312k / mo", className: "left-[6%] bottom-[34%]", floatClass: "float-mid", depth: 20 },
];

const FILMSTRIP: { src: string; label: string }[] = [
  { src: REAL_IMAGES.fleet, label: "Trucking" },
  { src: REAL_IMAGES.warehouse, label: "Warehousing" },
  { src: REAL_IMAGES.port, label: "Drayage" },
];

/** Left-hand branded visual panel: real logistics photography + real 3D truck + floating glass stats. */
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
      {/* real photographic hero background */}
      <img
        src={REAL_IMAGES.dock}
        alt="Semi truck at a warehouse loading dock"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* legibility scrims */}
      <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "linear-gradient(180deg, rgba(4,18,30,0.55) 0%, rgba(4,18,30,0.35) 40%, rgba(4,18,30,0.9) 100%)" }} />
      <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(1100px 700px at 25% 15%, rgba(45,226,199,0.16), transparent 55%)" }} />

      {/* glow orbs for depth */}
      <div
        className="pointer-events-none absolute -left-24 top-10 h-[24rem] w-[24rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(45,226,199,0.28), transparent 70%)", animation: "glow-breathe 9s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-24 h-[26rem] w-[26rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.26), transparent 70%)", animation: "glow-breathe 11s ease-in-out infinite" }}
        aria-hidden
      />

      {/* floating stat cards */}
      {FLOAT_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={`pointer-events-none absolute z-10 ${card.className} ${card.floatClass}`}
            style={{ transform: `translate3d(${tilt.x * card.depth}px, ${tilt.y * card.depth}px, 0)`, transition: "transform 0.25s ease-out" }}
          >
            <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.08] px-4 py-3 backdrop-blur-md shadow-[0_8px_40px_-12px_rgba(45,226,199,0.55)]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] text-[#04121a]">
                <Icon size={20} strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-white/70">{card.label}</p>
                <p className="font-display text-sm font-semibold text-white">{card.value}</p>
              </div>
            </div>
          </div>
        );
      })}

      {/* content overlay */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-12">
        <a href="/" className="pointer-events-auto flex w-fit items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">D2</span>
          <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
        </a>

        <div className="max-w-md">
          <span className="reveal inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-white/85 backdrop-blur-md" style={{ animationDelay: "0.05s" }}>
            <Sparkles size={13} className="text-[#2de2c7]" />
            The Dock2Door Operations Console
          </span>
          <h2 className="reveal font-display mt-6 text-4xl font-extrabold leading-[1.02] tracking-tight text-white xl:text-5xl" style={{ animationDelay: "0.15s", textShadow: "0 4px 30px rgba(0,0,0,0.6)" }}>
            Move anything.
            <br />
            <span className="gradient-text">Anywhere. On time.</span>
          </h2>
          <p className="reveal mt-5 max-w-sm text-sm leading-relaxed text-white/80" style={{ animationDelay: "0.28s" }}>
            Shippers, warehouses, drayage, trucking and labour — one live network. Sign in to run it all from a single console.
          </p>
        </div>

        <div className="space-y-6">
          {/* real photo filmstrip */}
          <div className="reveal pointer-events-auto flex gap-3" style={{ animationDelay: "0.36s" }}>
            {FILMSTRIP.map((f) => (
              <div key={f.label} className="group relative h-20 flex-1 overflow-hidden rounded-2xl border border-white/12 shadow-[0_10px_40px_-18px_rgba(0,0,0,0.9)]">
                <img src={f.src} alt={f.label} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="absolute bottom-2 left-3 text-xs font-semibold text-white">{f.label}</span>
              </div>
            ))}
          </div>

          <div className="reveal grid max-w-md grid-cols-3 gap-4 border-t border-white/15 pt-6" style={{ animationDelay: "0.42s" }}>
            {[
              { k: "$4.8B+", v: "Freight moved" },
              { k: "12k+", v: "Active carriers" },
              { k: "99.2%", v: "On-time" },
            ].map((s) => (
              <div key={s.v}>
                <p className="font-display text-xl font-bold text-white">{s.k}</p>
                <p className="mt-1 text-[11px] text-white/65">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [fleetCode, setFleetCode] = useState<string>("");
  const [agentCode, setAgentCode] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [acceptedNda, setAcceptedNda] = useState<boolean>(false);
  const [ndaName, setNdaName] = useState<string>("");
  const [viewingDoc, setViewingDoc] = useState<LegalDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedOption = selectedId ? ALL_ROLE_OPTIONS.find((r) => r.id === selectedId) ?? null : null;
  const selectedRole: Role | null = selectedOption?.role ?? null;
  const needsCompany = selectedRole != null && !NO_COMPANY_ROLES.includes(selectedRole);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const supabase = getBrowserSupabase();

    if (mode === "signup") {
      if (!name.trim()) { setError("Name is required"); return; }
      if (!password || password.length < 6) { setError("Password must be at least 6 characters"); return; }
      if (!selectedRole) { setError("Please select your role"); return; }
      if (needsCompany && !companyName.trim()) { setError("Company name is required for this role"); return; }
      if (!acceptedTerms) { setError("Please accept the Terms & Conditions to continue"); return; }
      if (!acceptedNda) { setError("You must agree to the Non-Disclosure Agreement"); return; }
      if (!ndaName.trim()) { setError("Type your full legal name to sign the NDA"); return; }
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
            data: {
              name: name.trim(),
              role: selectedRole,
              company_name: needsCompany ? companyName.trim() : "",
              city: city.trim(),
              fleet_code: fleetCode.trim().toUpperCase(),
              agent_code: agentCode.trim().toUpperCase(),
              accepted_terms: "true",
              terms_version: TERMS_VERSION,
              accepted_nda: "true",
              nda_version: NDA_VERSION,
              nda_signed_name: ndaName.trim(),
              signup_platform: "web",
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
          return;
        }
        setInfo(`Account created. We sent a confirmation link to ${email.trim()} — click it, then sign in here.`);
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
        {/* ambient glow behind card */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#2de2c7]/15 blur-3xl" />
          <div className="absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-[#818cf8]/15 blur-3xl" />
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
            {mode === "signup" && (
              <div>
                <label htmlFor="name" className="text-xs font-medium uppercase tracking-wider text-white/50">Full Name</label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className={fieldClass}
                />
              </div>
            )}
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

            {mode === "signup" && needsCompany && (
              <>
                <div>
                  <label htmlFor="companyName" className="text-xs font-medium uppercase tracking-wider text-white/50">Company Name</label>
                  <input
                    id="companyName"
                    type="text"
                    autoComplete="organization"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Dock2Door Logistics Ltd."
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="city" className="text-xs font-medium uppercase tracking-wider text-white/50">City</label>
                  <input
                    id="city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Chicago"
                    className={fieldClass}
                  />
                </div>
              </>
            )}

            {mode === "signup" && selectedRole === "Driver" && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <label htmlFor="fleetCode" className="text-xs font-medium uppercase tracking-wider text-white/50">Fleet code (optional)</label>
                <input
                  id="fleetCode"
                  type="text"
                  value={fleetCode}
                  onChange={(e) => setFleetCode(e.target.value.toUpperCase())}
                  placeholder="e.g. AB7K2P"
                  className={fieldClass}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Joining a fleet or carrier company? Enter the code your dispatcher gave you and you'll show up in their fleet automatically. Leave blank if you're an independent owner-operator.
                </p>
              </div>
            )}

            {mode === "signup" && selectedRole != null && selectedRole !== "SalesAgent" && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <label htmlFor="agentCode" className="text-xs font-medium uppercase tracking-wider text-white/50">Referral code (optional)</label>
                <input
                  id="agentCode"
                  type="text"
                  value={agentCode}
                  onChange={(e) => setAgentCode(e.target.value.toUpperCase())}
                  placeholder="e.g. AG7K2PQ"
                  className={fieldClass}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Were you referred by a Dock2Door sales agent? Enter their code so they get credit for bringing you on board.
                </p>
              </div>
            )}

            {mode === "signup" && (
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Your Role</label>
                <div className="mt-2 space-y-4">
                  {ROLE_WORLDS.map((group) => (
                    <div key={group.world}>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#2de2c7]">{group.world}</p>
                      <div className="space-y-2">
                        {group.roles.map((r) => {
                          const selected = selectedId === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setSelectedId(r.id)}
                              className={[
                                "relative w-full rounded-xl border p-3.5 text-left transition",
                                selected
                                  ? "border-[#2de2c7] bg-[#2de2c7]/10"
                                  : "border-white/12 bg-white/[0.03] hover:border-white/25",
                              ].join(" ")}
                            >
                              {selected && (
                                <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[#2de2c7]">
                                  <Check size={12} className="text-[#04121a]" />
                                </span>
                              )}
                              <span className={["block pr-8 text-sm font-semibold", selected ? "text-[#7ff0dd]" : "text-white"].join(" ")}>{r.label}</span>
                              <span className="mt-0.5 block text-xs text-white/50">{r.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mode === "signup" && selectedRole != null && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="space-y-2.5 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={15} className="text-[#2de2c7]" />
                    <span className="text-sm font-semibold text-white">Non-Disclosure Agreement</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/40">
                    Everyone on Dock2Door may access confidential business, customer and shipment data, so you must read and sign our NDA before you start.
                  </p>
                  <button type="button" className="flex items-start gap-2.5 text-left" onClick={() => setAcceptedNda((v) => !v)}>
                    <span className={["mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition", acceptedNda ? "border-[#2de2c7] bg-[#2de2c7]" : "border-white/25 bg-transparent"].join(" ")}>
                      {acceptedNda && <Check size={13} className="text-[#04121a]" />}
                    </span>
                    <span className="text-xs leading-relaxed text-white/70">
                      I have read and agree to the{" "}
                      <span
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer font-semibold text-[#7ff0dd] underline"
                        onClick={(e) => { e.stopPropagation(); setViewingDoc(NDA_AGREEMENT); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setViewingDoc(NDA_AGREEMENT); } }}
                      >
                        Non-Disclosure Agreement
                      </span>.
                    </span>
                  </button>
                  {acceptedNda && (
                    <div>
                      <label htmlFor="ndaName" className="text-xs font-medium uppercase tracking-wider text-white/50">Type your full legal name to sign</label>
                      <input
                        id="ndaName"
                        type="text"
                        value={ndaName}
                        onChange={(e) => setNdaName(e.target.value)}
                        placeholder="e.g. Jane A. Smith"
                        className={fieldClass}
                      />
                    </div>
                  )}
                </div>

                <button type="button" className="flex items-start gap-2.5 text-left" onClick={() => setAcceptedTerms((v) => !v)}>
                  <span className={["mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition", acceptedTerms ? "border-[#2de2c7] bg-[#2de2c7]" : "border-white/25 bg-transparent"].join(" ")}>
                    {acceptedTerms && <Check size={13} className="text-[#04121a]" />}
                  </span>
                  <span className="text-xs leading-relaxed text-white/70">
                    I agree to the{" "}
                    <span
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer font-semibold text-[#7ff0dd] underline"
                      onClick={(e) => { e.stopPropagation(); setViewingDoc(TERMS_AND_CONDITIONS); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setViewingDoc(TERMS_AND_CONDITIONS); } }}
                    >
                      Terms &amp; Conditions
                    </span>{" "}
                    and Privacy Policy.
                  </span>
                </button>

                <button type="button" className="flex items-center gap-1.5 text-[11px] text-white/40 transition hover:text-white/70" onClick={() => setViewingDoc(TERMS_AND_CONDITIONS)}>
                  <FileText size={12} />
                  Read the full documents
                </button>
              </div>
            )}

            {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            {info && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{info}</p>}

            <button
              type="submit"
              disabled={busy || (mode === "signup" && (!selectedRole || !acceptedTerms || !acceptedNda || !ndaName.trim()))}
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2de2c7] to-[#4fd6c0] font-display text-sm font-semibold text-[#04121a] shadow-[0_10px_40px_-8px_rgba(45,226,199,0.7)] transition hover:shadow-[0_14px_50px_-6px_rgba(45,226,199,0.9)] disabled:opacity-60"
            >
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create Account"}
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

      {viewingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setViewingDoc(null)}
          role="dialog"
          aria-modal="true"
          aria-label={viewingDoc.title}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a1420] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="font-display text-base font-bold text-white">{viewingDoc.title}</p>
                <p className="text-[11px] text-white/40">Version {viewingDoc.version}</p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:text-white"
                onClick={() => setViewingDoc(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed text-white/70">
              {viewingDoc.body}
            </div>
            <div className="border-t border-white/10 px-5 py-3">
              <button
                type="button"
                className="h-10 w-full rounded-xl bg-white/10 text-sm font-semibold text-white transition hover:bg-white/15"
                onClick={() => setViewingDoc(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
