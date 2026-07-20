"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign, CheckCircle2, Clock, CreditCard, Globe, Mail, Megaphone,
  MessageCircle, Pencil, Phone, Play, Plus, Trash2, X, XCircle,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

type MediaType = "image" | "video" | "youtube";
type LinkType = "website" | "instagram" | "phone" | "whatsapp" | "youtube" | "email";

interface Ad {
  id: string;
  title: string;
  body: string;
  image_url: string;
  cta_label: string;
  advertiser_name: string;
  status: string;
  review_status: string | null;
  price: number | null;
  currency: string | null;
  admin_note: string | null;
  media_type?: string | null;
  video_url?: string | null;
  placements?: string[] | null;
  links?: { type: string; value: string }[] | null;
  [k: string]: unknown;
}

const LINK_TYPES: { key: LinkType; label: string; Icon: typeof Globe; placeholder: string }[] = [
  { key: "website", label: "Website", Icon: Globe, placeholder: "https://yourbusiness.com" },
  { key: "instagram", label: "Instagram", Icon: AtSign, placeholder: "@handle or profile URL" },
  { key: "phone", label: "Call", Icon: Phone, placeholder: "+1 555 123 4567" },
  { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, placeholder: "+1 555 123 4567" },
  { key: "youtube", label: "YouTube", Icon: Play, placeholder: "https://youtu.be/..." },
  { key: "email", label: "Email", Icon: Mail, placeholder: "sales@yourbusiness.com" },
];

const PLACEMENTS: { key: string; label: string }[] = [
  { key: "all", label: "Every page" },
  { key: "customer", label: "Customers" },
  { key: "warehouse-provider", label: "Warehouses" },
  { key: "trucking-company", label: "Trucking" },
  { key: "drayage-company", label: "Drayage" },
  { key: "freight-forwarder", label: "Freight forwarders" },
  { key: "service-provider", label: "Service providers" },
  { key: "employer", label: "Employers" },
  { key: "worker", label: "Workers" },
  { key: "driver", label: "Drivers" },
  { key: "shipper", label: "Shippers" },
];

const emptyLinks: Record<LinkType, string> = {
  website: "", instagram: "", phone: "", whatsapp: "", youtube: "", email: "",
};

interface Draft {
  id: string | null;
  title: string;
  body: string;
  imageUrl: string;
  ctaLabel: string;
  advertiserName: string;
  placements: string[];
  mediaType: MediaType;
  videoUrl: string;
  links: Record<LinkType, string>;
}

const emptyDraft: Draft = {
  id: null, title: "", body: "", imageUrl: "", ctaLabel: "Learn more",
  advertiserName: "", placements: ["all"], mediaType: "image", videoUrl: "", links: { ...emptyLinks },
};

