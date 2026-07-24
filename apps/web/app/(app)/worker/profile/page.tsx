"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MapPin, Star, ShieldCheck } from "lucide-react";
import { SKILL_GROUPS, ALL_SKILL_IDS, type SkillId } from "@/lib/skills";
import { useExplore, useActionGuard } from "@/lib/explore-store";

type Skill = SkillId;

interface WorkerProfileRow {
  id: string;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  skills: string[] | null;
  coverage_cities: string[] | null;
  hourly_expectation: number | null;
  verified: boolean | null;
  status: string | null;
  tagline: string | null;
  phone: string | null;
  languages: string[] | null;
  experience_years: number | null;
  transportation: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  references_text: string | null;
  work_history: string | null;
  education: string | null;
  preferred_shift: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

interface PrivateInfoRow {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  gender: string | null;
  work_permit_status: string | null;
  bank_institution_number: string | null;
  bank_transit_number: string | null;
  bank_account_number: string | null;
  bank_account_holder_name: string | null;
}

const SAMPLE_PROFILE: WorkerProfileRow = {
  id: "ex-wp-1", user_id: "explore-user", display_name: "Alex Morgan", bio: "Reliable warehouse generalist with forklift and reach-truck experience. Comfortable with fast-paced pick/pack environments.", skills: ["forklift", "general_labour"], coverage_cities: ["Vancouver", "Burnaby", "Richmond"], hourly_expectation: 26, verified: true, status: "Active", tagline: "Certified forklift operator", phone: "+1 604 555 0199", languages: ["English", "Spanish"], experience_years: 5, transportation: "Own vehicle", emergency_contact_name: "J. Morgan", emergency_contact_phone: "+1 604 555 0111", references_text: "Available on request", work_history: "Preview Logistics Co. (2022–present), Harbour Freight Ltd. (2019–2022)", education: "Forklift certification, WHMIS", preferred_shift: "Day", linkedin_url: "", website_url: "" };

export default function WorkerProfilePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();

