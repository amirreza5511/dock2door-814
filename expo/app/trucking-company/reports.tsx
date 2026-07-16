import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Clock, Gauge, Route as RouteIcon, TrendingUp, Truck, UserRound } from 'lucide-react-native';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type LoadRow = {
  id: string; status: string; distance_km?: number | null;
  accepted_driver_user_id?: string | null; driver_name?: string | null;
  assigned_truck_id?: string | null;
  provider_net?: number | null;
  driver_pay_type?: string | null; driver_pay_value?: number | null; fuel_cost?: number | null;
  deadline_at?: string | null; delivered_at?: string | null;
};
type FleetDriver = { id: string; name?: string | null; data?: { name?: string; userId?: string } | null };
type FleetUnit = { id: string; status?: string | null };

const PERIODS: [number, string][] = [[7, '7d'], [30, '30d'], [90, '90d']];

function driverPay(l: LoadRow): number {
  const net = Number(l.provider_net ?? 0);
  if (l.driver_pay_type === 'Percent') return Math.round(net * Number(l.driver_pay_value ?? 0)) / 100;
  if (l.driver_pay_type === 'Flat') return Number(l.driver_pay_value ?? 0);
  return 0;
}

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settlementQuery = trpc.loads.settlement.useQuery(undefined, { refetchInterval: 60000 });
  const activeQuery = trpc.loads.listAccepted.useQuery(undefined, { refetchInterval: 30000 });
  const driversQuery = trpc.operations.listFleet.useQuery({ entity: 'drivers' });
  const trucksQuery = trpc.operations.listFleet.useQuery({ entity: 'trucks' });

  const [days, setDays] = useState<number>(30);

  const delivered = useMemo<LoadRow[]>(() => {
    const since = Date.now() - days * 86_400_000;
    return ((settlementQuery.data ?? []) as LoadRow[]).filter((l) => {
      const t = l.delivered_at ? new Date(l.delivered_at).getTime() : 0;
      return t >= since;
    });
  }, [settlementQuery.data, days]);

  const active = useMemo<LoadRow[]>(
    () => ((activeQuery.data ?? []) as LoadRow[]).filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status)),
    [activeQuery.data],
  );
  const drivers = useMemo<FleetDriver[]>(() => (driversQuery.data ?? []) as FleetDriver[], [driversQuery.data]);
  const trucks = useMemo<FleetUnit[]>(() => (trucksQuery.data ?? []) as FleetUnit[], [trucksQuery.data]);

  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) { const uid = d.data?.userId; if (uid) m.set(uid, d.name || d.data?.name || 'Driver'); }
    return m;
  }, [drivers]);

  const kpis = useMemo(() => {
    let revenue = 0, cost = 0, loadedKm = 0, withDeadline = 0, onTime = 0;
    for (const l of delivered) {
      revenue += Number(l.provider_net ?? 0);
      cost += driverPay(l) + Number(l.fuel_cost ?? 0);
      loadedKm += Number(l.distance_km ?? 0);
      if (l.deadline_at && l.delivered_at) {
        withDeadline += 1;
        if (new Date(l.delivered_at).getTime() <= new Date(l.deadline_at).getTime()) onTime += 1;
      }
    }
    const busyTrucks = new Set(active.filter((l) => l.assigned_truck_id).map((l) => l.assigned_truck_id as string)).size;
    const totalTrucks = trucks.filter((t) => (t.status ?? 'Active') === 'Active').length;
    return {
      revenue, cost, profit: revenue - cost, loadedKm,
      onTimePct: withDeadline > 0 ? Math.round((onTime / withDeadline) * 100) : null,
      withDeadline,
      utilization: totalTrucks > 0 ? Math.round((busyTrucks / totalTrucks) * 100) : null,
      busyTrucks, totalTrucks,
      activeCount: active.length, completedCount: delivered.length,
    };
  }, [delivered, active, trucks]);

  const perDriver = useMemo(() => {
    const map = new Map<string, { name: string; loads: number; revenue: number; pay: number; profit: number; onTime: number; withDl: number }>();
    for (const l of delivered) {
      const key = l.accepted_driver_user_id ?? l.driver_name ?? 'unknown';
      const name = l.driver_name?.trim() || (l.accepted_driver_user_id ? nameByUid.get(l.accepted_driver_user_id) : null) || 'Unassigned';
      if (!map.has(key)) map.set(key, { name, loads: 0, revenue: 0, pay: 0, profit: 0, onTime: 0, withDl: 0 });
      const g = map.get(key)!;
      g.loads += 1;
      g.revenue += Number(l.provider_net ?? 0);
      g.pay += driverPay(l);
      g.profit += Number(l.provider_net ?? 0) - driverPay(l) - Number(l.fuel_cost ?? 0);
      if (l.deadline_at && l.delivered_at) { g.withDl += 1; if (new Date(l.delivered_at).getTime() <= new Date(l.deadline_at).getTime()) g.onTime += 1; }
    }
    return Array.from(map.values()).sort((a, b) => b.loads - a.loads);
  }, [delivered, nameByUid]);

  const loading = settlementQuery.isLoading || activeQuery.isLoading;
  if (loading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading reports" /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/' as never); } }} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reports & KPIs</Text>
          <Text style={styles.subtitle}>Fleet performance for the last {days} days</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.periodRow}>
          {PERIODS.map(([d, lbl]) => (
            <TouchableOpacity key={d} style={[styles.periodChip, days === d && styles.periodChipOn]} onPress={() => setDays(d)}>
              <Text style={[styles.periodText, days === d && styles.periodTextOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <View style={styles.kpiTop}><Clock size={15} color={C.green} /><Text style={styles.kpiLabel}>On-time</Text></View>
            <Text style={styles.kpiValue}>{kpis.onTimePct === null ? '—' : `${kpis.onTimePct}%`}</Text>
            <Text style={styles.kpiSub}>{kpis.withDeadline} with deadline</Text>
          </View>
          <View style={styles.kpiCard}>
            <View style={styles.kpiTop}><Gauge size={15} color={C.accent} /><Text style={styles.kpiLabel}>Fleet use</Text></View>
            <Text style={styles.kpiValue}>{kpis.utilization === null ? '—' : `${kpis.utilization}%`}</Text>
            <Text style={styles.kpiSub}>{kpis.busyTrucks}/{kpis.totalTrucks} trucks</Text>
          </View>
          <View style={styles.kpiCard}>
            <View style={styles.kpiTop}><Truck size={15} color={C.blue} /><Text style={styles.kpiLabel}>Loads</Text></View>
            <Text style={styles.kpiValue}>{kpis.activeCount}<Text style={styles.kpiValueSmall}> active</Text></Text>
            <Text style={styles.kpiSub}>{kpis.completedCount} completed</Text>
          </View>
          <View style={styles.kpiCard}>
            <View style={styles.kpiTop}><RouteIcon size={15} color={C.yellow} /><Text style={styles.kpiLabel}>Loaded km</Text></View>
            <Text style={styles.kpiValue}>{Math.round(kpis.loadedKm)}</Text>
            <Text style={styles.kpiSub}>delivered distance</Text>
          </View>
        </View>

        <View style={styles.financeCard}>
          <Text style={styles.financeTitle}>Period summary</Text>
          <View style={styles.financeRow}><Text style={styles.financeLabel}>Revenue</Text><Text style={styles.financeVal}>${kpis.revenue.toFixed(0)}</Text></View>
          <View style={styles.financeRow}><Text style={styles.financeLabel}>Driver + fuel cost</Text><Text style={[styles.financeVal, { color: C.textSecondary }]}>-${kpis.cost.toFixed(0)}</Text></View>
          <View style={[styles.financeRow, styles.financeTotal]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><TrendingUp size={15} color={C.green} /><Text style={[styles.financeLabel, { color: C.text, fontWeight: '800' }]}>Net profit</Text></View>
            <Text style={[styles.financeVal, { color: kpis.profit >= 0 ? C.green : C.red, fontSize: 20 }]}>${kpis.profit.toFixed(0)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Driver performance</Text>
        {perDriver.length === 0 ? (
          <EmptyState icon={UserRound} title="No completed loads yet" description="Driver performance appears here once trips are delivered in this period." />
        ) : perDriver.map((g) => (
          <View key={g.name} style={styles.driverCard}>
            <View style={styles.driverHead}>
              <View style={styles.driverAvatar}><UserRound size={16} color={C.accent} /></View>
              <Text style={styles.driverName}>{g.name}</Text>
              <View style={styles.loadsTag}><Text style={styles.loadsTagText}>{g.loads} load{g.loads > 1 ? 's' : ''}</Text></View>
            </View>
            <View style={styles.driverStats}>
              <View style={styles.dStat}><Text style={styles.dStatLabel}>On-time</Text><Text style={styles.dStatVal}>{g.withDl > 0 ? `${Math.round((g.onTime / g.withDl) * 100)}%` : '—'}</Text></View>
              <View style={styles.dStat}><Text style={styles.dStatLabel}>Revenue</Text><Text style={styles.dStatVal}>${g.revenue.toFixed(0)}</Text></View>
              <View style={styles.dStat}><Text style={styles.dStatLabel}>Paid</Text><Text style={[styles.dStatVal, { color: C.accent }]}>${g.pay.toFixed(0)}</Text></View>
              <View style={styles.dStat}><Text style={styles.dStatLabel}>Profit</Text><Text style={[styles.dStatVal, { color: g.profit >= 0 ? C.green : C.red }]}>${g.profit.toFixed(0)}</Text></View>
            </View>
          </View>
        ))}
      </ScrollView>
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
  periodRow: { flexDirection: 'row', gap: 8 },
  periodChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  periodChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  periodText: { fontSize: 13, fontWeight: '800' as const, color: C.textSecondary },
  periodTextOn: { color: C.accent },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { width: '47%', flexGrow: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 4 },
  kpiTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  kpiValue: { fontSize: 26, fontWeight: '900' as const, color: C.text },
  kpiValueSmall: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  kpiSub: { fontSize: 11.5, color: C.textMuted },
  financeCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, gap: 10 },
  financeTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  financeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  financeLabel: { fontSize: 13, color: C.textSecondary },
  financeVal: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  financeTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10, marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  driverCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 12 },
  driverHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  driverAvatar: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  driverName: { flex: 1, fontSize: 14.5, fontWeight: '800' as const, color: C.text },
  loadsTag: { backgroundColor: C.bgSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  loadsTagText: { fontSize: 11.5, fontWeight: '800' as const, color: C.textSecondary },
  driverStats: { flexDirection: 'row', gap: 8 },
  dStat: { flex: 1 },
  dStatLabel: { fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  dStatVal: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginTop: 2 },
});
