"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, RotateCcw, Store, QrCode, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STORES = [
  { key: "amazon", name: "Amazon", addr: "Amazon Returns", city: "Mississauga", postal: "L5T 2T3", color: "#FF9900" },
  { key: "temu", name: "Temu", addr: "Temu Returns Center", city: "City of Industry", postal: "91746", color: "#FB7701" },
  { key: "shein", name: "SHEIN", addr: "SHEIN Returns", city: "Whittier", postal: "90601", color: "#222222" },
  { key: "walmart", name: "Walmart", addr: "Walmart Returns", city: "Brampton", postal: "L6T 5V1", color: "#0071CE" },
  { key: "bestbuy", name: "Best Buy", addr: "Best Buy Returns", city: "Burnaby", postal: "V5J 5J8", color: "#0046BE" },
  { key: "other", name: "Other store", addr: "", city: "", postal: "", color: "#64748b" },
];

const REASONS = ["Wrong item", "Damaged / defective", "No longer needed", "Wrong size", "Not as described"];

export default function ShipReturnPage() {
  const [storeKey, setStoreKey] = useState("amazon");
  const [orderRef, setOrderRef] = useState("");
  const [reason, setReason] = useState("Wrong item");
  const [customStore, setCustomStore] = useState("");
  const [atCounter, setAtCounter] = useState(true);

  const store = STORES.find((s) => s.key === storeKey) ?? STORES[0];
  const isOther = storeKey === "other";

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <Link href="/ship" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="mb-2 text-2xl font-bold tracking-tight">Start a return</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Return to any store. We&apos;ll create a return label with a scannable code — print it or show the QR at the counter.
      </p>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Which store?</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {STORES.map((s) => {
          const on = storeKey === s.key;
          return (
            <button key={s.key} onClick={() => setStoreKey(s.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          );
        })}
      </div>

      {isOther ? (
        <div className="mb-6">
          <label className="text-xs text-muted-foreground">Store name</label>
          <Input value={customStore} onChange={(e) => setCustomStore(e.target.value)} placeholder="Store name" />
        </div>
      ) : (
        <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground"><Store className="h-4 w-4" /> {store.addr}, {store.city} {store.postal}</p>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order reference (optional)</h2>
      <div className="mb-6"><Input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="e.g. 112-3456789-0000000" /></div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reason</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        {REASONS.map((r) => {
          const on = reason === r;
          return (
            <button key={r} onClick={() => setReason(r)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {r}
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How to send it back</h2>
      <div className="mb-6 space-y-3">
        {[
          { on: atCounter, set: true, icon: QrCode, title: "Show QR at the counter", desc: "No printer needed — staff scan your code" },
          { on: !atCounter, set: false, icon: RotateCcw, title: "Print a return label", desc: "Tape it on the box and drop it off" },
        ].map((o, i) => {
          const Icon = o.icon;
          return (
            <button key={i} onClick={() => setAtCounter(o.set)}
              className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${o.on ? "border-primary" : "border-border hover:border-primary/50"}`}>
              <Icon className={`h-5 w-5 ${o.on ? "text-primary" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className="font-semibold">{o.title}</p>
                <p className="text-xs text-muted-foreground">{o.desc}</p>
              </div>
              {o.on && <Check className="h-5 w-5 text-primary" />}
            </button>
          );
        })}
      </div>

      <Link href="/login?next=/dashboard">
        <Button className="w-full gap-2"><RotateCcw className="h-4 w-4" /> Continue in the app to create the return label</Button>
      </Link>
      <p className="mt-3 text-center text-xs text-muted-foreground">You&apos;ll be asked to sign in to generate the return label.</p>
    </div>
  );
}
