"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: "pickup" | "dropoff" | "driver" | "load";
  label?: string;
  selected?: boolean;
};

export type MapRoute = {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  muted?: boolean;
  /** Optional road-following polyline. When present it is drawn instead of a straight line. */
  path?: { lat: number; lng: number }[];
};

interface LoadsMapProps {
  points: MapPoint[];
  routes?: MapRoute[];
  height?: number;
  onSelectPoint?: (id: string) => void;
  className?: string;
}

const PIN_COLORS: Record<MapPoint["kind"], string> = {
  pickup: "#34d399",
  dropoff: "#f87171",
  driver: "#2dd4bf",
  load: "#60a5fa",
};

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 };
const DEFAULT_ZOOM = 9;

type LatLng = { lat: number; lng: number };
type Size = { w: number; h: number };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lngToWorldX(lng: number, z: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** z;
}
function latToWorldY(lat: number, z: number): number {
  const s = clamp(Math.sin((lat * Math.PI) / 180), -0.9999, 0.9999);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}
function worldXToLng(x: number, z: number): number {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}
function worldYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Choose a center + integer zoom that frames every point inside the viewport. */
function computeFit(points: MapPoint[], size: Size): { center: LatLng; zoom: number } | null {
  if (size.w <= 0 || size.h <= 0) return null;
  if (points.length === 0) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }

  const centerLng = (minLng + maxLng) / 2;
  const midY = (latToWorldY(minLat, 0) + latToWorldY(maxLat, 0)) / 2;
  const centerLat = worldYToLat(midY, 0);
  const center: LatLng = { lat: centerLat, lng: centerLng };

  if (minLat === maxLat && minLng === maxLng) return { center, zoom: 13 };

  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const spanX = Math.abs(lngToWorldX(maxLng, z) - lngToWorldX(minLng, z));
    const spanY = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
    if (spanX < size.w * 0.82 && spanY < size.h * 0.82) return { center, zoom: z };
  }
  return { center, zoom: MIN_ZOOM };
}

/**
 * Interactive tile-based map for the web app. Renders CARTO dark raster tiles
 * under an SVG overlay of routes and pins. Supports drag-to-pan, button zoom,
 * and pin selection — mirrors the mobile LoadsMap.
 */
