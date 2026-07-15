"use client";

import { useMemo } from "react";
import { qrSvgString } from "@/lib/qr";

/** Offline QR code rendered as inline SVG. Sizes to the given pixel box. */
export function QRCode({ value, size = 120, className }: { value: string; size?: number; className?: string }) {
  const svg = useMemo(() => qrSvgString(value, 4, 0), [value]);
  return (
    <span
      className={className}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      // The vendored generator returns a self-contained, trusted SVG string.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