  const profileQuery = useQuery({
    queryKey: ["worker", "profile"],
    enabled: !isExploring,
    queryFn: async (): Promise<WorkerProfileRow | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from("worker_profiles")
        .select(
          "id,user_id,display_name,bio,skills,coverage_cities,hourly_expectation,verified,status,tagline,phone,languages,experience_years,transportation,emergency_contact_name,emergency_contact_phone,references_text,work_history,education,preferred_shift,linkedin_url,website_url",
        )
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as WorkerProfileRow | null;
    },
  });

  const privateQuery = useQuery({
    queryKey: ["worker", "private-info"],
    enabled: !isExploring,
    queryFn: async (): Promise<PrivateInfoRow | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("worker_private_info")
        .select(
          "address_line1,address_line2,city,province,postal_code,country,nationality,date_of_birth,gender,work_permit_status,bank_institution_number,bank_transit_number,bank_account_number,bank_account_holder_name",
        )
        .eq("user_id", u.user.id)
        .maybeSingle();
      return (data ?? null) as PrivateInfoRow | null;
    },
  });

  const ratingQuery = useQuery({
    queryKey: ["worker", "rating-summary"],
    enabled: !isExploring,
    queryFn: async (): Promise<{ count: number; avg_rating: number } | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("review_summaries")
        .select("count, avg_rating")
        .eq("target_kind", "worker")
        .eq("target_id", u.user.id)
        .maybeSingle();
      return (data ?? null) as { count: number; avg_rating: number } | null;
    },
  });

  const p = isExploring ? SAMPLE_PROFILE : profileQuery.data;

  // ── Public/profile edit state ─────────────────────────────────────
  const [bio, setBio] = useState("");
  const [rate, setRate] = useState("");
  const [cities, setCities] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tagline, setTagline] = useState("");
  const [phone, setPhone] = useState("");
  const [languages, setLanguages] = useState("");
  const [experience, setExperience] = useState("");
  const [transport, setTransport] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [workHistory, setWorkHistory] = useState("");
  const [education, setEducation] = useState("");
  const [references, setReferences] = useState("");
  const [preferredShift, setPreferredShift] = useState("");

  useEffect(() => {
    if (!p) return;
    setBio(p.bio ?? "");
    setRate(String(p.hourly_expectation ?? ""));
    setCities((p.coverage_cities ?? []).join(", "));
    setSkills((p.skills ?? []).filter((s): s is Skill => (ALL_SKILL_IDS as readonly string[]).includes(s)));
    setTagline(p.tagline ?? "");
    setPhone(p.phone ?? "");
    setLanguages((p.languages ?? []).join(", "));
    setExperience(String(p.experience_years ?? ""));
    setTransport(p.transportation ?? "");
    setEmergencyName(p.emergency_contact_name ?? "");
    setEmergencyPhone(p.emergency_contact_phone ?? "");
    setLinkedin(p.linkedin_url ?? "");
    setWebsite(p.website_url ?? "");
    setWorkHistory(p.work_history ?? "");
    setEducation(p.education ?? "");
    setReferences(p.references_text ?? "");
    setPreferredShift(p.preferred_shift ?? "");
  }, [p]);

  // ── Private info edit state ───────────────────────────────────────
  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("Canada");
  const [nationality, setNationality] = useState("");
  const [bankInstitution, setBankInstitution] = useState("");
  const [bankTransit, setBankTransit] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankHolder, setBankHolder] = useState("");

  useEffect(() => {
    const d = privateQuery.data;
    if (!d) return;
    setAddr1(d.address_line1 ?? "");
    setAddr2(d.address_line2 ?? "");
    setCity(d.city ?? "");
    setProvince(d.province ?? "");
    setPostal(d.postal_code ?? "");
    setCountry(d.country ?? "Canada");
    setNationality(d.nationality ?? "");
    setBankInstitution(d.bank_institution_number ?? "");
    setBankTransit(d.bank_transit_number ?? "");
    setBankAccount(d.bank_account_number ?? "");
    setBankHolder(d.bank_account_holder_name ?? "");
  }, [privateQuery.data]);

  const createProfile = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in.");
      const displayName = (u.user.user_metadata?.name as string | undefined) ?? u.user.email?.split("@")[0] ?? "Worker";
      const { error } = await supabase.rpc("ensure_my_worker_profile", { p_display_name: displayName });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "profile"] }),
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_my_worker_profile", {
        p_bio: bio,
        p_skills: skills,
        p_coverage_cities: cities.split(",").map((s) => s.trim()).filter(Boolean),
        p_hourly_expectation: Number(rate) || 0,
        p_tagline: tagline,
        p_phone: phone,
        p_languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
        p_experience_years: Number(experience) || 0,
        p_transportation: transport,
        p_emergency_contact_name: emergencyName,
        p_emergency_contact_phone: emergencyPhone,
        p_references_text: references,
        p_work_history: workHistory,
        p_education: education,
        p_preferred_shift: preferredShift,
        p_linkedin_url: linkedin,
        p_website_url: website,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "profile"] }),
  });

  const savePrivate = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in.");
      const encrypt = async (v: string): Promise<string | null> => {
        if (!v) return null;
        const { data, error } = await supabase.rpc("encrypt_pii", { p_value: v });
        if (error) throw new Error(`Encryption failed: ${error.message}`);
        return data as string;
      };
      const [accEnc, transitEnc, instEnc] = await Promise.all([
        encrypt(bankAccount),
        encrypt(bankTransit),
        encrypt(bankInstitution),
      ]);
      const { error } = await supabase.from("worker_private_info").upsert(
        {
          user_id: u.user.id,
          address_line1: addr1 || null,
          address_line2: addr2 || null,
          city: city || null,
          province: province || null,
          postal_code: postal || null,
          country: country || "Canada",
          nationality: nationality || null,
          bank_institution_number: bankInstitution || null,
          bank_transit_number: bankTransit || null,
          bank_account_number: bankAccount || null,
          bank_account_holder_name: bankHolder || null,
          bank_account_number_enc: accEnc,
          bank_transit_number_enc: transitEnc,
          bank_institution_number_enc: instEnc,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "private-info"] }),
  });

  const toggleSkill = (s: Skill) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const rating = isExploring ? { count: 24, avg_rating: 4.8 } : ratingQuery.data;

  if (!isExploring && profileQuery.isLoading) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">Loading your profile…</div>;
  }

  if (!p) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card>
          <CardHeader>
            <CardTitle>Create your worker profile</CardTitle>
            <CardDescription>
              Build a resume-style profile with skills, coverage cities, and payment details so companies can hire you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => createProfile.mutate()} disabled={createProfile.isPending}>
              {createProfile.isPending ? "Creating…" : "Create my profile"}
            </Button>
            {createProfile.error && <p className="text-sm text-red-600">{(createProfile.error as Error).message}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          Your resume-style worker profile. Employers see your public info; private and payment details are never shown to them.
        </p>
      </div>

      {/* Hero summary */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
            {(p.display_name ?? "W").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold">{p.display_name ?? "Worker"}</span>
              {p.verified ? (
                <Badge variant="success" className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </Badge>
              ) : null}
            </div>
            {p.tagline ? <div className="truncate text-sm text-muted-foreground">{p.tagline}</div> : null}
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {rating && rating.count > 0 ? (
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {Number(rating.avg_rating).toFixed(1)} ({rating.count})
                </span>
              ) : (
                <span>No ratings yet</span>
              )}
              {(p.coverage_cities ?? []).length > 0 ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {(p.coverage_cities ?? []).join(", ")}
                </span>
              ) : null}
            </div>
          </div>
          <Badge variant={p.status === "Active" ? "success" : "warning"}>{p.status ?? "Active"}</Badge>
        </CardContent>
      </Card>

      {/* Public profile */}
      <Card>
        <CardHeader>
          <CardTitle>Public profile</CardTitle>
          <CardDescription>This is what employers see when reviewing your applications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Reliable forklift operator" />
            </div>
            <div>
              <Label>Hourly expectation ($)</Label>
              <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="24" />
            </div>
          </div>
          <div>
            <Label>Bio</Label>
            <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short summary about your experience and what you're great at." />
          </div>
          <div className="space-y-3">
            <Label>Skills</Label>
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
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Coverage cities</Label>
              <Input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Toronto, Mississauga" />
            </div>
            <div>
              <Label>Languages</Label>
              <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, French" />
            </div>
            <div>
              <Label>Years of experience</Label>
              <Input type="number" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="3" />
            </div>
            <div>
              <Label>Transportation</Label>
              <Input value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="Own vehicle / Transit" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
            </div>
            <div>
              <Label>LinkedIn URL</Label>
              <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
            </div>
            <div>
              <Label>Website URL</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Emergency contact name</Label>
              <Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
            </div>
            <div>
              <Label>Emergency contact phone</Label>
              <Input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Preferred shift</Label>
            <Input value={preferredShift} onChange={(e) => setPreferredShift(e.target.value)} placeholder="Day / Night / Swing" />
          </div>
          <div>
            <Label>Work history</Label>
            <Textarea rows={4} value={workHistory} onChange={(e) => setWorkHistory(e.target.value)} placeholder="Most recent jobs, dates, employers…" />
          </div>
          <div>
            <Label>Education & training</Label>
            <Textarea rows={2} value={education} onChange={(e) => setEducation(e.target.value)} placeholder="Diplomas, courses, certifications…" />
          </div>
          <div>
            <Label>References</Label>
            <Textarea rows={2} value={references} onChange={(e) => setReferences(e.target.value)} placeholder="Name, role, company, phone" />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => { if (!guard("Save your profile")) return; saveProfile.mutate(); }} disabled={saveProfile.isPending}>
              {saveProfile.isPending ? "Saving…" : "Save public profile"}
            </Button>
            {saveProfile.isSuccess && (
              <span className="flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </span>
            )}
            {saveProfile.error && <span className="text-sm text-red-600">{(saveProfile.error as Error).message}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Private info */}
      <Card>
        <CardHeader>
          <CardTitle>Private information</CardTitle>
          <CardDescription>
            Home address and payment details. Sensitive fields are encrypted and never shown to employers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Address line 1</Label>
              <Input value={addr1} onChange={(e) => setAddr1(e.target.value)} />
            </div>
            <div>
              <Label>Address line 2</Label>
              <Input value={addr2} onChange={(e) => setAddr2(e.target.value)} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label>Province / State</Label>
              <Input value={province} onChange={(e) => setProvince(e.target.value)} />
            </div>
            <div>
              <Label>Postal code</Label>
              <Input value={postal} onChange={(e) => setPostal(e.target.value)} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <div>
              <Label>Nationality</Label>
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Bank account holder name</Label>
              <Input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} />
            </div>
            <div>
              <Label>Institution number</Label>
              <Input value={bankInstitution} onChange={(e) => setBankInstitution(e.target.value)} />
            </div>
            <div>
              <Label>Transit number</Label>
              <Input value={bankTransit} onChange={(e) => setBankTransit(e.target.value)} />
            </div>
            <div>
              <Label>Account number</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => { if (!guard("Save your information")) return; savePrivate.mutate(); }} disabled={savePrivate.isPending}>
              {savePrivate.isPending ? "Saving…" : "Save private info"}
            </Button>
            {savePrivate.isSuccess && (
              <span className="flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </span>
            )}
            {savePrivate.error && <span className="text-sm text-red-600">{(savePrivate.error as Error).message}</span>}
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Manage your certifications and government ID uploads on the{" "}
        <a href="/worker/certifications" className="font-medium text-primary hover:underline">
          Certifications
        </a>{" "}
        page.
      </p>
    </div>
  );
}
