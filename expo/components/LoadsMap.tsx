import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
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

export type MapRoute = { from: { lat: number; lng: number }; to: { lat: number; lng: number }; muted?: boolean };

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

// Default region centered on Southern Ontario (Toronto-ish) when there are no points.
const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 };
const DEFAULT_SPAN = { lat: 0.6, lng: 0.8 };

/**
 * Lightweight cross-platform interactive map built on react-native-svg.
 * Projects lat/lng to pixels with an equirectangular projection, supports
 * pan (drag), zoom (buttons), pin selection, and tap-to-place.
 */
export default function LoadsMap({ points, routes = [], height = 280, onMapPress, onSelectPoint, placing = false }: LoadsMapProps) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: height });
  const fit = useMemo(() => fitRegion(points), [points]);
  const [center, setCenter] = useState<{ lat: number; lng: number }>(fit.center);
  const [span, setSpan] = useState<{ lat: number; lng: number }>(fit.span);
  const didInit = useRef<boolean>(false);

  // Re-fit once when the first points arrive.
  if (!didInit.current && points.length > 0) {
    didInit.current = true;
    setCenter(fit.center);
    setSpan(fit.span);
  }

  const stateRef = useRef({ center, span, size });
  stateRef.current = { center, span, size };

  const project = (lat: number, lng: number, s = stateRef.current) => {
    const { w, h } = s.size;
    const x = ((lng - (s.center.lng - s.span.lng / 2)) / s.span.lng) * w;
    const y = ((s.center.lat + s.span.lat / 2 - lat) / s.span.lat) * h;
    return { x, y };
  };

  const unproject = (x: number, y: number, s = stateRef.current) => {
    const { w, h } = s.size;
    const lng = s.center.lng - s.span.lng / 2 + (x / w) * s.span.lng;
    const lat = s.center.lat + s.span.lat / 2 - (y / h) * s.span.lat;
    return { lat, lng };
  };

  const start = useRef<{ x: number; y: number; center: { lat: number; lng: number }; moved: boolean } | null>(null);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: (e) => {
        start.current = {
          x: e.nativeEvent.locationX,
          y: e.nativeEvent.locationY,
          center: stateRef.current.center,
          moved: false,
        };
      },
      onPanResponderMove: (_e, g) => {
        if (!start.current) return;
        const s = stateRef.current;
        if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) start.current.moved = true;
        const dLng = -(g.dx / s.size.w) * s.span.lng;
        const dLat = (g.dy / s.size.h) * s.span.lat;
        setCenter({ lat: start.current.center.lat + dLat, lng: start.current.center.lng + dLng });
      },
      onPanResponderRelease: (e, g) => {
        const moved = start.current?.moved || Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
        const x = e.nativeEvent.locationX;
        const y = e.nativeEvent.locationY;
        start.current = null;
        if (moved) return;
        // Tap: hit-test points first, else place a pin.
        const s = stateRef.current;
        let hit: MapPoint | null = null;
        let best = 24;
        for (const p of points) {
          const pr = project(p.lat, p.lng, s);
          const d = Math.hypot(pr.x - x, pr.y - y);
          if (d < best) { best = d; hit = p; }
        }
        if (hit && onSelectPoint) { onSelectPoint(hit.id); return; }
        if (placing && onMapPress) {
          const ll = unproject(x, y, s);
          onMapPress(ll.lat, ll.lng);
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ w: width, h });
  };

  const zoom = (factor: number) => {
    setSpan((s) => ({
      lat: clamp(s.lat * factor, 0.005, 12),
      lng: clamp(s.lng * factor, 0.006, 16),
    }));
  };

  const ready = size.w > 0;
  const gridLines = useMemo(() => buildGrid(size), [size]);

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      {ready ? (
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
          <Svg width={size.w} height={size.h}>
            <Defs>
              <LinearGradient id="mapbg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.bgSecondary} />
                <Stop offset="1" stopColor={C.bg} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#mapbg)" />
            {gridLines.map((g, i) => (
              <Line key={`g${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={C.border} strokeWidth={1} opacity={0.5} />
            ))}

            {routes.map((r, i) => {
              const a = project(r.from.lat, r.from.lng);
              const b = project(r.to.lat, r.to.lng);
              return (
                <Path
                  key={`r${i}`}
                  d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                  stroke={r.muted ? C.textMuted : C.accent}
                  strokeWidth={r.muted ? 2 : 3}
                  strokeDasharray={r.muted ? '4 6' : undefined}
                  strokeLinecap="round"
                  opacity={r.muted ? 0.5 : 0.9}
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
                  {p.selected ? <Circle cx={x} cy={y} r={r + 7} fill={color} opacity={0.18} /> : null}
                  <Circle cx={x} cy={y} r={r} fill={color} stroke={C.white} strokeWidth={2.5} />
                  {p.kind === 'driver' ? <Circle cx={x} cy={y} r={3} fill={C.white} /> : null}
                  {p.label ? (
                    <SvgText x={x} y={y - r - 6} fill={C.text} fontSize={11} fontWeight="700" textAnchor="middle">
                      {p.label}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        </View>
      ) : null}

      <View style={styles.zoomCol} pointerEvents="box-none">
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(0.6)} accessibilityLabel="Zoom in">
          <Plus size={16} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(1.7)} accessibilityLabel="Zoom out">
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fitRegion(points: MapPoint[]): { center: { lat: number; lng: number }; span: { lat: number; lng: number } } {
  if (points.length === 0) return { center: DEFAULT_CENTER, span: DEFAULT_SPAN };
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const latSpan = Math.max((maxLat - minLat) * 1.6, 0.04);
  const lngSpan = Math.max((maxLng - minLng) * 1.6, 0.05);
  return { center, span: { lat: latSpan, lng: lngSpan } };
}

function buildGrid(size: { w: number; h: number }): { x1: number; y1: number; x2: number; y2: number }[] {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (size.w <= 0) return lines;
  const step = 56;
  for (let x = step; x < size.w; x += step) lines.push({ x1: x, y1: 0, x2: x, y2: size.h });
  for (let y = step; y < size.h; y += step) lines.push({ x1: 0, y1: y, x2: size.w, y2: y });
  return lines;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary },
  zoomCol: { position: 'absolute', right: 10, bottom: 10, gap: 8 },
  zoomBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', top: 10, alignSelf: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  hintText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
});
