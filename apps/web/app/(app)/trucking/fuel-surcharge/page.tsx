"use client";

import { useState } from "react";
import { Fuel, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFuelSurcharges, useSetFuelSurcharge, currentMonthIso } from "@/lib/hooks/use-pay-model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(iso: string): string {
  const d = new Date(iso.length <= 7 ? `${iso}-01` : iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Fuel surcharge settings for a carrier company (trucking or drayage). */
export function FuelSurchargePage({ subtitle }: { subtitle?: string }) {
  const listQ = useFuelSurcharges();
  const setFsc = useSetFuelSurcharge();
  const thisMonth = currentMonthIso();
  const rows = listQ.data ?? [];
  const currentRow = rows.find((r) => (r.month || "").slice(0, 7) === thisMonth.slice(0, 7));
  const [percent, setPercent] = useState<string>("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!seeded && currentRow && percent === "") {
    setPercent(String(currentRow.percent));
    setSeeded(true);
  }

  const save = async () => {
    setError(null);
    const val = Number(percent);
    if (!Number.isFinite(val) || val < 0 || val > 100) { setError("Enter a percent between 0 and 100."); return; }
    try {
      await setFsc.mutateAsync({ month: thisMonth, percent: val });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save fuel surcharge");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Fuel surcharge</p>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly fuel surcharge</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle ?? "A percent of freight added to bills and invoices each month."}</p>
      </div>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="flex items-center gap-4 pt-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
            <Fuel className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{monthLabel(thisMonth)} surcharge</p>
            <p className="text-3xl font-bold tracking-tight">{currentRow ? `${currentRow.percent}%` : "Not set"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set this month&apos;s rate</CardTitle>
          <CardDescription>Applied as a percent of freight on every bill and invoice this month, and shown as its own line in settlement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Percent of freight</Label>
              <div className="flex items-center gap-2">
                <Input value={percent} onChange={(e) => { setPercent(e.target.value); setSeeded(true); }} placeholder="e.g. 12" inputMode="decimal" />
                <span className="text-lg font-semibold text-muted-foreground">%</span>
              </div>
            </div>
            <Button disabled={setFsc.isPending} onClick={() => void save()}>
              {setFsc.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save {monthLabel(thisMonth)}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Past monthly rates.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No history yet. Set a monthly rate above to start tracking.</p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium">{monthLabel(r.month)}</span>
                  <span className="text-sm font-semibold text-primary">{r.percent}%</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TruckingFuelSurchargePage() {
  return <FuelSurchargePage subtitle="A percent of freight added to your invoices each month." />;
}
