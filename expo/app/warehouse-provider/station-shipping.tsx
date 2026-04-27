import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Truck, Tag, FileText, AlertTriangle, ExternalLink } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

interface OrderRow { id: string; reference?: string | null; status: string; ship_to?: string | null }
interface ShipmentRow { id: string; order_id?: string | null; status: string; tracking_code?: string | null; carrier_code?: string | null; label_url?: string | null }

export default function ShippingStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'orders.ship');

  const orders = trpc.fulfillment.listMyOrders.useQuery();
  const shipments = trpc.shipping.listShipments.useQuery();
  const ship = trpc.fulfillment.shipOrder.useMutation({
    onSuccess: async () => { await Promise.all([utils.fulfillment.listMyOrders.invalidate(), utils.shipping.listShipments.invalidate()]); },
  });

  const [busy, setBusy] = useState<string | null>(null);

  const orderList = useMemo<OrderRow[]>(() => (orders.data ?? []) as OrderRow[], [orders.data]);
  const shipList = useMemo<ShipmentRow[]>(() => (shipments.data ?? []) as ShipmentRow[], [shipments.data]);
  const queue = useMemo(() => orderList.filter((o) => o.status === 'Packed'), [orderList]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerSimple, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
          <Text style={styles.title}>Shipping Station</Text>
        </View>
        <View style={{ padding: 24 }}>
          <EmptyState icon={AlertTriangle} title="Not allowed" description={`Your role (${role ? ROLE_LABEL[role] : 'none'}) does not have orders.ship.`} />
        </View>
      </View>
    );
  }

  const onShip = async (id: string) => {
    setBusy(id);
    try {
      await ship.mutateAsync({ orderId: id });
      Alert.alert('Shipped', `${id.slice(0, 8)} marked shipped. Buy a label below.`);
    } catch (err) {
      Alert.alert('Ship failed', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setBusy(null);
    }
  };

  const openLabel = async (url: string | null | undefined) => {
    if (!url) { Alert.alert('No label yet', 'Purchase a label from the Rate Shop screen.'); return; }
    if (Platform.OS === 'web') { window.open(url, '_blank'); return; }
    await Linking.openURL(url);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Shipping Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.orange + '20' }]}>
          <Truck size={20} color={C.orange} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={orders.isFetching || shipments.isFetching} onRefresh={() => { void orders.refetch(); void shipments.refetch(); }} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.orange }]}>{queue.length}</Text><Text style={styles.statLabel}>To ship</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{shipList.length}</Text><Text style={styles.statLabel}>Shipments</Text></View>
        </View>

        <View style={styles.actionsRow}>
          <Button label="Rate Shop" size="sm" variant="secondary" onPress={() => router.push('/fulfillment/rate-shop')} />
          <Button label="Manifest" size="sm" variant="secondary" onPress={() => router.push('/fulfillment/manifest')} icon={<FileText size={13} color={C.text} />} />
          <Button label="Shipments" size="sm" variant="secondary" onPress={() => router.push('/fulfillment/shipments')} />
        </View>

        <Text style={styles.sectionTitle}>Ready to ship</Text>
        {queue.length === 0 ? (
          <EmptyState icon={Truck} title="No packed orders" description="Packed orders will appear here for label purchase." />
        ) : queue.map((o) => (
          <View key={o.id} style={styles.row}>
            <Truck size={14} color={C.orange} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.reference || o.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{o.ship_to || 'No address'}</Text>
            </View>
            <Button label="Mark shipped" size="sm" onPress={() => void onShip(o.id)} loading={busy === o.id} />
          </View>
        ))}

        <Text style={styles.sectionTitle}>Recent labels</Text>
        {shipList.length === 0 ? (
          <EmptyState icon={Tag} title="No shipments" />
        ) : shipList.slice(0, 20).map((s) => (
          <View key={s.id} style={styles.row}>
            <Tag size={14} color={C.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{s.tracking_code || s.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{s.carrier_code ?? 'Carrier'} · {s.status}</Text>
            </View>
            {s.label_url ? (
              <TouchableOpacity onPress={() => void openLabel(s.label_url)} style={styles.linkBtn}>
                <ExternalLink size={13} color={C.accent} />
              </TouchableOpacity>
            ) : null}
            <StatusBadge status={s.status} size="sm" />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerSimple: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBubble: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  body: { padding: 16, gap: 10 },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  actionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  linkBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
});
