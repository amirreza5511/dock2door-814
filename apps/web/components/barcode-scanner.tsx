"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * Camera QR/barcode scanner using the browser-native BarcodeDetector API
 * (Chrome/Edge/Android). Falls back to manual entry where unavailable.
 * De-dupes rapid repeat reads of the same code.
 */
export function BarcodeScanner({
  open,
  onClose,
  onScanned,
  title = "Scan label",
  subtitle,
  progress,
}: {
  open: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
  title?: string;
  subtitle?: string;
  progress?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<{ data: string; at: number }>({ data: "", at: 0 });
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState("");

  const handleData = useCallback(
    (data: string) => {
      const v = data.trim();
      if (!v) return;
      const now = Date.now();
      if (lastRef.current.data === v && now - lastRef.current.at < 2000) return;
      lastRef.current = { data: v, at: now };
      setFlash(v);
      window.setTimeout(() => setFlash(""), 900);
      onScanned(v);
    },
    [onScanned],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (!Ctor) {
          setSupported(false);
          return;
        }
        const detector = new Ctor({ formats: ["qr_code", "code_128", "code_39", "ean_13", "pdf417"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) handleData(codes[0].rawValue);
          } catch {
            /* frame not ready */
          }
          rafRef.current = window.requestAnimationFrame(() => void tick());
        };
        rafRef.current = window.requestAnimationFrame(() => void tick());
      } catch {
        setError("Camera access is off or unavailable. Enter the code manually below.");
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, handleData]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-lg font-bold text-white">{title}</p>
          {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}
        </div>
        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white"><X className="h-5 w-5" /></button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none relative h-60 w-60 rounded-3xl border-[3px] border-white/80" />
        {flash ? <p className="absolute bottom-24 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Scanned {flash}</p> : null}
      </div>

      <div className="space-y-3 p-4">
        {error ? <p className="rounded-md bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {!supported && !error ? <p className="rounded-md bg-white/10 px-3 py-2 text-sm text-white/80">Live scanning isn&apos;t supported in this browser — enter the code manually.</p> : null}
        {(!supported || error) && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) {
                handleData(manual);
                setManual("");
              }
            }}
          >
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Enter barcode e.g. BOL-260715-00001-001"
              className="flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none"
            />
            <Button type="submit" variant="secondary"><ScanLine className="mr-1.5 h-4 w-4" /> Add</Button>
          </form>
        )}
        {progress ? <p className="rounded-md bg-white/10 py-2 text-center text-sm font-bold text-white">{progress}</p> : null}
        <Button className="w-full" size="lg" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
