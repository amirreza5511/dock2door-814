import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LogOut, Send, Package, Truck, MapPin, CheckCircle2, Plus, Warehouse, ChevronRight, Navigation } from 'lucide-react-native';
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
  uses_hub?: boolean; hub_name?: string | null; hub_leg_status?: string | null;
  handling_fee?: number; storage_per_day?: number; storage_charged?: number;
  freight_price?: number; booking_fee?: number;
};

type StatFilter = 'all' | 'open' | 'transit' | 'delivered';

const ACTIVE_STATUSES = ['Open', 'Accepted', 'EnRoute', 'Arrived'];

export default function ShipperDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const query = trpc.loads.listPosted.useQuery(undefined, { refetchInterval: 20000 });

  const [filter, setFilter] = useState<StatFilter>('all');

  const loads = useMemo<LoadRow[]>(() => (query.data ?? []) as LoadRow[], [query.data]);
  const stats = useMemo(() => ({
    open: loads.filter((l) => l.status === 'Open').length,
    inTransit: loads.filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status)).length,
    delivered: loads.filter((l) => l.status === 'Delivered').length,
    spend: loads.filter((l) => l.status !== 'Cancelled').reduce((s, l) => s + Number(l.total_price ?? 0), 0),
  }), [loads]);

  const activeJourneys = useMemo(
    () => loads.filter((l) => l.uses_hub && ACTIVE_STATUSES.includes(l.status)).slice(0, 4),
    [loads],
  );

  const filtered = useMemo(() => {
    const list = filter === 'open'
      ? loads.filter((l) => l.status === 'Open')
      : filter === 'transit'
      ? loads.filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status))
      : filter === 'delivered'
      ? loads.filter((l) => l.status === 'Delivered')
      : loads;
    return list.slice(0, 8);
  }, [loads, filter]);

  if (query.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading your deliveries" /></View>;
  }
  if (query.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load deliveries" onRetry={() => void query.refetch()} /></View>;
  }

  const statCards: { key: StatFilter; label: string; value: string | number; icon: typeof Package; color: string }[] = [
    { key: 'open', label: 'Open', value: stats.open, icon: Package, color: C.blue },
    { key: 'transit', label: 'In transit', value: stats.inTransit, icon: Truck, color: C.yellow },
    { key: 'delivered', label: 'Delivered', value: stats.delivered, icon: CheckCircle2, color: C.green },
    { key: 'all', label: 'Total spend', value: `$${stats.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: MapPin, color: C.accent },
  ];

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
          <TouchableOpacity onPress={logout} style={styles.logoutBtn} testID="logout-btn" accessibilityLabel="Sign out">
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
          {statCards.map((s) => {
            const active = filter === s.key;
            return (
              <TouchableOpacity
                key={s.label}
                style={[styles.statCard, active && { borderColor: s.color, backgroundColor: s.color + '12' }]}
                activeOpacity={0.85}
                onPress={() => setFilter((prev) => (prev === s.key ? 'all' : s.key))}
              >
                <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}><s.icon size={18} color={s.color} /></View>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity onPress={() => router.push('/shipper/post-load' as never)} style={styles.cta} activeOpacity={0.9}>
          <View style={styles.ctaIcon}><Plus size={22} color={C.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Post a delivery</Text>
            <Text style={styles.ctaDesc}>From an envelope to a full truckload</Text>
          </View>
          <Send size={18} color={C.white} />
        </TouchableOpacity>

        {activeJourneys.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Active journeys</Text>
              <View style={styles.hubPill}><Warehouse size={11} color={C.accent} /><Text style={styles.hubPillText}>via hub</Text></View>
            </View>
            {activeJourneys.map((l) => (
              <TouchableOpacity key={l.id} activeOpacity={0.85} onPress={() => router.push('/shipper/loads' as never)}>
                <Card style={styles.journeyCard}>
                  <View style={styles.journeyTop}>
                    <Text style={styles.journeyRoute} numberOfLines={1}>
                      {(l.pickup_address || 'Pickup').split(',')[0]} → {(l.dropoff_address || 'Drop-off').split(',')[0]}
                    </Text>
                    <StatusBadge status={l.status} />
                  </View>
                  <JourneyTrack status={l.status} hubLeg={l.hub_leg_status ?? 'Pending'} hubName={l.hub_name ?? 'Hub'} />
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>{filter === 'all' ? 'Recent deliveries' : 'Filtered deliveries'}</Text>
            <TouchableOpacity onPress={() => router.push('/shipper/loads' as never)} style={styles.trackAllRow}>
              <Navigation size={13} color={C.accent} />
              <Text style={styles.seeAll}>Track all</Text>
            </TouchableOpacity>
          </View>
          {filtered.length === 0 ? (
            <EmptyState icon={Send} title="No deliveries yet" description="Post your first load and watch a nearby driver pick it up." />
          ) : (
            filtered.map((l) => (
              <TouchableOpacity key={l.id} activeOpacity={0.85} onPress={() => router.push('/shipper/loads' as never)}>
                <Card style={styles.loadCard}>
                  <View style={styles.loadTop}>
                    <View style={styles.cargoBadge}>
                      <Text style={styles.cargoBadgeText}>{CARGO_LABEL[l.cargo_type as CargoType] ?? l.cargo_type}</Text>
                    </View>
                    {l.uses_hub ? (
                      <View style={styles.hubTag}><Warehouse size={10} color={C.accent} /><Text style={styles.hubTagText} numberOfLines={1}>{l.hub_name || 'Hub'}</Text></View>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <StatusBadge status={l.status} />
                  </View>
                  <View style={styles.routeCol}>
                    <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{l.pickup_address || 'Pickup point'}</Text></View>
                    {l.uses_hub ? (
                      <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.accent }]} /><Text style={styles.routeText} numberOfLines={1}>{l.hub_name || 'Partner hub'}</Text></View>
                    ) : null}
                    <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{l.dropoff_address || 'Drop-off point'}</Text></View>
                  </View>
                  <View style={styles.loadFooter}>
                    <Text style={styles.loadMeta}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type} · {l.distance_km} km</Text>
                    <View style={styles.priceCol}>
                      <Text style={styles.loadPrice}>${Number(l.total_price).toFixed(2)}</Text>
                      {l.uses_hub && Number(l.handling_fee ?? 0) > 0 ? (
                        <Text style={styles.priceBreak} numberOfLines={1}>incl. handling ${Number(l.handling_fee).toFixed(0)} · storage ${Number(l.storage_per_day ?? 0).toFixed(0)}/day</Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Compact multi-leg progress track: Picked up → At hub → Out for delivery → Delivered. */
function JourneyTrack({ status, hubLeg, hubName }: { status: string; hubLeg: string; hubName: string }) {
  const steps = [
    { label: 'Picked up', icon: Truck },
    { label: hubName || 'At hub', icon: Warehouse },
    { label: 'Final leg', icon: Navigation },
    { label: 'Delivered', icon: CheckCircle2 },
  ];
  // Derive current step index from load + hub leg status.
  let current = 0;
  if (status === 'Accepted' || status === 'EnRoute') current = 0;
  if (hubLeg === 'AtHub') current = 1;
  if (hubLeg === 'Released') current = 2;
  if (status === 'Delivered') current = 3;

  return (
    <View style={styles.track}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const color = done || active ? C.accent : C.border;
        return (
          <React.Fragment key={s.label}>
            <View style={styles.trackStep}>
              <View style={[styles.trackNode, { backgroundColor: done ? C.accent : active ? C.accent + '22' : C.card, borderColor: color }]}>
                <s.icon size={12} color={done ? C.white : active ? C.accent : C.textMuted} />
              </View>
              <Text style={[styles.trackLabel, (done || active) && { color: C.text }]} numberOfLines={1}>{s.label}</Text>
            </View>
            {i < steps.length - 1 ? <View style={[styles.trackBar, { backgroundColor: i < current ? C.accent : C.border }]} /> : null}
          </React.Fragment>
        );
      })}
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
  trackAllRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  hubPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  hubPillText: { fontSize: 10, fontWeight: '800' as const, color: C.accent, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  journeyCard: { gap: 14 },
  journeyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  journeyRoute: { flex: 1, fontSize: 13, fontWeight: '700' as const, color: C.text },
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  trackStep: { alignItems: 'center', width: 60 },
  trackNode: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  trackLabel: { fontSize: 9, color: C.textMuted, marginTop: 5, textAlign: 'center' as const, fontWeight: '600' as const },
  trackBar: { flex: 1, height: 2, backgroundColor: C.border, marginTop: 14, borderRadius: 1 },
  loadCard: { gap: 10 },
  loadTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cargoBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cargoBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  hubTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, maxWidth: 120 },
  hubTagText: { fontSize: 10, fontWeight: '700' as const, color: C.accent },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  loadFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, gap: 10 },
  loadMeta: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const, flexShrink: 1 },
  priceCol: { alignItems: 'flex-end' as const },
  loadPrice: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  priceBreak: { fontSize: 9, color: C.textMuted, marginTop: 1 },
});
