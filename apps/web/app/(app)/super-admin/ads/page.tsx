"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Eye, MousePointerClick, Plus, Pencil, Trash2, Play, Pause } from "lucide-react";

interface AdRow {
  id: string;
  title: string;
  body: string;
  image_url: string;
  target_url: string;
  cta_label: string;
  advertiser_name: string;
  placement: string;
  status: string;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  source: string | null;
  review_status: string | null;
  price: number | null;
  currency: string | null;
  admin_note: string | null;
  created_at: string;
}

type Draft = {
  id?: string;
  title: string;
  body: string;
  image_url: string;
  target_url: string;
  cta_label: string;
  advertiser_name: string;
  placement: string;
  status: string;
  priority: number;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  body: "",
  image_url: "",
  target_url: "",
  cta_label: "Learn more",
  advertiser_name: "",
  placement: "all",
  status: "Active",
  priority: 0,
};

const PLACEMENTS = [
  "all",
  "customer",
  "warehouse-provider",
  "trucking-company",
  "driver",
  "service-provider",
  "employer",
  "worker",
];

function statusVariant(status: string): "success" | "secondary" {
  return status === "Active" ? "success" : "secondary";
}

function reviewVariant(s: string | null): "success" | "warning" | "destructive" | "secondary" {
  switch (s) {
    case "Approved": return "success";
    case "Paid": return "success";
    case "Quoted": return "warning";
    case "Pending": return "warning";
    case "Rejected": return "destructive";
    default: return "secondary";
  }
}

