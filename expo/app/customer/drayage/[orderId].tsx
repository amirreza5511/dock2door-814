import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CalendarClock, MapPin, Package, Ship, Truck, Anchor, Clock, CheckCircle2, Radio } from 'lucide-react-native';
import { Image } from 'expo-image';
import { CheckCircle2 as _CC } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { getSignedUrl } from '@/lib/storage-files';

const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };

// react-native-maps does not render on web (needs a Google Maps loader/key), so we
// only pull it in on native and show a graceful fallback on web.
const isWeb = Platform.OS === 'web';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Maps = isWeb ? null : require('react-native-maps');
const MapView = Maps?.default ?? null;
const Marker = Maps?.Marker ?? null;
const Polyline = Maps?.Polyline ?? null;
const PROVIDER_DEFAULT = Maps?.PROVIDER_DEFAULT ?? undefined;

type LatLng = { latitude: number; longitude: number };
const validCoord = (lat?: number | null, lng?: number | null): LatLng | null =>
  lat != null && lng != null && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001)
    ? { latitude: lat, longitude: lng }
    : null;

const STATUS_LABEL: Record<string, string> = {
  Open: 'Open — waiting for drayage company',
  Assigned: 'Drayage company assigned',
  Dispatched: 'Driver dispatched',
  EnRoute: 'Driver en route to pickup',
  PickedUp: 'Container picked up',
  InTransit: 'Container in transit',
  Delivered: 'Delivered',
  EmptyReturned: 'Empty returned',
  Cancelled: 'Cancelled',
};

