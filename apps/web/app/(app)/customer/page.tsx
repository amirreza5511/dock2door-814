"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Warehouse, Wrench, TrendingUp, Clock, CheckCircle, AlertCircle, Truck, Ship,
  Sparkles, Store, Plane, PackageCheck,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface BookingRow {
  id: string;
  status: string;
  pallets_requested: number;
  start_date: string | null;
  end_date: string | null;
  proposed_price: number | null;
  final_price: number | null;
  payment_status: string;
  created_at: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  Confirmed: "success",
  InProgress: "success",
  Completed: "success",
  Requested: "warning",
  CounterOffered: "warning",
  Cancelled: "destructive",
};

const ACTIONS = [
  { href: "/customer/warehouses", title: "Find warehouse", desc: "Search available storage space", icon: Warehouse, color: "text-blue-400" },
  { href: "/customer/services", title: "Book services", desc: "On-demand industrial crews", icon: Wrench, color: "text-primary" },
  { href: "/customer/post-load", title: "Post a load", desc: "Ship freight, any vehicle", icon: Truck, color: "text-emerald-400" },
  { href: "/customer/loads", title: "Track loads", desc: "See pickup progress live", icon: TrendingUp, color: "text-blue-400" },
  { href: "/customer/drayage", title: "Container drayage", desc: "Import / export containers", icon: Ship, color: "text-blue-400" },
  { href: "/marketplace", title: "Marketplace", desc: "Rent gear, repair & services", icon: Store, color: "text-purple-400" },
  { href: "/copilot", title: "AI Copilot", desc: "Track orders & get answers", icon: Sparkles, color: "text-primary" },
  { href: "/customer/ocean", title: "Ocean booking", desc: "Post containers, forwarders bid", icon: Ship, color: "text-blue-400" },
  { href: "/customer/air", title: "Air cargo", desc: "Photos + AI estimate, forwarders bid", icon: Plane, color: "text-purple-400" },
  { href: "/customer/parcel", title: "Parcel counter", desc: "Size, price & print a barcode label", icon: PackageCheck, color: "text-emerald-400" },
];

export default function CustomerHomePage() {
  const supabase = getBrowserSupabase();

  const bookingsQ = useQuery({
    queryKey: ["customer", "dashboard", "bookings"],
    queryFn: async (): Promise<BookingRow[]> => {
      const { data, error } = await supabase
        .from("warehouse_bookings")
        .select("id,status,pallets_requested,start_date,end_date,proposed_price,final_price,payment_status,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return (data as BookingRow[] | null) ?? [];
    },
  });

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => ["Confirmed", "InProgress"].includes(b.status)).length;
    const pending = bookings.filter((b) => ["Requested", "CounterOffered"].includes(b.status)).length;
    const totalSpend = bookings
      .filter((b) => b.payment_status === "Paid")
      .reduce((sum, b) => sum + Number(b.final_price ?? b.proposed_price ?? 0), 0);
    return { active, pending, totalSpend };
  }, [bookings]);

  const recent = useMemo(() => bookings.slice(0, 4), [bookings]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">Good day 👋</p>
        <h1 className="text-2xl font-semibold tracking-tight">Customer dashboard</h1>
        <p className="text-sm text-muted-foreground">Manage your warehousing, freight, services and fulfilment operations.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<CheckCircle className="h-5 w-5 text-emerald-400" />} value={String(stats.active)} label="Active bookings" />
        <Stat icon={<Clock className="h-5 w-5 text-yellow-400" />} value={String(stats.pending)} label="Pending" />
        <Stat icon={<AlertCircle className="h-5 w-5 text-primary" />} value={`$${stats.totalSpend.toLocaleString()}`} label="Total spent" />
      </div>

      <div>
        <p className="mb-3 text-base font-semibold">Quick actions</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-start gap-3 pt-6">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted">
                    <a.icon className={`h-5 w-5 ${a.color}`} />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-base font-semibold">Recent bookings</p>
          <Link href="/customer/bookings" className="text-sm font-medium text-primary hover:underline">See all</Link>
        </div>
        {bookingsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Warehouse className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No bookings yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">Start by searching for warehouse space or booking a service.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((b) => (
              <div key={b.id} className="rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted">
                      <Warehouse className="h-4 w-4 text-blue-400" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Booking #{b.id.slice(0, 8).toUpperCase()}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.pallets_requested} pallets · {b.start_date ? formatDate(b.start_date) : "—"} → {b.end_date ? formatDate(b.end_date) : "—"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[b.status] ?? "secondary"}>{b.status}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                  <span className="text-sm font-bold">${b.final_price ?? b.proposed_price ?? 0}</span>
                  <Badge variant={b.payment_status === "Paid" ? "success" : "secondary"}>{b.payment_status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
