"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Badge } from "./ui/badge";

export function OperatorCard({ stationName }: { stationName: string }) {
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");

  useEffect(() => {
    const supabase = getBrowserSupabase();
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", data.user.id)
        .maybeSingle();
      const fn = (prof as { full_name?: string | null } | null)?.full_name;
      if (fn) setName(fn);
    })();
  }, []);

  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-2 text-sm">
      <Badge variant="secondary">{stationName}</Badge>
      <div className="flex-1">
        <div className="font-medium">{name || email || "Operator"}</div>
        {name && email && <div className="text-xs text-muted-foreground">{email}</div>}
      </div>
      <div className="text-xs text-muted-foreground">{new Date().toLocaleString()}</div>
    </div>
  );
}