export default function LoadsMap({ points, routes = [], height = 320, onSelectPoint, className }: LoadsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: height });
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  const fitKey = useMemo(() => points.map((p) => p.id).sort().join("|"), [points]);
  const lastFit = useRef<string>("");

  // Measure the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (size.w <= 0) return;
    const key = `${fitKey}@${Math.round(size.w)}x${Math.round(size.h)}`;
    if (key === lastFit.current) return;
    lastFit.current = key;
    const f = computeFit(points, size);
    if (f) { setCenter(f.center); setZoom(f.zoom); }
  }, [fitKey, size, points]);

  const stateRef = useRef({ center, zoom, size, points });
  stateRef.current = { center, zoom, size, points };

  const project = useCallback((lat: number, lng: number, s = stateRef.current) => {
    const cx = lngToWorldX(s.center.lng, s.zoom);
    const cy = latToWorldY(s.center.lat, s.zoom);
    return {
      x: lngToWorldX(lng, s.zoom) - cx + s.size.w / 2,
      y: latToWorldY(lat, s.zoom) - cy + s.size.h / 2,
    };
  }, []);

  const drag = useRef<{ startCx: number; startCy: number; startX: number; startY: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const s = stateRef.current;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      startCx: lngToWorldX(s.center.lng, s.zoom),
      startCy: latToWorldY(s.center.lat, s.zoom),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const s = stateRef.current;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
    const newCx = drag.current.startCx - dx;
    const newCy = drag.current.startCy - dy;
    setCenter({ lat: worldYToLat(newCy, s.zoom), lng: worldXToLng(newCx, s.zoom) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag || !onSelectPoint) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const s = stateRef.current;
    let hit: MapPoint | null = null;
    let best = 26;
    for (const p of s.points) {
      const pr = project(p.lat, p.lng, s);
      const d = Math.hypot(pr.x - x, pr.y - y);
      if (d < best) { best = d; hit = p; }
    }
    if (hit) onSelectPoint(hit.id);
  };

  const changeZoom = (delta: number) => setZoom((z) => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));
  const ready = size.w > 0;

  const tiles = useMemo(() => {
    if (!ready) return [] as { key: string; uri: string; left: number; top: number }[];
    const n = 2 ** zoom;
    const cx = lngToWorldX(center.lng, zoom);
    const cy = latToWorldY(center.lat, zoom);
    const leftWorld = cx - size.w / 2;
    const topWorld = cy - size.h / 2;
    const firstX = Math.floor(leftWorld / TILE);
    const lastX = Math.floor((cx + size.w / 2) / TILE);
    const firstY = Math.floor(topWorld / TILE);
    const lastY = Math.floor((cy + size.h / 2) / TILE);
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let tx = firstX; tx <= lastX; tx++) {
      for (let ty = firstY; ty <= lastY; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n;
        out.push({
          key: `${zoom}/${wrappedX}/${ty}`,
          uri: `https://a.basemaps.cartocdn.com/dark_all/${zoom}/${wrappedX}/${ty}.png`,
          left: tx * TILE - leftWorld,
          top: ty * TILE - topWorld,
        });
      }
    }
    return out;
  }, [ready, zoom, center, size]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card ${className ?? ""}`}
      style={{ height, touchAction: "none", cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
    >
      {ready && (
        <>
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.key}
              src={t.uri}
              alt=""
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{ left: t.left, top: t.top, width: TILE, height: TILE }}
            />
          ))}

          <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0">
            {routes.map((r, i) => {
              let d: string;
              if (r.path && r.path.length >= 2) {
                d = r.path
                  .map((pt, idx) => {
                    const pr = project(pt.lat, pt.lng);
                    return `${idx === 0 ? "M" : "L"} ${pr.x} ${pr.y}`;
                  })
                  .join(" ");
              } else {
                const a = project(r.from.lat, r.from.lng);
                const b = project(r.to.lat, r.to.lng);
                d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
              }
              return (
                <path
                  key={`r${i}`}
                  d={d}
                  stroke={r.muted ? "#94a3b8" : "#2dd4bf"}
                  strokeWidth={r.muted ? 2 : 4}
                  strokeDasharray={r.muted ? "4 6" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={r.muted ? 0.6 : 0.95}
                  fill="none"
                />
              );
            })}

            {points.map((p) => {
              const { x, y } = project(p.lat, p.lng);
              if (x < -40 || y < -40 || x > size.w + 40 || y > size.h + 40) return null;
              const color = PIN_COLORS[p.kind];
              const r = p.selected ? 11 : 8;
              return (
                <g key={p.id}>
                  {p.selected && <circle cx={x} cy={y} r={r + 8} fill={color} opacity={0.2} />}
                  {p.kind === "driver" && <circle cx={x} cy={y} r={r + 6} fill={color} opacity={0.22} />}
                  <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={2.5} />
                  {p.kind === "driver" && <circle cx={x} cy={y} r={3} fill="#fff" />}
                  {p.label && (
                    <text x={x} y={y - r - 7} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle" stroke="#000" strokeWidth={0.4}>
                      {p.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </>
      )}

      <div className="pointer-events-none absolute bottom-1.5 left-2 rounded-md bg-black/55 px-1.5 py-0.5">
        <span className="text-[9px] text-muted-foreground">© OpenStreetMap · CARTO</span>
      </div>

      <div className="absolute bottom-2.5 right-2.5 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => changeZoom(1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-card/90 text-foreground hover:bg-accent"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => changeZoom(-1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-card/90 text-foreground hover:bg-accent"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
