"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { SKILL_GROUPS, type SkillId } from "@/lib/skills";

export default function CreateShiftPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    title: "",
    location_address: "",
    location_city: "",
    date: "",
    start_time: "08:00",
    end_time: "17:00",
    hourly_rate: 20,
    workers_needed: 1,
    requirements: "",
    notes: "",
  });
  const [skills, setSkills] = useState<SkillId[]>([]);
  const [isOngoing, setIsOngoing] = useState(false);
  const toggleSkill = (s: SkillId) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const v = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Gate posting on company profile + billing completion.
  const readinessQ = useQuery({
    queryKey: ["employer", "create-shift", "readiness"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: m } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("company_role", ["Owner", "Staff", "Manager", "Supervisor"])
        .eq("status", "Active")
        .limit(1)
        .maybeSingle();
      if (!m?.company_id) return null;
      const [companyRes, profileRes, billingRes, canPostRes] = await Promise.all([
        supabase
          .from("companies")
          .select("id, status, billing_setup_completed_at, profile_completed_at, industry, public_bio, legal_business_name, admin_contact_email")
          .eq("id", m.company_id)
          .maybeSingle(),
        supabase.rpc("company_profile_is_complete", { p_company_id: m.company_id }),
        supabase.rpc("company_billing_is_complete", { p_company_id: m.company_id }),
        supabase.rpc("company_can_post_paid_shifts", { p_company_id: m.company_id }),
      ]);
      return {
        row: companyRes.data as null | {
          id: string;
          status: string | null;
          billing_setup_completed_at: string | null;
          profile_completed_at: string | null;
          industry: string | null;
          public_bio: string | null;
          legal_business_name: string | null;
          admin_contact_email: string | null;
        },
        profileComplete: profileRes.error ? null : Boolean(profileRes.data),
        billingComplete: billingRes.error ? null : Boolean(billingRes.data),
        canPostPaid: canPostRes.error ? null : Boolean(canPostRes.data),
        companyId: m.company_id as string,
      };
    },
  });
  const readiness = readinessQ.data?.row ?? null;
  const profileReady = readinessQ.data?.profileComplete ?? Boolean(
    readiness?.profile_completed_at ||
      (readiness?.industry &&
        (readiness?.public_bio?.length ?? 0) >= 20 &&
        readiness?.legal_business_name &&
        readiness?.admin_contact_email)
  );
  const billingReady = readinessQ.data?.billingComplete ?? Boolean(readiness?.billing_setup_completed_at);
  const companyStatus = readiness?.status ?? "";
  const postingBlocked = companyStatus === "Suspended";
  const canPostPaid = readinessQ.data?.canPostPaid ?? (profileReady && billingReady && !postingBlocked);
  const paid = form.hourly_rate > 0;
  const gateBlocked = paid && !canPostPaid;

  const create = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: membership, error: memErr } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("company_role", ["Owner", "Staff", "Manager", "Supervisor"])
        .eq("status", "Active")
        .limit(1)
        .single();

      if (memErr || !membership?.company_id) throw new Error("No company associated with your account.");
      if (skills.length === 0) throw new Error("Pick at least one skill this job requires.");

      if (paid) {
        // Re-check server-side at submit so we never trust stale client state.
        const { data: canPost } = await supabase.rpc("company_can_post_paid_shifts", { p_company_id: membership.company_id });
        if (canPost === false) {
          if (postingBlocked) throw new Error(`Company is ${companyStatus}. Contact support.`);
          if (!profileReady) throw new Error("Complete your company profile (industry, bio, legal name, admin contact) before posting paid shifts.");
          if (!billingReady) throw new Error("Set up billing before posting paid shifts.");
          throw new Error("Your company cannot post paid shifts right now. Contact support.");
        }
      }

      const { error } = await supabase.from("shift_posts").insert({
        employer_company_id: membership.company_id,
        title: form.title.trim(),
        category: skills[0],
        skills,
        is_ongoing: isOngoing,
        location_address: form.location_address.trim(),
        location_city: form.location_city.trim(),
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        hourly_rate: form.hourly_rate,
        workers_needed: form.workers_needed,
        requirements: form.requirements.trim(),
        notes: form.notes.trim(),
        status: "Posted",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "shifts"] });
      router.push("/employer");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Post a shift</h1>
          <p className="text-sm text-muted-foreground">Create a new labour shift posting for workers to apply.</p>
        </div>
        <Link href="/employer"><Button variant="secondary">Cancel</Button></Link>
      </div>

      {create.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      {paid && postingBlocked && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Company is {companyStatus}. You cannot post shifts — contact support.
        </div>
      )}
      {paid && !postingBlocked && (!profileReady || !billingReady) && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800 space-y-2">
          <p className="font-medium">Cannot post paid shifts yet:</p>
          <ul className="list-disc pl-5 space-y-1">
            {!profileReady && (
              <li>
                Company profile incomplete —{" "}
                <Link href="/employer" className="underline">complete profile</Link> (industry, bio, legal name, admin contact).
              </li>
            )}
            {!billingReady && (
              <li>
                Billing not set up —{" "}
                <Link href="/employer/billing" className="underline">set up billing</Link>.
              </li>
            )}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Shift details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Shift / role title *</Label>
              <Input value={form.title} onChange={set("title")} placeholder="e.g. Forklift Operator — Delta warehouse" />
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={set("date")} />
            </div>
            <div className="space-y-1.5">
              <Label>{isOngoing ? "Positions open" : "Workers needed"}</Label>
              <Input type="number" min={1} value={form.workers_needed} onChange={set("workers_needed")} />
            </div>
            <div className="space-y-1.5">
              <Label>Start time *</Label>
              <Input type="time" value={form.start_time} onChange={set("start_time")} />
            </div>
            <div className="space-y-1.5">
              <Label>End time *</Label>
              <Input type="time" value={form.end_time} onChange={set("end_time")} />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly rate ($)</Label>
              <Input type="number" min={0} step={0.5} value={form.hourly_rate} onChange={set("hourly_rate")} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.location_city} onChange={set("location_city")} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Address</Label>
              <Input value={form.location_address} onChange={set("location_address")} placeholder="1234 Industrial Way" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Required skills</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Pick every skill this job needs — workers are matched on these.</p>
          {SKILL_GROUPS.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
              <div className="flex flex-wrap gap-2">
                {group.skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      skills.includes(skill.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {skill.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="flex items-center gap-3 rounded-md border border-border p-3">
            <input type="checkbox" checked={isOngoing} onChange={(e) => setIsOngoing(e.target.checked)} className="h-4 w-4" />
            <span className="text-sm">
              <span className="font-medium">Ongoing job opening</span>{" "}
              <span className="text-muted-foreground">— a recurring/continuous role, not a single dated shift. The date is the start date.</span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Requirements &amp; notes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Certification requirements</Label>
            <Input value={form.requirements} onChange={set("requirements")} placeholder="e.g. Forklift certification required" />
          </div>
          <div className="space-y-1.5">
            <Label>Additional notes</Label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Any special instructions for workers…"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/employer"><Button variant="secondary">Cancel</Button></Link>
        <Button
          disabled={!form.title || !form.date || create.isPending || gateBlocked}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Posting…" : gateBlocked ? "Complete profile & billing to post" : "Post shift"}
        </Button>
      </div>
    </div>
  );
}
