"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

type ModerationStatus = "pending" | "approved" | "rejected";

interface WorkPhotoRow {
  id: string;
  worker_user_id: string;
  file_path: string;
  caption: string | null;
  visibility: string;
  moderation_status: ModerationStatus;
  rejection_reason: string | null;
  created_at: string;
}

const STATUS_TABS: { value: ModerationStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function statusVariant(s: ModerationStatus): "warning" | "success" | "destructive" | "secondary" {
  if (s === "pending") return "warning";
  if (s === "approved") return "success";
  if (s === "rejected") return "destructive";
  return "secondary";
}

export default function AdminWorkPhotosPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ModerationStatus | "all">("pending");
  const [reason, setReason] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const photosQ = useQuery({
    queryKey: ["admin", "work-photos", filter],
    queryFn: async () => {
      let q = supabase
        .from("work_photos")
        .select("id,worker_user_id,file_path,caption,visibility,moderation_status,rejection_reason,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("moderation_status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WorkPhotoRow[];
    },
  });

  const moderate = useMutation({
    mutationFn: async ({ photoId, status, rej_reason }: { photoId: string; status: ModerationStatus; rej_reason?: string }) => {
      const { error } = await supabase.rpc("admin_moderate_work_photo", {
        p_photo_id: photoId,
        p_status: status,
        p_reason: rej_reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "work-photos"] });
      setSelectedId(null);
      setReason("");
    },
  });

  const photos = photosQ.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Work Photos</h1>
        <p className="text-sm text-muted-foreground">
          Review and moderate worker work photo submissions.
        </p>
      </div>

      {moderate.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(moderate.error as Error).message}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={filter === tab.value ? "default" : "outline"}
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Rejection reason input */}
      {selectedId && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rejection reason required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this photo is being rejected…"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!reason.trim() || moderate.isPending}
                onClick={() =>
                  moderate.mutate({ photoId: selectedId, status: "rejected", rej_reason: reason.trim() })
                }
              >
                Confirm reject
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setSelectedId(null); setReason(""); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Photo queue</CardTitle>
          <CardDescription>
            {photosQ.isLoading ? "Loading…" : `${photos.length} photos`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {photosQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : photos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No photos in this queue.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="rounded-lg border bg-card overflow-hidden flex flex-col"
                >
                  {/* Photo preview placeholder */}
                  <div className="bg-muted h-40 flex items-center justify-center">
                    <div className="text-center text-xs text-muted-foreground space-y-1">
                      <div className="text-2xl">🖼️</div>
                      <div className="font-mono break-all px-2">{photo.file_path.split("/").pop()}</div>
                    </div>
                  </div>

                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant={statusVariant(photo.moderation_status)} className="capitalize">
                        {photo.moderation_status}
                      </Badge>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {photo.visibility}
                      </Badge>
                    </div>

                    {photo.caption && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{photo.caption}</p>
                    )}

                    {photo.rejection_reason && (
                      <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                        Rejected: {photo.rejection_reason}
                      </p>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Worker: <span className="font-mono">{photo.worker_user_id.slice(0, 8)}…</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(photo.created_at)}</p>

                    {photo.moderation_status === "pending" && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="default"
                          className="flex-1"
                          disabled={moderate.isPending}
                          onClick={() => moderate.mutate({ photoId: photo.id, status: "approved" })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          disabled={moderate.isPending}
                          onClick={() => setSelectedId(photo.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
