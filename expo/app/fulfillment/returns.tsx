import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Alert, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Undo2, ArrowLeft, Plus, FileText } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface ReturnRow {
  id: string;
  order_id: string;
  rma_number?: string | null;
  reason: string;
  status: string;
  created_at: string;
}

interface OrderRow { id: string; reference_code?: string; reference?: string }

export default function ReturnsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const listQuery = trpc.returns.list.useQuery();
  const orders = trpc.fulfillment.listMyOrders.useQuery();
  const requestMut = trpc.returns.request.useMutation({
    onSuccess: async () => { await utils.returns.list.invalidate(); },
  });

  const [showForm, setShowForm] = useState<boolean>(false);
  const [orderId, setOrderId] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const rmas = useMemo<ReturnRow[]>(() => (listQuery.data ?? []) as ReturnRow[], [listQuery.data]);
  const availableOrders = useMemo<OrderRow[]>(() => ((orders.data as { orders?: OrderRow[] })?.orders ?? []).filter((o) => true) as OrderRow[], [orders.data]);

  const onSubmit = async () => {
    if (!orderId || !reason.trim()) {
      Alert.alert('Missing info', 'Please pick an order and enter a reason.');
      return;
    }
    try {
      await requestMut.mutateAsync({ orderId, reason: reason.trim() });
      setShowForm(false);
      setOrderId('');
      setReason('');
      Alert.alert('Return requested', 'Your RMA has been created.');
    } catch (error) {
      Alert.alert('Unable to request return', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (listQuery.isLoading) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading returns" /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Returns / RMA</Text>
          <Text style={styles.sub}>{rmas.length} on file</Text>
        </View>
        <TouchableOpacity onPress={() => setShowForm(true)} style={styles.addBtn}><Plus size={18} color={C.white} /></TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} tintColor={C.accent} />}
      >
        {rmas.length === 0 ? (
          <EmptyState icon={Undo2} title="No returns" description="Request a return from a completed order." />
        ) : rmas.map((r) => (
          <Card key={r.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: C.yellowDim }]}><FileText size={15} color={C.yellow} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{r.rma_number || `RMA ${r.id.slice(0, 8)}`}</Text>
                <Text style={styles.cardMeta}>Order {r.order_id.slice(0, 8)} · {new Date(r.created_at).toLocaleDateString()}</Text>
                {r.reason ? <Text style={styles.reason}>{r.reason}</Text> : null}
              </View>
              <StatusBadge status={r.status} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitle}>Request Return</Text>
            <Text style={styles.sectionLabel}>Order</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {availableOrders.map((o) => (
                <TouchableOpacity key={o.id} onPress={() => setOrderId(o.id)} style={[styles.chip, orderId === o.id && styles.chipActive]}>
                  <Text style={[styles.chipText, orderId === o.id && styles.chipTextActive]}>{o.reference_code ?? o.reference ?? o.id.slice(0, 8)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Input label="Reason *" value={reason} onChangeText={setReason} multiline numberOfLines={4} placeholder="Describe the issue" />
            <Button label="Submit RMA" onPress={() => void onSubmit()} loading={requestMut.isPending} fullWidth size="lg" />
            <Button label="Cancel" onPress={() => setShowForm(false)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  card: { padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  reason: { fontSize: 12, color: C.textSecondary, marginTop: 6 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sectionLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginRight: 8 },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
});
