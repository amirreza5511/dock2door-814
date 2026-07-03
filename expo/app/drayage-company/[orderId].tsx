import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CalendarClock, CheckCircle2, MapPin, Package, Ship, Truck, User, X, Anchor, Clock } from 'lucide-react-native';
import { Image } from 'expo-image';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
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

const MOVE_NEXT: Record<string, { label: string; status: string } | null> = {
  Pending: { label: 'Assign driver', status: 'Assigned' },
  Assigned: { label: 'Start trip', status: 'EnRoute' },
  EnRoute: { label: 'At pickup', status: 'AtOrigin' },
  AtOrigin: { label: 'Pick up container', status: 'Loaded' },
  Loaded: { label: 'In transit', status: 'InTransit' },
  InTransit: { label: 'At destination', status: 'AtDestination' },
  AtDestination: { label: 'Drop off', status: 'Unloaded' },
  Unloaded: { label: 'Complete', status: 'Completed' },
};

export default function DrayageOrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const utils = trpc.useUtils();

  const detailsQuery = trpc.drayage.getOrderDetails.useQuery({ id: orderId }, { refetchInterval: 15000 });
  const portResMutation = trpc.drayage.updatePortReservation.useMutation({
    onSuccess: async () => { await utils.drayage.getOrderDetails.invalidate({ id: orderId }); },
  });
  const dispatchMutation = trpc.drayage.dispatchMove.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.getOrderDetails.invalidate({ id: orderId });
      setDispatchModal(null);
    },
  });
  const advanceMutation = trpc.drayage.advanceMove.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await utils.drayage.getOrderDetails.invalidate({ id: orderId });
    },
  });

  const [portModal, setPortModal] = useState(false);
  const [dispatchModal, setDispatchModal] = useState<any | null>(null);
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');
  const [drivers, setDrivers] = useState<any[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [allTracking, setAllTracking] = useState<any[]>([]);

  const order = detailsQuery.data?.order as any;
  const moves = (detailsQuery.data?.moves ?? []) as any[];
  const latestTracking = detailsQuery.data?.latestTracking as any;

  // Resolve signed URLs for any captured pickup/delivery proof photos so ops can audit them.
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
  }, [JSON.stringify(moves.map((m) => [m.pickup_photo_path, m.delivery_photo_path]))]);

  useEffect(() => {
    if (order?.port_reservation_date) setResDate(String(order.port_reservation_date));
    if (order?.port_reservation_time) setResTime(order.port_reservation_time);
  }, [order?.port_reservation_date, order?.port_reservation_time]);

  // Load drivers from fleet
  useEffect(() => {
    if (!order?.drayage_company_id) return;
    void (async () => {
      const { data } = await supabase
        .from('fleet')
        .select('*')
        .eq('company_id', order.drayage_company_id)
        .eq('entity', 'drivers')
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      setDrivers(data ?? []);
    })();
  }, [order?.drayage_company_id]);

  // Load terminals for display
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('terminals').select('*').eq('is_active', true).order('name');
      setTerminals(data ?? []);
    })();
  }, []);

  // Fetch full tracking history so ops can see the truck's path on the map.
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
    () => terminalCoord(order?.origin_terminal_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, terminals],
  );
  const destCoord = useMemo(
    () => terminalCoord(order?.destination_terminal_id),
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

  const handleSavePortReservation = async () => {
    if (!resDate.trim() || !resTime.trim()) {
      Alert.alert('Required', 'Enter both date and time from the port portal.');
      return;
    }
    try {
      await portResMutation.mutateAsync({
        orderId,
        reservationDate: resDate.trim(),
        reservationTime: resTime.trim(),
        confirmed: true,
      });
      setPortModal(false);
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown');
    }
  };

  const handleAdvance = async (move: any) => {
    const next = MOVE_NEXT[move.status];
    if (!next) return;
    try {
      await advanceMutation.mutateAsync({ moveId: move.id, nextStatus: next.status });
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown');
    }
  };

  if (detailsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading order" /></View>;
  }
  if (detailsQuery.isError || !order) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Order not found" onRetry={() => void detailsQuery.refetch()} /></View>;
  }

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
        {/* Order info card */}
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

        {/* Route card */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <MapPin size={16} color={C.blue} />
            <Text style={styles.sectionTitle}>Route</Text>
          </View>
          {order.direction === 'Import' ? (
            <>
              <Text style={styles.routeLabel}>From (Pickup):</Text>
              <Text style={styles.routeValue}>{terminalName(order.origin_terminal_id)}</Text>
              <Text style={styles.routeLabel}>To (Delivery):</Text>
              <Text style={styles.routeValue}>{order.delivery_address || terminalName(order.destination_terminal_id)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.routeLabel}>Empty pickup:</Text>
              <Text style={styles.routeValue}>{terminalName(order.origin_terminal_id)}</Text>
              <Text style={styles.routeLabel}>Load at:</Text>
              <Text style={styles.routeValue}>{order.pickup_address || terminalName(order.warehouse_company_id ? '' : null)}</Text>
              <Text style={styles.routeLabel}>Deliver to port/rail:</Text>
              <Text style={styles.routeValue}>{terminalName(order.destination_terminal_id)}</Text>
            </>
          )}
        </Card>

        {/* Port reservation card */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <CalendarClock size={16} color={order.port_reservation_confirmed ? C.green : C.yellow} />
            <Text style={styles.sectionTitle}>Port Reservation</Text>
          </View>
          {order.port_reservation_date ? (
            <View style={styles.resRow}>
              <View>
                <Text style={styles.resDate}>{order.port_reservation_date}</Text>
                <Text style={styles.resTime}>{order.port_reservation_time}</Text>
              </View>
              {order.port_reservation_confirmed ? (
                <View style={styles.confirmedBadge}><CheckCircle2 size={14} color={C.green} /><Text style={styles.confirmedText}>Confirmed</Text></View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.noRes}>No port reservation entered yet</Text>
          )}
          <Button
            label={order.port_reservation_date ? 'Update reservation' : 'Enter port reservation'}
            variant="ghost"
            onPress={() => setPortModal(true)}
            fullWidth
            size="md"
            icon={<CalendarClock size={15} color={C.accent} />}
          />
        </Card>

        {/* Prepull card */}
        {order.is_prepull ? (
          <Card style={[styles.sectionCard, { borderColor: C.purple + '55' }]}>
            <View style={styles.sectionHeader}>
              <Clock size={16} color={C.purple} />
              <Text style={styles.sectionTitle}>Prepull</Text>
            </View>
            <Text style={styles.prepullDesc}>
              Container picked up {order.prepull_pickup_date ? `on ${order.prepull_pickup_date}` : 'day before'} and held at {terminalName(order.prepull_yard_terminal_id)}.
              Delivered next day.
            </Text>
          </Card>
        ) : null}

        {/* Moves / Work Orders */}
        <View style={styles.sectionHeader}>
          <Truck size={16} color={C.accent} />
          <Text style={styles.sectionTitle}>Moves & Driver Assignments</Text>
        </View>
        {moves.length === 0 ? (
          <Card style={styles.sectionCard}>
            <EmptyState icon={Truck} title="No moves yet" description="Moves are generated when you dispatch drivers for this order." />
          </Card>
        ) : moves.map((m, i) => {
          const next = MOVE_NEXT[m.status];
          const driverName = drivers.find((d) => (d.driver_user_id ?? d.data?.userId) === m.driver_user_id)?.data?.name ?? (m.driver_user_id ? 'Assigned' : 'Unassigned');
          return (
            <Card key={m.id} style={styles.moveCard}>
              <View style={styles.moveTop}>
                <View style={styles.moveNum}><Text style={styles.moveNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.moveType}>{m.move_type}</Text>
                  <Text style={styles.moveDriver}>{driverName}</Text>
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
                        <CheckCircle2 size={12} color={C.blue} />
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
                        <CheckCircle2 size={12} color={C.green} />
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
              {m.status === 'Pending' && order.drayage_company_id ? (
                <Button
                  label="Assign driver"
                  variant="ghost"
                  size="sm"
                  onPress={() => setDispatchModal(m)}
                  icon={<User size={14} color={C.accent} />}
                  fullWidth
                />
              ) : next ? (
                <Button
                  label={next.label}
                  size="sm"
                  onPress={() => handleAdvance(m)}
                  loading={advanceMutation.isPending}
                  fullWidth
                />
              ) : null}
            </Card>
          );
        })}

        {/* Live map */}
        {mapRegion ? (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MapPin size={16} color={C.green} />
              <Text style={styles.sectionTitle}>Live Truck Location</Text>
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
                    <Marker coordinate={containerCoord} title="Truck" description="Current location" pinColor={C.accent}>
                      <View style={styles.truckMarker}><Truck size={16} color={C.white} /></View>
                    </Marker>
                  ) : null}
                </MapView>
              )}
            </View>
            {latestTracking ? (
              <Text style={styles.trackingTime}>
                {latestTracking.lat.toFixed(4)}, {latestTracking.lng.toFixed(4)} · updated {new Date(latestTracking.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            ) : null}
          </Card>
        ) : latestTracking ? (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MapPin size={16} color={C.green} />
              <Text style={styles.sectionTitle}>Last Known Location</Text>
            </View>
            <Text style={styles.trackingCoord}>{latestTracking.lat.toFixed(4)}, {latestTracking.lng.toFixed(4)}</Text>
            <Text style={styles.trackingTime}>Updated {new Date(latestTracking.recorded_at).toLocaleString()}</Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* Port Reservation Modal */}
      <Modal visible={portModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPortModal(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Port Reservation</Text>
            <TouchableOpacity onPress={() => setPortModal(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.modalHint}>Enter the reservation date & time you got from the port portal:</Text>
            <Input label="Reservation date (YYYY-MM-DD)" value={resDate} onChangeText={setResDate} placeholder="2026-07-15" />
            <Input label="Reservation time" value={resTime} onChangeText={setResTime} placeholder="14:30" />
            <Button label="Save reservation" onPress={() => void handleSavePortReservation()} loading={portResMutation.isPending} fullWidth size="lg" />
            <Button label="Cancel" onPress={() => setPortModal(false)} variant="ghost" fullWidth />
          </View>
        </View>
      </Modal>

      {/* Dispatch Driver Modal */}
      <Modal visible={dispatchModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDispatchModal(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign Driver</Text>
            <TouchableOpacity onPress={() => setDispatchModal(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.modalHint}>Select a driver from your fleet:</Text>
            {drivers.length === 0 ? (
              <EmptyState icon={User} title="No drivers" description="Add drivers in your fleet management first." />
            ) : drivers.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={styles.driverItem}
                onPress={() => {
                  const driverUserId = d.driver_user_id ?? d.data?.userId;
                  if (!driverUserId) { Alert.alert('No driver login', 'This driver has no linked account yet. Edit the driver in Fleet and set the email they signed up with.'); return; }
                  void dispatchMutation.mutateAsync({ moveId: dispatchModal?.id, driverUserId }).catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
                }}
              >
                <View style={styles.driverIcon}><User size={16} color={C.green} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{d.data?.name ?? d.name ?? 'Driver'}</Text>
                  <Text style={styles.driverMeta}>{d.license_number ?? d.license_class ?? 'Tap to assign'}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <Button label="Cancel" onPress={() => setDispatchModal(null)} variant="ghost" fullWidth />
          </View>
        </View>
      </Modal>
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
  routeLabel: { fontSize: 11, color: C.textMuted, marginTop: 4 },
  routeValue: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  resRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resDate: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  resTime: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  confirmedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  confirmedText: { fontSize: 11, fontWeight: '700' as const, color: C.green },
  noRes: { fontSize: 13, color: C.textMuted },
  prepullDesc: { fontSize: 12, color: C.purple, lineHeight: 18 },
  moveCard: { gap: 8 },
  moveTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moveNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  moveNumText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  moveType: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  moveDriver: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  moveApptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moveApptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  proofRow: { flexDirection: 'row', gap: 10 },
  proofCell: { flex: 1, gap: 4 },
  proofHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  proofLabel: { fontSize: 11, fontWeight: '700' as const },
  proofPhoto: { width: '100%', height: 110, borderRadius: 10, backgroundColor: C.card },
  proofPhotoPlaceholder: { borderWidth: 1, borderColor: C.border },
  proofTime: { fontSize: 10, color: C.textMuted },
  proofMeta: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  trackingCoord: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  trackingTime: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  mapWrap: { height: 220, borderRadius: 12, overflow: 'hidden' as const, backgroundColor: C.bgSecondary },
  mapFallback: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, padding: 20 },
  mapFallbackText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const },
  mapFallbackCoord: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  truckMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2, borderColor: C.white },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
  modalHint: { fontSize: 13, color: C.textSecondary, marginBottom: 4 },
  driverItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  driverIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  driverMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
