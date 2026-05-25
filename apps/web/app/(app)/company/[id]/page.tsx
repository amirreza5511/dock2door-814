"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

// Public + worker-facing company profile. Reads from the safe `companies_public`
// projection (migration 0064) — never selects billing/admin/private fields, so
// workers and unauthenticated visitors can't see anything sensitive.
interface PublicCompany {
  id: string;
  display_name: string | null;
  industry: string | null;
  city: string | null;
  public_bio: string | null;
  logo_url: string | null;
  website: string | null;
  public_contact_email: string | null;
  public_contact_phone: string | null;
  status: string | null;
  verified_at: string | null;
  created_at: string | null;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export default function CompanyPublicPage() {
  const params = useParams<{ id: string }>();
  const companyId = params.id;
  const supabase = getBrowserSupabase();

  const companyQ = useQuery({
    queryKey: ["company-public", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies_public")
        .select("id, display_name, industry, city, public_bio, logo_url, website, public_contact_email, public_contact_phone, status, verified_at, created_at")
        .eq("id", companyId)
        .maybeSingle();
      if (error) throw error;
      return data as PublicCompany | null;
    },
    enabled: Boolean(companyId),
  });

  const reviewsQ = useQuery({
    queryKey: ["company-public-reviews", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at")
        .eq("target_company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data ?? []) as ReviewRow[];
    },
    enabled: Boolean(companyId),
  });

  const company = companyQ.data;
  const reviews = reviewsQ.data ?? [];
  const avg = reviews.length === 0 ? 0 : reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const verified = Boolean(company?.verified_at) && (company?.status === "Approved" || company?.status === "Active");
  const memberSince = company?.created_at ? new Date(company.created_at).getFullYear() : null;

  if (companyQ.isLoading) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!company) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-3">
        <p className="text-sm text-muted-foreground">Company not found.</p>
        <Link href="/worker/browse-shifts" className="text-sm underline">Back to shifts</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-1">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            {company.logo_url ? (
              <img src={company.logo_url} alt="" className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-lg font-semibold">
                {(company.display_name ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <CardTitle className="text-xl flex items-center gap-2">
                {company.display_name ?? "Company"}
                {verified && <Badge variant="success">Verified</Badge>}
              </CardTitle>
              <CardDescription>
                {[company.industry, company.city].filter(Boolean).join(" · ") || "—"}
                {memberSince ? ` · Member since ${memberSince}` : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {company.public_bio && <p className="text-sm leading-relaxed">{company.public_bio}</p>}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {company.website && (
              <a href={company.website} target="_blank" rel="noreferrer" className="underline">
                {company.website}
              </a>
            )}
            {company.public_contact_email && <span>{company.public_contact_email}</span>}
            {company.public_contact_phone && <span>{company.public_contact_phone}</span>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Public profile. Billing, business registration, admin contacts and staff are private and never shown here.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reviews from workers</CardTitle>
          <CardDescription>
            {reviews.length === 0
              ? "No reviews yet."
              : `${avg.toFixed(1)} ★ · ${reviews.length} review${reviews.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        {reviews.length > 0 && (
          <CardContent className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-yellow-500">
                    {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                {r.comment && <p className="mt-1 text-muted-foreground">{r.comment}</p>}
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
