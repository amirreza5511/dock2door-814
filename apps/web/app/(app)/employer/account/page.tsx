"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Camera, Building2, ChevronRight, Star, Bell, Shield } from "lucide-react";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const AVATAR_BUCKET = "worker-photos";

interface ProfileRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profile_image: string | null;
  company_id: string | null;
}

interface CompanyLite {
  id: string;
  name: string;
  status: string;
}

/**
 * Employer › My account. Web mirror of expo/app/employer/account.tsx.
 * Reads/writes the same `profiles` row and uploads avatars to the same
 * `worker-photos` bucket the mobile app uses.
 */
export default function EmployerAccountPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const profileQ = useQuery({
    queryKey: ["employer", "account"],
    enabled: !isExploring,
    queryFn: async (): Promise<{ profile: ProfileRow; email: string; company: CompanyLite | null }> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, phone, profile_image, company_id")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      const profile = (data ?? { id: u.user.id, name: null, email: null, phone: null, profile_image: null, company_id: null }) as ProfileRow;
      let company: CompanyLite | null = null;
      if (profile.company_id) {
        const { data: c } = await supabase.from("companies").select("id, name, status").eq("id", profile.company_id).maybeSingle();
        company = (c as CompanyLite | null) ?? null;
      }
      return { profile, email: u.user.email ?? profile.email ?? "", company };
    },
  });

  useEffect(() => {
    if (isExploring) {
      setName("Alex Morgan");
      setPhone("+1 604 555 0199");
      return;
    }
    if (profileQ.data) {
      setName(profileQ.data.profile.name ?? "");
      setPhone(profileQ.data.profile.phone ?? "");
      setAvatarUrl(profileQ.data.profile.profile_image ?? null);
    }
  }, [profileQ.data, isExploring]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      if (name.trim().length < 2) throw new Error("Please enter your full name.");
      const { error } = await supabase
        .from("profiles")
        .update({ name: name.trim(), phone: phone.trim() })
        .eq("id", u.user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employer", "account"] }),
  });

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!guard("Change your photo")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const ext = file.type.includes("png") ? "png" : "jpg";
      const path = `${u.user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? null;
      const { error: updErr } = await supabase.from("profiles").update({ profile_image: url }).eq("id", u.user.id);
      if (updErr) throw updErr;
      setAvatarUrl(url);
      qc.invalidateQueries({ queryKey: ["employer", "account"] });
    } catch (err) {
      console.error("[employer/account] avatar upload failed", err);
      alert(err instanceof Error ? err.message : "Could not upload photo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const email = isExploring ? "alex@previewco.com" : (profileQ.data?.email ?? "");
  const company = isExploring ? { id: "explore-company", name: "Preview Logistics Co.", status: "Active" } : (profileQ.data?.company ?? null);
  const initials = (name || email || "E").slice(0, 1).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My account</h1>
        <p className="text-sm text-muted-foreground">Manage your personal details, photo, and company.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-primary text-primary-foreground"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-3xl font-bold">{initials}</span>
            )}
            <span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-primary ring-2 ring-background">
              <Camera className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
          </button>
          <p className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "Click to change photo"}</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Your name and phone are visible to your team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} disabled />
            <p className="text-xs text-muted-foreground">Email is managed by your account and can&apos;t be changed here.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
          </div>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          {save.isSuccess && <p className="text-sm text-emerald-600">Saved.</p>}
          <Button disabled={save.isPending} onClick={() => { if (!guard("Save your account")) return; save.mutate(); }}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
        </CardHeader>
        <CardContent>
          <Link href="/employer/company-profile" className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{company?.name ?? "Set up company"}</div>
              <div className="text-xs text-muted-foreground">
                {company ? <Badge variant="secondary">{company.status}</Badge> : "Required before posting shifts"}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {[
            { href: "/reviews", label: "Reviews about my company", sub: "Ratings from workers", icon: Star },
            { href: "/notifications", label: "Notifications", sub: "Inbox and alerts", icon: Bell },
          ].map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{l.label}</div>
                  <div className="text-xs text-muted-foreground">{l.sub}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
