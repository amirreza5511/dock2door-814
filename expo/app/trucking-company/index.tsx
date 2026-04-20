import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CalendarClock, CreditCard, LogOut, MessagesSquare, Truck, Users } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function TruckingCompanyDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const dashboardQuery = trpc.operations.truckingDashboard.useQuery();

  const stats = useMemo(() => {
    const appointments = dashboardQuery.data?.appointments ?? [];
    const drivers = dashboardQuery.data?.drivers ?? [];
    const trucks = dashboardQuery.data?.trucks ?? [];

    return {
      appointmentsToday: appointments.filter((item) => String(item.scheduled_start).slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      activeDrivers: drivers.length,
      fleetUnits: trucks.length,
      loadingNow: appointments.filter((item) => ['AtDoor', 'Loading', 'Unloading'].includes(String(item.status))).length,
    };
  }, [dashboardQuery.data]);

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading fleet ops" /></View>;
  }

  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load trucking dashboard" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  const appointments = dashboardQuery.data?.appointments ?? [];
  const drivers = dashboardQuery.data?.drivers ?? [];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}> 
        <View>
          <Text style={styles.eyebrow}>Trucking Company</Text>
          <Text style={styles.title}>{user?.name}</Text>
        </View>
        <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn} testID="trucking-logout-btn">
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.statsGrid}>
          {[
            ['Today', stats.appointmentsToday],
            ['Drivers', stats.activeDrivers],
            ['Trucks', stats.fleetUnits],
            ['At Door', stats.loadingNow],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.actionsRow}>
          <Card onPress={() => router.push('/trucking-company/appointments' as never)} style={styles.actionCard}>
            <CalendarClock size={20} color={C.accent} />
            <Text style={styles.actionTitle}>Dispatch appointments</Text>
            <Text style={styles.actionText}>Create and monitor dock arrivals.</Text>
          </Card>
          <Card onPress={() => router.push('/trucking-company/fleet' as never)} style={styles.actionCard}>
            <Truck size={20} color={C.blue} />
            <Text style={styles.actionTitle}>Manage fleet</Text>
            <Text style={styles.actionText}>Drivers, trucks, trailers, capacity.</Text>
          </Card>
        </View>
        <View style={styles.actionsRow}>
          <Card onPress={() => router.push('/trucking-company/finance' as never)} style={styles.actionCard}>
            <CreditCard size={20} color={C.green} />
            <Text style={styles.actionTitle}>Finance visibility</Text>
            <Text style={styles.actionText}>Payments, invoices, and payouts.</Text>
          </Card>
          <Card onPress={() => router.push('/trucking-company/messages' as never)} style={styles.actionCard}>
            <MessagesSquare size={20} color={C.accent} />
            <Text style={styles.actionTitle}>Inbox</Text>
            <Text style={styles.actionText}>Threads, attachments, notifications.</Text>
          </Card>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Upcoming appointments</Text>
          <TouchableOpacity onPress={() => router.push('/trucking-company/appointments' as never)}><Text style={styles.link}>All</Text></TouchableOpacity>
        </View>
        {appointments.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No appointments yet" description="Create the first delivery or pickup slot for your team." actionLabel="Create appointment" onAction={() => router.push('/trucking-company/appointments' as never)} />
        ) : appointments.slice(0, 5).map((item) => (
          <Card key={String(item.id)} style={styles.listCard}>
            <View style={styles.listTop}>
              <View style={styles.listTitleWrap}>
                <Text style={styles.listTitle}>{String(item.driver_name ?? item.truck_plate ?? 'Unassigned trip')}</Text>
                <Text style={styles.listMeta}>{String(item.appointment_type)} · {String(item.pallet_count)} pallets</Text>
              </View>
              <StatusBadge status={String(item.status)} />
            </View>
            <Text style={styles.listSub}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
          </Card>
        ))}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Driver roster</Text>
          <TouchableOpacity onPress={() => router.push('/trucking-company/fleet' as never)}><Text style={styles.link}>Manage</Text></TouchableOpacity>
        </View>
        {drivers.length === 0 ? (
          <EmptyState icon={Users} title="No drivers added" description="Add your dispatch team to make assignments usable." actionLabel="Open fleet" onAction={() => router.push('/trucking-company/fleet' as never)} />
        ) : drivers.slice(0, 4).map((item) => (
          <Card key={String(item.id)} style={styles.driverCard}>
            <View style={styles.driverIcon}><Users size={16} color={C.green} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{String(item.data?.name ?? item.name ?? item.driver_name ?? 'Driver')}</Text>
              <Text style={styles.listMeta}>{String(item.license_number ?? item.license_class ?? 'Ready for dispatch')}</Text>
            </View>
          </Card>
        ))}
        </ResponsiveContainer>
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
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16 },
  statValue: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 16, color: C.text, fontWeight: '700' as const },
  link: { fontSize: 13, color: C.accent, fontWeight: '700' as const },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionCard: { flex: 1, gap: 8 },
  actionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  actionText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  listCard: { marginTop: 10, gap: 8 },
  listTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  listTitleWrap: { flex: 1 },
  listTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  listMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  listSub: { fontSize: 12, color: C.textMuted },
  driverCard: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  driverIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenDim },
});
