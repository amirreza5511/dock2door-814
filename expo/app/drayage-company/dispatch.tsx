import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, CheckCircle2, MapPin, MessageCircle, Navigation, Package, Radio, Ship, Truck, User, UserPlus, X, XCircle, Zap, Layers, AlertTriangle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { orderCharges, chargeChipLabel } from '@/lib/drayage-charges';

const URGENCY_COLOR: Record<string, string> = { over: C.red, soon: C.yellow, ok: C.green, none: C.textMuted };

const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };
const ACTIVE_STATUSES = ['Assigned', 'Dispatched', 'EnRoute', 'PickedUp', 'InTransit', 'AtOrigin', 'Loaded', 'AtDestination', 'Unloaded'];

// react-native-maps doesn't render on web, so only require it on native.
const isWeb = Platform.OS === 'web';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Maps = isWeb ? null : require('react-native-maps');
const MapView = Maps?.default ?? null;
const Marker = Maps?.Marker ?? null;
const PROVIDER_DEFAULT = Maps?.PROVIDER_DEFAULT ?? undefined;

type LatLng = { latitude: number; longitude: number };
const validCoord = (lat?: number | null, lng?: number | null): LatLng | null =>
  lat != null && lng != null && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001)
    ? { latitude: lat, longitude: lng }
    : null;

