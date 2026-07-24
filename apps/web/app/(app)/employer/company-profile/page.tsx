"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Circle, Star, Send, Building2, MapPin } from "lucide-react";
import { useExplore, useActionGuard } from "@/lib/explore-store";

function sampleCompanyProfile(): { company: CompanyRow; shifts: ShiftRow[]; reviews: ReviewRow[] } {
  const company: CompanyRow = {
    id: "explore-company", name: "Preview Logistics Co.", city: "Vancouver", status: "Active", created_at: new Date(Date.now() - 86400000 * 200).toISOString(),
    display_name: "Preview Logistics Co.", industry: "Warehousing", public_bio: "A Metro Vancouver 3PL running high-volume pick/pack and cross-dock operations. We hire reliable warehouse crews year-round.", website: "https://previewlogistics.example", public_contact_email: "hello@previewco.com", public_contact_phone: "+1 604 555 0100",
    legal_business_name: "Preview Logistics Co. Ltd.", business_number: "BC-8842217", business_address: "4000 Still Creek Ave, Burnaby, BC", admin_contact_name: "Alex Morgan", admin_contact_email: "alex@previewco.com", admin_contact_phone: "+1 604 555 0199",
    submitted_for_approval_at: new Date(Date.now() - 86400000 * 190).toISOString(), verified_at: new Date(Date.now() - 86400000 * 180).toISOString(), billing_setup_completed_at: new Date(Date.now() - 86400000 * 180).toISOString(),
  };
  const shifts: ShiftRow[] = [
    { id: "ex-sp-1", status: "Completed", title: "Warehouse Loader", date: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10), hourly_rate: 24 },
    { id: "ex-sp-2", status: "Posted", title: "Forklift Operator", date: new Date().toISOString().slice(0, 10), hourly_rate: 31 },
    { id: "ex-sp-3", status: "Completed", title: "Order Picker", date: new Date(Date.now() - 86400000 * 7).toISOString().slice(0, 10), hourly_rate: 26 },
  ];
  const reviews: ReviewRow[] = [
    { id: "ex-cr-1", rating: 5, comment: "Clear instructions, paid on time.", created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
    { id: "ex-cr-2", rating: 4, comment: "Good shift, well organized dock.", created_at: new Date(Date.now() - 86400000 * 20).toISOString() },
  ];
  return { company, shifts, reviews };
}

interface CompanyRow {
  id: string;
  name: string;
  city: string | null;
  status: string;
  created_at: string;
  display_name: string | null;
  industry: string | null;
  public_bio: string | null;
  website: string | null;
  public_contact_email: string | null;
  public_contact_phone: string | null;
  legal_business_name: string | null;
  business_number: string | null;
  business_address: string | null;
  admin_contact_name: string | null;
  admin_contact_email: string | null;
  admin_contact_phone: string | null;
  submitted_for_approval_at: string | null;
  verified_at: string | null;
  billing_setup_completed_at: string | null;
}

interface ShiftRow { id: string; status: string; title: string; date: string; hourly_rate: number | null }
interface ReviewRow { id: string; rating: number; comment: string | null; created_at: string }

const INDUSTRIES = ["Logistics", "Warehousing", "Manufacturing", "Retail", "Construction", "Hospitality", "Other"];

