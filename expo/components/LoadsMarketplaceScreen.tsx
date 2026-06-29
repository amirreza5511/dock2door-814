import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, MapPin, Package, Plus, ShieldAlert, Truck, UserCheck, UserRound, X, Zap } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import LoadsMap, { type MapPoint, type MapRoute } from '@/components/LoadsMap';
import C from '@/constants/colors';
import { VEHICLE_LABEL, VEHICLE_OPTIONS, VehicleType, smallerThanOwned } from '@/constants/loads';
import { useAuthStore } from '@/store/auth';
import { getCarrierVehicles } from '@/lib/carrier-vehicles';
import { trpc } from '@/lib/trpc';

/** Driver-side marketplace filter modes. */
type DriverMode = { kind: 'mine' } | { kind: 'smaller' } | { kind: 'type'; type: VehicleType };

type LoadRow = {
  id: string; vehicle_type: string; pallets: number; delivery_speed: string;
  pickup_lat: number; pickup_lng: number; pickup_address?: string | null;
  dropoff_lat: number; dropoff_lng: number; dropoff_address?: string | null;
  distance_km: number; freight_price: number; total_price: number; provider_net: number;
  notes?: string | null; status: string;
};

type FleetDriver = { id: string; name: string; userId: string | null; email: string | null; phone: string | null; licenseNumber: string | null };

interface Props {
  /** Route to the Post a Load screen, when this role can post (shippers/companies). */
  postRoute?: string;
  title?: string;
  /** When true, restrict the marketplace to the owner-operator's registered
   *  vehicle(s) — they never see loads requiring a bigger truck than they own. */
  restrictToMyVehicles?: boolean;
  /** When true (carrier dispatcher), the company can accept a load and assign it
   *  to one of its fleet drivers in a single flow, straight from the map. */
  enableDispatch?: boolean;
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(s)));
}

