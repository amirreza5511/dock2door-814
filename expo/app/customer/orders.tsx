import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ClipboardList, Box, Truck, CheckCircle, ChevronRight } from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface OrderRow {
  id: string;
  booking_id: string;
  reference: string;
  status: string;
  ship_to: string;
  picked_at: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
}

interface ShipmentRow {
  id: string;
  order_id: string;
  tracking_code: string;
}

export default function CustomerOrders() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = trpc.fulfillment.listMyOrders.useQuery();

  const orders = useMemo<OrderRow[]>(() => (query.data?.orders ?? []) as OrderRow[], [query.data]);
  const itemsByOrder = useMemo(() => {
    const map = new Map<string, OrderItemRow[]>();
    const items = (query.data?.items ?? []) as OrderItemRow[];
    for (const it of items) {
      const arr = map.get(it.order_id) ?? [];
      arr.push(it);
      map.set(it.order_id, arr);
    }
    return map;
  }, [query.data]);
  const shipmentByOrder = useMemo(() => {
    const map = new Map<string, ShipmentRow>();
    const shipments = (query.data?.shipments ?? []) as ShipmentRow[];
    for (const s of shipments) map.set(s.order_id, s);
    return map;
  }, [query.data]);

  const stats = useMemo(() => ({
    pending: orders.filter((o) => o.status === 'Pending').length,
    inProgress: orders.filter((o) => ['Picked', 'Packed'].includes(o.status)).length,
    shipped: orders.filter((o) => o.status === 'Shipped').length,
    completed: orders.filter((o) => o.status === 'Completed').length,
  }), [orders]);

  if (query.isLoading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ScreenFeedback state="loading" title="Loading orders" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ScreenFeedback state="error" title="Unable to load orders" description={query.error?.message} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.sub}>{orders.length} total</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statsRow}>
          <StatPill label="Pending" value={stats.pending} color={C.yellow} icon={ClipboardList} />
          <StatPill label="In-Progress" value={stats.inProgress} color={C.blue} icon={Box} />
          <StatPill label="Shipped" value={stats.shipped} color={C.accent} icon={Truck} />
          <StatPill label="Done" value={stats.completed} color={C.green} icon={CheckCircle} />
        </View>

        {orders.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No orders yet" description="Orders you create from inventory will appear here. Open a booking to add inventory and create your first order." />
        ) : (
          orders.map((order) => {
            const items = itemsByOrder.get(order.id) ?? [];
            const shipment = shipmentByOrder.get(order.id);
            const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
            return (
              <TouchableOpacity
                key={order.id}
                onPress={() => router.push(`/fulfillment/${order.booking_id}` as never)}
                activeOpacity={0.85}
              >
                <Card style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}>
                      <Box size={16} color={C.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ref}>{order.reference}</Text>
                      <Text style={styles.meta}>{items.length} line{items.length === 1 ? '' : 's'} · {totalUnits} units · {new Date(order.created_at).toLocaleDateString()}</Text>
                    </View>
                    <StatusBadge status={order.status} />
                  </View>

                  {order.ship_to ? <Text style={styles.shipTo}>Ship to: {order.ship_to}</Text> : null}

                  <View style={styles.timeline}>
                    <TimelineStep active={Boolean(order.picked_at)} label="Picked" />
                    <TimelineStep active={Boolean(order.packed_at)} label="Packed" />
                    <TimelineStep active={Boolean(order.shipped_at)} label="Shipped" />
                    <TimelineStep active={Boolean(order.completed_at)} label="Done" />
                  </View>

                  <View style={styles.footer}>
                    {shipment ? (
                      <View style={styles.trackRow}>
                        <Truck size={13} color={C.blue} />
                        <Text style={styles.trackText}>{shipment.tracking_code}</Text>
                      </View>
                    ) : <View />}
                    <View style={styles.openRow}>
                      <Text style={styles.openText}>Open</Text>
                      <ChevronRight size={14} color={C.accent} />
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function StatPill({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: typeof ClipboardList }) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statIconWrap, { backgroundColor: color + '20' }]}>
        <Icon size={14} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function TimelineStep({ active, label }: { active: boolean; label: string }) {
  return (
    <View style={styles.tlStep}>
      <View style={[styles.tlDot, active && styles.tlDotActive]} />
      <Text style={[styles.tlLabel, active && styles.tlLabelActive]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  statPill: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4 },
  statIconWrap: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, fontWeight: '600' as const },
  card: { padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ref: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  meta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  shipTo: { fontSize: 12, color: C.textSecondary },
  timeline: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  tlStep: { alignItems: 'center', gap: 4, flex: 1 },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.border },
  tlDotActive: { backgroundColor: C.green },
  tlLabel: { fontSize: 10, color: C.textMuted, fontWeight: '600' as const },
  tlLabelActive: { color: C.text },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trackText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  openText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
});
