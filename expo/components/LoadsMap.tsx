import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { Minus, Plus } from 'lucide-react-native';
import C from '@/constants/colors';

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: 'pickup' | 'dropoff' | 'driver' | 'load';
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
  onMapPress?: (lat: number, lng: number) => void;
  onSelectPoint?: (id: string) => void;
  /** When true, taps on empty map drop a pin via onMapPress. */
  placing?: boolean;
}

const PIN_COLORS: Record<MapPoint['kind'], string> = {
  pickup: C.green,
  dropoff: C.red,
  driver: C.accent,
  load: C.blue,
};

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

// Default region centered on Southern Ontario (Toronto-ish) when there are no points.
const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 };
const DEFAULT_ZOOM = 9;

type LatLng = { lat: number; lng: number };
type Size = { w: number; h: number };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// --- Web Mercator projection (absolute world pixels at a given integer zoom) ---
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
  // Mercator-correct latitude midpoint (zoom-independent ratio).
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
 * Real, interactive tile-based map. Renders OpenStreetMap/CARTO raster tiles
 * (dark theme) under an SVG overlay of routes and pins. Supports drag-to-pan,
 * button zoom, pin selection, and tap-to-place — on web and native alike.
 */
export default function LoadsMap({ points, routes = [], height = 280, onMapPress, onSelectPoint, placing = false }: LoadsMapProps) {
  const [size, setSize] = useState<Size>({ w: 0, h: height });
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  // Re-fit only when the SET of pins changes (ids), not when an existing pin
  // moves — so live truck tracking doesn't fight the user's pan/zoom.
  const fitKey = useMemo(() => points.map((p) => p.id).sort().join('|'), [points]);
  const lastFit = useRef<string>('');

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

  const project = (lat: number, lng: number, s = stateRef.current) => {
    const cx = lngToWorldX(s.center.lng, s.zoom);
    const cy = latToWorldY(s.center.lat, s.zoom);
    return {
      x: lngToWorldX(lng, s.zoom) - cx + s.size.w / 2,
      y: latToWorldY(lat, s.zoom) - cy + s.size.h / 2,
    };
  };

  const drag = useRef<{ startCx: number; startCy: number; moved: boolean } | null>(null);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        const s = stateRef.current;
        drag.current = {
          startCx: lngToWorldX(s.center.lng, s.zoom),
          startCy: latToWorldY(s.center.lat, s.zoom),
          moved: false,
        };
      },
      onPanResponderMove: (_e, g) => {
        if (!drag.current) return;
        const s = stateRef.current;
        if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) drag.current.moved = true;
        const newCx = drag.current.startCx - g.dx;
        const newCy = drag.current.startCy - g.dy;
        setCenter({ lat: worldYToLat(newCy, s.zoom), lng: worldXToLng(newCx, s.zoom) });
      },
      onPanResponderRelease: (e, g) => {
        const moved = drag.current?.moved || Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
        const x = e.nativeEvent.locationX;
        const y = e.nativeEvent.locationY;
        drag.current = null;
        if (moved) return;
        const s = stateRef.current;
        let hit: MapPoint | null = null;
        let best = 26;
        for (const p of s.points) {
          const pr = project(p.lat, p.lng, s);
          const d = Math.hypot(pr.x - x, pr.y - y);
          if (d < best) { best = d; hit = p; }
        }
        if (hit && onSelectPoint) { onSelectPoint(hit.id); return; }
        if (placing && onMapPress) {
          const cx = lngToWorldX(s.center.lng, s.zoom);
          const cy = latToWorldY(s.center.lat, s.zoom);
          const wx = x - s.size.w / 2 + cx;
          const wy = y - s.size.h / 2 + cy;
          onMapPress(worldYToLat(wy, s.zoom), worldXToLng(wx, s.zoom));
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ w: width, h });
  };

  const changeZoom = (delta: number) => setZoom((z) => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));

  const ready = size.w > 0;

  // Compute the visible tile grid for the current center/zoom/size.
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
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      {ready ? (
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
          {tiles.map((t) => (
            <Image
              key={t.key}
              source={{ uri: t.uri }}
              style={[styles.tile, { left: t.left, top: t.top }]}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
            />
          ))}

          <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
            {routes.map((r, i) => {
              let d: string;
              if (r.path && r.path.length >= 2) {
                d = r.path
                  .map((pt, idx) => {
                    const pr = project(pt.lat, pt.lng);
                    return `${idx === 0 ? 'M' : 'L'} ${pr.x} ${pr.y}`;
                  })
                  .join(' ');
              } else {
                const a = project(r.from.lat, r.from.lng);
                const b = project(r.to.lat, r.to.lng);
                d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
              }
              return (
                <Path
                  key={`r${i}`}
                  d={d}
                  stroke={r.muted ? C.textMuted : C.accent}
                  strokeWidth={r.muted ? 2 : 4}
                  strokeDasharray={r.muted ? '4 6' : undefined}
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
                <G key={p.id}>
                  {p.selected ? <Circle cx={x} cy={y} r={r + 8} fill={color} opacity={0.2} /> : null}
                  {p.kind === 'driver' ? <Circle cx={x} cy={y} r={r + 6} fill={color} opacity={0.22} /> : null}
                  <Circle cx={x} cy={y} r={r} fill={color} stroke={C.white} strokeWidth={2.5} />
                  {p.kind === 'driver' ? <Circle cx={x} cy={y} r={3} fill={C.white} /> : null}
                  {p.label ? (
                    <SvgText x={x} y={y - r - 7} fill={C.white} fontSize={11} fontWeight="700" textAnchor="middle" stroke={C.black} strokeWidth={0.4}>
                      {p.label}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        </View>
      ) : null}

      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>© OpenStreetMap · CARTO</Text>
      </View>

      <View style={styles.zoomCol} pointerEvents="box-none">
        <TouchableOpacity style={styles.zoomBtn} onPress={() => changeZoom(1)} accessibilityLabel="Zoom in">
          <Plus size={16} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.zoomBtn} onPress={() => changeZoom(-1)} accessibilityLabel="Zoom out">
          <Minus size={16} color={C.text} />
        </TouchableOpacity>
      </View>

      {placing ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Tap the map to drop a pin</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary },
  tile: { position: 'absolute', width: TILE, height: TILE },
  attribution: { position: 'absolute', left: 8, bottom: 6, backgroundColor: 'rgba(8,17,30,0.55)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  attributionText: { fontSize: 9, color: C.textSecondary },
  zoomCol: { position: 'absolute', right: 10, bottom: 10, gap: 8 },
  zoomBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', top: 10, alignSelf: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  hintText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
});
