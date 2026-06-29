import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowLeft, CheckCircle2, Clock, MapPin, Navigation, Package, Truck } from 'lucide-react-native';
import LoadsMap, { MapPoint, MapRoute } from '@/components/LoadsMap';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';
import { getSignedUrl } from '@/lib/storage-files';

type LoadRow = {
  id: string; vehicle_type: string; status: string;
  pickup_lat: number; pickup_lng: number; pickup_address?: string | null;
  dropoff_lat: number; dropoff_lng: number; dropoff_address?: string | null;
  driver_lat?: number | null; driver_lng?: number | null; driver_location_at?: string | null;
  pickup_photo_path?: string | null; delivery_photo_path?: string | null;
  receiver_name?: string | null; picked_up_at?: string | null; delivered_at?: string | null;
  distance_km: number; total_price: number;
};

const STAGE_LABEL: Record<string, string> = {
  Open: 'Waiting for a driver',
  Accepted: 'Driver assigned',
  EnRoute: 'En route',
  Arrived: 'Arrived at drop-off',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export default function ShipperTrackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const loadId = params.id ?? '';
  const query = trpc.loads.get.useQuery({ id: loadId }, { enabled: Boolean(loadId), refetchInterval: 8000 });
  const load = query.data as LoadRow | undefined;

  const [pickupUrl, setPickupUrl] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (load?.pickup_photo_path) {
        try { const u = await getSignedUrl('attachments', load.pickup_photo_path, 300); if (!cancelled) setPickupUrl(u); } catch {}
      }
      if (load?.delivery_photo_path) {
        try { const u = await getSignedUrl('attachments', load.delivery_photo_path, 300); if (!cancelled) setDeliveryUrl(u); } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [load?.pickup_photo_path, load?.delivery_photo_path]);

  const points = useMemo<MapPoint[]>(() => {
    if (!load) return [];
    const pts: MapPoint[] = [
      { id: 'pickup', lat: Number(load.pickup_lat), lng: Number(load.pickup_lng), kind: 'pickup', label: 'Pickup' },
      { id: 'dropoff', lat: Number(load.dropoff_lat), lng: Number(load.dropoff_lng), kind: 'dropoff', label: 'Drop-off' },
    ];
    if (load.driver_lat != null && load.driver_lng != null) {
      pts.push({ id: 'driver', lat: Number(load.driver_lat), lng: Number(load.driver_lng), kind: 'driver', label: 'Truck', selected: true });
    }
    return pts;
  }, [load]);

  const routes = useMemo<MapRoute[]>(() => {
    if (!load) return [];
    return [{ from: { lat: Number(load.pickup_lat), lng: Number(load.pickup_lng) }, to: { lat: Number(load.dropoff_lat), lng: Number(load.dropoff_lng) } }];
  }, [load]);

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading shipment" /></View>;
  if (query.isError || !load) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load shipment" onRetry={() => void query.refetch()} /></View>;

  const hasDriverPos = load.driver_lat != null && load.driver_lng != null;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Track shipment</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[load.vehicle_type as VehicleType] ?? load.vehicle_type}</Text></View>
          <StatusBadge status={load.status} />
        </View>

        <View style={styles.stageCard}>
          <Navigation size={16} color={C.blue} />
          <View style={{ flex: 1 }}>
            <Text style={styles.stageText}>{STAGE_LABEL[load.status] ?? load.status}</Text>
            <Text style={styles.stageSub}>
              {hasDriverPos
                ? `Truck location updated ${relativeTime(load.driver_location_at)}`
                : load.status === 'Delivered' ? 'Trip complete' : 'Waiting for driver location…'}
            </Text>
          </View>
        </View>

        <LoadsMap points={points} routes={routes} height={300} />

        <View style={styles.routeCard}>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText}>{load.pickup_address || 'Pickup point'}</Text></View>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText}>{load.dropoff_address || 'Drop-off point'}</Text></View>
          <View style={styles.metaRow}>
            <View style={styles.meta}><MapPin size={12} color={C.textMuted} /><Text style={styles.metaText}>{load.distance_km} km</Text></View>
            <View style={styles.meta}><Package size={12} color={C.textMuted} /><Text style={styles.metaText}>${Number(load.total_price).toFixed(2)}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Proof</Text>
        <View style={styles.proofCard}>
          <View style={styles.proofRow}>
            <View style={styles.proofIcon}><Truck size={15} color={load.picked_up_at ? C.green : C.textMuted} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.proofTitle}>Pickup</Text>
              <Text style={styles.proofMeta}>{load.picked_up_at ? new Date(load.picked_up_at).toLocaleString() : 'Not picked up yet'}</Text>
            </View>
            {load.picked_up_at ? <CheckCircle2 size={16} color={C.green} /> : <Clock size={16} color={C.textMuted} />}
          </View>
          {pickupUrl ? <Image source={{ uri: pickupUrl }} style={styles.proofPhoto} contentFit="cover" /> : null}
        </View>

        <View style={styles.proofCard}>
          <View style={styles.proofRow}>
            <View style={styles.proofIcon}><CheckCircle2 size={15} color={load.delivered_at ? C.green : C.textMuted} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.proofTitle}>Delivery</Text>
              <Text style={styles.proofMeta}>
                {load.delivered_at ? `${new Date(load.delivered_at).toLocaleString()}${load.receiver_name ? ` · received by ${load.receiver_name}` : ''}` : 'Not delivered yet'}
              </Text>
            </View>
            {load.delivered_at ? <CheckCircle2 size={16} color={C.green} /> : <Clock size={16} color={C.textMuted} />}
          </View>
          {deliveryUrl ? <Image source={{ uri: deliveryUrl }} style={styles.proofPhoto} contentFit="cover" /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  vehBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  stageCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  stageText: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  stageSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  routeCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 8 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  proofCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 10 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  proofIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  proofTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  proofMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  proofPhoto: { width: '100%', height: 180, borderRadius: 12, backgroundColor: C.bgSecondary },
});