/** Status → pill styling + human copy for a self-serve ad's review lifecycle. */
function statusMeta(ad: Ad): { label: string; cls: string; Icon: typeof Clock; note: string } {
  const rs = ad.review_status ?? "Pending";
  if (rs === "Approved" || ad.status === "Active") {
    return { label: "Live", cls: "bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2, note: "Your ad is running on the pages you chose." };
  }
  if (rs === "Paid") {
    return { label: "Awaiting approval", cls: "bg-purple-500/15 text-purple-300", Icon: Clock, note: "Payment received — our team will approve it shortly." };
  }
  if (rs === "Quoted") {
    return { label: "Price ready", cls: "bg-blue-500/15 text-blue-300", Icon: CreditCard, note: "We\u2019ve set a price. Pay to publish your ad." };
  }
  if (rs === "Rejected") {
    return { label: "Not approved", cls: "bg-red-500/15 text-red-300", Icon: XCircle, note: ad.admin_note || "This ad wasn\u2019t approved. Edit and resubmit." };
  }
  return { label: "Pending review", cls: "bg-yellow-500/15 text-yellow-300", Icon: Clock, note: "Submitted — we\u2019ll send you a price soon." };
}

const money = (n: number | null | undefined, cur: string | null | undefined): string =>
  `${cur ?? "CAD"} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Self-serve advertising — submit an ad, get a quote, pay, go live. Mirrors the mobile /advertise screen. */
export default function AdvertisePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adsQ = useQuery({
    queryKey: ["advertise", "mine"],
    queryFn: async (): Promise<Ad[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error: err } = await supabase
        .from("advertisements")
        .select("*")
        .eq("submitted_by", u.user.id)
        .eq("source", "self_serve")
        .order("created_at", { ascending: false });
      if (err) return [];
      return (data as Ad[] | null) ?? [];
    },
  });

  const submit = useMutation({
    mutationFn: async (d: Draft) => {
      if (!d.title.trim()) throw new Error("Give your ad a title.");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const placements = d.placements.filter((p) => p && p.length > 0);
      const primaryPlacement = placements.includes("all") ? "all" : (placements[0] ?? "all");
      const links = (Object.entries(d.links) as [LinkType, string][])
        .filter(([, v]) => v.trim().length > 0)
        .map(([type, value]) => ({ type, value: value.trim() }));
      const primaryLink = links[0];
      const row: Record<string, unknown> = {
        title: d.title.trim(),
        body: d.body.trim(),
        image_url: d.imageUrl.trim(),
        target_url: primaryLink?.value ?? "",
        cta_label: d.ctaLabel.trim().length > 0 ? d.ctaLabel.trim() : "Learn more",
        advertiser_name: d.advertiserName.trim(),
        advertiser_company_id: companyId,
        owner_company_id: companyId,
        placement: primaryPlacement,
        placements: placements.length > 0 ? placements : [primaryPlacement],
        links,
        media_type: d.mediaType,
        video_url: d.videoUrl.trim(),
        link_type: primaryLink?.type ?? "website",
        updated_at: new Date().toISOString(),
      };
      if (d.id) {
        const { error: err } = await supabase.from("advertisements")
          .update(row).eq("id", d.id).eq("submitted_by", u.user.id);
        if (err) throw new Error(err.message);
        return;
      }
      const { error: err } = await supabase.from("advertisements").insert({
        ...row,
        source: "self_serve",
        submitted_by: u.user.id,
        status: "Paused",
        review_status: "Pending",
        price: 0,
        weight: 1,
        priority: 0,
        created_by: u.user.id,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["advertise", "mine"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const pay = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc("ad_mark_paid", { p_id: id });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["advertise", "mine"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error: err } = await supabase.from("advertisements")
        .delete().eq("id", id).eq("submitted_by", u.user.id);
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["advertise", "mine"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const ads = useMemo(() => adsQ.data ?? [], [adsQ.data]);

  const openEdit = (ad: Ad) => {
    const links: Record<LinkType, string> = { ...emptyLinks };
    for (const l of ad.links ?? []) {
      if (l.type in links) links[l.type as LinkType] = l.value;
    }
    setDraft({
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.image_url,
      ctaLabel: ad.cta_label,
      advertiserName: ad.advertiser_name,
      placements: (ad.placements && ad.placements.length > 0) ? ad.placements : ["all"],
      mediaType: ((ad.media_type as MediaType) ?? "image"),
      videoUrl: ad.video_url ?? "",
      links,
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Grow your business</p>
          <h1 className="text-2xl font-semibold tracking-tight">Advertise on Dock2Door</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit your ad → we send you a price → pay → it goes live on the pages you chose.
          </p>
        </div>
        <Button onClick={() => { setError(null); setDraft({ ...emptyDraft, links: { ...emptyLinks } }); }}>
          <Plus className="mr-2 h-4 w-4" /> New ad
        </Button>
      </div>

      {error && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {adsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your ads…</p>
      ) : ads.length === 0 && !draft ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Megaphone className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No ads yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Promote your business to every member on Dock2Door. Create your first ad — our team will review and price it.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ads.map((ad) => {
            const meta = statusMeta(ad);
            const Icon = meta.Icon;
            const canEdit = (ad.review_status ?? "Pending") === "Pending" || ad.review_status === "Rejected";
            const canPay = ad.review_status === "Quoted";
            return (
              <Card key={ad.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{ad.title}</p>
                      {ad.advertiser_name && <p className="text-xs text-muted-foreground">{ad.advertiser_name}</p>}
                    </div>
                    <Badge className={`shrink-0 gap-1 ${meta.cls}`}><Icon className="h-3 w-3" />{meta.label}</Badge>
                  </div>
                  {ad.body && <p className="text-sm text-muted-foreground">{ad.body}</p>}
                  <p className="text-xs text-muted-foreground">{meta.note}</p>
                  {(ad.price ?? 0) > 0 && (
                    <p className="text-sm font-bold">{money(ad.price, ad.currency)}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {canPay && (
                      <Button size="sm" onClick={() => pay.mutate(ad.id)} disabled={pay.isPending}>
                        <CreditCard className="mr-2 h-4 w-4" /> Pay {money(ad.price, ad.currency)}
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(ad)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => { if (window.confirm("Remove this ad?")) remove.mutate(ad.id); }}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDraft(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{draft.id ? "Edit ad" : "New ad"}</h2>
              <button onClick={() => setDraft(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Title *">
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. 20% off pallet storage this month" />
              </Field>
              <Field label="Business name">
                <Input value={draft.advertiserName} onChange={(e) => setDraft({ ...draft, advertiserName: e.target.value })} placeholder="Your business name" />
              </Field>
              <Field label="Message">
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder="Short pitch shown under the title"
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </Field>
              <Field label="Media">
                <div className="flex gap-1 rounded-lg border border-white/10 bg-card p-1">
                  {(["image", "video", "youtube"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDraft({ ...draft, mediaType: m })}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                        draft.mediaType === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              {draft.mediaType === "image" ? (
                <Field label="Image URL">
                  <Input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="https://…/banner.jpg" />
                </Field>
              ) : (
                <Field label={draft.mediaType === "youtube" ? "YouTube URL" : "Video URL"}>
                  <Input value={draft.videoUrl} onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })} placeholder={draft.mediaType === "youtube" ? "https://youtu.be/…" : "https://…/ad.mp4"} />
                </Field>
              )}
              <Field label="Button label">
                <Input value={draft.ctaLabel} onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })} placeholder="Learn more" />
              </Field>

              <Field label="Where should it show?">
                <div className="flex flex-wrap gap-1.5">
                  {PLACEMENTS.map((p) => {
                    const selected = draft.placements.includes(p.key);
                    return (
                      <button
                        key={p.key}
                        onClick={() => {
                          if (p.key === "all") { setDraft({ ...draft, placements: ["all"] }); return; }
                          const without = draft.placements.filter((k) => k !== "all" && k !== p.key);
                          const next = selected ? without : [...without, p.key];
                          setDraft({ ...draft, placements: next.length === 0 ? ["all"] : next });
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          selected ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Contact links (first becomes the button)">
                <div className="space-y-2">
                  {LINK_TYPES.map(({ key, label, Icon, placeholder }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted" title={label}>
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <Input
                        value={draft.links[key]}
                        onChange={(e) => setDraft({ ...draft, links: { ...draft.links, [key]: e.target.value } })}
                        placeholder={placeholder}
                      />
                    </div>
                  ))}
                </div>
              </Field>

              <Button className="w-full" size="lg" onClick={() => submit.mutate(draft)} disabled={submit.isPending}>
                {submit.isPending ? "Submitting…" : draft.id ? "Save changes" : "Submit for review"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                After review, we&rsquo;ll send you a price. Your ad goes live once paid and approved.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
