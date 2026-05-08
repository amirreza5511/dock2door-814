"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ReviewRow {
  id: string;
  target_kind: string;
  target_user_id: string | null;
  target_company_id: string | null;
  context_kind: string;
  context_id: string;
  rating: number;
  comment: string;
  created_at: string;
  reviewer_name?: string | null;
  reviewer_email?: string | null;
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? "text-amber-400" : "text-muted-foreground/30"}>
          ★
        </span>
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const supabase = getBrowserSupabase();
  const [tab, setTab] = useState<"received" | "given">("received");

  const receivedQ = useQuery({
    queryKey: ["reviews", "received"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, company_id")
        .eq("id", user.id)
        .single();

      const { data, error } = await supabase
        .from("reviews")
        .select(`id, target_kind, target_user_id, target_company_id, context_kind, context_id, rating, comment, created_at,
          profiles!reviewer_user_id(name, email)`)
        .or(
          `target_user_id.eq.${profile?.id}${profile?.company_id ? `,target_company_id.eq.${profile.company_id}` : ""}`
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        reviewer_name: r.profiles?.name ?? null,
        reviewer_email: r.profiles?.email ?? null,
      })) as ReviewRow[];
    },
  });

  const givenQ = useQuery({
    queryKey: ["reviews", "given"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("reviews")
        .select(`id, target_kind, target_user_id, target_company_id, context_kind, context_id, rating, comment, created_at`)
        .eq("reviewer_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  const activeQ = tab === "received" ? receivedQ : givenQ;

  const avgRating = (activeQ.data ?? []).length > 0
    ? (activeQ.data ?? []).reduce((s, r) => s + r.rating, 0) / (activeQ.data ?? []).length
    : null;

  const cols: Column<ReviewRow>[] = [
    {
      key: "rating",
      header: "Rating",
      render: (r) => (
        <div>
          <Stars rating={r.rating} />
          <div className="text-xs text-muted-foreground">{r.rating}/5</div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.rating,
    },
    {
      key: "comment",
      header: "Comment",
      render: (r) => r.comment ? (
        <p className="text-sm max-w-xs line-clamp-3">{r.comment}</p>
      ) : (
        <span className="text-xs text-muted-foreground">No comment</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r) => <Badge variant="secondary" className="text-xs capitalize">{r.target_kind}</Badge>,
      sortable: true,
      sortValue: (r) => r.target_kind,
    },
    {
      key: "context",
      header: "Context",
      render: (r) => (
        <Badge variant="outline" className="text-xs capitalize">{r.context_kind.replace(/_/g, " ")}</Badge>
      ),
    },
    ...(tab === "received" ? [{
      key: "reviewer",
      header: "From",
      render: (r: ReviewRow) => (
        <div>
          <div className="text-sm">{r.reviewer_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{r.reviewer_email ?? ""}</div>
        </div>
      ),
    } satisfies Column<ReviewRow>] : []),
    {
      key: "created",
      header: "Date",
      render: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>,
      sortable: true,
      sortValue: (r) => r.created_at,
    },
  ];

  const ratingDist = [5, 4, 3, 2, 1].map((n) => ({
    stars: n,
    count: (activeQ.data ?? []).filter((r) => r.rating === n).length,
    pct: (activeQ.data ?? []).length > 0
      ? Math.round(((activeQ.data ?? []).filter((r) => r.rating === n).length / (activeQ.data ?? []).length) * 100)
      : 0,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">Your reputation on the platform.</p>
      </div>

      <div className="flex gap-1 border-b">
        {(["received", "given"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average rating</CardDescription>
            <CardTitle className="text-3xl">{avgRating != null ? avgRating.toFixed(1) : "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            {avgRating != null && <Stars rating={Math.round(avgRating)} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total reviews</CardDescription>
            <CardTitle className="text-3xl">{(activeQ.data ?? []).length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>5-star reviews</CardDescription>
            <CardTitle className="text-3xl">{(activeQ.data ?? []).filter((r) => r.rating === 5).length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {(activeQ.data ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Rating breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {ratingDist.map((d) => (
              <div key={d.stars} className="flex items-center gap-3">
                <div className="w-10 text-sm text-right shrink-0">{d.stars}★</div>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${d.pct}%` }} />
                </div>
                <div className="w-12 text-xs text-muted-foreground text-right shrink-0">{d.count} ({d.pct}%)</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tab === "received" ? "Reviews received" : "Reviews given"}</CardTitle>
          <CardDescription>{(activeQ.data ?? []).length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={activeQ.data ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            isLoading={activeQ.isLoading}
            error={activeQ.error as Error | null}
            searchPlaceholder="Search reviews…"
            filters={[
              { value: "5star", label: "5 stars", predicate: (r: ReviewRow) => r.rating === 5 },
              { value: "4star", label: "4 stars", predicate: (r: ReviewRow) => r.rating === 4 },
              { value: "low", label: "1-3 stars", predicate: (r: ReviewRow) => r.rating <= 3 },
            ]}
            emptyMessage={tab === "received" ? "No reviews received yet." : "You haven't reviewed anyone yet."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
