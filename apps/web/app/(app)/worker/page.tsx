import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TILES = [
  { href: "/worker/shifts", title: "My shifts", desc: "Assigned shifts. Clock in / out." },
  { href: "/worker/certifications", title: "Certifications", desc: "Upload and track your certifications." },
];

export default function WorkerHomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="text-sm text-muted-foreground">Your shifts and credentials.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="group">
            <Card className="transition group-hover:border-primary">
              <CardHeader><CardTitle>{t.title}</CardTitle><CardDescription>{t.desc}</CardDescription></CardHeader>
              <CardContent><span className="text-sm text-primary group-hover:underline">Open →</span></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
