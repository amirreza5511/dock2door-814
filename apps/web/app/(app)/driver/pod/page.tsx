"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Camera, Check, ClipboardCheck, FileCheck2, PenLine, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDriverJobs, usePods, useAttachPod, type DriverJob } from "@/lib/hooks/use-pod";

function SignaturePad({ onChange }: { onChange: (blank: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    if (!dirty.current) {
      dirty.current = true;
      onChange(false);
    }
  };
  const end = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(true);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border-2 border-dashed bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="h-40 w-full touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <Button type="button" size="sm" variant="outline" onClick={clear}>
        <Trash2 className="mr-1.5 h-4 w-4" /> Clear signature
      </Button>
    </div>
  );
}

export default function DriverPodPage() {
  const jobsQ = useDriverJobs();
  const attach = useAttachPod();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [signatureBlank, setSignatureBlank] = useState(true);
  const [signerName, setSignerName] = useState("");
  const [notes, setNotes] = useState("");

  const jobs = useMemo<DriverJob[]>(() => jobsQ.data ?? [], [jobsQ.data]);
  const podsQ = usePods(selectedId);
  const pods = podsQ.data ?? [];

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const submit = useCallback(async () => {
    if (!selectedId) return window.alert("Pick a job first");
    if (!photo) return window.alert("Add a photo of the cargo / receipt");
    if (signatureBlank) return window.alert("Signature required");
    if (!signerName.trim()) return window.alert("Signer name required");
    try {
      await attach.mutateAsync({ appointmentId: selectedId, file: photo, signerName: signerName.trim(), notes: notes.trim() || undefined });
      setPhoto(null);
      setSignerName("");
      setNotes("");
      if (fileRef.current) fileRef.current.value = "";
      window.alert("Proof of delivery saved and sent to the warehouse.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to save POD");
    }
  }, [selectedId, photo, signatureBlank, signerName, notes, attach]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
        <h1 className="text-2xl font-semibold tracking-tight">Proof of delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">Capture a photo and signature to close out a delivery.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pick a job</h2>
        {jobsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No jobs ready for POD right now.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {jobs.map((j) => (
              <button key={j.id} onClick={() => setSelectedId(j.id)} className="text-left">
                <Card className={selectedId === j.id ? "border-primary" : undefined}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{j.appointment_type}{j.dock_door ? ` · Door ${j.dock_door}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{j.truck_plate ?? "No plate"}{j.scheduled_start ? ` · ${new Date(j.scheduled_start).toLocaleString()}` : ""}</p>
                    </div>
                    <Badge variant={selectedId === j.id ? "default" : "outline"}>{j.status}</Badge>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="space-y-2">
              <Label>Photo of cargo / receipt</Label>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-44 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/30"
              >
                {photoPreview ? (
                  <Image src={photoPreview} alt="POD" width={400} height={176} unoptimized className="h-44 w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera className="h-8 w-8" />
                    <span className="text-sm">Tap to add photo</span>
                  </span>
                )}
              </button>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><PenLine className="h-4 w-4" /> Signature</Label>
              <SignaturePad onChange={setSignatureBlank} />
            </div>

            <div className="space-y-1.5">
              <Label>Signed by</Label>
              <Input value={signerName} placeholder="Receiver name" onChange={(e) => setSignerName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input value={notes} placeholder="Anything worth noting" onChange={(e) => setNotes(e.target.value)} />
            </div>

            <Button className="w-full" onClick={() => void submit()} disabled={attach.isPending}>
              <Check className="mr-1.5 h-4 w-4" /> {attach.isPending ? "Saving…" : "Save proof of delivery"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selectedId && pods.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Captured for this job</h2>
          {pods.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center gap-3 py-3">
                <FileCheck2 className="h-5 w-5 text-emerald-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.signer_name || "Signed"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}
