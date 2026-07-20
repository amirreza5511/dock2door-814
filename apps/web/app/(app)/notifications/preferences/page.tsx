"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Mail, MessageSquare } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Prefs {
  email_enabled?: boolean;
  push_enabled?: boolean;
  sms_enabled?: boolean;
}

/** Notification preferences — mirrors the mobile /notifications/preferences screen. */
export default function NotificationPreferencesPage() {
  const supabase = getBrowserSupabase();
  const [email, setEmail] = useState<boolean>(true);
  const [push, setPush] = useState<boolean>(true);
  const [sms, setSms] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: async (): Promise<Prefs> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return {};
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return (data as Prefs | null) ?? { email_enabled: true, push_enabled: true, sms_enabled: false };
    },
  });

  useEffect(() => {
    const d = q.data;
    if (d) {
      setEmail(Boolean(d.email_enabled ?? true));
      setPush(Boolean(d.push_enabled ?? true));
      setSms(Boolean(d.sms_enabled ?? false));
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: u.user.id,
          email_enabled: email,
          push_enabled: push,
          sms_enabled: sms,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => setStatus("Saved — your notification preferences have been updated."),
    onError: (e: Error) => setStatus(`Unable to save: ${e.message}`),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notification Preferences</h1>
        <p className="text-sm text-muted-foreground">Choose how you want to be notified.</p>
      </div>

      <Card>
        <CardContent className="divide-y divide-white/5 pt-2">
          <PrefRow
            icon={<Mail className="h-4 w-4 text-blue-400" />}
            label="Email"
            description="Booking, invoice and shift updates by email"
            value={email}
            onChange={setEmail}
          />
          <PrefRow
            icon={<Bell className="h-4 w-4 text-primary" />}
            label="Push"
            description="Real-time alerts in the mobile app"
            value={push}
            onChange={setPush}
          />
          <PrefRow
            icon={<MessageSquare className="h-4 w-4 text-emerald-400" />}
            label="SMS"
            description="Text messages for time-critical events"
            value={sms}
            onChange={setSms}
          />
        </CardContent>
      </Card>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <Button className="w-full" size="lg" onClick={() => save.mutate()} disabled={save.isPending || q.isLoading}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );
}

function PrefRow({
  icon,
  label,
  description,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
