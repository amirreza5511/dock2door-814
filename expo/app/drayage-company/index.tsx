import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Anchor, CalendarClock, HelpCircle, LogOut, MapPin, Package, Plus, Ship, Truck, Users, Zap } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import CompanySwitcher from '@/components/ui/CompanySwitcher';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const DIRECTION_LABEL: Record<string, string> = { Import: 'Import', Export: 'Export' };
const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };

export default function DrayageCompanyDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const dashboardQuery = trpc.drayage.dashboard.useQuery(undefined, { refetchInterval: 30000 });

  const stats = useMemo(() => {
    const open = dashboardQuery.data?.openOrders ?? [];
    const my = dashboardQuery.data?.myOrders ?? [];
    const active = dashboardQuery.data?.activeMoves ?? [];
    const drivers = dashboardQuery.data?.drivers ?? [];
    return {
      openCount: open.length,
      activeCount: my.filter((o: any) => ['Assigned', 'Dispatched', 'EnRoute', 'PickedUp', 'InTransit'].includes(o.status)).length,
      inTransit: active.length,
      driverCount: drivers.length,
    };
  }, [dashboardQuery.data]);

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading drayage ops" /></View>;
  }
  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load drayage dashboard" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  const openOrders = (dashboardQuery.data?.openOrders ?? []) as any[];
  const myOrders = (dashboardQuery.data?.myOrders ?? []) as any[];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.eyebrow}>Drayage Company</Text>
          <Text style={styles.title}>{user?.name}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CompanySwitcher />
          <TouchableOpacity onPress={() => router.push('/help' as never)} style={styles.iconBtn}>
            <HelpCircle size={18} color={C.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void logout()} style={styles.iconBtn}>
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={dashboardQuery.isFetching} onRefresh={() => void dashboardQuery.refetch()} tintColor={C.accent} />}
      >
        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Open Orders', value: stats.openCount, icon: Zap, color: C.yellow },
            { label: 'Active', value: stats.activeCount, icon: Truck, color: C.accent },
            { label: 'In Transit', value: stats.inTransit, icon: MapPin, color: C.blue },
            { label: 'Drivers', value: stats.driverCount, icon: Users, color: C.green },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}><s.icon size={18} color={s.color} /></View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Card onPress={() => router.push('/drayage-company/board' as never)} style={styles.actionCard}>
            <Package size={20} color={C.accent} />
            <Text style={styles.actionTitle}>Orders Board</Text>
            <Text style={styles.actionText}>Claim open orders & manage your fleet</Text>
          </Card>
          <Card onPress={() => router.push('/drayage-company/dispatch' as never)} style={styles.actionCard}>
            <Ship size={20} color={C.blue} />
            <Text style={styles.actionTitle}>Dispatch</Text>
            <Text style={styles.actionText}>Assign drivers & enter port reservations</Text>
          </Card>
        </View>
        <View style={styles.actionsRow}>
          <Card onPress={() => router.push('/drayage-company/terminals' as never)} style={styles.actionCard}>
            <Anchor size={20} color={C.green} />
            <Text style={styles.actionTitle}>Terminals</Text>
            <Text style={styles.actionText}>BC ports, CN & CP rail terminals</Text>
          </Card>
          <Card onPress={() => router.push('/drayage-company/fleet' as never)} style={styles.actionCard}>
            <Users size={20} color={C.yellow} />
            <Text style={styles.actionTitle}>Fleet</Text>
            <Text style={styles.actionText}>Manage drivers & trucks</Text>
          </Card>
        </View>

        {/* Open Orders */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Open Orders — Available</Text>
          <TouchableOpacity onPress={() => router.push('/drayage-company/board' as never)}>
            <Text style={styles.link}>See all</Text>
          </TouchableOpacity>
        </View>
        {openOrders.length === 0 ? (
          <EmptyState icon={Package} title="No open orders" description="When freight forwarders post container orders, they'll appear here for you to claim." />
        ) : openOrders.slice(0, 5).map((o) => (
          <Card key={o.id} style={styles.orderCard}>
            <View style={styles.orderTop}>
              <View style={[styles.dirBadge, { backgroundColor: (DIRECTION_COLOR[o.direction] ?? C.blue) + '20' }]}>
                <Text style={[styles.dirBadgeText, { color: DIRECTION_COLOR[o.direction] ?? C.blue }]}>{DIRECTION_LABEL[o.direction] ?? o.direction}</Text>
              </View>
              <StatusBadge status={o.status} />
            </View>
            <Text style={styles.orderRef}>{o.reference_code}</Text>
            <View style={styles.orderMeta}>
              <Text style={styles.orderMetaText}>Container: {o.container_number || 'TBD'}</Text>
              <Text style={styles.orderMetaText}>{o.container_size} · {o.container_type || 'Standard'}</Text>
            </View>
            {o.commodity ? <Text style={styles.orderCommodity}>{o.commodity}</Text> : null}
          </Card>
        ))}

        {/* My Active Orders */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>My Active Orders</Text>
        </View>
        {myOrders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled').length === 0 ? (
          <EmptyState icon={Truck} title="No active orders" description="Claim an open order to start dispatching containers." actionLabel="Browse orders" onAction={() => router.push('/drayage-company/board' as never)} />
        ) : myOrders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled').slice(0, 10).map((o) => (
          <Card key={o.id} onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: o.id } } as never)} style={styles.orderCard}>
            <View style={styles.orderTop}>
              <View style={[styles.dirBadge, { backgroundColor: (DIRECTION_COLOR[o.direction] ?? C.blue) + '20' }]}>
                <Text style={[styles.dirBadgeText, { color: DIRECTION_COLOR[o.direction] ?? C.blue }]}>{DIRECTION_LABEL[o.direction] ?? o.direction}</Text>
              </View>
              <StatusBadge status={o.status} />
            </View>
            <Text style={styles.orderRef}>{o.reference_code}</Text>
            <View style={styles.orderMeta}>
              <Text style={styles.orderMetaText}>Container: {o.container_number || 'TBD'}</Text>
              <Text style={styles.orderMetaText}>{o.container_size}</Text>
            </View>
            {o.port_reservation_date ? (
              <View style={styles.apptRow}>
                <CalendarClock size={12} color={C.green} />
                <Text style={styles.apptText}>Port appt: {o.port_reservation_date} {o.port_reservation_time}</Text>
              </View>
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  eyebrow: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: '47%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.textSecondary },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionCard: { flex: 1, gap: 8 },
  actionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  actionText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 16, color: C.text, fontWeight: '700' as const },
  link: { fontSize: 13, color: C.accent, fontWeight: '700' as const },
  orderCard: { gap: 8 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dirBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dirBadgeText: { fontSize: 11, fontWeight: '800' as const },
  orderRef: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  orderMeta: { flexDirection: 'row', gap: 12 },
  orderMetaText: { fontSize: 12, color: C.textSecondary },
  orderCommodity: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  apptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
});