export default function AdManagerPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [editor, setEditor] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdRow | null>(null);
  const [quoteFor, setQuoteFor] = useState<AdRow | null>(null);
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteNote, setQuoteNote] = useState("");

  const adsQ = useQuery({
    queryKey: ["super-admin", "ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("advertisements")
        .select(
          "id,title,body,image_url,target_url,cta_label,advertiser_name,placement,status,priority,starts_at,ends_at,impressions,clicks,source,review_status,price,currency,admin_note,created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdRow[];
    },
  });

  const ads = adsQ.data ?? [];
  const selfServeQueue = useMemo(
    () => ads.filter((a) => a.source === "self_serve" && a.review_status && !["Approved", "Rejected"].includes(a.review_status)),
    [ads],
  );
  const totalImpr = ads.reduce((s, a) => s + (a.impressions ?? 0), 0);
  const totalClicks = ads.reduce((s, a) => s + (a.clicks ?? 0), 0);
  const activeCount = ads.filter((a) => a.status === "Active").length;

  const saveMut = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        title: d.title.trim(),
        body: d.body.trim(),
        image_url: d.image_url.trim(),
        target_url: d.target_url.trim(),
        cta_label: d.cta_label.trim() || "Learn more",
        advertiser_name: d.advertiser_name.trim(),
        placement: d.placement,
        status: d.status,
        priority: Number(d.priority) || 0,
      };
      if (d.id) {
        const { error } = await supabase.from("advertisements").update(payload).eq("id", d.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("advertisements").insert({ ...payload, source: "admin" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin", "ads"] });
      setEditor(null);
    },
  });

  const toggleMut = useMutation({
    mutationFn: async (ad: AdRow) => {
      const next = ad.status === "Active" ? "Paused" : "Active";
      const { error } = await supabase.from("advertisements").update({ status: next }).eq("id", ad.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super-admin", "ads"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("advertisements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin", "ads"] });
      setConfirmDelete(null);
    },
  });

  const reviewMut = useMutation({
    mutationFn: async (input: { ad: AdRow; action: "quote" | "approve" | "reject"; price?: number; note?: string }) => {
      const patch: Record<string, unknown> = {};
      if (input.action === "quote") {
        patch.review_status = "Quoted";
        patch.price = input.price ?? 0;
        patch.admin_note = input.note ?? "";
      } else if (input.action === "approve") {
        patch.review_status = "Approved";
        patch.status = "Active";
      } else {
        patch.review_status = "Rejected";
        patch.status = "Paused";
        if (input.note) patch.admin_note = input.note;
      }
      const { error } = await supabase.from("advertisements").update(patch).eq("id", input.ad.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin", "ads"] });
      setQuoteFor(null);
      setQuotePrice("");
      setQuoteNote("");
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ad Manager</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage sponsored placements, and review self-serve advertising requests.
          </p>
        </div>
        <Button onClick={() => setEditor({ ...EMPTY_DRAFT })}>
          <Plus className="h-4 w-4" /> New ad
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active ads" value={activeCount} icon={<Play className="h-4 w-4" />} />
        <StatCard label="Total impressions" value={totalImpr.toLocaleString()} icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Total clicks" value={totalClicks.toLocaleString()} icon={<MousePointerClick className="h-4 w-4" />} />
      </div>

      {adsQ.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {(adsQ.error as Error).message}
        </div>
      )}

      {selfServeQueue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Self-serve requests</CardTitle>
            <CardDescription>Businesses requesting to advertise. Quote a price, then approve once paid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selfServeQueue.map((ad) => (
              <div key={ad.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{ad.title}</p>
                    <Badge variant={reviewVariant(ad.review_status)}>{ad.review_status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ad.advertiser_name || "Unknown advertiser"}
                    {ad.price ? ` · ${ad.currency ?? "CAD"} ${ad.price}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setQuoteFor(ad); setQuotePrice(String(ad.price ?? "")); setQuoteNote(ad.admin_note ?? ""); }}>
                    Quote
                  </Button>
                  <Button size="sm" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ ad, action: "approve" })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="destructive" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ ad, action: "reject" })}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All ads</CardTitle>
          <CardDescription>{ads.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          {adsQ.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : ads.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No ads yet. Create your first sponsored placement.</p>
          ) : (
            <div className="space-y-3">
              {ads.map((ad) => (
                <div key={ad.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-white/10 p-4">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-white/5">
                    {ad.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[10px] text-muted-foreground">No image</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium truncate">{ad.title}</p>
                      <Badge variant={statusVariant(ad.status)}>{ad.status}</Badge>
                      {ad.source === "self_serve" && ad.review_status && (
                        <Badge variant={reviewVariant(ad.review_status)}>{ad.review_status}</Badge>
                      )}
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">{ad.placement}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {ad.advertiser_name || "—"} · priority {ad.priority} · {formatDate(ad.created_at)}
                    </p>
                    <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {ad.impressions.toLocaleString()}</span>
                      <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> {ad.clicks.toLocaleString()}</span>
                      <span>CTR {ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : "0.0"}%</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleMut.mutate(ad)} disabled={toggleMut.isPending}>
                      {ad.status === "Active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditor({
                          id: ad.id,
                          title: ad.title,
                          body: ad.body,
                          image_url: ad.image_url,
                          target_url: ad.target_url,
                          cta_label: ad.cta_label,
                          advertiser_name: ad.advertiser_name,
                          placement: ad.placement,
                          status: ad.status,
                          priority: ad.priority,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(ad)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor modal */}
      {editor && (
        <Modal onClose={() => setEditor(null)} title={editor.id ? "Edit ad" : "New ad"}>
          <div className="space-y-3">
            <Field label="Title">
              <Input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder="Ad headline" />
            </Field>
            <Field label="Body">
              <Textarea value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} placeholder="Short supporting text" rows={2} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Image URL">
                <Input value={editor.image_url} onChange={(e) => setEditor({ ...editor, image_url: e.target.value })} placeholder="https://…" />
              </Field>
              <Field label="Target URL">
                <Input value={editor.target_url} onChange={(e) => setEditor({ ...editor, target_url: e.target.value })} placeholder="https://…" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advertiser name">
                <Input value={editor.advertiser_name} onChange={(e) => setEditor({ ...editor, advertiser_name: e.target.value })} placeholder="Company name" />
              </Field>
              <Field label="CTA label">
                <Input value={editor.cta_label} onChange={(e) => setEditor({ ...editor, cta_label: e.target.value })} placeholder="Learn more" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Placement">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={editor.placement}
                  onChange={(e) => setEditor({ ...editor, placement: e.target.value })}
                >
                  {PLACEMENTS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={editor.status}
                  onChange={(e) => setEditor({ ...editor, status: e.target.value })}
                >
                  <option value="Active">Active</option>
                  <option value="Paused">Paused</option>
                </select>
              </Field>
              <Field label="Priority">
                <Input type="number" value={editor.priority} onChange={(e) => setEditor({ ...editor, priority: Number(e.target.value) })} />
              </Field>
            </div>
            {saveMut.error && <p className="text-sm text-red-400">{(saveMut.error as Error).message}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
              <Button disabled={!editor.title.trim() || saveMut.isPending} onClick={() => saveMut.mutate(editor)}>
                {saveMut.isPending ? "Saving…" : "Save ad"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Quote modal */}
      {quoteFor && (
        <Modal onClose={() => setQuoteFor(null)} title="Quote self-serve ad">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{quoteFor.title}</span> — {quoteFor.advertiser_name || "Unknown"}
            </p>
            <Field label={`Price (${quoteFor.currency ?? "CAD"})`}>
              <Input type="number" value={quotePrice} onChange={(e) => setQuotePrice(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Note to advertiser">
              <Textarea value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} rows={2} placeholder="Optional quote details" />
            </Field>
            {reviewMut.error && <p className="text-sm text-red-400">{(reviewMut.error as Error).message}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setQuoteFor(null)}>Cancel</Button>
              <Button
                disabled={reviewMut.isPending}
                onClick={() => reviewMut.mutate({ ad: quoteFor, action: "quote", price: Number(quotePrice) || 0, note: quoteNote })}
              >
                {reviewMut.isPending ? "Sending…" : "Send quote"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} title="Delete ad">
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{confirmDelete.title}</span>? This cannot be undone.
          </p>
          {deleteMut.error && <p className="mt-2 text-sm text-red-400">{(deleteMut.error as Error).message}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(confirmDelete.id)}>
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">{icon}</span>
        <div>
          <p className="text-xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