/** Employer › Company profile. Web mirror of expo/app/employer/company-profile.tsx. */
export default function EmployerCompanyProfilePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    display_name: "", industry: "", city: "", public_bio: "", website: "",
    public_contact_email: "", public_contact_phone: "",
    legal_business_name: "", business_number: "", business_address: "",
    admin_contact_name: "", admin_contact_email: "", admin_contact_phone: "",
  });

  const profileQ = useQuery({
    queryKey: ["employer", "company-profile"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", u.user.id).maybeSingle();
      let companyId = (prof as { company_id: string | null } | null)?.company_id ?? null;
      if (!companyId) {
        const { data: mem } = await supabase.from("company_users").select("company_id").eq("user_id", u.user.id).limit(1).maybeSingle();
        companyId = (mem as { company_id: string | null } | null)?.company_id ?? null;
      }
      if (!companyId) return null;
      const [companyRes, shiftsRes, reviewsRes] = await Promise.all([
        supabase.from("companies").select("id,name,city,status,created_at,display_name,industry,public_bio,website,public_contact_email,public_contact_phone,legal_business_name,business_number,business_address,admin_contact_name,admin_contact_email,admin_contact_phone,submitted_for_approval_at,verified_at,billing_setup_completed_at").eq("id", companyId).maybeSingle(),
        supabase.from("shift_posts").select("id,status,title,date,hourly_rate").eq("employer_company_id", companyId),
        supabase.from("reviews").select("id,rating,comment,created_at").eq("target_company_id", companyId).order("created_at", { ascending: false }).limit(10),
      ]);
      if (!companyRes.data) throw new Error(companyRes.error?.message ?? "Company not found");
      return {
        company: companyRes.data as CompanyRow,
        shifts: (shiftsRes.data ?? []) as ShiftRow[],
        reviews: (reviewsRes.data ?? []) as ReviewRow[],
      };
    },
  });

  const exploreData = useMemo(() => (isExploring ? sampleCompanyProfile() : null), [isExploring]);
  const company = isExploring ? exploreData!.company : (profileQ.data?.company ?? null);
  const shifts = isExploring ? exploreData!.shifts : (profileQ.data?.shifts ?? []);
  const reviews = isExploring ? exploreData!.reviews : (profileQ.data?.reviews ?? []);

  useEffect(() => {
    if (!company) return;
    setForm({
      display_name: company.display_name ?? company.name ?? "",
      industry: company.industry ?? "",
      city: company.city ?? "",
      public_bio: company.public_bio ?? "",
      website: company.website ?? "",
      public_contact_email: company.public_contact_email ?? "",
      public_contact_phone: company.public_contact_phone ?? "",
      legal_business_name: company.legal_business_name ?? "",
      business_number: company.business_number ?? "",
      business_address: company.business_address ?? "",
      admin_contact_name: company.admin_contact_name ?? "",
      admin_contact_email: company.admin_contact_email ?? "",
      admin_contact_phone: company.admin_contact_phone ?? "",
    });
  }, [company]);

  const avgRating = useMemo(() => (reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0), [reviews]);
  const totalPosted = shifts.length;
  const totalCompleted = shifts.filter((s) => s.status === "Completed").length;
  const fillRate = totalPosted > 0 ? Math.round((totalCompleted / totalPosted) * 100) : 0;

  const checklist = company ? [
    { label: "Company name", ok: Boolean((company.display_name ?? company.name)?.trim()) },
    { label: "Industry", ok: Boolean(company.industry?.trim()) },
    { label: "City / service area", ok: Boolean(company.city?.trim()) },
    { label: "Public bio (20+ chars)", ok: (company.public_bio?.trim().length ?? 0) >= 20 },
    { label: "Legal business name", ok: Boolean(company.legal_business_name?.trim()) },
    { label: "Admin contact", ok: Boolean(company.admin_contact_name?.trim() && company.admin_contact_email?.trim()) },
    { label: "Billing set up", ok: Boolean(company.billing_setup_completed_at) },
  ] : [];
  const profileComplete = checklist.every((c) => c.ok);

  const save = useMutation({
    mutationFn: async () => {
      if (!company) throw new Error("No company");
      if (form.display_name.trim().length < 2) throw new Error("Company name required");
      if (!form.industry) throw new Error("Industry required");
      if (form.city.trim().length < 2) throw new Error("City required");
      if (form.public_bio.trim().length < 20) throw new Error("Public bio must be at least 20 characters");
      if (form.legal_business_name.trim().length < 2) throw new Error("Legal business name required");
      if (form.admin_contact_name.trim().length < 2) throw new Error("Admin contact name required");
      if (!/.+@.+\..+/.test(form.admin_contact_email.trim())) throw new Error("Valid admin email required");
      const { error } = await supabase.rpc("company_update_profile", {
        p_company_id: company.id,
        p_display_name: form.display_name.trim(),
        p_industry: form.industry,
        p_city: form.city.trim(),
        p_public_bio: form.public_bio.trim(),
        p_logo_url: null,
        p_website: form.website.trim() || null,
        p_public_contact_email: form.public_contact_email.trim() || null,
        p_public_contact_phone: form.public_contact_phone.trim() || null,
        p_legal_business_name: form.legal_business_name.trim(),
        p_business_number: form.business_number.trim() || null,
        p_business_address: form.business_address.trim() || null,
        p_admin_contact_name: form.admin_contact_name.trim(),
        p_admin_contact_email: form.admin_contact_email.trim(),
        p_admin_contact_phone: form.admin_contact_phone.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employer", "company-profile"] }); setEditing(false); },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!company) throw new Error("No company");
      const { error } = await supabase.rpc("company_submit_for_approval", { p_company_id: company.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employer", "company-profile"] }),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!isExploring && profileQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading your company…</div>;
  if (!company) return <div className="p-6 text-sm text-muted-foreground">No company yet. Finish company setup first.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/40">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              {company.city && (<><MapPin className="h-3.5 w-3.5" />{company.city}</>)}
              <Badge variant="secondary">{company.status}</Badge>
              {company.verified_at && <Badge variant="success">Verified</Badge>}
            </div>
          </div>
        </div>
        {!editing && <Button variant="outline" onClick={() => { if (!guard("Edit company profile")) return; setEditing(true); }}>Edit profile</Button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Shifts posted" value={String(totalPosted)} />
        <StatCard label="Fill rate" value={`${fillRate}%`} />
        <StatCard label="Avg rating" value={avgRating > 0 ? `${avgRating.toFixed(1)} ★` : "—"} />
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit company profile</CardTitle>
            <CardDescription>Public fields are shown to workers. Business fields stay private.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public (workers will see)</p>
            <Field label="Company name *"><Input value={form.display_name} onChange={set("display_name")} /></Field>
            <div className="space-y-1.5">
              <Label>Industry *</Label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map((i) => (
                  <button key={i} type="button" onClick={() => setForm((f) => ({ ...f, industry: i }))}
                    className={`rounded-full border px-3 py-1 text-xs ${form.industry === i ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                    {i}
                  </button>
                ))}
              </div>
            </div>
            <Field label="City / service area *"><Input value={form.city} onChange={set("city")} /></Field>
            <Field label="Public bio * (min 20 chars)"><Textarea value={form.public_bio} onChange={set("public_bio")} rows={4} /></Field>
            <Field label="Website"><Input value={form.website} onChange={set("website")} /></Field>
            <Field label="Public contact email"><Input value={form.public_contact_email} onChange={set("public_contact_email")} /></Field>
            <Field label="Public contact phone"><Input value={form.public_contact_phone} onChange={set("public_contact_phone")} /></Field>

            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business (private)</p>
            <Field label="Legal business name *"><Input value={form.legal_business_name} onChange={set("legal_business_name")} /></Field>
            <Field label="Business number"><Input value={form.business_number} onChange={set("business_number")} /></Field>
            <Field label="Business address"><Input value={form.business_address} onChange={set("business_address")} /></Field>
            <Field label="Admin contact name *"><Input value={form.admin_contact_name} onChange={set("admin_contact_name")} /></Field>
            <Field label="Admin email *"><Input value={form.admin_contact_email} onChange={set("admin_contact_email")} /></Field>
            <Field label="Admin phone"><Input value={form.admin_contact_phone} onChange={set("admin_contact_phone")} /></Field>

            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <div className="flex gap-2">
              <Button disabled={save.isPending} onClick={() => { if (!guard("Save company profile")) return; save.mutate(); }}>{save.isPending ? "Saving…" : "Save changes"}</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Profile completion</CardTitle>
              <CardDescription>Complete everything to submit your company for approval.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {checklist.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                  <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                </div>
              ))}
              {profileComplete && company.status !== "Active" && company.status !== "Approved" && !company.submitted_for_approval_at && (
                <div className="pt-2">
                  {submit.error && <p className="mb-2 text-sm text-red-600">{(submit.error as Error).message}</p>}
                  <Button disabled={submit.isPending} onClick={() => { if (!guard("Submit for approval")) return; submit.mutate(); }}>
                    <Send className="mr-1.5 h-4 w-4" />{submit.isPending ? "Submitting…" : "Submit for approval"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {company.public_bio && (
            <Card>
              <CardHeader><CardTitle>About</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{company.public_bio}</p></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Reviews ({reviews.length})</CardTitle>
              {reviews.length > 0 && <CardDescription>Average {avgRating.toFixed(1)} ★</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reviews yet. Reviews appear after workers complete shifts and rate your company.</p>
              ) : reviews.map((r) => (
                <div key={r.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(r.rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.comment && <p className="mt-1.5 text-sm">{r.comment}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
