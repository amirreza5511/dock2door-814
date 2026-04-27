import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Package, CheckCircle2, AlertTriangle, Printer } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

interface OrderRow { id: string; reference?: string | null; ship_to?: string | null; status: string; created_at: string }

export default function PackingStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'orders.pack');

  const orders = trpc.fulfillment.listMyOrders.useQuery();
  const pack = trpc.fulfillment.packOrder.useMutation({
    onSuccess: async () => { await utils.fulfillment.listMyOrders.invalidate(); },
  });
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo<OrderRow[]>(() => (orders.data ?? []) as OrderRow[], [orders.data]);
  const queue = useMemo(() => list.filter((o) => o.status === 'Picking'), [list]);
  const packed = useMemo(() => list.filter((o) => o.status === 'Packed'), [list]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerSimple, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
          <Text style={styles.title}>Packing Station</Text>
        </View>
        <View style={{ padding: 24 }}>
          <EmptyState icon={AlertTriangle} title="Not allowed" description={`Your role (${role ? ROLE_LABEL[role] : 'none'}) does not have orders.pack.`} />
        </View>
      </View>
    );
  }

  const onPack = async (id: string) => {
    setBusy(id);
    try {
      await pack.mutateAsync({ orderId: id });
      Alert.alert('Packed', `${id.slice(0, 8)} ready for shipping.`);
    } catch (err) {
      Alert.alert('Pack failed', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Packing Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.purple + '20' }]}>
          <Package size={20} color={C.purple} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={orders.isFetching} onRefresh={() => void orders.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.purple }]}>{queue.length}</Text><Text style={styles.statLabel}>To pack</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.green }]}>{packed.length}</Text><Text style={styles.statLabel}>Packed</Text></View>
        </View>

        <Text style={styles.sectionTitle}>To pack</Text>
        {queue.length === 0 ? (
          <EmptyState icon={Package} title="Nothing waiting" description="Picked orders will appear here for pack-out." />
        ) : queue.map((o) => (
          <View key={o.id} style={styles.row}>
            <Package size={14} color={C.purple} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.reference || o.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{o.ship_to || 'No address'}</Text>
            </View>
            <Button label="Pack" size="sm" onPress={() => void onPack(o.id)} loading={busy === o.id} icon={<CheckCircle2 size={13} color={C.white} />} />
          </View>
        ))}

        <Text style={styles.sectionTitle}>Packed (awaiting shipping)</Text>
        {packed.length === 0 ? (
          <EmptyState icon={Printer} title="No packed orders" />
        ) : packed.map((o) => (
          <View key={o.id} style={styles.row}>
            <Printer size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.reference || o.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>Sent to shipping queue</Text>
            </View>
            <StatusBadge status={o.status} size="sm" />
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
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
