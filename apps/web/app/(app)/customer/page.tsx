import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TILES = [
  { href: "/customer/warehouses", title: "Find warehouses", desc: "Browse available storage facilities and request a booking." },
  { href: "/customer/bookings", title: "My bookings", desc: "Track active and historical warehouse bookings." },
  { href: "/customer/inventory", title: "Inventory", desc: "View stock levels and movements across all warehouses." },
  { href: "/customer/services", title: "Services", desc: "Book labour, forklift, and logistics services." },
  { href: "/customer/orders", title: "Orders", desc: "Manage fulfilment orders and track deliveries." },
  { href: "/customer/invoices", title: "Invoices", desc: "View and pay your outstanding invoices." },
];

export default function CustomerHomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customer dashboard</h1>
        <p className="text-sm text-muted-foreground">Manage your warehousing, services, and fulfilment operations.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="group">
            <Card className="transition group-hover:border-primary">
              <CardHeader>
                <CardTitle>{t.title}</CardTitle>
                <CardDescription>{t.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm text-primary group-hover:underline">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
