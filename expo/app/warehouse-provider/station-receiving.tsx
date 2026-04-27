import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { PackageOpen, ArrowLeft, CheckCircle2, AlertTriangle, History } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

interface ReceiptRow { id: string; reference?: string | null; status: string; supplier?: string | null; created_at: string }

export default function ReceivingStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'wms.receive');

  const receipts = trpc.wms.listReceipts.useQuery();
  const locations = trpc.wms.listLocations.useQuery();
  const receive = trpc.wms.receive.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listReceipts.invalidate(), utils.wms.listStockLevels.invalidate()]);
    },
  });

  const [variantId, setVariantId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [lot, setLot] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [receiptId, setReceiptId] = useState<string>('');

  const list = useMemo<ReceiptRow[]>(() => (receipts.data ?? []) as ReceiptRow[], [receipts.data]);
  const open = useMemo(() => list.filter((r) => r.status !== 'Completed'), [list]);
  const recent = useMemo(() => list.slice(0, 10), [list]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ title: 'Receiving' }} />
        <ScreenFeedback state="error" title="Not allowed" message={`Your role (${role ? ROLE_LABEL[role] : 'none'}) does not have wms.receive.`} />
        <View style={{ padding: 16 }}>
          <Button label="Back" onPress={() => router.back()} variant="secondary" />
        </View>
      </View>
    );
  }

  const submit = async () => {
    if (!variantId.trim() || !locationId.trim() || !qty.trim()) {
      Alert.alert('Missing info', 'Variant ID, location, and quantity are required.');
      return;
    }
    try {
      await receive.mutateAsync({
        receiptId: receiptId.trim() || undefined,
        variantId: variantId.trim(),
        locationId: locationId.trim(),
        quantity: Number(qty) || 0,
        lotCode: lot.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      Alert.alert('Received', `Logged by ${user?.name ?? user?.email ?? 'operator'}.`);
      setVariantId(''); setQty(''); setLot('');
    } catch (err) {
      Alert.alert('Receive failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back">
          <ArrowLeft size={18} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Receiving Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.green + '20' }]}>
          <PackageOpen size={20} color={C.green} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={receipts.isFetching} onRefresh={() => void receipts.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{open.length}</Text><Text style={styles.statLabel}>Open ASNs</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{list.length - open.length}</Text><Text style={styles.statLabel}>Completed</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: receive.isError ? C.red : C.text }]}>{receive.data ? '1' : '0'}</Text><Text style={styles.statLabel}>Last submit</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Open ASNs</Text>
        {open.length === 0 ? (
          <EmptyState icon={PackageOpen} title="No open receipts" description="ASNs will appear here when scheduled." />
        ) : open.map((r) => (
          <TouchableOpacity key={r.id} onPress={() => { setReceiptId(r.id); setReference(r.reference ?? ''); }} style={[styles.row, receiptId === r.id && styles.rowActive]}>
            <PackageOpen size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.reference || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{r.supplier ?? 'Unknown supplier'} · {new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Receive line</Text>
        <View style={styles.card}>
          <Input label="Receipt / ASN id" value={receiptId} onChangeText={setReceiptId} placeholder="optional" />
          <Input label="Variant / SKU id" value={variantId} onChangeText={setVariantId} placeholder="variant_…" />
          <Input label="Location id" value={locationId} onChangeText={setLocationId} placeholder="location_…" />
          {(locations.data ?? []).length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {(locations.data as { id: string; label?: string; zone?: string }[]).slice(0, 12).map((l) => (
                <TouchableOpacity key={l.id} onPress={() => setLocationId(l.id)} style={[styles.chip, locationId === l.id && styles.chipActive]}>
                  <Text style={[styles.chipText, locationId === l.id && styles.chipTextActive]}>{l.label || l.zone || l.id.slice(0, 6)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="48" />
          <Input label="Lot / batch" value={lot} onChangeText={setLot} placeholder="LOT-2026-04" autoCapitalize="characters" />
          <Input label="Reference" value={reference} onChangeText={setReference} placeholder="Supplier note" />
          <Button label="Receive & putaway" onPress={() => void submit()} loading={receive.isPending} fullWidth icon={<CheckCircle2 size={15} color={C.white} />} />
          {receive.error ? (
            <View style={styles.errBox}>
              <AlertTriangle size={13} color={C.red} />
              <Text style={styles.errText}>{receive.error.message}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}><History size={11} color={C.textSecondary} /> Recent receipts</Text>
        {recent.length === 0 ? (
          <EmptyState icon={History} title="No history yet" description="Your station's recent receipts will show here." />
        ) : recent.map((r) => (
          <View key={r.id} style={styles.row}>
            <PackageOpen size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.reference || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{new Date(r.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
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
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  chipRow: { gap: 6, paddingVertical: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 11, fontWeight: '700' as const, color: C.textSecondary },
  chipTextActive: { color: C.accent },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: C.red + '15', borderRadius: 8, borderWidth: 1, borderColor: C.red },
  errText: { flex: 1, fontSize: 11, color: C.red },
});
