"use client";

import { useImperativeHandle, useRef, forwardRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  isBlank: () => boolean;
  toDataUrl: () => string;
  clear: () => void;
}

/** Finger/mouse signature canvas. Parent reads the result via a ref. */
export const SignaturePad = forwardRef<SignaturePadHandle, { className?: string }>(function SignaturePad({ className }, ref) {
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
    dirty.current = true;
  };
  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
  };

  useImperativeHandle(ref, () => ({
    isBlank: () => !dirty.current,
    toDataUrl: () => canvasRef.current?.toDataURL("image/png") ?? "",
    clear,
  }));

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
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
});
