import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, MapPin, Navigation, Package, Radio, Truck } from 'lucide-react-native';
import LoadsMap, { MapPoint, MapRoute } from '@/components/LoadsMap';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';
import { useRoadRoute } from '@/lib/route';

type LoadRow = {
  id: string; vehicle_type: string; status: string;
  pickup_lat?: number | null; pickup_lng?: number | null; pickup_address?: string | null;
  dropoff_lat?: number | null; dropoff_lng?: number | null; dropoff_address?: string | null;
  driver_lat?: number | null; driver_lng?: number | null; driver_location_at?: string | null;
  driver_name?: string | null; distance_km?: number | null;
};

const ACTIVE = ['Accepted', 'EnRoute', 'Arrived'];

function isCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'no signal yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function FleetDispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = trpc.loads.listAccepted.useQuery(undefined, { refetchInterval: 10000 });
  const [selected, setSelected] = useState<string | null>(null);

  const trips = useMemo<LoadRow[]>(
    () => ((query.data ?? []) as LoadRow[]).filter((l) => ACTIVE.includes(l.status)),
    [query.data],
  );

  const selectedTrip = useMemo(
    () => trips.find((t) => t.id === selected) ?? null,
    [trips, selected],
  );

  // All trucks + their pickup/dropoff on one map. When a trip is selected we
  // highlight its truck and draw a road-following route for that driver.
  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    for (const t of trips) {
      const isSel = t.id === selected;
      if (isCoord(t.driver_lat) && isCoord(t.driver_lng)) {
        pts.push({ id: `d-${t.id}`, lat: Number(t.driver_lat), lng: Number(t.driver_lng), kind: 'driver', label: t.driver_name || 'Truck', selected: isSel });
      }
      if (isSel) {
        if (isCoord(t.pickup_lat) && isCoord(t.pickup_lng)) pts.push({ id: `p-${t.id}`, lat: Number(t.pickup_lat), lng: Number(t.pickup_lng), kind: 'pickup', label: 'Pickup' });
        if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng)) pts.push({ id: `x-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'dropoff', label: 'Drop-off' });
      } else if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng) && !(isCoord(t.driver_lat) && isCoord(t.driver_lng))) {
        // Show a load pin for trucks not yet reporting GPS so nothing is hidden.
        pts.push({ id: `l-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'load', label: t.driver_name || 'Assigned' });
      }
    }
    return pts;
  }, [trips, selected]);

  const navToPickup = selectedTrip?.status === 'Accepted';
  const navOrigin = selectedTrip
    ? isCoord(selectedTrip.driver_lat) && isCoord(selectedTrip.driver_lng)
      ? { lat: Number(selectedTrip.driver_lat), lng: Number(selectedTrip.driver_lng) }
      : isCoord(selectedTrip.pickup_lat) && isCoord(selectedTrip.pickup_lng)
        ? { lat: Number(selectedTrip.pickup_lat), lng: Number(selectedTrip.pickup_lng) }
        : null
    : null;
  const navTarget = selectedTrip
    ? navToPickup
      ? isCoord(selectedTrip.pickup_lat) && isCoord(selectedTrip.pickup_lng) ? { lat: Number(selectedTrip.pickup_lat), lng: Number(selectedTrip.pickup_lng) } : null
      : isCoord(selectedTrip.dropoff_lat) && isCoord(selectedTrip.dropoff_lng) ? { lat: Number(selectedTrip.dropoff_lat), lng: Number(selectedTrip.dropoff_lng) } : null
    : null;
  const roadRoute = useRoadRoute([navOrigin, navTarget], Boolean(selectedTrip));

  const routes = useMemo<MapRoute[]>(() => {
    if (!selectedTrip || !navOrigin || !navTarget) return [];
    return [{ from: navOrigin, to: navTarget, path: roadRoute.data?.path }];
  }, [selectedTrip, navOrigin, navTarget, roadRoute.data]);

  const withGps = trips.filter((t) => isCoord(t.driver_lat) && isCoord(t.driver_lng)).length;

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading dispatch board" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load dispatch" onRetry={() => void query.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/' as never); } }} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dispatch board</Text>
          <Text style={styles.subtitle}>{trips.length} active · {withGps} live on map</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.mapWrap}>
          <LoadsMap points={points} routes={routes} height={320} onSelectPoint={(id) => { const tid = id.split('-').slice(1).join('-'); setSelected(tid); }} />
        </View>

        {trips.length === 0 ? (
          <EmptyState icon={Truck} title="No trucks on the road" description="When your drivers accept loads and start trips, they appear here live on the map. You can track each one individually." />
        ) : (
          <>
            <Text style={styles.sectionTitle}>Your trucks</Text>
            {trips.map((t) => {
              const isSel = t.id === selected;
              const live = isCoord(t.driver_lat) && isCoord(t.driver_lng);
              return (
                <TouchableOpacity key={t.id} activeOpacity={0.85} onPress={() => setSelected(isSel ? null : t.id)} style={[styles.tripCard, isSel && styles.tripCardSel]}>
                  <View style={styles.tripTop}>
                    <View style={[styles.tripIcon, { backgroundColor: live ? C.accentDim : C.bgSecondary }]}>
                      <Truck size={16} color={live ? C.accent : C.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tripName}>{t.driver_name || VEHICLE_LABEL[t.vehicle_type as VehicleType] || 'Assigned driver'}</Text>
                      <View style={styles.tripSignal}>
                        <Radio size={11} color={live ? C.green : C.textMuted} />
                        <Text style={[styles.tripSignalText, { color: live ? C.green : C.textMuted }]}>{live ? `Live · ${relativeTime(t.driver_location_at)}` : 'No GPS signal yet'}</Text>
                      </View>
                    </View>
                    <StatusBadge status={t.status} />
                  </View>
                  <View style={styles.routeCol}>
                    <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{t.pickup_address || 'Pickup point'}</Text></View>
                    <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{t.dropoff_address || 'Drop-off point'}</Text></View>
                  </View>
                  {isSel ? (
                    <TouchableOpacity style={styles.trackBtn} onPress={() => router.push(`/shipper/track?id=${t.id}` as never)}>
                      <Navigation size={15} color={C.white} />
                      <Text style={styles.trackBtnText}>Open live tracking</Text>
                    </TouchableOpacity>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 14 },
  mapWrap: { borderRadius: 16, overflow: 'hidden' },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  tripCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 10 },
  tripCardSel: { borderColor: C.accent, borderWidth: 2 },
  tripTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tripIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tripName: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  tripSignal: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tripSignalText: { fontSize: 11.5, fontWeight: '700' as const },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 12.5, color: C.textSecondary },
  trackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12 },
  trackBtnText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
});
