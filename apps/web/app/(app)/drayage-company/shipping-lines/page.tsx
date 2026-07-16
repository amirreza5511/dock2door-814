"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ship, Plus, Globe, Building2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface LineRow {
  id: string;
  company_id: string | null;
  name: string;
  scac: string | null;
}

export default function DrayageShippingLinesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [scac, setScac] = useState("");

  const linesQ = useQuery({
    queryKey: ["shipping-lines", "manage"],
    queryFn: async (): Promise<LineRow[]> => {
      const { data, error } = await supabase.from("shipping_lines").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return (data as LineRow[] | null) ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("add_shipping_line", { p_name: name.trim(), p_scac: scac.trim().toUpperCase() });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["shipping-lines"] });
      setShowAdd(false);
      setName("");
      setScac("");
    },
  });

  const lines = linesQ.data ?? [];
  const custom = lines.filter((l) => l.company_id);
  const global = lines.filter((l) => !l.company_id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
          <h1 className="text-2xl font-semibold tracking-tight">Shipping lines</h1>
          <p className="mt-1 text-sm text-muted-foreground">Steamship lines you can assign to container orders.</p>
        </div>
        <Button onClick={() => { setName(""); setScac(""); setShowAdd(true); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add line
        </Button>
      </div>

      {linesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {custom.length > 0 ? (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                <Building2 className="h-3.5 w-3.5" /> Your lines
              </h2>
              {custom.map((l) => (
                <LineCard key={l.id} line={l} />
              ))}
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Globe className="h-3.5 w-3.5" /> Global lines
            </h2>
            {global.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">No shipping lines yet.</CardContent>
              </Card>
            ) : (
              global.map((l) => <LineCard key={l.id} line={l} />)
            )}
          </section>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add shipping line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Shipping line name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Swire Shipping" />
            </div>
            <div className="space-y-1.5">
              <Label>SCAC code (optional)</Label>
              <Input value={scac} onChange={(e) => setScac(e.target.value.toUpperCase())} placeholder="e.g. CHVW" />
            </div>
            {addMutation.isError ? <p className="text-sm text-red-500">{(addMutation.error as Error).message}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || name.trim().length < 2}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineCard({ line }: { line: LineRow }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15">
          <Ship className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{line.name}</p>
          {line.scac ? <p className="text-sm text-muted-foreground">{line.scac}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
