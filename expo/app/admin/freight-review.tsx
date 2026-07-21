import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShipWheel, Check, X, FileText, Package } from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { FREIGHT_MODE_LABEL, DELIVERY_METHOD_LABEL, type FreightMode, type DeliveryMethod } from '@/constants/globalFreight';
import { formatMoney } from '@/constants/world';
import ScreenFeedback from '@/components/ui/ScreenFeedback';

type AdminFreight = {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; dest_country: string; dest_city: string;
  weight: number; weight_unit: string; pieces: number;
  commodity: string; declared_value: number; currency: string;
  delivery_method: string; needs_container_pickup: boolean;
  status: string; customer_name: string; doc_count: number; created_at: string;
};

export default function AdminFreightReview() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const listQuery = trpc.freight.adminList.useQuery({ scope });
  const rows = (listQuery.data ?? []) as AdminFreight[];

  const approveMutation = trpc.freight.approve.useMutation();
  const rejectMutation = trpc.freight.reject.useMutation();

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('');

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'PendingReview').length, [rows]);

  const refresh = useCallback(async () => {
    await utils.freight.adminList.invalidate();
  }, [utils]);

  const handleApprove = useCallback(async (id: string) => {
    try {
      await approveMutation.mutateAsync({ quoteId: id });
      await refresh();
    } catch (e) {
      Alert.alert('Could not approve', e instanceof Error ? e.message : 'Try again.');
    }
  }, [approveMutation, refresh]);

  const submitReject = useCallback(async () => {
    if (!rejectId) return;
    try {
      await rejectMutation.mutateAsync({ quoteId: rejectId, reason: reason.trim() });
      setRejectId(null);
      setReason('');
      await refresh();
    } catch (e) {
      Alert.alert('Could not reject', e instanceof Error ? e.message : 'Try again.');
    }
  }, [rejectId, reason, rejectMutation, refresh]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.brandRow}>
          <ShipWheel size={22} color={C.red} />
          <Text style={styles.title}>Freight review</Text>
          {pendingCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{pendingCount}</Text></View> : null}
        </View>
        <View style={styles.tabs}>
          {(['pending', 'all'] as const).map((s) => (
            <TouchableOpacity key={s} onPress={() => setScope(s)} style={[styles.tab, scope === s && styles.tabActive]}>
              <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === 'pending' ? 'Pending' : 'All'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {listQuery.isLoading ? (
        <ScreenFeedback state="loading" title="Loading review queue" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={<RefreshControl refreshing={listQuery.isRefetching} onRefresh={() => void listQuery.refetch()} tintColor={C.textSecondary} />}
        >
          {rows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Package size={28} color={C.textMuted} />
              <Text style={styles.emptyTitle}>Nothing to review</Text>
              <Text style={styles.emptyDesc}>New freight requests appear here for approval.</Text>
            </View>
          ) : (
            rows.map((r) => {
              const isPending = r.status === 'PendingReview';
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.ref}>{r.reference_code}</Text>
                    <Text style={[styles.statusText, isPending ? { color: C.yellow } : { color: C.textMuted }]}>{r.status}</Text>
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.customer}>{r.customer_name}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{FREIGHT_MODE_LABEL[r.freight_mode]}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.meta}>{r.origin_city || r.origin_country} → {r.dest_city || r.dest_country}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{r.weight} {r.weight_unit} · {r.pieces} pcs</Text>
                    {r.declared_value ? <><Text style={styles.metaDot}>·</Text><Text style={styles.meta}>{formatMoney(r.declared_value, r.currency)}</Text></> : null}
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{DELIVERY_METHOD_LABEL[r.delivery_method as DeliveryMethod]}</Text>
                    {r.needs_container_pickup ? <><Text style={styles.metaDot}>·</Text><Text style={[styles.meta, { color: C.blue }]}>+ drayage</Text></> : null}
                    {r.doc_count > 0 ? <><Text style={styles.metaDot}>·</Text><View style={styles.docChip}><FileText size={12} color={C.textSecondary} /><Text style={styles.meta}>{r.doc_count}</Text></View></> : null}
                  </View>

                  {isPending ? (
                    <View style={styles.actions}>
                      <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => { setRejectId(r.id); setReason(''); }}>
                        <X size={16} color={C.red} /><Text style={[styles.actionText, { color: C.red }]}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => void handleApprove(r.id)}>
                        <Check size={16} color={C.white} /><Text style={[styles.actionText, { color: C.white }]}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={!!rejectId} transparent animationType="fade" onRequestClose={() => setRejectId(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject request</Text>
            <Text style={styles.modalDesc}>Tell the customer what to fix (optional).</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason for rejection"
              placeholderTextColor={C.textMuted}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setRejectId(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalConfirm]} onPress={() => void submitReject()} disabled={rejectMutation.isPending}>
                {rejectMutation.isPending ? <ActivityIndicator color={C.white} /> : <Text style={styles.modalConfirmText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary, gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  badge: { backgroundColor: C.yellow, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '800' as const, color: C.bg },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.redDim, borderColor: C.red },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  tabTextActive: { color: C.red },
  scroll: { padding: 16, gap: 12 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 30, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  card: { gap: 6, padding: 16, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.5 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  customer: { fontSize: 13, color: C.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 13, color: C.textSecondary },
  metaDot: { fontSize: 13, color: C.textMuted },
  docChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  rejectBtn: { backgroundColor: C.redDim, borderColor: C.red },
  approveBtn: { backgroundColor: C.green, borderColor: C.green },
  actionText: { fontSize: 14, fontWeight: '700' as const },
  modalRoot: { flex: 1, backgroundColor: C.overlay, justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: C.cardElevated, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalDesc: { fontSize: 13, color: C.textSecondary },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, color: C.text, minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12 },
  modalCancel: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modalCancelText: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary },
  modalConfirm: { backgroundColor: C.red },
  modalConfirmText: { fontSize: 14, fontWeight: '700' as const, color: C.white },
});