export default function LoadsMarketplaceScreen({ postRoute, title = 'Loads marketplace', restrictToMyVehicles = false, enableDispatch = false }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const userId = useAuthStore((s) => s.user?.id);

  const [vehicleFilter, setVehicleFilter] = useState<VehicleType | null>(null);
  const [driverMode, setDriverMode] = useState<DriverMode>({ kind: 'mine' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);

  // Owner-operator's registered vehicle types (restricted marketplace only).
  // Read from their profile (carrier_vehicle_types).
  const ownedQuery = useQuery({
    queryKey: ['carrier-vehicles', userId],
    enabled: restrictToMyVehicles && Boolean(userId),
    queryFn: async (): Promise<VehicleType[]> => getCarrierVehicles(userId ?? ''),
    staleTime: 30_000,
  });
  const owned = useMemo<VehicleType[]>(() => ownedQuery.data ?? [], [ownedQuery.data]);
  const smaller = useMemo<VehicleType[]>(() => smallerThanOwned(owned), [owned]);
  const hasVehicles = owned.length > 0;

  // Vehicle types the driver's current filter resolves to (undefined = no filter).
  const driverVehicleTypes = useMemo<VehicleType[] | undefined>(() => {
    if (!restrictToMyVehicles) return undefined;
    if (!hasVehicles) return undefined; // not registered yet — show all with a prompt
    if (driverMode.kind === 'mine') return owned;
    if (driverMode.kind === 'smaller') return smaller;
    return [driverMode.type];
  }, [restrictToMyVehicles, hasVehicles, driverMode, owned, smaller]);

  const loadsQuery = trpc.loads.listOpen.useQuery(
    restrictToMyVehicles ? { vehicleTypes: driverVehicleTypes ?? null } : { vehicleType: vehicleFilter },
    { refetchInterval: 20000, enabled: !restrictToMyVehicles || !ownedQuery.isLoading },
  );
  const acceptMutation = trpc.loads.accept.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.loads.listOpen.invalidate(), utils.loads.listAccepted.invalidate()]);
    },
  });

  // Carrier dispatcher: pick a fleet driver to assign the load to right after accepting.
  const fleetDriversQuery = trpc.loads.fleetDrivers.useQuery(undefined, { enabled: enableDispatch });
  const fleetDrivers = useMemo<FleetDriver[]>(() => (fleetDriversQuery.data ?? []) as FleetDriver[], [fleetDriversQuery.data]);
  const dispatchMutation = trpc.loads.dispatch.useMutation();
  // The id of the load that was just accepted and is now awaiting driver assignment.
  const [assignLoadId, setAssignLoadId] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setMe({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch { /* ignore */ }
    })();
  }, []);

  const loads = useMemo<LoadRow[]>(() => (loadsQuery.data ?? []) as LoadRow[], [loadsQuery.data]);

  const sorted = useMemo(() => {
    if (!me) return loads;
    return [...loads].sort((a, b) =>
      haversine(me.lat, me.lng, a.pickup_lat, a.pickup_lng) - haversine(me.lat, me.lng, b.pickup_lat, b.pickup_lng));
  }, [loads, me]);

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    for (const l of loads) {
      out.push({ id: `${l.id}:p`, lat: l.pickup_lat, lng: l.pickup_lng, kind: 'pickup', selected: l.id === selectedId });
      if (l.id === selectedId) out.push({ id: `${l.id}:d`, lat: l.dropoff_lat, lng: l.dropoff_lng, kind: 'dropoff', label: 'Drop-off' });
    }
    if (me) out.push({ id: 'me', lat: me.lat, lng: me.lng, kind: 'driver', label: 'You' });
    return out;
  }, [loads, selectedId, me]);

  const routes = useMemo<MapRoute[]>(() => {
    const sel = loads.find((l) => l.id === selectedId);
    return sel ? [{ from: { lat: sel.pickup_lat, lng: sel.pickup_lng }, to: { lat: sel.dropoff_lat, lng: sel.dropoff_lng } }] : [];
  }, [loads, selectedId]);

  const selected = loads.find((l) => l.id === selectedId) ?? null;

  const accept = async (id: string) => {
    try {
      await acceptMutation.mutateAsync({ id });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectedId(null);
      if (enableDispatch) {
        // Carrier flow: keep going and let the dispatcher assign a driver now.
        setAssignLoadId(id);
        return;
      }
      Alert.alert('Load accepted', 'It\'s now in My Loads — start the trip when you\'re ready.');
    } catch (err) {
      Alert.alert('Unable to accept', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const assignDriver = async (loadId: string, driver: FleetDriver) => {
    if (!driver.userId) {
      Alert.alert('Driver not linked', `${driver.name} isn\u2019t a registered app user yet. Add their account email in Fleet so they can receive dispatched loads.`);
      return;
    }
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await dispatchMutation.mutateAsync({ id: loadId, driverUserId: driver.userId });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([utils.loads.listOpen.invalidate(), utils.loads.listAccepted.invalidate()]);
      setAssignLoadId(null);
      Alert.alert('Driver dispatched', `${driver.name} was assigned this load and notified.`);
    } catch (err) {
      Alert.alert('Unable to dispatch', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const onSelectPoint = (pid: string) => setSelectedId(pid.split(':')[0]);

  if (loadsQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading marketplace" /></View>;
  if (loadsQuery.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load marketplace" onRetry={() => void loadsQuery.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        {postRoute ? (
          <TouchableOpacity onPress={() => router.push(postRoute as never)} style={styles.iconBtn}><Plus size={18} color={C.accent} /></TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loadsQuery.isFetching} onRefresh={() => void loadsQuery.refetch()} tintColor={C.accent} />}
      >
        <LoadsMap points={points} routes={routes} height={300} onSelectPoint={onSelectPoint} />

        {restrictToMyVehicles && !hasVehicles && !ownedQuery.isLoading ? (
          <TouchableOpacity style={styles.registerBanner} onPress={() => router.push('/driver/documents' as never)} activeOpacity={0.85}>
            <ShieldAlert size={18} color={C.yellow} />
            <View style={{ flex: 1 }}>
              <Text style={styles.registerTitle}>Register your truck</Text>
              <Text style={styles.registerSub}>Add the vehicle(s) you own so we show only loads you can actually haul.</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {restrictToMyVehicles ? (
          hasVehicles ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <FilterChip active={driverMode.kind === 'mine'} label="🚛 My vehicles" onPress={() => setDriverMode({ kind: 'mine' })} />
              {owned.length > 1 ? owned.map((t) => {
                const opt = VEHICLE_OPTIONS.find((v) => v.type === t);
                return (
                  <FilterChip
                    key={t}
                    active={driverMode.kind === 'type' && driverMode.type === t}
                    label={`${opt?.emoji ?? ''} ${VEHICLE_LABEL[t]}`}
                    onPress={() => setDriverMode({ kind: 'type', type: t })}
                  />
                );
              }) : null}
              {smaller.length > 0 ? (
                <FilterChip active={driverMode.kind === 'smaller'} label="📦 Smaller loads" onPress={() => setDriverMode({ kind: 'smaller' })} />
              ) : null}
            </ScrollView>
          ) : null
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <FilterChip active={vehicleFilter === null} label="All" onPress={() => setVehicleFilter(null)} />
            {VEHICLE_OPTIONS.map((v) => (
              <FilterChip key={v.type} active={vehicleFilter === v.type} label={`${v.emoji} ${v.label}`} onPress={() => setVehicleFilter(v.type)} />
            ))}
          </ScrollView>
        )}

        <Text style={styles.countText}>{sorted.length} open {sorted.length === 1 ? 'load' : 'loads'}{me ? ' · nearest first' : ''}</Text>

        {sorted.length === 0 ? (
          <EmptyState icon={Truck} title="No open loads" description={postRoute ? 'Post the first load to get drivers moving.' : 'New loads will appear here as shippers post them.'} actionLabel={postRoute ? 'Post a load' : undefined} onAction={postRoute ? () => router.push(postRoute as never) : undefined} />
        ) : sorted.map((l) => {
          const dist = me ? haversine(me.lat, me.lng, l.pickup_lat, l.pickup_lng) : null;
          return (
            <Card key={l.id} style={StyleSheet.flatten([styles.loadCard, l.id === selectedId && styles.loadCardActive])} onPress={() => setSelectedId(l.id)}>
              <View style={styles.loadTop}>
                <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type}</Text></View>
                {l.delivery_speed === 'SameDay' ? <View style={styles.sameDay}><Zap size={10} color={C.accent} /><Text style={styles.sameDayText}>Same day</Text></View> : null}
                <Text style={styles.loadPrice}>${Number(l.total_price).toFixed(0)}</Text>
              </View>
              <View style={styles.routeRow}>
                <View style={styles.routeCol}>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{l.pickup_address || 'Pickup point'}</Text></View>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{l.dropoff_address || 'Drop-off point'}</Text></View>
                </View>
              </View>
              <View style={styles.loadMetaRow}>
                <Meta icon={Package} text={`${l.pallets} ${l.pallets === 1 ? 'pallet' : 'pallets'}`} />
                <Meta icon={MapPin} text={`${l.distance_km} km`} />
                {dist != null ? <Meta icon={Truck} text={`${dist} km away`} /> : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelectedId(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            {selected ? (
              <>
                <View style={styles.sheetHead}>
                  <Text style={styles.sheetTitle}>{VEHICLE_LABEL[selected.vehicle_type as VehicleType] ?? selected.vehicle_type} load</Text>
                  <TouchableOpacity onPress={() => setSelectedId(null)} style={styles.iconBtn}><X size={18} color={C.text} /></TouchableOpacity>
                </View>
                <View style={styles.sheetRoute}>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.sheetRouteText}>{selected.pickup_address || 'Pickup point'}</Text></View>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.sheetRouteText}>{selected.dropoff_address || 'Drop-off point'}</Text></View>
                </View>
                <View style={styles.sheetStats}>
                  <Stat label="Distance" value={`${selected.distance_km} km`} />
                  <Stat label="Pallets" value={String(selected.pallets)} />
                  <Stat label="Speed" value={selected.delivery_speed === 'SameDay' ? 'Same day' : 'Next day'} />
                </View>
                <View style={styles.payoutBox}>
                  <Text style={styles.payoutLabel}>You earn (after platform cut)</Text>
                  <Text style={styles.payoutValue}>${Number(selected.provider_net).toFixed(2)}</Text>
                </View>
                {selected.notes ? <Text style={styles.sheetNotes}>“{selected.notes}”</Text> : null}
                <Button label={enableDispatch ? 'Accept & assign driver' : 'Accept load'} onPress={() => void accept(selected.id)} loading={acceptMutation.isPending} fullWidth size="lg" icon={enableDispatch ? <UserCheck size={16} color={C.white} /> : <Truck size={16} color={C.white} />} />
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterChipText, active && { color: C.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Meta({ icon: Icon, text }: { icon: React.ComponentType<{ size?: number; color?: string }>; text: string }) {
  return (
    <View style={styles.meta}><Icon size={12} color={C.textMuted} /><Text style={styles.metaText}>{text}</Text></View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 12 },
  registerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.yellowDim, borderWidth: 1, borderColor: C.yellow + '55', borderRadius: 14, padding: 12 },
  registerTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  registerSub: { fontSize: 11, color: C.textSecondary, marginTop: 2, lineHeight: 15 },
  filterRow: { gap: 8, paddingVertical: 2 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterChipText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  countText: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  loadCard: { gap: 10 },
  loadCardActive: { borderColor: C.accent },
  loadTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  vehBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  sameDay: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  sameDayText: { fontSize: 10, fontWeight: '800' as const, color: C.accent },
  loadPrice: { marginLeft: 'auto', fontSize: 18, fontWeight: '800' as const, color: C.text },
  routeRow: { flexDirection: 'row' },
  routeCol: { flex: 1, gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  loadMetaRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  sheetBackdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  sheetRoute: { gap: 8 },
  sheetRouteText: { flex: 1, fontSize: 14, color: C.text },
  sheetStats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 3, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  payoutBox: { backgroundColor: C.greenDim, borderRadius: 12, padding: 14, alignItems: 'center' },
  payoutLabel: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  payoutValue: { fontSize: 24, fontWeight: '800' as const, color: C.green, marginTop: 2 },
  sheetNotes: { fontSize: 13, color: C.textSecondary, fontStyle: 'italic' as const },
});
