import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Clock, MapPin, Navigation, Radio, Route as RouteIcon, Search, Truck, UserPlus, UserRound, Waypoints, X } from 'lucide-react-native';
import LoadsMap, { MapPoint, MapRoute } from '@/components/LoadsMap';
import { LoadStopsEditor, LoadStop, useLoadStops } from '@/components/LoadStops';
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
  driver_response?: string | null; driver_response_reason?: string | null;
  pickup_lat?: number | null; pickup_lng?: number | null; pickup_address?: string | null;
  dropoff_lat?: number | null; dropoff_lng?: number | null; dropoff_address?: string | null;
  driver_lat?: number | null; driver_lng?: number | null; driver_location_at?: string | null;
  driver_name?: string | null; distance_km?: number | null;
  assigned_truck_id?: string | null; assigned_trailer_id?: string | null;
  deadline_at?: string | null; arrived_at?: string | null; wait_started_at?: string | null;
};

/** A load is delayed when it has a deadline that has already passed and it is
 *  not yet delivered. */
function isDelayed(t: LoadRow): boolean {
  if (!t.deadline_at) return false;
  if (t.status === 'Delivered' || t.status === 'Cancelled') return false;
  return new Date(t.deadline_at).getTime() < Date.now();
}

function deadlineLabel(iso?: string | null): string {
  if (!iso) return '';
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diffMin < -60) return `${Math.round(-diffMin / 60)}h overdue`;
  if (diffMin < 0) return `${-diffMin} min overdue`;
  if (diffMin < 60) return `due in ${diffMin} min`;
  return `due in ${Math.round(diffMin / 60)}h`;
}

/** Dispatch response chip meta shown on each assigned load card. */
function responseMeta(t: LoadRow): { label: string; color: string } | null {
  if (!t.accepted_driver_user_id) return null;
  if (t.driver_response === 'Accepted') return { label: 'Accepted', color: C.green };
  if (t.driver_response === 'Pending') return { label: 'Waiting for response', color: C.yellow };
  return null;
}

type FleetDriver = {
  id: string; name?: string | null; phone?: string | null;
  data?: { name?: string; email?: string; userId?: string } | null;
};

type FleetUnit = {
  id: string; plate?: string | null; make?: string | null; model?: string | null;
  trailer_type?: string | null; status?: string | null;
  data?: { insuranceExpiry?: string; inspectionExpiry?: string } | null;
};

/** True when either the unit's insurance or inspection date is in the past. */
function unitDocsExpired(u: FleetUnit): boolean {
  const check = (s?: string) => {
    const v = (s ?? '').trim();
    if (!v) return false;
    const t = new Date(v).getTime();
    return Number.isFinite(t) && t < Date.now();
  };
  return check(u.data?.insuranceExpiry) || check(u.data?.inspectionExpiry);
}

function unitLabel(u: FleetUnit): string {
  const plate = (u.plate ?? '').trim();
  const desc = [u.make, u.model].filter(Boolean).join(' ').trim() || (u.trailer_type ?? '').trim();
  return [plate, desc].filter(Boolean).join(' · ') || 'Unit';
}

/** Units that are active, not tied to another load, and not in maintenance
 *  (plus the currently-selected one so it stays visible while editing). */
