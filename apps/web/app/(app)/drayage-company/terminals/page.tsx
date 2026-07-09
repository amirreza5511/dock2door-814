"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Anchor, Search, Ship, Warehouse } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Terminal {
  id: string;
  name: string;
  code: string | null;
  terminal_type: string | null;
  operator: string | null;
  city: string | null;
  address: string | null;
  [k: string]: unknown;
}

const TYPES = ["all", "Port", "Rail", "Yard", "Depot"] as const;

function useTerminals(type: string, search: string) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["terminals", type, search],
    queryFn: async (): Promise<Terminal[]> => {
      let q = supabase.from("terminals").select("*").eq("is_active", true).order("terminal_type").order("name");
      if (type !== "all") q = q.eq("terminal_type", type);
      if (search.trim()) {
        const s = search.trim();
        q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%,city.ilike.%${s}%,operator.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as Terminal[] | null) ?? [];
    },
  });
}

export default function TerminalsPage() {
  const [type, setType] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const q = useTerminals(type, search);
  const terminals = useMemo(() => q.data ?? [], [q.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Terminals &amp; depots</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ports, rail ramps, yards and container depots you dispatch to.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, code, city or operator" className="pl-9" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${type === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : terminals.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-14 text-center"><Anchor className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No terminals found.</p></CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {terminals.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-1.5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium">
                    {t.terminal_type === "Port" ? <Ship className="h-4 w-4 text-primary" /> : <Warehouse className="h-4 w-4 text-primary" />}
                    {t.name}
                  </div>
                  {t.terminal_type ? <Badge variant="secondary">{t.terminal_type}</Badge> : null}
                </div>
                {t.code ? <p className="text-xs font-mono text-muted-foreground">{t.code}</p> : null}
                <p className="text-sm text-muted-foreground">{[t.operator, t.city].filter(Boolean).join(" · ") || "—"}</p>
                {t.address ? <p className="text-xs text-muted-foreground">{t.address}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
