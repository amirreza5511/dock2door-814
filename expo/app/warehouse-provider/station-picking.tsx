import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, ListChecks, CheckCircle2, AlertTriangle, History } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

interface OrderRow { id: string; reference?: string | null; ship_to?: string | null; status: string; created_at: string }

export default function PickingStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'orders.pick');

  const orders = trpc.fulfillment.listMyOrders.useQuery();
  const pick = trpc.fulfillment.pickOrder.useMutation({
    onSuccess: async () => { await utils.fulfillment.listMyOrders.invalidate(); },
  });
  const [picking, setPicking] = useState<string | null>(null);

  const list = useMemo<OrderRow[]>(() => (orders.data ?? []) as OrderRow[], [orders.data]);
  const queue = useMemo(() => list.filter((o) => ['New', 'Allocated', 'Pending'].includes(o.status)), [list]);
  const inProgress = useMemo(() => list.filter((o) => o.status === 'Picking'), [list]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerSimple, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
          <Text style={styles.title}>Picking Station</Text>
        </View>
        <View style={{ padding: 24 }}>
          <EmptyState icon={AlertTriangle} title="Not allowed" description={`Your role (${role ? ROLE_LABEL[role] : 'none'}) does not have orders.pick.`} />
        </View>
      </View>
    );
  }

  const onPick = async (id: string) => {
    setPicking(id);
    try {
      await pick.mutateAsync({ orderId: id });
      Alert.alert('Picked', `${id.slice(0, 8)} moved to Picking by ${user?.name ?? user?.email}.`);
    } catch (err) {
      Alert.alert('Pick failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPicking(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Picking Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.blue + '20' }]}>
          <ListChecks size={20} color={C.blue} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={orders.isFetching} onRefresh={() => void orders.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.blue }]}>{queue.length}</Text><Text style={styles.statLabel}>Wave queue</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{inProgress.length}</Text><Text style={styles.statLabel}>Picking now</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{list.length}</Text><Text style={styles.statLabel}>Total today</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Pick queue</Text>
        {queue.length === 0 ? (
          <EmptyState icon={ListChecks} title="Queue empty" description="No allocated orders waiting to be picked." />
        ) : queue.map((o) => (
          <View key={o.id} style={styles.row}>
            <ListChecks size={14} color={C.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.reference || o.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{o.ship_to || 'No address'} · {new Date(o.created_at).toLocaleString()}</Text>
            </View>
            <Button label="Pick" size="sm" onPress={() => void onPick(o.id)} loading={picking === o.id} icon={<CheckCircle2 size={13} color={C.white} />} />
          </View>
        ))}

        <Text style={styles.sectionTitle}>In progress</Text>
        {inProgress.length === 0 ? (
          <EmptyState icon={History} title="None active" description="Picked-but-not-packed orders show here." />
        ) : inProgress.map((o) => (
          <View key={o.id} style={styles.row}>
            <ListChecks size={14} color={C.orange} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.reference || o.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>Awaiting packer · {new Date(o.created_at).toLocaleTimeString()}</Text>
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
