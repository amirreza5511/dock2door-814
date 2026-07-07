import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LogOut, Send, Package, Truck, MapPin, CheckCircle2, Plus, HelpCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import WorldSwitcher from '@/components/WorldSwitcher';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { CARGO_LABEL, CargoType, VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type LoadRow = {
  id: string; vehicle_type: string; cargo_type: string; pallets: number; status: string;
  pickup_address?: string | null; dropoff_address?: string | null;
  distance_km: number; total_price: number; created_at: string;
};

export default function ShipperDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const query = trpc.loads.listPosted.useQuery(undefined, { refetchInterval: 20000 });

  const loads = useMemo<LoadRow[]>(() => (query.data ?? []) as LoadRow[], [query.data]);
  const stats = useMemo(() => ({
    open: loads.filter((l) => l.status === 'Open').length,
    inTransit: loads.filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status)).length,
    delivered: loads.filter((l) => l.status === 'Delivered').length,
    spend: loads.filter((l) => l.status !== 'Cancelled').reduce((s, l) => s + Number(l.total_price ?? 0), 0),
  }), [loads]);
  const recent = useMemo(() => [...loads].slice(0, 5), [loads]);

  if (query.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading your deliveries" /></View>;
  }
  if (query.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load deliveries" onRetry={() => void query.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}><Send size={18} color={C.blue} /></View>
          <View>
            <Text style={styles.greeting}>Freight & Delivery</Text>
            <Text style={styles.name}>{user?.name}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <WorldSwitcher />
          <SupportMenu />
          <TouchableOpacity onPress={logout} style={styles.logoutBtn} testID="logout-btn">
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statsGrid}>
          {[
            { label: 'Open', value: stats.open, icon: Package, color: C.blue },
            { label: 'In transit', value: stats.inTransit, icon: Truck, color: C.yellow },
            { label: 'Delivered', value: stats.delivered, icon: CheckCircle2, color: C.green },
            { label: 'Total spend', value: `$${stats.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: MapPin, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}><s.icon size={18} color={s.color} /></View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity onPress={() => router.push('/shipper/post-load' as never)} style={styles.cta} activeOpacity={0.9}>
          <View style={styles.ctaIcon}><Plus size={22} color={C.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Post a delivery</Text>
            <Text style={styles.ctaDesc}>From an envelope to a full truckload</Text>
          </View>
          <Send size={18} color={C.white} />
        </TouchableOpacity>

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent deliveries</Text>
            <TouchableOpacity onPress={() => router.push('/shipper/loads' as never)}>
              <Text style={styles.seeAll}>Track all</Text>
            </TouchableOpacity>
          </View>
          {recent.length === 0 ? (
            <EmptyState icon={Send} title="No deliveries yet" description="Post your first load and watch a nearby driver pick it up." />
          ) : (
            recent.map((l) => (
              <Card key={l.id} style={styles.loadCard}>
                <View style={styles.loadTop}>
                  <View style={styles.cargoBadge}>
                    <Text style={styles.cargoBadgeText}>{CARGO_LABEL[l.cargo_type as CargoType] ?? l.cargo_type}</Text>
                  </View>
                  <StatusBadge status={l.status} />
                </View>
                <View style={styles.routeCol}>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{l.pickup_address || 'Pickup point'}</Text></View>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{l.dropoff_address || 'Drop-off point'}</Text></View>
                </View>
                <View style={styles.loadFooter}>
                  <Text style={styles.loadMeta}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type} · {l.distance_km} km</Text>
                  <Text style={styles.loadPrice}>${Number(l.total_price).toFixed(2)}</Text>
                </View>
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 12, color: C.blue, fontWeight: '700' as const, letterSpacing: 0.4 },
  name: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20, paddingHorizontal: 20, gap: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.textSecondary },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.accent, borderRadius: 16, padding: 16 },
  ctaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  ctaDesc: { fontSize: 12, color: '#FFFFFFCC', marginTop: 2 },
  section: { gap: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, letterSpacing: -0.2 },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  loadCard: { gap: 10 },
  loadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cargoBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cargoBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  loadFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  loadMeta: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  loadPrice: { fontSize: 15, fontWeight: '800' as const, color: C.text },
});