export default function CustomerDrayageOrderDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();

  const detailsQuery = trpc.drayage.getOrderDetails.useQuery({ id: orderId }, { refetchInterval: 10000 });
  const [terminals, setTerminals] = useState<any[]>([]);
  const [allTracking, setAllTracking] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('terminals').select('*').eq('is_active', true).order('name');
      setTerminals(data ?? []);
    })();
  }, []);

  // Fetch tracking history
  useEffect(() => {
    if (!orderId) return;
    void (async () => {
      const { data } = await supabase
        .from('container_tracking')
        .select('*')
        .eq('order_id', orderId)
        .order('recorded_at', { ascending: false })
        .limit(20);
      setAllTracking(data ?? []);
    })();
  }, [orderId, detailsQuery.data]);

  const order = detailsQuery.data?.order as any;
  const moves = (detailsQuery.data?.moves ?? []) as any[];

  // Resolve signed URLs for any captured pickup/delivery proof photos.
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const paths = moves
      .flatMap((m) => [m.pickup_photo_path, m.delivery_photo_path])
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        paths.map(async (p) => {
          try { return [p, await getSignedUrl('attachments', p, 60 * 60)] as const; }
          catch { return null; }
        }),
      );
      setProofUrls((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsQuery.data]);
  const latestTracking = (detailsQuery.data?.latestTracking ?? allTracking[0]) as any;

  const terminalName = (id: string | null) => {
    if (!id) return '—';
    const t = terminals.find((t) => t.id === id);
    return t ? `${t.name} (${t.code})` : '—';
  };

  const terminalCoord = (id: string | null): LatLng | null => {
    if (!id) return null;
    const t = terminals.find((t) => t.id === id);
    return t ? validCoord(Number(t.geo_lat), Number(t.geo_lng)) : null;
  };

  const containerCoord = useMemo(
    () => (latestTracking ? validCoord(Number(latestTracking.lat), Number(latestTracking.lng)) : null),
    [latestTracking],
  );

  const originCoord = useMemo(
    () => terminalCoord(order?.origin_terminal_id) ?? validCoord(Number(order?.pickup_lat), Number(order?.pickup_lng)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, terminals],
  );
  const destCoord = useMemo(
    () => terminalCoord(order?.destination_terminal_id) ?? validCoord(Number(order?.delivery_lat), Number(order?.delivery_lng)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, terminals],
  );

  const trackPath = useMemo(
    () =>
      allTracking
        .map((t) => validCoord(Number(t.lat), Number(t.lng)))
        .filter((c): c is LatLng => c != null)
        .reverse(),
    [allTracking],
  );

  const mapRegion = useMemo(() => {
    const pts = [containerCoord, originCoord, destCoord].filter((c): c is LatLng => c != null);
    if (pts.length === 0) return null;
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.05),
      longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.05),
    };
  }, [containerCoord, originCoord, destCoord]);

  if (detailsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading order" /></View>;
  }
  if (detailsQuery.isError || !order) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Order not found" onRetry={() => void detailsQuery.refetch()} /></View>;
  }

  const dirColor = DIRECTION_COLOR[order.direction] ?? C.blue;
  const isActive = ['Dispatched', 'EnRoute', 'PickedUp', 'InTransit'].includes(order.status);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{order.reference_code}</Text>
          <Text style={styles.headerSub}>{order.direction} · {order.container_number || 'Container TBD'}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={detailsQuery.isFetching} onRefresh={() => void detailsQuery.refetch()} tintColor={C.accent} />}
      >
        {/* Status banner */}
        <View style={[styles.statusBanner, { borderColor: dirColor + '55', backgroundColor: dirColor + '10' }]}>
          <View style={[styles.statusIcon, { backgroundColor: dirColor + '20' }]}>
            {isActive ? <Radio size={20} color={dirColor} /> : order.status === 'Delivered' ? <CheckCircle2 size={20} color={C.green} /> : <Package size={20} color={dirColor} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>{STATUS_LABEL[order.status] ?? order.status}</Text>
            {latestTracking ? (
              <Text style={styles.statusSub}>Last update: {new Date(latestTracking.recorded_at).toLocaleString()}</Text>
            ) : (
              <Text style={styles.statusSub}>{isActive ? 'Waiting for driver location...' : 'Not yet in transit'}</Text>
            )}
          </View>
        </View>

        {/* Live map */}
        {mapRegion ? (
          <Card style={styles.mapCard}>
            <View style={styles.sectionHeader}>
              <MapPin size={16} color={C.green} />
              <Text style={styles.sectionTitle}>Live Map</Text>
            </View>
            <View style={styles.mapWrap}>
              {isWeb || !MapView ? (
                <View style={styles.mapFallback}>
                  <Ship size={30} color={C.accent} />
                  <Text style={styles.mapFallbackText}>Open on your phone to see the live map.</Text>
                  {containerCoord ? (
                    <Text style={styles.mapFallbackCoord}>{containerCoord.latitude.toFixed(4)}, {containerCoord.longitude.toFixed(4)}</Text>
                  ) : null}
                </View>
              ) : (
                <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} region={mapRegion}>
                  {originCoord && Marker ? (
                    <Marker coordinate={originCoord} title="Pickup" description={terminalName(order.origin_terminal_id)} pinColor={C.blue} />
                  ) : null}
                  {destCoord && Marker ? (
                    <Marker coordinate={destCoord} title="Destination" description={order.delivery_address || terminalName(order.destination_terminal_id)} pinColor={C.green} />
                  ) : null}
                  {trackPath.length > 1 && Polyline ? (
                    <Polyline coordinates={trackPath} strokeColor={C.accent} strokeWidth={3} />
                  ) : null}
                  {containerCoord && Marker ? (
                    <Marker coordinate={containerCoord} title="Container" description="Current location" pinColor={C.accent}>
                      <View style={styles.truckMarker}><Truck size={16} color={C.white} /></View>
                    </Marker>
                  ) : null}
                </MapView>
              )}
            </View>
          </Card>
        ) : null}

        {/* Live tracking card */}
        {latestTracking ? (
          <Card style={styles.trackingCard}>
            <View style={styles.sectionHeader}>
              <MapPin size={16} color={C.green} />
              <Text style={styles.sectionTitle}>Live Container Location</Text>
            </View>
            <View style={styles.trackingCoordBox}>
              <Text style={styles.trackingLat}>{latestTracking.lat.toFixed(4)}</Text>
              <Text style={styles.trackingLng}>{latestTracking.lng.toFixed(4)}</Text>
            </View>
            <View style={styles.trackingMetaRow}>
              <View style={styles.trackingMetaCell}>
                <Text style={styles.trackingMetaLabel}>Speed</Text>
                <Text style={styles.trackingMetaValue}>{latestTracking.speed_kph ? `${latestTracking.speed_kph} kph` : '—'}</Text>
              </View>
              <View style={styles.trackingMetaCell}>
                <Text style={styles.trackingMetaLabel}>Heading</Text>
                <Text style={styles.trackingMetaValue}>{latestTracking.heading ? `${Math.round(latestTracking.heading)}°` : '—'}</Text>
              </View>
              <View style={styles.trackingMetaCell}>
                <Text style={styles.trackingMetaLabel}>Updated</Text>
                <Text style={styles.trackingMetaValue}>{new Date(latestTracking.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Container details */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Package size={16} color={C.accent} />
            <Text style={styles.sectionTitle}>Container Details</Text>
          </View>
          <View style={styles.detailGrid}>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>Container #</Text><Text style={styles.detailValue}>{order.container_number || 'TBD'}</Text></View>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>Size</Text><Text style={styles.detailValue}>{order.container_size}</Text></View>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>Type</Text><Text style={styles.detailValue}>{order.container_type || 'Standard'}</Text></View>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>Weight</Text><Text style={styles.detailValue}>{order.weight_kg ? `${order.weight_kg}kg` : '—'}</Text></View>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>BOL</Text><Text style={styles.detailValue}>{order.bol_number || '—'}</Text></View>
            <View style={styles.detailCell}><Text style={styles.detailLabel}>Booking</Text><Text style={styles.detailValue}>{order.booking_number || '—'}</Text></View>
          </View>
          {order.commodity ? <Text style={styles.commodity}>{order.commodity}</Text> : null}
          {(order.is_hazmat || order.is_overweight || order.is_oversized) ? (
            <View style={styles.flagsRow}>
              {order.is_hazmat ? <Text style={[styles.flag, { color: C.red, backgroundColor: C.redDim }]}>Hazmat</Text> : null}
              {order.is_overweight ? <Text style={[styles.flag, { color: C.yellow, backgroundColor: C.yellowDim }]}>Overweight</Text> : null}
              {order.is_oversized ? <Text style={[styles.flag, { color: C.orange, backgroundColor: C.orangeDim }]}>Oversized</Text> : null}
            </View>
          ) : null}
        </Card>

        {/* Route */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ship size={16} color={C.blue} />
            <Text style={styles.sectionTitle}>Route</Text>
          </View>
          {order.direction === 'Import' ? (
            <>
              <View style={styles.routeStop}>
                <View style={[styles.routeDot, { backgroundColor: C.blue }]} />
                <View>
                  <Text style={styles.routeLabel}>Pickup from:</Text>
                  <Text style={styles.routeValue}>{terminalName(order.origin_terminal_id)}</Text>
                </View>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeStop}>
                <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                <View>
                  <Text style={styles.routeLabel}>Deliver to:</Text>
                  <Text style={styles.routeValue}>{order.delivery_address || terminalName(order.destination_terminal_id)}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.routeStop}>
                <View style={[styles.routeDot, { backgroundColor: C.yellow }]} />
                <View>
                  <Text style={styles.routeLabel}>Empty pickup:</Text>
                  <Text style={styles.routeValue}>{terminalName(order.origin_terminal_id)}</Text>
                </View>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeStop}>
                <View style={[styles.routeDot, { backgroundColor: C.accent }]} />
                <View>
                  <Text style={styles.routeLabel}>Load at:</Text>
                  <Text style={styles.routeValue}>{order.pickup_address || 'Warehouse'}</Text>
                </View>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeStop}>
                <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                <View>
                  <Text style={styles.routeLabel}>Deliver to port/rail:</Text>
                  <Text style={styles.routeValue}>{terminalName(order.destination_terminal_id)}</Text>
                </View>
              </View>
            </>
          )}
        </Card>

        {/* Port reservation */}
        {order.port_reservation_date ? (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <CalendarClock size={16} color={order.port_reservation_confirmed ? C.green : C.yellow} />
              <Text style={styles.sectionTitle}>Port Reservation</Text>
            </View>
            <View style={styles.resRow}>
              <View>
                <Text style={styles.resDate}>{order.port_reservation_date}</Text>
                <Text style={styles.resTime}>{order.port_reservation_time}</Text>
              </View>
              {order.port_reservation_confirmed ? (
                <View style={styles.confirmedBadge}><CheckCircle2 size={14} color={C.green} /><Text style={styles.confirmedText}>Confirmed</Text></View>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* Prepull */}
        {order.is_prepull ? (
          <Card style={[styles.sectionCard, { borderColor: C.purple + '55' }]}>
            <View style={styles.sectionHeader}>
              <Clock size={16} color={C.purple} />
              <Text style={styles.sectionTitle}>Prepull</Text>
            </View>
            <Text style={styles.prepullDesc}>
              Container picked up {order.prepull_pickup_date ? `on ${order.prepull_pickup_date}` : 'day before'} and held at yard. Delivered next day.
            </Text>
          </Card>
        ) : null}

        {/* Move progress */}
        <View style={styles.sectionHeader}>
          <Truck size={16} color={C.accent} />
          <Text style={styles.sectionTitle}>Move Progress</Text>
        </View>
        {moves.length === 0 ? (
          <Card><EmptyState icon={Truck} title="No moves yet" description="The drayage company will dispatch drivers for this order." /></Card>
        ) : moves.map((m, i) => (
          <Card key={m.id} style={styles.moveCard}>
            <View style={styles.moveTop}>
              <View style={styles.moveNum}><Text style={styles.moveNumText}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.moveType}>{m.move_type}</Text>
              </View>
              <StatusBadge status={m.status} />
            </View>
            {m.appt_date ? (
              <View style={styles.moveApptRow}>
                <CalendarClock size={11} color={C.green} />
                <Text style={styles.moveApptText}>Appt: {m.appt_date} {m.appt_time}</Text>
              </View>
            ) : null}
            {(m.pickup_photo_path || m.delivery_photo_path) ? (
              <View style={styles.proofRow}>
                {m.pickup_photo_path ? (
                  <View style={styles.proofCell}>
                    <View style={styles.proofHead}>
                      <_CC size={12} color={C.blue} />
                      <Text style={[styles.proofLabel, { color: C.blue }]}>Pickup</Text>
                    </View>
                    {proofUrls[m.pickup_photo_path] ? (
                      <Image source={{ uri: proofUrls[m.pickup_photo_path] }} style={styles.proofPhoto} contentFit="cover" />
                    ) : <View style={[styles.proofPhoto, styles.proofPhotoPlaceholder]} />}
                    {m.picked_up_at ? <Text style={styles.proofTime}>{new Date(m.picked_up_at).toLocaleString()}</Text> : null}
                    {m.captured_container_number ? <Text style={styles.proofMeta}>#{m.captured_container_number}</Text> : null}
                  </View>
                ) : null}
                {m.delivery_photo_path ? (
                  <View style={styles.proofCell}>
                    <View style={styles.proofHead}>
                      <_CC size={12} color={C.green} />
                      <Text style={[styles.proofLabel, { color: C.green }]}>Delivery</Text>
                    </View>
                    {proofUrls[m.delivery_photo_path] ? (
                      <Image source={{ uri: proofUrls[m.delivery_photo_path] }} style={styles.proofPhoto} contentFit="cover" />
                    ) : <View style={[styles.proofPhoto, styles.proofPhotoPlaceholder]} />}
                    {m.delivered_at ? <Text style={styles.proofTime}>{new Date(m.delivered_at).toLocaleString()}</Text> : null}
                    {m.receiver_name ? <Text style={styles.proofMeta}>By {m.receiver_name}</Text> : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        ))}

        {/* Tracking history */}
        {allTracking.length > 1 ? (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MapPin size={16} color={C.textMuted} />
              <Text style={styles.sectionTitle}>Location History</Text>
            </View>
            {allTracking.slice(0, 10).map((t, i) => (
              <View key={t.id} style={styles.historyRow}>
                <View style={[styles.historyDot, i === 0 && { backgroundColor: C.green }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyCoord}>{t.lat.toFixed(3)}, {t.lng.toFixed(3)}</Text>
                  <Text style={styles.historyTime}>{new Date(t.recorded_at).toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { paddingHorizontal: 20, gap: 14, paddingTop: 16 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 16 },
  statusIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  statusSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  mapCard: { gap: 10 },
  mapWrap: { height: 220, borderRadius: 12, overflow: 'hidden' as const, backgroundColor: C.bgSecondary },
  mapFallback: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, padding: 20 },
  mapFallbackText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const },
  mapFallbackCoord: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  truckMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2, borderColor: C.white },
  trackingCard: { gap: 10 },
  trackingCoordBox: { flexDirection: 'row', gap: 20, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 14 },
  trackingLat: { fontSize: 22, fontWeight: '800' as const, color: C.green, letterSpacing: -0.5 },
  trackingLng: { fontSize: 22, fontWeight: '800' as const, color: C.green, letterSpacing: -0.5 },
  trackingMetaRow: { flexDirection: 'row', gap: 8 },
  trackingMetaCell: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, alignItems: 'center' as const },
  trackingMetaLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  trackingMetaValue: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 3 },
  sectionCard: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  detailCell: { width: '48%', gap: 2 },
  detailLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  detailValue: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  commodity: { fontSize: 13, color: C.textSecondary, fontStyle: 'italic' as const },
  flagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  flag: { fontSize: 10, fontWeight: '700' as const, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' as const },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeLine: { marginLeft: 5, height: 24, width: 2, backgroundColor: C.border },
  routeLabel: { fontSize: 11, color: C.textMuted },
  routeValue: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  resRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resDate: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  resTime: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  confirmedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  confirmedText: { fontSize: 11, fontWeight: '700' as const, color: C.green },
  prepullDesc: { fontSize: 12, color: C.purple, lineHeight: 18 },
  moveCard: { gap: 8 },
  moveTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moveNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  moveNumText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  moveType: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  moveApptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moveApptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  proofRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  proofCell: { flex: 1, gap: 4 },
  proofHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  proofLabel: { fontSize: 10, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  proofPhoto: { width: '100%' as const, height: 96, borderRadius: 10, backgroundColor: C.bgSecondary },
  proofPhotoPlaceholder: { borderWidth: 1, borderColor: C.border },
  proofTime: { fontSize: 10, color: C.textMuted },
  proofMeta: { fontSize: 11, color: C.text, fontWeight: '600' as const },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.textMuted },
  historyCoord: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  historyTime: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