const timeAgo = (iso?: string | null): string => {
  if (!iso) return 'no GPS yet';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

export default function DrayageDispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const dashboardQuery = trpc.drayage.dashboard.useQuery(undefined, { refetchInterval: 20000 });
  const fleetQuery = trpc.drayage.fleetLive.useQuery(undefined, { refetchInterval: 8000 });
  const equipmentQuery = trpc.drayage.equipmentLive.useQuery(undefined, { refetchInterval: 15000 });

  const [dropModal, setDropModal] = useState<{ type: 'chassis' | 'trailer'; id: string; label: string } | null>(null);
  const [dropLabel, setDropLabel] = useState('');

  const dropMutation = trpc.drayage.dropEquipment.useMutation({
    onSuccess: async () => { await utils.drayage.equipmentLive.invalidate(); setDropModal(null); },
  });
  const pickupMutation = trpc.drayage.pickupEquipment.useMutation({
    onSuccess: async () => { await utils.drayage.equipmentLive.invalidate(); },
  });

  const equipment = useMemo(() => {
    const chassis = ((equipmentQuery.data?.chassis ?? []) as any[]).map((e) => ({ ...e, _type: 'chassis' as const, _label: e.chassis_number }));
    const trailers = ((equipmentQuery.data?.trailers ?? []) as any[]).map((e) => ({ ...e, _type: 'trailer' as const, _label: e.plate || e.data?.trailerNumber || 'Trailer' }));
    return [...chassis, ...trailers];
  }, [equipmentQuery.data]);

  const trucks = useMemo(() => (fleetQuery.data?.trucks ?? []) as any[], [fleetQuery.data]);
  const locatedTrucks = useMemo(
    () => trucks.filter((t) => validCoord(t.lat, t.lng) != null),
    [trucks],
  );
  const fleetRegion = useMemo(() => {
    const pts = locatedTrucks.map((t) => validCoord(t.lat, t.lng)).filter((c): c is LatLng => c != null);
    if (pts.length === 0) return null;
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.08),
      longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.08),
    };
  }, [locatedTrucks]);

  const [portModal, setPortModal] = useState<any | null>(null);
  const [dispatchModal, setDispatchModal] = useState<any | null>(null);
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');

  const portResMutation = trpc.drayage.updatePortReservation.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.dashboard.invalidate();
      setPortModal(null);
    },
  });
  const openThreadMutation = trpc.drayage.openThread.useMutation();
  const messageDriver = useCallback((orderId: string) => {
    void openThreadMutation
      .mutateAsync({ orderId })
      .then((res) => router.push(`/messages/${res.threadId}` as never))
      .catch((e) => Alert.alert('Unable to open chat', e instanceof Error ? e.message : 'Unknown'));
  }, [openThreadMutation, router]);

  const dispatchMutation = trpc.drayage.dispatchMove.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.dashboard.invalidate();
      setDispatchModal(null);
    },
  });

  const approveDriverMutation = trpc.drayage.approveDriver.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.dashboard.invalidate();
    },
  });

  const drivers = useMemo(() => (dashboardQuery.data?.drivers ?? []) as any[], [dashboardQuery.data]);
  const pendingDrivers = useMemo(() => (dashboardQuery.data?.pendingDrivers ?? []) as any[], [dashboardQuery.data]);

  const decideDriver = useCallback((driver: any, approve: boolean) => {
    const act = () => void approveDriverMutation
      .mutateAsync({ driverId: driver.id, approve })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
    if (approve) { act(); return; }
    Alert.alert('Decline request?', `${driver.name ?? driver.data?.name ?? 'This driver'} will not be able to join your fleet.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: act },
    ]);
  }, [approveDriverMutation]);

  const myOrders = useMemo(() => {
    const orders = (dashboardQuery.data?.myOrders ?? []) as any[];
    return orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled' && o.status !== 'Completed');
  }, [dashboardQuery.data]);

  // Orders whose per diem / demurrage / storage is overdue or due within 2 days.
  const chargeAlerts = useMemo(() => {
    return myOrders
      .map((o) => ({ order: o, charges: orderCharges(o).filter((c) => c.urgency === 'over' || c.urgency === 'soon') }))
      .filter((x) => x.charges.length > 0);
  }, [myOrders]);

  const needsReservation = useMemo(() => myOrders.filter((o) => !o.port_reservation_date), [myOrders]);
  const dispatched = useMemo(() => myOrders.filter((o) => ACTIVE_STATUSES.includes(o.status)), [myOrders]);
  const ready = useMemo(() => myOrders.filter((o) => o.status === 'Assigned' || o.status === 'Claimed'), [myOrders]);

  const openPortModal = useCallback((order: any) => {
    setResDate(order.port_reservation_date ? String(order.port_reservation_date) : '');
    setResTime(order.port_reservation_time ?? '');
    setPortModal(order);
  }, []);

  const confirmDrop = useCallback(() => {
    if (!dropModal) return;
    void dropMutation.mutateAsync({ equipmentType: dropModal.type, equipmentId: dropModal.id, label: dropLabel.trim() })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [dropModal, dropLabel, dropMutation]);

  const savePortReservation = useCallback(() => {
    if (!portModal) return;
    if (!resDate.trim()) { Alert.alert('Date required', 'Enter the reservation date from the port portal (YYYY-MM-DD).'); return; }
    void portResMutation
      .mutateAsync({ orderId: portModal.id, reservationDate: resDate.trim(), reservationTime: resTime.trim(), confirmed: true })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [portModal, resDate, resTime, portResMutation]);

  const assignDriver = useCallback((driver: any) => {
    if (!dispatchModal) return;
    const driverUserId = driver.driver_user_id ?? driver.data?.userId ?? driver.user_id;
    if (!driverUserId) { Alert.alert('No driver login', 'This driver has no linked account yet. Edit the driver in Fleet and set the email they signed up with.'); return; }
    void dispatchMutation
      .mutateAsync({ moveId: dispatchModal.moveId, driverUserId })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [dispatchModal, dispatchMutation]);

  const isLoading = dashboardQuery.isLoading;
  const isError = dashboardQuery.isError;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dispatch Console</Text>
          <Text style={styles.headerSub}>Reservations, driver assignment & active moves</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={dashboardQuery.isFetching} onRefresh={() => void dashboardQuery.refetch()} tintColor={C.accent} />}
      >
        {isLoading ? (
          <ScreenFeedback state="loading" title="Loading dispatch" />
        ) : isError ? (
          <ScreenFeedback state="error" title="Unable to load dispatch" onRetry={() => void dashboardQuery.refetch()} />
        ) : myOrders.length === 0 ? (
          <EmptyState
            icon={Ship}
            title="Nothing to dispatch"
            description="Claim an order from the board to start entering port reservations and assigning drivers."
            actionLabel="Go to board"
            onAction={() => router.push('/drayage-company/board' as never)}
          />
        ) : (
          <>
            {/* Driver join requests */}
            {pendingDrivers.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <UserPlus size={16} color={C.yellow} />
                  <Text style={styles.sectionTitle}>Driver requests</Text>
                  <View style={styles.countPill}><Text style={styles.countPillText}>{pendingDrivers.length}</Text></View>
                </View>
                {pendingDrivers.map((d) => (
                  <Card key={d.id} style={styles.requestCard}>
                    <View style={styles.requestRow}>
                      <View style={styles.driverAvatar}><User size={18} color={C.accent} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.driverName}>{d.name ?? d.data?.name ?? 'Driver'}</Text>
                        {d.data?.email ? <Text style={styles.driverMeta}>{d.data.email}</Text> : null}
                        <Text style={styles.requestHint}>Wants to join your fleet</Text>
                      </View>
                    </View>
                    <View style={styles.requestBtns}>
                      <TouchableOpacity
                        style={[styles.requestBtn, styles.declineBtn]}
                        disabled={approveDriverMutation.isPending}
                        onPress={() => decideDriver(d, false)}
                      >
                        <XCircle size={15} color={C.red} />
                        <Text style={[styles.requestBtnText, { color: C.red }]}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.requestBtn, styles.approveBtn]}
                        disabled={approveDriverMutation.isPending}
                        onPress={() => decideDriver(d, true)}
                      >
                        <CheckCircle2 size={15} color={C.white} />
                        <Text style={[styles.requestBtnText, { color: C.white }]}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            {/* Live fleet map */}
            <View style={styles.sectionRow}>
              <Radio size={16} color={C.green} />
              <Text style={styles.sectionTitle}>Live fleet</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{trucks.length}</Text></View>
            </View>
            {trucks.length === 0 ? (
              <Text style={styles.emptyLine}>No trucks on the road right now. Dispatch a driver to see them here.</Text>
            ) : (
              <Card style={styles.fleetCard}>
                <View style={styles.mapWrap}>
                  {isWeb || !MapView || !fleetRegion ? (
                    <View style={styles.mapFallback}>
                      <MapPin size={28} color={C.accent} />
                      <Text style={styles.mapFallbackText}>
                        {fleetRegion ? 'Open on your phone for the live map.' : 'Waiting for drivers to share GPS…'}
                      </Text>
                    </View>
                  ) : (
                    <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} region={fleetRegion}>
                      {locatedTrucks.map((t) => {
                        const coord = validCoord(t.lat, t.lng);
                        if (!coord) return null;
                        return (
                          <Marker key={t.moveId} coordinate={coord} title={t.driverName} description={`${t.referenceCode ?? ''} · ${t.status}`}>
                            <View style={styles.truckMarker}><Truck size={15} color={C.white} /></View>
                          </Marker>
                        );
                      })}
                    </MapView>
                  )}
                </View>
                {trucks.map((t) => {
                  const coord = validCoord(t.lat, t.lng);
                  return (
                    <TouchableOpacity
                      key={t.moveId}
                      style={styles.truckRow}
                      onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: t.orderId } } as never)}
                    >
                      <View style={[styles.truckDot, { backgroundColor: coord ? C.green : C.textMuted }]}>
                        <Truck size={14} color={C.white} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.truckName}>{t.driverName}{t.truck ? ` · ${t.truck}` : ''}</Text>
                        <Text style={styles.truckMeta}>{t.referenceCode ?? '—'} · {t.containerSize ?? ''}</Text>
                      </View>
                      <View style={styles.truckRight}>
                        <StatusBadge status={t.status} />
                        <View style={styles.gpsMeta}>
                          {coord ? <Navigation size={10} color={C.green} /> : <MapPin size={10} color={C.textMuted} />}
                          <Text style={[styles.gpsMetaText, { color: coord ? C.green : C.textMuted }]}>
                            {coord ? `${Math.round(t.speedKph)} km/h · ${timeAgo(t.recordedAt)}` : 'no GPS yet'}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => messageDriver(t.orderId)}
                        style={styles.msgIconBtn}
                        hitSlop={8}
                      >
                        <MessageCircle size={16} color={C.accent} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </Card>
            )}

            {/* Equipment on the road / dropped */}
            <View style={styles.sectionRow}>
              <Layers size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>Equipment locations</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{equipment.length}</Text></View>
            </View>
            {equipment.length === 0 ? (
              <Text style={styles.emptyLine}>Add chassis & trailers in Fleet to track them here.</Text>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' as const }}>
                {equipment.map((e, idx) => {
                  const attached = !e.is_dropped && e.current_truck_id;
                  const hasGps = e.live_lat != null;
                  return (
                    <View key={`${e._type}-${e.id}`} style={[styles.truckRow, idx === 0 && { borderTopWidth: 0 }]}>
                      <View style={[styles.truckDot, { backgroundColor: e.is_dropped ? C.yellow : attached ? C.green : C.textMuted }]}>
                        <Layers size={14} color={C.white} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.truckName}>{e._label} <Text style={styles.eqType}>· {e._type === 'chassis' ? 'Chassis' : 'Trailer'}</Text></Text>
                        <Text style={styles.truckMeta}>
                          {e.is_dropped
                            ? `Dropped${e.dropped_label ? ` · ${e.dropped_label}` : ''}${e.live_at ? ` · ${timeAgo(e.live_at)}` : ''}`
                            : attached
                              ? `On truck${hasGps ? ` · ${timeAgo(e.live_at)}` : ' · no GPS'}`
                              : 'Idle · not attached'}
                          {e.is_rental ? ` · Rental $${e.rental_daily_rate ?? 0}/d` : ''}
                        </Text>
                      </View>
                      {e.is_dropped ? (
                        <TouchableOpacity style={styles.eqBtn} onPress={() => void pickupMutation.mutateAsync({ equipmentType: e._type, equipmentId: e.id }).catch((err) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown'))}>
                          <Text style={styles.eqBtnText}>Pick up</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={[styles.eqBtn, styles.eqBtnDrop]} onPress={() => { setDropLabel(''); setDropModal({ type: e._type, id: e.id, label: e._label }); }}>
                          <Text style={[styles.eqBtnText, { color: C.yellow }]}>Drop</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Per diem / demurrage / storage alerts */}
            {chargeAlerts.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <AlertTriangle size={16} color={C.red} />
                  <Text style={styles.sectionTitle}>Free-day alerts</Text>
                  <View style={styles.countPill}><Text style={styles.countPillText}>{chargeAlerts.length}</Text></View>
                </View>
                {chargeAlerts.map(({ order, charges }) => (
                  <Card key={`alert-${order.id}`} onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: order.id } } as never)} style={[styles.orderCard, { borderColor: C.red + '55' }]}>
                    <OrderHead order={order} />
                    <View style={styles.chipWrap}>
                      {charges.map((c) => (
                        <View key={c.kind} style={[styles.chargeChip, { borderColor: URGENCY_COLOR[c.urgency] + '66', backgroundColor: URGENCY_COLOR[c.urgency] + '18' }]}>
                          <Text style={[styles.chargeChipText, { color: URGENCY_COLOR[c.urgency] }]}>{chargeChipLabel(c)}</Text>
                        </View>
                      ))}
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            {/* Needs port reservation */}
            <View style={styles.sectionRow}>
              <CalendarClock size={16} color={C.yellow} />
              <Text style={styles.sectionTitle}>Needs port reservation</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{needsReservation.length}</Text></View>
            </View>
            {needsReservation.length === 0 ? (
              <Text style={styles.emptyLine}>All active orders have a reservation.</Text>
            ) : needsReservation.map((o) => (
              <Card key={o.id} style={styles.orderCard}>
                <OrderHead order={o} />
                <Button label="Enter port reservation" size="md" fullWidth onPress={() => openPortModal(o)} />
              </Card>
            ))}

            {/* Ready to dispatch a driver */}
            <View style={styles.sectionRow}>
              <Truck size={16} color={C.accent} />
              <Text style={styles.sectionTitle}>Ready to dispatch</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{ready.length}</Text></View>
            </View>
            {ready.length === 0 ? (
              <Text style={styles.emptyLine}>No orders waiting for a driver.</Text>
            ) : ready.map((o) => (
              <Card key={o.id} onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: o.id } } as never)} style={styles.orderCard}>
                <OrderHead order={o} />
                {o.port_reservation_date ? (
                  <View style={styles.apptRow}>
                    <CalendarClock size={12} color={C.green} />
                    <Text style={styles.apptText}>Port appt: {o.port_reservation_date} {o.port_reservation_time}</Text>
                  </View>
                ) : null}
                <Text style={styles.hintLine}>Open order to assign a driver to each move.</Text>
              </Card>
            ))}

            {/* Active / dispatched */}
            <View style={styles.sectionRow}>
              <Zap size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>Active moves</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{dispatched.length}</Text></View>
            </View>
            {dispatched.length === 0 ? (
              <Text style={styles.emptyLine}>Nothing in transit right now.</Text>
            ) : dispatched.map((o) => (
              <Card key={o.id} onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: o.id } } as never)} style={styles.orderCard}>
                <OrderHead order={o} />
                {o.container_number ? <Text style={styles.metaLine}>Container: {o.container_number}</Text> : null}
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      {/* Port reservation modal */}
      <Modal visible={portModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPortModal(null)}>
        <View style={[styles.modalRoot, { backgroundColor: C.bg }]}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.modalTitle}>Port reservation</Text>
            <TouchableOpacity onPress={() => setPortModal(null)} style={styles.iconBtn}><X size={20} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalHint}>Enter the reservation you booked on the port/terminal portal for {portModal?.reference_code}.</Text>
            <Input label="Reservation date" placeholder="2026-07-10" value={resDate} onChangeText={setResDate} autoCapitalize="none" />
            <Input label="Reservation time / window" placeholder="08:00–10:00" value={resTime} onChangeText={setResTime} autoCapitalize="none" />
            <Button label="Save reservation" fullWidth loading={portResMutation.isPending} onPress={savePortReservation} />
          </ScrollView>
        </View>
      </Modal>

      {/* Drop equipment modal */}
      <Modal visible={dropModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDropModal(null)}>
        <View style={[styles.modalRoot, { backgroundColor: C.bg }]}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.modalTitle}>Drop {dropModal?.label}</Text>
            <TouchableOpacity onPress={() => setDropModal(null)} style={styles.iconBtn}><X size={20} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalHint}>Where is this {dropModal?.type} being left? The truck goes bobtail until it is picked back up.</Text>
            <Input label="Drop location" placeholder="e.g. ABC Warehouse yard, Surrey" value={dropLabel} onChangeText={setDropLabel} />
            <Button label="Confirm drop" fullWidth loading={dropMutation.isPending} onPress={confirmDrop} />
          </ScrollView>
        </View>
      </Modal>

      {/* Driver assign modal */}
      <Modal visible={dispatchModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDispatchModal(null)}>
        <View style={[styles.modalRoot, { backgroundColor: C.bg }]}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.modalTitle}>Assign driver</Text>
            <TouchableOpacity onPress={() => setDispatchModal(null)} style={styles.iconBtn}><X size={20} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            {drivers.length === 0 ? (
              <EmptyState icon={User} title="No drivers" description="Add drivers to your fleet first." />
            ) : drivers.map((d) => (
              <TouchableOpacity key={d.id} onPress={() => assignDriver(d)} style={styles.driverRow} disabled={dispatchMutation.isPending}>
                <View style={styles.driverAvatar}><User size={18} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{d.name ?? d.data?.name ?? 'Driver'}</Text>
                  {d.data?.truck_plate ? <Text style={styles.driverMeta}>{d.data.truck_plate}</Text> : null}
                </View>
                <CheckCircle2 size={18} color={C.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function OrderHead({ order }: { order: any }) {
  return (
    <>
      <View style={styles.orderTop}>
        <View style={[styles.dirBadge, { backgroundColor: (DIRECTION_COLOR[order.direction] ?? C.blue) + '20' }]}>
          <Text style={[styles.dirBadgeText, { color: DIRECTION_COLOR[order.direction] ?? C.blue }]}>{order.direction}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>
      <Text style={styles.orderRef}>{order.reference_code}</Text>
      <View style={styles.orderMeta}>
        <Package size={12} color={C.textMuted} />
        <Text style={styles.orderMetaText}>{order.container_size} · {order.container_type || 'Standard'}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  countPill: { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  countPillText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  emptyLine: { fontSize: 13, color: C.textMuted, paddingVertical: 4 },
  orderCard: { gap: 10 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dirBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dirBadgeText: { fontSize: 11, fontWeight: '800' as const },
  orderRef: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  orderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderMetaText: { fontSize: 12, color: C.textSecondary },
  metaLine: { fontSize: 12, color: C.textMuted },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  hintLine: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { padding: 20, gap: 14 },
  modalHint: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent + '20', alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  driverMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  requestCard: { gap: 12, borderColor: C.yellow + '55' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestHint: { fontSize: 12, color: C.yellow, marginTop: 2, fontWeight: '600' as const },
  requestBtns: { flexDirection: 'row', gap: 10 },
  requestBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 11 },
  declineBtn: { backgroundColor: C.red + '15', borderWidth: 1, borderColor: C.red + '40' },
  approveBtn: { backgroundColor: C.accent },
  requestBtnText: { fontSize: 14, fontWeight: '700' as const },
  fleetCard: { gap: 0, padding: 0, overflow: 'hidden' as const },
  mapWrap: { height: 220, backgroundColor: C.bgSecondary },
  mapFallback: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, padding: 20 },
  mapFallbackText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const },
  truckMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2, borderColor: C.white },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: C.border },
  truckDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const },
  truckName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  truckMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  truckRight: { alignItems: 'flex-end' as const, gap: 4 },
  gpsMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gpsMetaText: { fontSize: 11, fontWeight: '600' as const },
  msgIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accent + '15', borderWidth: 1, borderColor: C.accent + '40', alignItems: 'center' as const, justifyContent: 'center' as const },
  eqType: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  eqBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.accent + '15', borderWidth: 1, borderColor: C.accent + '40' },
  eqBtnDrop: { backgroundColor: C.yellow + '15', borderColor: C.yellow + '40' },
  eqBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chargeChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chargeChipText: { fontSize: 11.5, fontWeight: '800' as const },
});
