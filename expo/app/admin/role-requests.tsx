import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Alert, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, CheckCircle, XCircle, RefreshCw, Building2 } from 'lucide-react-native';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { ROLE_LABEL } from '@/lib/relationships';
import type { UserRole } from '@/constants/types';

interface RoleRequest {
  id: string; company_id: string; company_name: string; company_type: string;
  requested_role: string; note: string; status: string; created_at: string;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function AdminRoleRequestsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [reject, setReject] = useState<RoleRequest | null>(null);
  const [reason, setReason] = useState('');

  const q = useQuery({
    queryKey: ['admin-role-requests'],
    queryFn: async (): Promise<RoleRequest[]> => {
      const { data, error } = await supabase.rpc('list_role_requests', { p_status: 'Pending' });
      if (error) throw new Error(error.message);
      return (data ?? []) as RoleRequest[];
    },
    staleTime: 30_000,
  });

  const reviewMut = useMutation({
    mutationFn: async ({ id, approve, r }: { id: string; approve: boolean; r?: string }) => {
      const { error } = await supabase.rpc('admin_review_role_request', {
        p_request_id: id, p_approve: approve, p_reason: r ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-role-requests'] });
      setReject(null); setReason('');
    },
    onError: (e: Error) => {
      if (Platform.OS === 'web') window.alert(e.message); else Alert.alert('Action failed', e.message);
    },
  });

  const items = q.data ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Layers size={20} color={C.red} />
          <Text style={styles.headerTitle}>Role Requests</Text>
          {items.length > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{items.length}</Text></View>}
        </View>
        <TouchableOpacity onPress={() => void q.refetch()} disabled={q.isFetching} style={styles.refreshBtn}>
          <RefreshCw size={18} color={q.isFetching ? C.textMuted : C.red} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} tintColor={C.red} />}
      >
        {q.isLoading ? (
          <ActivityIndicator color={C.red} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Layers size={26} color={C.textMuted} /></View>
            <Text style={styles.emptyTitle}>No pending role requests</Text>
            <View style={styles.clearRow}>
              <CheckCircle size={13} color={C.green} />
              <Text style={styles.clearText}>All clear</Text>
            </View>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((it) => (
              <Card key={it.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Building2 size={16} color={C.textSecondary} />
                  <Text style={styles.companyName}>{it.company_name}</Text>
                </View>
                <Text style={styles.meta}>
                  {ROLE_LABEL[it.company_type as UserRole] ?? it.company_type} wants to add{' '}
                  <Text style={styles.roleName}>{ROLE_LABEL[it.requested_role as UserRole] ?? it.requested_role}</Text>
                  {'\n'}Requested {fmtDate(it.created_at)}
                </Text>
                {it.note ? <Text style={styles.note}>“{it.note}”</Text> : null}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    disabled={reviewMut.isPending}
                    onPress={() => { setReject(it); setReason(''); }}
                  >
                    <XCircle size={13} color={C.red} />
                    <Text style={[styles.actionText, { color: C.red }]}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    disabled={reviewMut.isPending}
                    onPress={() => reviewMut.mutate({ id: it.id, approve: true })}
                  >
                    <CheckCircle size={13} color={C.white} />
                    <Text style={[styles.actionText, { color: C.white }]}>Approve</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={reject !== null} transparent animationType="fade" onRequestClose={() => setReject(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              Reject {ROLE_LABEL[reject?.requested_role as UserRole] ?? reject?.requested_role} for {reject?.company_name}
            </Text>
            <Text style={styles.sheetLabel}>Reason (required)</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Explain why…"
              placeholderTextColor={C.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.sheetBtns}>
              <TouchableOpacity onPress={() => setReject(null)} style={[styles.sheetBtn, styles.cancelBtn]}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => reject && reviewMut.mutate({ id: reject.id, approve: false, r: reason.trim() })}
                disabled={reviewMut.isPending || !reason.trim()}
                style={[styles.sheetBtn, styles.confirmBtn, (reviewMut.isPending || !reason.trim()) && { opacity: 0.5 }]}
              >
                {reviewMut.isPending ? <ActivityIndicator size="small" color={C.white} /> : <Text style={styles.confirmText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700' as const, color: C.text },
  badge: { backgroundColor: C.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.white },
  refreshBtn: { padding: 6 },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  list: { gap: 10 },
  card: { padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  companyName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  meta: { fontSize: 12, color: C.textSecondary, lineHeight: 18, marginBottom: 8 },
  roleName: { color: C.text, fontWeight: '700' as const },
  note: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' as const, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 8 },
  rejectBtn: { borderWidth: 1, borderColor: C.red + '66', backgroundColor: C.redDim },
  approveBtn: { backgroundColor: C.green },
  actionText: { fontSize: 13, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600' as const, color: C.text },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { fontSize: 12, color: C.green },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { backgroundColor: C.bgSecondary, borderRadius: 16, padding: 22, width: '100%', maxWidth: 420 },
  sheetTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 14 },
  sheetLabel: { fontSize: 13, color: C.textSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, color: C.text, backgroundColor: C.bg, minHeight: 80, textAlignVertical: 'top', fontSize: 14 },
  sheetBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: C.border },
  cancelText: { color: C.text, fontWeight: '600' as const },
  confirmBtn: { backgroundColor: C.red },
  confirmText: { color: C.white, fontWeight: '700' as const },
});
