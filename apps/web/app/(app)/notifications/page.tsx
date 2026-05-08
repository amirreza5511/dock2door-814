"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
}

const KIND_VARIANT: Record<string, "success" | "warning" | "secondary" | "default"> = {
  booking: "default" as any,
  service: "warning",
  shift: "success",
  system: "secondary",
  dispute: "destructive" as any,
  thread_message: "default" as any,
};

const KIND_ICON: Record<string, string> = {
  booking: "🏭",
  service: "🔧",
  shift: "👷",
  system: "⚙️",
  dispute: "⚠️",
  thread_message: "💬",
};

export default function NotificationsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const notifsQ = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, kind, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
      if (error) {
        // Fallback direct update
        const { error: e2 } = await supabase
          .from("notifications")
          .update({ read: true })
          .eq("id", id);
        if (e2) throw e2;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const displayed = filter === "unread"
    ? (notifsQ.data ?? []).filter((n) => !n.read)
    : (notifsQ.data ?? []);

  const unreadCount = (notifsQ.data ?? []).filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {f === "all" ? `All (${(notifsQ.data ?? []).length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {notifsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : displayed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-2xl mb-2">🔔</p>
            <p className="text-sm text-muted-foreground">
              {filter === "unread" ? "No unread notifications." : "No notifications yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {displayed.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border p-4 transition-colors ${
                !n.read ? "bg-card border-primary/30" : "bg-muted/20 border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg shrink-0">{KIND_ICON[n.kind] ?? "📬"}</span>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-medium ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>
                        {n.title}
                      </span>
                      <Badge variant={KIND_VARIANT[n.kind] ?? "secondary"} className="text-xs">
                        {n.kind}
                      </Badge>
                      {!n.read && (
                        <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
                  </div>
                </div>
                {!n.read && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-xs"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