function availableUnits(units: FleetUnit[], busy: Set<string>, selected: string | null): FleetUnit[] {
  return units.filter((u) => {
    if (u.id === selected) return true;
    if (busy.has(u.id)) return false;
    const st = (u.status ?? 'Active');
    return st === 'Active';
  });
}

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
  const trucksQuery = trpc.operations.listFleet.useQuery({ entity: 'trucks' });
  const trailersQuery = trpc.operations.listFleet.useQuery({ entity: 'trailers' });
  const dispatchMutation = trpc.loads.dispatch.useMutation();
  const setFleetMutation = trpc.loads.setFleet.useMutation();
  const setDeadlineMutation = trpc.loads.setDeadline.useMutation();

  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');
  const [assignFor, setAssignFor] = useState<LoadRow | null>(null);
  const [freeOnly, setFreeOnly] = useState<boolean>(true);
  const [pendingDriver, setPendingDriver] = useState<string | null>(null);
  const [pendingTruck, setPendingTruck] = useState<string | null>(null);
  const [pendingTrailer, setPendingTrailer] = useState<string | null>(null);
  const [stopsFor, setStopsFor] = useState<string | null>(null);

  // Numbered stops for the selected trip (drawn on the live map in order).
  const selectedStopsQuery = useLoadStops(selected, !!selected);
  const selectedStops = useMemo<LoadStop[]>(() => (selectedStopsQuery.data ?? []) as LoadStop[], [selectedStopsQuery.data]);

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

  // Drivers already running an active (assigned, not-declined) load — used to
  // flag double-assignment and to power the “free only” filter in the modal.
  const busyDriverIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTrips) {
      if (t.accepted_driver_user_id && t.driver_response !== 'Rejected' && t.id !== assignFor?.id) {
        s.add(t.accepted_driver_user_id);
      }
    }
    return s;
  }, [allTrips, assignFor?.id]);

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
        selectedStops.forEach((s, i) => {
          if (isCoord(s.lat) && isCoord(s.lng)) pts.push({ id: `s-${s.id}`, lat: Number(s.lat), lng: Number(s.lng), kind: s.kind === 'Pickup' ? 'pickup' : 'dropoff', label: `${i + 1}. ${s.label || s.kind}` });
        });
        if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng)) pts.push({ id: `x-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'dropoff', label: 'Drop-off' });
      } else if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng) && !(isCoord(t.driver_lat) && isCoord(t.driver_lng))) {
        pts.push({ id: `l-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: 'load', label: resolveDriverName(t) });
      }
    }
    return pts;
  }, [trips, selected, resolveDriverName, selectedStops]);

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

  const fleetTrucks = useMemo<FleetUnit[]>(() => (trucksQuery.data ?? []) as FleetUnit[], [trucksQuery.data]);
  const fleetTrailers = useMemo<FleetUnit[]>(() => (trailersQuery.data ?? []) as FleetUnit[], [trailersQuery.data]);

  // Trucks / trailers already tied to another active load — hidden as “in use”.
  const busyTruckIds = useMemo(() => new Set(allTrips.filter((t) => t.assigned_truck_id && t.id !== assignFor?.id).map((t) => t.assigned_truck_id as string)), [allTrips, assignFor?.id]);
  const busyTrailerIds = useMemo(() => new Set(allTrips.filter((t) => t.assigned_trailer_id && t.id !== assignFor?.id).map((t) => t.assigned_trailer_id as string)), [allTrips, assignFor?.id]);

  const openAssign = useCallback((t: LoadRow) => {
    setPendingDriver(t.accepted_driver_user_id ?? null);
    setPendingTruck(t.assigned_truck_id ?? null);
    setPendingTrailer(t.assigned_trailer_id ?? null);
    setAssignFor(t);
  }, []);

  const selectDriver = useCallback((driver: FleetDriver) => {
    const uid = driverUserIdOf(driver);
    if (!uid) {
      Alert.alert('No driver login', 'This driver has no linked account yet. Open Fleet and set the email they signed up with.');
      return;
    }
    setPendingDriver((prev) => (prev === uid ? null : uid));
  }, []);

  const commitSet = useCallback(() => {
    if (!assignFor || !pendingDriver) return;
    const loadId = assignFor.id;
    const driverChanged = pendingDriver !== assignFor.accepted_driver_user_id;
    const run = async () => {
      try {
        if (driverChanged) await dispatchMutation.mutateAsync({ id: loadId, driverUserId: pendingDriver });
        await setFleetMutation.mutateAsync({ id: loadId, truckId: pendingTruck, trailerId: pendingTrailer });
        setAssignFor(null);
        await utils.loads.listAccepted.invalidate();
      } catch (e) {
        Alert.alert('Dispatch failed', e instanceof Error ? e.message : 'Unknown error');
      }
    };
    if (driverChanged && busyDriverIds.has(pendingDriver)) {
      Alert.alert('Driver already busy', 'This driver is already running an active load. Assign this one too?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Assign anyway', style: 'destructive', onPress: () => void run() },
      ]);
      return;
    }
    void run();
  }, [assignFor, pendingDriver, pendingTruck, pendingTrailer, busyDriverIds, dispatchMutation, setFleetMutation, utils]);

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
        {isDelayed(t) ? (
          <View style={styles.delayChip}>
            <Clock size={12} color={C.red} />
            <Text style={styles.delayChipText}>Delayed · {deadlineLabel(t.deadline_at)}</Text>
          </View>
        ) : t.deadline_at && t.status !== 'Delivered' ? (
          <View style={styles.dueChip}>
            <Clock size={12} color={C.textSecondary} />
            <Text style={styles.dueChipText}>{deadlineLabel(t.deadline_at)}</Text>
          </View>
        ) : null}
        {t.status === 'Arrived' && t.wait_started_at ? (
          <View style={styles.dueChip}>
            <Clock size={12} color={C.yellow} />
            <Text style={[styles.dueChipText, { color: C.yellow }]}>Waiting on site · {relativeTime(t.wait_started_at)}</Text>
          </View>
        ) : null}
        {isSel && eta ? (
          <View style={styles.etaRow}>
            <View style={styles.etaChip}><RouteIcon size={12} color={C.accent} /><Text style={styles.etaText}>{eta.distanceKm.toFixed(1)} km</Text></View>
            <View style={styles.etaChip}><Clock size={12} color={C.accent} /><Text style={styles.etaText}>~{Math.round(eta.durationMin)} min</Text></View>
            <Text style={styles.etaHint}>{navToPickup ? 'to pickup' : 'to drop-off'}</Text>
          </View>
        ) : null}
        {t.assigned_truck_id || t.assigned_trailer_id ? (
          <View style={styles.setRow}>
            <Truck size={12} color={C.blue} />
            <Text style={styles.setText} numberOfLines={1}>
              {[
                fleetTrucks.find((u) => u.id === t.assigned_truck_id) && unitLabel(fleetTrucks.find((u) => u.id === t.assigned_truck_id) as FleetUnit),
                fleetTrailers.find((u) => u.id === t.assigned_trailer_id) && unitLabel(fleetTrailers.find((u) => u.id === t.assigned_trailer_id) as FleetUnit),
              ].filter(Boolean).join('  +  ')}
            </Text>
          </View>
        ) : null}
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.assignBtn} onPress={() => openAssign(t)}>
            <UserPlus size={15} color={C.accent} />
            <Text style={styles.assignBtnText}>{hasDriver ? 'Edit set' : 'Assign set'}</Text>
          </TouchableOpacity>
          {isSel ? (
            <TouchableOpacity style={styles.trackBtn} onPress={() => router.push(`/shipper/track?id=${t.id}` as never)}>
              <Navigation size={15} color={C.white} />
              <Text style={styles.trackBtnText}>Track</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.stopsBtn} onPress={() => setStopsFor(t.id)}>
          <Waypoints size={14} color={C.textSecondary} />
          <Text style={styles.stopsBtnText}>Manage stops</Text>
        </TouchableOpacity>
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
                <Text style={styles.modalTitle}>Assign the set</Text>
                <Text style={styles.modalSub}>Pick a driver, then attach a truck and trailer.</Text>
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
              <>
                <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.modalSectionRow}>
                    <Text style={styles.modalSectionTitle}>Driver</Text>
                    <TouchableOpacity style={styles.freeToggle} onPress={() => setFreeOnly((v) => !v)}>
                      <View style={[styles.checkbox, freeOnly && styles.checkboxOn]}>{freeOnly ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
                      <Text style={styles.freeToggleText}>Free only</Text>
                    </TouchableOpacity>
                  </View>
                  {(() => {
                    const visible = freeOnly
                      ? linkedDrivers.filter((d) => { const uid = driverUserIdOf(d); return !uid || !busyDriverIds.has(uid) || pendingDriver === uid; })
                      : linkedDrivers;
                    if (visible.length === 0) {
                      return <Text style={styles.unlinkedNote}>All linked drivers are busy on other loads. Turn off “free only” to reassign one.</Text>;
                    }
                    return visible.map((d) => {
                      const uid = driverUserIdOf(d);
                      const current = pendingDriver === uid;
                      const busy = !!uid && busyDriverIds.has(uid);
                      return (
                        <TouchableOpacity key={d.id} style={[styles.driverRow, current && styles.driverRowCurrent]} onPress={() => selectDriver(d)}>
                          <View style={styles.driverAvatar}><UserRound size={18} color={C.accent} /></View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.driverName}>{d.name || d.data?.name || 'Driver'}</Text>
                            {d.phone || d.data?.email ? <Text style={styles.driverMeta}>{[d.phone, d.data?.email].filter(Boolean).join(' · ')}</Text> : null}
                          </View>
                          {current ? <Text style={styles.currentTag}>Selected</Text> : busy ? <View style={styles.busyTag}><Text style={styles.busyTagText}>On a load</Text></View> : <View style={styles.freeTag}><Text style={styles.freeTagText}>Free</Text></View>}
                        </TouchableOpacity>
                      );
                    });
                  })()}
                  {unlinkedCount > 0 ? (
                    <Text style={styles.unlinkedNote}>{unlinkedCount} more driver{unlinkedCount > 1 ? 's are' : ' is'} not linked to an app account yet and can’t be dispatched.</Text>
                  ) : null}

                  <Text style={[styles.modalSectionTitle, { marginTop: 14 }]}>Truck</Text>
                  <View style={styles.unitWrap}>
                    {availableUnits(fleetTrucks, busyTruckIds, pendingTruck).length === 0 ? (
                      <Text style={styles.unlinkedNote}>No available trucks.</Text>
                    ) : availableUnits(fleetTrucks, busyTruckIds, pendingTruck).map((u) => (
                      <TouchableOpacity key={u.id} style={[styles.unitChip, pendingTruck === u.id && styles.unitChipOn, unitDocsExpired(u) && styles.unitChipWarn]} onPress={() => setPendingTruck((p) => (p === u.id ? null : u.id))}>
                        <Truck size={13} color={pendingTruck === u.id ? C.white : unitDocsExpired(u) ? C.red : C.textSecondary} />
                        <Text style={[styles.unitChipText, pendingTruck === u.id && styles.unitChipTextOn, unitDocsExpired(u) && !(pendingTruck === u.id) && { color: C.red }]}>{unitLabel(u)}{unitDocsExpired(u) ? ' · docs expired' : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.modalSectionTitle, { marginTop: 14 }]}>Trailer</Text>
                  <View style={styles.unitWrap}>
                    {availableUnits(fleetTrailers, busyTrailerIds, pendingTrailer).length === 0 ? (
                      <Text style={styles.unlinkedNote}>No available trailers.</Text>
                    ) : availableUnits(fleetTrailers, busyTrailerIds, pendingTrailer).map((u) => (
                      <TouchableOpacity key={u.id} style={[styles.unitChip, pendingTrailer === u.id && styles.unitChipOn, unitDocsExpired(u) && styles.unitChipWarn]} onPress={() => setPendingTrailer((p) => (p === u.id ? null : u.id))}>
                        <Text style={[styles.unitChipText, pendingTrailer === u.id && styles.unitChipTextOn, unitDocsExpired(u) && !(pendingTrailer === u.id) && { color: C.red }]}>{unitLabel(u)}{unitDocsExpired(u) ? ' · docs expired' : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={[styles.confirmSetBtn, (!pendingDriver || dispatchMutation.isPending || setFleetMutation.isPending) && styles.confirmSetBtnOff]}
                  disabled={!pendingDriver || dispatchMutation.isPending || setFleetMutation.isPending}
                  onPress={commitSet}
                >
                  <UserPlus size={16} color={C.white} />
                  <Text style={styles.confirmSetBtnText}>{dispatchMutation.isPending || setFleetMutation.isPending ? 'Dispatching…' : 'Dispatch set'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={stopsFor !== null} transparent animationType="slide" onRequestClose={() => setStopsFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Stops & timing</Text>
                <Text style={styles.modalSub}>Delivery deadline and extra stops.</Text>
              </View>
              <TouchableOpacity onPress={() => setStopsFor(null)} style={styles.modalClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {(() => {
                const load = allTrips.find((t) => t.id === stopsFor);
                const setDL = (hours: number | null) => {
                  if (!stopsFor) return;
                  const iso = hours === null ? null : new Date(Date.now() + hours * 3600_000).toISOString();
                  setDeadlineMutation.mutate({ id: stopsFor, deadline: iso }, {
                    onSuccess: async () => { await utils.loads.listAccepted.invalidate(); },
                    onError: (e) => Alert.alert('Unable to set deadline', e instanceof Error ? e.message : 'Error'),
                  });
                };
                return (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.modalSectionTitle}>Delivery deadline</Text>
                    <Text style={styles.deadlineNow}>{load?.deadline_at ? deadlineLabel(load.deadline_at) : 'No deadline set'}</Text>
                    <View style={styles.unitWrap}>
                      {[['+2h', 2], ['+4h', 4], ['+8h', 8], ['+24h', 24]].map(([lbl, h]) => (
                        <TouchableOpacity key={lbl as string} style={styles.unitChip} disabled={setDeadlineMutation.isPending} onPress={() => setDL(h as number)}>
                          <Text style={styles.unitChipText}>{lbl as string}</Text>
                        </TouchableOpacity>
                      ))}
                      {load?.deadline_at ? (
                        <TouchableOpacity style={[styles.unitChip, { borderColor: C.red + '55' }]} disabled={setDeadlineMutation.isPending} onPress={() => setDL(null)}>
                          <Text style={[styles.unitChipText, { color: C.red }]}>Clear</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })()}
              <Text style={[styles.modalSectionTitle, { marginBottom: 8 }]}>Extra stops</Text>
              {stopsFor ? <LoadStopsEditor loadId={stopsFor} onSaved={() => void selectedStopsQuery.refetch()} /> : null}
            </ScrollView>
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
  respChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  respDot: { width: 7, height: 7, borderRadius: 4 },
  respChipText: { fontSize: 11.5, fontWeight: '800' as const },
  delayChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.red + '1E', borderWidth: 1, borderColor: C.red + '66', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  delayChipText: { fontSize: 11.5, fontWeight: '800' as const, color: C.red },
  dueChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.bgSecondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dueChipText: { fontSize: 11.5, fontWeight: '700' as const, color: C.textSecondary },
  deadlineNow: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  setText: { flex: 1, fontSize: 11.5, fontWeight: '700' as const, color: C.blue },
  stopsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 9, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  stopsBtnText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
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
  freeToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 2, marginBottom: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkboxTick: { color: C.white, fontSize: 12, fontWeight: '900' as const },
  freeToggleText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  modalSectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalSectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  unitWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  unitChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  unitChipOn: { backgroundColor: C.accent, borderColor: C.accent },
  unitChipWarn: { borderColor: C.red + '66' },
  unitChipText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  unitChipTextOn: { color: C.white },
  confirmSetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, marginTop: 14 },
  confirmSetBtnOff: { opacity: 0.5 },
  confirmSetBtnText: { fontSize: 15, fontWeight: '800' as const, color: C.white },
  busyTag: { backgroundColor: C.yellow + '1E', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  busyTagText: { fontSize: 10.5, fontWeight: '800' as const, color: C.yellow },
  freeTag: { backgroundColor: C.green + '1E', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  freeTagText: { fontSize: 10.5, fontWeight: '800' as const, color: C.green },
  unlinkedNote: { fontSize: 12, color: C.textMuted, lineHeight: 17, paddingVertical: 8, paddingHorizontal: 4 },
});
