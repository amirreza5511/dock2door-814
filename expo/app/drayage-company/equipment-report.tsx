import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Layers, DollarSign, AlertTriangle, Truck } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { orderCharges, chargeChipLabel } from '@/lib/drayage-charges';

const URGENCY_COLOR: Record<string, string> = { over: C.red, soon: C.yellow, ok: C.green, none: C.textMuted };

export default function DrayageEquipmentReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const equipmentQuery = trpc.drayage.equipmentLive.useQuery(undefined, { refetchInterval: 30000 });
  const dashboardQuery = trpc.drayage.dashboard.useQuery();

  const chassis = useMemo(() => (equipmentQuery.data?.chassis ?? []) as any[], [equipmentQuery.data]);
  const trailers = useMemo(() => (equipmentQuery.data?.trailers ?? []) as any[], [equipmentQuery.data]);

  // Monthly rental exposure across rented chassis + trailers.
  const rentalMonthly = useMemo(() => {
    const all = [...chassis, ...trailers].filter((e) => e.is_rental);
    return all.reduce((s, e) => s + (Number(e.rental_daily_rate) || 0) * 30, 0);
  }, [chassis, trailers]);

  const rentedCount = useMemo(() => [...chassis, ...trailers].filter((e) => e.is_rental).length, [chassis, trailers]);
  const attachedCount = useMemo(() => [...chassis, ...trailers].filter((e) => !e.is_dropped && e.current_truck_id).length, [chassis, trailers]);
  const droppedCount = useMemo(() => [...chassis, ...trailers].filter((e) => e.is_dropped).length, [chassis, trailers]);

  // Outstanding accessorials across active orders.
  const accessorials = useMemo(() => {
    const orders = (dashboardQuery.data?.myOrders ?? []) as any[];
    let total = 0;
    const rows: { order: any; charges: ReturnType<typeof orderCharges> }[] = [];
    for (const o of orders) {
      if (['Delivered', 'Cancelled', 'Completed'].includes(o.status)) continue;
      const ch = orderCharges(o).filter((c) => c.amount > 0 || c.urgency === 'soon' || c.urgency === 'over');
      if (ch.length === 0) continue;
      total += ch.reduce((s, c) => s + c.amount, 0);
      rows.push({ order: o, charges: ch });
    }
    return { total: Math.round(total * 100) / 100, rows };
  }, [dashboardQuery.data]);

  const isLoading = equipmentQuery.isLoading || dashboardQuery.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Equipment & accessorials</Text>
          <Text style={styles.headerSub}>Rental exposure & outstanding charges</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={equipmentQuery.isFetching} onRefresh={() => void equipmentQuery.refetch()} tintColor={C.accent} />}
      >
        {isLoading ? (
          <ScreenFeedback state="loading" title="Loading report" />
        ) : (
          <>
            <View style={styles.statsRow}>
              <Card style={styles.statCard}>
                <Layers size={18} color={C.blue} />
                <Text style={styles.statValue}>{chassis.length + trailers.length}</Text>
                <Text style={styles.statLabel}>Equipment</Text>
              </Card>
              <Card style={styles.statCard}>
                <Truck size={18} color={C.green} />
                <Text style={styles.statValue}>{attachedCount}</Text>
                <Text style={styles.statLabel}>On trucks</Text>
              </Card>
              <Card style={styles.statCard}>
                <AlertTriangle size={18} color={C.yellow} />
                <Text style={styles.statValue}>{droppedCount}</Text>
                <Text style={styles.statLabel}>Dropped</Text>
              </Card>
            </View>

            <Card style={styles.bigCard}>
              <View style={styles.bigRow}><DollarSign size={16} color={C.accent} /><Text style={styles.bigTitle}>Rental exposure</Text></View>
              <Text style={styles.bigValue}>${rentalMonthly.toLocaleString()}<Text style={styles.bigUnit}> / mo est.</Text></Text>
              <Text style={styles.bigMeta}>{rentedCount} rented unit(s) across chassis & trailers.</Text>
            </Card>

            <Card style={styles.bigCard}>
              <View style={styles.bigRow}><AlertTriangle size={16} color={C.red} /><Text style={styles.bigTitle}>Outstanding accessorials</Text></View>
              <Text style={[styles.bigValue, { color: accessorials.total > 0 ? C.red : C.text }]}>${accessorials.total.toLocaleString()}</Text>
              <Text style={styles.bigMeta}>Per diem / demurrage / storage accrued on active orders — billed to customers.</Text>
            </Card>

            {accessorials.rows.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>By order</Text>
                {accessorials.rows.map(({ order, charges }) => (
                  <Card key={order.id} onPress={() => router.push({ pathname: '/drayage-company/[orderId]', params: { orderId: order.id } } as never)} style={styles.orderCard}>
                    <Text style={styles.orderRef}>{order.reference_code}</Text>
                    <View style={styles.chipWrap}>
                      {charges.map((c) => (
                        <View key={c.kind} style={[styles.chip, { borderColor: URGENCY_COLOR[c.urgency] + '66', backgroundColor: URGENCY_COLOR[c.urgency] + '18' }]}>
                          <Text style={[styles.chipText, { color: URGENCY_COLOR[c.urgency] }]}>{chargeChipLabel(c)}</Text>
                        </View>
                      ))}
                    </View>
                  </Card>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 12 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  bigCard: { gap: 6 },
  bigRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  bigValue: { fontSize: 28, fontWeight: '900' as const, color: C.text },
  bigUnit: { fontSize: 14, fontWeight: '600' as const, color: C.textMuted },
  bigMeta: { fontSize: 12, color: C.textSecondary },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 8 },
  orderCard: { gap: 8 },
  orderRef: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 11.5, fontWeight: '800' as const },
});
