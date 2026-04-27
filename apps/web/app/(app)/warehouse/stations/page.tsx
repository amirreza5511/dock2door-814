import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATIONS = [
  { href: "/warehouse/stations/receiving", title: "Receiving", desc: "ASN check-in, dock receive" },
  { href: "/warehouse/stations/picking", title: "Picking", desc: "Wave queue, pick lists" },
  { href: "/warehouse/stations/packing", title: "Packing", desc: "Pack, weigh, manifest" },
  { href: "/warehouse/stations/shipping", title: "Shipping", desc: "Buy labels, ship" },
  { href: "/warehouse/stations/inventory", title: "Inventory", desc: "Counts, transfers, adjustments" },
  { href: "/warehouse/stations/dock", title: "Dock / Gate", desc: "Yard moves, gate events" },
];

export default function StationsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workstations</h1>
        <p className="text-sm text-muted-foreground">Pick a station to start working. Web stations mirror mobile workflows.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {STATIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="transition group-hover:border-primary">
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm text-primary group-hover:underline">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        Per-station workflows are live in the mobile app and wired through the same RPCs (<code>wms_receive</code>,
        <code> fulfillment.pickOrder</code>, <code>yard.recordEvent</code>, …). The web station detail pages are scaffolded
        and will reuse those same RPCs.
      </p>
    </div>
  );
}
