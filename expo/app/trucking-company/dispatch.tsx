import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Clock, MapPin, Navigation, Radio, Route as RouteIcon, Search, Truck, UserPlus, UserRound, X } from 'lucide-react-native';
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
  accepted_driver_user_id?: string | null;
  pickup_lat?: number | null; pickup_lng?: number | null; pickup_address?: string | null;
  dropoff_lat?: number | null; dropoff_lng?: number | null; dropoff_address?: string | null;
  driver_lat?: number | null; driver_lng?: number | null; driver_location_at?: string | null;
  driver_name?: string | null; distance_km?: number | null;
};

type FleetDriver = {
  id: string; name?: string | null; phone?: string | null;
  data?: { name?: string; email?: string; userId?: string } | null;
};

const ACTIVE = ['Accepted', 'EnRoute', 'Arrived'];
type FilterKey = 'all' | 'waiting' | 'enroute' | 'arrived';
const FILTERS: [FilterKey, string][] = [
  ['all', 'All'],
  ['waiting', 'Waiting for driver'],
  ['enroute', 'En route'],
  ['arrived', 'Arrived'],
];

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

function driverUserIdOf(d: FleetDriver): string | null {
  return d.data?.userId ?? null;
}

export default function FleetDispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.loads.listAccepted.useQuery(undefined, { refetchInterval: 10000 });
  const driversQuery = trpc.operations.listFleet.useQuery({ entity: 'drivers' });
  const dispatchMutation = trpc.loads.dispatch.useMutation();

  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');
  const [assignFor, setAssignFor] = useState<LoadRow | null>(null);

  const fleetDrivers = useMemo<FleetDriver[]>(() => (driversQuery.data ?? []) as FleetDriver[], [driversQuery.data]);

  // Resolve a driver's display name from the linked profile/fleet record even
  // before a BOL is issued (loads.driver_name is only set at issuance).
  const driverNameById = useMemo(() => {
    const map = new Map<string, { name: string; phone: string }>();
    for (const d of fleetDrivers) {
      const uid = driverUserIdOf(d);
      if (uid) map.set(uid, { name: d.name || d.data?.name || 'Driver', phone: d.phone || '' });
    }
    return map;
  }, [fleetDrivers]);

  const resolveDriverName = useCallback((t: LoadRow): string => {
    if (t.driver_name && t.driver_name.trim()) return t.driver_name.trim();
    if (t.accepted_driver_user_id) {
      const info = driverNameById.get(t.accepted_driver_user_id);
      if (info) return info.name;
    }
    return VEHICLE_LABEL[t.vehicle_type as VehicleType] || 'Assigned driver';
  }, [driverNameById]);

  const allTrips = useMemo<LoadRow[]>(
    () => ((query.data ?? []) as LoadRow[]).filter((l) => ACTIVE.includes(l.status)),
    [query.data],
  );

  const trips = useMemo<LoadRow[]>(() => {
    let list = allTrips;
    if (filter === 'waiting') list = list.filter((t) => !t.accepted_driver_user_id);
    else if (filter === 'enroute') list = list.filter((t) => t.status === 'EnRoute' || (t.status === 'Accepted' && !!t.accepted_driver_user_id));
    else if (filter === 'arrived') list = list.filter((t) => t.status === 'Arrived');
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((t) =>
        `${resolveDriverName(t)} ${t.pickup_address ?? ''} ${t.dropoff_address ?? ''} ${t.vehicle_type}`
          .toLowerCase().includes(s),
      );
    }
    return list;
  }, [allTrips, filter, search, resolveDriverName]);

  const waiting = useMemo(() => allTrips.filter((t) => !t.accepted_driver_user_id), [allTrips]);

  const selectedTrip = useMemo(() => trips.find((t) => t.id === selected) ?? null, [trips, selected]);

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    for (const t of trips) {
      const isSel = t.id === selected;
      if (isCoord(t.driver_lat) && isCoord(t.driver_lng)) {
        pts.push({ id: `d-${t.id}`, lat: Number(t.driver_lat), lng: Number(t.driver_lng), kind: 'driver', label: resolveDriverName(t), selected: isSel });
      }
      if (isSel) {
        if (isCoord(t.pickup_lat) && isCoord(t.pickup_lng)) pts.push({ id: `p-${t.id}`, lat: Number(t.pickup_lat), lng: Number(t.pickup_lng), kind: 'pickup', label: 'Pickup' });
        if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng)) pts.push({ id: `x-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'dropoff', label: 'Drop-off' });
      } else if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng) && !(isCoord(t.driver_lat) && isCoord(t.driver_lng))) {
        pts.push({ id: `l-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'load', label: resolveDriverName(t) });
      }
    }
    return pts;
  }, [trips, selected, resolveDriverName]);

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

  const eta = roadRoute.data;

  const linkedDrivers = useMemo(() => fleetDrivers.filter((d) => !!driverUserIdOf(d)), [fleetDrivers]);
  const unlinkedCount = fleetDrivers.length - linkedDrivers.length;

  const assignDriver = useCallback((driver: FleetDriver) => {
    if (!assignFor) return;
    const uid = driverUserIdOf(driver);
    if (!uid) {
      Alert.alert('No driver login', 'This driver has no linked account yet. Open Fleet and set the email they signed up with.');
      return;
    }
    void dispatchMutation
      .mutateAsync({ id: assignFor.id, driverUserId: uid })
      .then(async () => {
        setAssignFor(null);
        await utils.loads.listAccepted.invalidate();
      })
      .catch((e) => Alert.alert('Dispatch failed', e instanceof Error ? e.message : 'Unknown error'));
  }, [assignFor, dispatchMutation, utils]);

  const withGps = allTrips.filter((t) => isCoord(t.driver_lat) && isCoord(t.driver_lng)).length;

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading dispatch board" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load dispatch" onRetry={() => void query.refetch()} /></View>;

  const renderCard = (t: LoadRow) => {
    const isSel = t.id === selected;
    const live = isCoord(t.driver_lat) && isCoord(t.driver_lng);
    const hasDriver = !!t.accepted_driver_user_id;
    return (
      <TouchableOpacity key={t.id} activeOpacity={0.85} onPress={() => setSelected(isSel ? null : t.id)} style={[styles.tripCard, isSel && styles.tripCardSel]}>
        <View style={styles.tripTop}>
          <View style={[styles.tripIcon, { backgroundColor: live ? C.accentDim : C.bgSecondary }]}>
            <Truck size={16} color={live ? C.accent : C.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tripName}>{hasDriver ? resolveDriverName(t) : 'Unassigned load'}</Text>
            <View style={styles.tripSignal}>
              <Radio size={11} color={live ? C.green : C.textMuted} />
              <Text style={[styles.tripSignalText, { color: live ? C.green : C.textMuted }]}>{live ? `Live · ${relativeTime(t.driver_location_at)}` : hasDriver ? 'No GPS signal yet' : 'Not dispatched'}</Text>
            </View>
          </View>
          <StatusBadge status={t.status} />
        </View>
        <View style={styles.routeCol}>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{t.pickup_address || 'Pickup point'}</Text></View>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{t.dropoff_address || 'Drop-off point'}</Text></View>
        </View>
        {isSel && eta ? (
          <View style={styles.etaRow}>
            <View style={styles.etaChip}><RouteIcon size={12} color={C.accent} /><Text style={styles.etaText}>{eta.distanceKm.toFixed(1)} km</Text></View>
            <View style={styles.etaChip}><Clock size={12} color={C.accent} /><Text style={styles.etaText}>~{Math.round(eta.durationMin)} min</Text></View>
            <Text style={styles.etaHint}>{navToPickup ? 'to pickup' : 'to drop-off'}</Text>
          </View>
        ) : null}
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.assignBtn} onPress={() => setAssignFor(t)}>
            <UserPlus size={15} color={C.accent} />
            <Text style={styles.assignBtnText}>{hasDriver ? 'Reassign driver' : 'Assign driver'}</Text>
          </TouchableOpacity>
          {isSel ? (
            <TouchableOpacity style={styles.trackBtn} onPress={() => router.push(`/shipper/track?id=${t.id}` as never)}>
              <Navigation size={15} color={C.white} />
              <Text style={styles.trackBtnText}>Track</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/' as never); } }} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dispatch console</Text>
          <Text style={styles.subtitle}>{allTrips.length} active · {withGps} live · {waiting.length} waiting</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.mapWrap}>
          <LoadsMap points={points} routes={routes} height={300} onSelectPoint={(id) => { const tid = id.split('-').slice(1).join('-'); setSelected(tid); }} />
        </View>

        {allTrips.length === 0 ? (
          <EmptyState icon={Truck} title="No active loads" description="Loads your company accepts appear here. Assign a driver to each one and track them live on the map." />
        ) : (
          <>
            <View style={styles.searchRow}>
              <Search size={16} color={C.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search driver, city, address"
                placeholderTextColor={C.textMuted}
                style={styles.searchInput}
              />
              {search ? (
                <TouchableOpacity onPress={() => setSearch('')}><X size={16} color={C.textMuted} /></TouchableOpacity>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map(([key, label]) => {
                const active = filter === key;
                const count = key === 'all' ? allTrips.length : key === 'waiting' ? waiting.length : key === 'enroute' ? allTrips.filter((t) => t.status === 'EnRoute' || (t.status === 'Accepted' && !!t.accepted_driver_user_id)).length : allTrips.filter((t) => t.status === 'Arrived').length;
                return (
                  <TouchableOpacity key={key} onPress={() => setFilter(key)} style={[styles.filterChip, active && styles.filterChipActive]}>
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label} · {count}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {filter === 'all' && waiting.length > 0 ? (
              <View style={styles.waitingBanner}>
                <UserPlus size={14} color={C.yellow} />
                <Text style={styles.waitingText}>{waiting.length} load{waiting.length > 1 ? 's' : ''} waiting for a driver</Text>
                <TouchableOpacity onPress={() => setFilter('waiting')}><Text style={styles.waitingLink}>View</Text></TouchableOpacity>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>{filter === 'all' ? 'Your loads' : FILTERS.find((f) => f[0] === filter)?.[1]}</Text>
            {trips.length === 0 ? (
              <EmptyState icon={Truck} title="Nothing here" description="No loads match this filter or search." />
            ) : trips.map(renderCard)}
          </>
        )}
      </ScrollView>

      <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign a driver</Text>
                <Text style={styles.modalSub}>Pick a fleet driver to run this load.</Text>
              </View>
              <TouchableOpacity onPress={() => setAssignFor(null)} style={styles.modalClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>

            {driversQuery.isLoading ? (
              <View style={styles.modalLoading}><ActivityIndicator color={C.accent} /></View>
            ) : linkedDrivers.length === 0 ? (
              <View style={styles.modalEmpty}>
                <UserRound size={28} color={C.textMuted} />
                <Text style={styles.modalEmptyTitle}>No drivers with a login</Text>
                <Text style={styles.modalEmptyText}>Drivers can only be dispatched once they join your fleet with a Driver account. Open Fleet and set the email they signed up with, or share your fleet code.</Text>
                <TouchableOpacity style={styles.modalGoFleet} onPress={() => { setAssignFor(null); router.push('/trucking-company/fleet' as never); }}>
                  <Text style={styles.modalGoFleetText}>Open Fleet</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {linkedDrivers.map((d) => {
                  const uid = driverUserIdOf(d);
                  const current = assignFor?.accepted_driver_user_id === uid;
                  return (
                    <TouchableOpacity key={d.id} style={[styles.driverRow, current && styles.driverRowCurrent]} disabled={dispatchMutation.isPending} onPress={() => assignDriver(d)}>
                      <View style={styles.driverAvatar}><UserRound size={18} color={C.accent} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.driverName}>{d.name || d.data?.name || 'Driver'}</Text>
                        {d.phone || d.data?.email ? <Text style={styles.driverMeta}>{[d.phone, d.data?.email].filter(Boolean).join(' · ')}</Text> : null}
                      </View>
                      {current ? <Text style={styles.currentTag}>Current</Text> : null}
                    </TouchableOpacity>
                  );
                })}
                {unlinkedCount > 0 ? (
                  <Text style={styles.unlinkedNote}>{unlinkedCount} more driver{unlinkedCount > 1 ? 's are' : ' is'} not linked to an app account yet and can’t be dispatched.</Text>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0, height: 44 },
  filterRow: { gap: 8, paddingRight: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterChipText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  filterChipTextActive: { color: C.accent },
  waitingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.yellow + '18', borderWidth: 1, borderColor: C.yellow + '55', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  waitingText: { flex: 1, fontSize: 12.5, fontWeight: '700' as const, color: C.text },
  waitingLink: { fontSize: 12.5, fontWeight: '800' as const, color: C.yellow },
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
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  etaText: { fontSize: 12, fontWeight: '800' as const, color: C.accent },
  etaHint: { fontSize: 11.5, color: C.textMuted },
  cardActions: { flexDirection: 'row', gap: 10 },
  assignBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55', borderRadius: 12, paddingVertical: 11 },
  assignBtnText: { fontSize: 13.5, fontWeight: '800' as const, color: C.accent },
  trackBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 11 },
  trackBtnText: { fontSize: 13.5, fontWeight: '800' as const, color: C.white },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, borderTopWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalSub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  modalClose: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  modalLoading: { paddingVertical: 40, alignItems: 'center' },
  modalEmpty: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 8 },
  modalEmptyTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  modalEmptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  modalGoFleet: { marginTop: 8, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20 },
  modalGoFleetText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 10 },
  driverRowCurrent: { borderColor: C.accent, backgroundColor: C.accentDim },
  driverAvatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  driverName: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  driverMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  currentTag: { fontSize: 11, fontWeight: '800' as const, color: C.accent },
  unlinkedNote: { fontSize: 12, color: C.textMuted, lineHeight: 17, paddingVertical: 8, paddingHorizontal: 4 },
});
