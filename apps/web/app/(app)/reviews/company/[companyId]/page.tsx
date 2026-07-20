"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, MessageSquare } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

interface ReviewRow {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  reviewerName: string;
  reviewerCompanyName: string | null;
  contextKind: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 text-sm">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? "text-amber-400" : "text-muted-foreground/30"}>★</span>
      ))}
    </div>
  );
}

/** Public company ratings page — mirrors the mobile /reviews/company/[companyId] screen. */
export default function CompanyReviewsPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = String(params.companyId ?? "");
  const supabase = getBrowserSupabase();

  const summaryQ = useQuery({
    queryKey: ["reviews", "company-summary", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<{ count: number; avg_rating: number }> => {
      const { data } = await supabase
        .from("review_summaries")
        .select("*")
        .eq("target_kind", "company")
        .eq("target_id", companyId)
        .maybeSingle();
      return (data as { count: number; avg_rating: number } | null) ?? { count: 0, avg_rating: 0 };
    },
  });

  const listQ = useQuery({
    queryKey: ["reviews", "company-list", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ReviewRow[]> => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at, reviewer_user_id, reviewer_company_id, context_kind, profiles:reviewer_user_id(name), reviewer_company:reviewer_company_id(name)")
        .eq("target_company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        id: String(r.id),
        rating: Number(r.rating ?? 0),
        comment: String(r.comment ?? ""),
        createdAt: String(r.created_at ?? ""),
        reviewerName: String(r.profiles?.name ?? "User"),
        reviewerCompanyName: (r.reviewer_company?.name ?? null) as string | null,
        contextKind: String(r.context_kind ?? ""),
      }));
    },
  });

  const reviews = useMemo(() => listQ.data ?? [], [listQ.data]);
  const summary = summaryQ.data ?? { count: 0, avg_rating: 0 };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company Ratings</h1>
        <p className="text-sm text-muted-foreground">Public reviews from completed bookings and jobs.</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 pt-6">
          <div className="grid h-13 w-13 place-items-center rounded-xl bg-primary/10 p-3">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-3xl font-bold tracking-tight">{Number(summary.avg_rating ?? 0).toFixed(1)}</p>
            <Stars rating={Math.round(Number(summary.avg_rating ?? 0))} />
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.count ?? 0} review{Number(summary.count) === 1 ? "" : "s"}
            </p>
          </div>
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No reviews yet</p>
          <p className="text-xs text-muted-foreground">Completed bookings and jobs will surface public ratings here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-center justify-between">
                  <Stars rating={r.rating} />
                  <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                </div>
                {r.comment && <p className="text-sm italic">&ldquo;{r.comment}&rdquo;</p>}
                <p className="border-t border-white/5 pt-2 text-xs font-medium text-muted-foreground">
                  {r.reviewerCompanyName ?? r.reviewerName ?? "Verified customer"} · {r.contextKind.replace(/_/g, " ")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
