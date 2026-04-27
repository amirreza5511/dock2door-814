import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Archive, ClipboardCheck, Move, AlertTriangle } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

type Mode = 'count' | 'transfer';

export default function InventoryStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'wms.cycleCount') || can(role, 'wms.transfer');

  const stock = trpc.wms.listStockLevels.useQuery();
  const counts = trpc.wms.listCycleCounts.useQuery();
  const adjust = trpc.wms.adjust.useMutation({
    onSuccess: async () => { await Promise.all([utils.wms.listStockLevels.invalidate(), utils.wms.listCycleCounts.invalidate()]); },
  });

  const [mode, setMode] = useState<Mode>('count');
  const [variantId, setVariantId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [systemQty, setSystemQty] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [reason, setReason] = useState('');
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [qty, setQty] = useState('');

  const stockList = useMemo(() => (stock.data ?? []) as { id: string; on_hand: number; reserved: number; product_variants?: { sku?: string } | null }[], [stock.data]);
  const countList = useMemo(() => (counts.data ?? []) as { id: string; status: string; variance?: number | null; created_at: string }[], [counts.data]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerSimple, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
          <Text style={styles.title}>Inventory Station</Text>
        </View>
        <View style={{ padding: 24 }}>
          <EmptyState icon={AlertTriangle} title="Not allowed" description={`Your role (${role ? ROLE_LABEL[role] : 'none'}) lacks wms.cycleCount/wms.transfer.`} />
        </View>
      </View>
    );
  }

  const submitCount = async () => {
    if (!variantId.trim() || !locationId.trim() || !countedQty || !systemQty) { Alert.alert('Missing info'); return; }
    const delta = Number(countedQty) - Number(systemQty);
    if (delta !== 0 && !reason.trim()) { Alert.alert('Reason required for variance'); return; }
    try {
      if (delta !== 0) {
        await adjust.mutateAsync({ variantId: variantId.trim(), locationId: locationId.trim(), delta, reason: `cycle_count:${reason.trim() || 'variance'}` });
      }
      Alert.alert('Count logged', delta === 0 ? 'Match.' : `Adjusted ${delta > 0 ? '+' : ''}${delta}.`);
      setVariantId(''); setLocationId(''); setCountedQty(''); setSystemQty(''); setReason('');
    } catch (err) { Alert.alert('Count failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  const submitTransfer = async () => {
    const n = Number(qty);
    if (!variantId.trim() || !fromLoc.trim() || !toLoc.trim() || n <= 0) { Alert.alert('Missing info'); return; }
    try {
      await adjust.mutateAsync({ variantId: variantId.trim(), locationId: fromLoc.trim(), delta: -n, reason: `transfer_out:${toLoc.trim()}` });
      await adjust.mutateAsync({ variantId: variantId.trim(), locationId: toLoc.trim(), delta: n, reason: `transfer_in:${fromLoc.trim()}` });
      Alert.alert('Transferred', `${n} units moved.`);
      setVariantId(''); setFromLoc(''); setToLoc(''); setQty('');
    } catch (err) { Alert.alert('Transfer failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Inventory Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.accent + '20' }]}>
          <Archive size={20} color={C.accent} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={stock.isFetching || counts.isFetching} onRefresh={() => { void stock.refetch(); void counts.refetch(); }} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{stockList.length}</Text><Text style={styles.statLabel}>SKU·Loc rows</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: countList.some((c) => Math.abs(Number(c.variance ?? 0)) > 0) ? C.red : C.green }]}>{countList.filter((c) => Math.abs(Number(c.variance ?? 0)) > 0).length}</Text><Text style={styles.statLabel}>Variances</Text></View>
        </View>

        <View style={styles.tabs}>
          {(['count', 'transfer'] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && styles.tabActive]}>
              {m === 'count' ? <ClipboardCheck size={13} color={mode === m ? C.accent : C.textMuted} /> : <Move size={13} color={mode === m ? C.accent : C.textMuted} />}
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m === 'count' ? 'Cycle count' : 'Transfer'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'count' ? (
          <View style={styles.card}>
            <Input label="Variant / SKU" value={variantId} onChangeText={setVariantId} />
            <Input label="Location" value={locationId} onChangeText={setLocationId} />
            <Input label="System qty" value={systemQty} onChangeText={setSystemQty} keyboardType="numeric" />
            <Input label="Counted qty" value={countedQty} onChangeText={setCountedQty} keyboardType="numeric" />
            <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Required if variance" multiline numberOfLines={2} />
            <Button label="Submit count" onPress={() => void submitCount()} loading={adjust.isPending} fullWidth icon={<ClipboardCheck size={15} color={C.white} />} />
          </View>
        ) : (
          <View style={styles.card}>
            <Input label="Variant / SKU" value={variantId} onChangeText={setVariantId} />
            <Input label="From location" value={fromLoc} onChangeText={setFromLoc} />
            <Input label="To location" value={toLoc} onChangeText={setToLoc} />
            <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" />
            <Button label="Transfer" onPress={() => void submitTransfer()} loading={adjust.isPending} fullWidth icon={<Move size={15} color={C.white} />} />
          </View>
        )}

        <Text style={styles.sectionTitle}>Recent counts</Text>
        {countList.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No counts yet" />
        ) : countList.slice(0, 15).map((c) => (
          <View key={c.id} style={styles.row}>
            <ClipboardCheck size={14} color={Math.abs(Number(c.variance ?? 0)) > 0 ? C.red : C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Count {c.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>Variance {c.variance ?? 0} · {new Date(c.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={c.status} size="sm" />
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
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  tabTextActive: { color: C.accent },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
