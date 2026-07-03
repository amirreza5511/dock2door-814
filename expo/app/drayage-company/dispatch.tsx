import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, CheckCircle2, Package, Ship, Truck, User, X, Zap } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };
const ACTIVE_STATUSES = ['Assigned', 'Dispatched', 'EnRoute', 'PickedUp', 'InTransit', 'AtOrigin', 'Loaded', 'AtDestination', 'Unloaded'];

export default function DrayageDispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const dashboardQuery = trpc.drayage.dashboard.useQuery(undefined, { refetchInterval: 20000 });

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
  const dispatchMutation = trpc.drayage.dispatchMove.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.dashboard.invalidate();
      setDispatchModal(null);
    },
  });

  const drivers = useMemo(() => (dashboardQuery.data?.drivers ?? []) as any[], [dashboardQuery.data]);

  const myOrders = useMemo(() => {
    const orders = (dashboardQuery.data?.myOrders ?? []) as any[];
    return orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled' && o.status !== 'Completed');
  }, [dashboardQuery.data]);

  const needsReservation = useMemo(() => myOrders.filter((o) => !o.port_reservation_date), [myOrders]);
  const dispatched = useMemo(() => myOrders.filter((o) => ACTIVE_STATUSES.includes(o.status)), [myOrders]);
  const ready = useMemo(() => myOrders.filter((o) => o.status === 'Assigned' || o.status === 'Claimed'), [myOrders]);

  const openPortModal = useCallback((order: any) => {
    setResDate(order.port_reservation_date ? String(order.port_reservation_date) : '');
    setResTime(order.port_reservation_time ?? '');
    setPortModal(order);
  }, []);

  const savePortReservation = useCallback(() => {
    if (!portModal) return;
    if (!resDate.trim()) { Alert.alert('Date required', 'Enter the reservation date from the port portal (YYYY-MM-DD).'); return; }
    void portResMutation
      .mutateAsync({ orderId: portModal.id, reservationDate: resDate.trim(), reservationTime: resTime.trim(), confirmed: true })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [portModal, resDate, resTime, portResMutation]);

  const assignDriver = useCallback((driver: any) => {
    if (!dispatchModal) return;
    const driverUserId = driver.driver_user_id ?? driver.data?.user_id ?? driver.user_id;
    if (!driverUserId) { Alert.alert('No driver account', 'This fleet entry has no linked driver login.'); return; }
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
});
