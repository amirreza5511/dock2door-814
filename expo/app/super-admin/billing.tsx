import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, TouchableOpacity, RefreshControl, Modal, TextInput } from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, AlertCircle, CheckCircle2, X } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';

interface UnpaidInvoice {
  invoice_id: string;
  employer_company_id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number;
  currency: string;
  due_date: string | null;
}

interface PendingPayout {
  payable_id: string;
  worker_user_id: string;
  shift_title: string | null;
  shift_date: string | null;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  status: string;
  invoice_status: string | null;
  employer_name: string | null;
}

export default function SuperAdminBillingScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'invoices' | 'payouts'>('invoices');
  const [reasonModal, setReasonModal] = useState<{ kind: 'invoice' | 'payout'; id: string; amount: number } | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const unpaidQ = useQuery({
    queryKey: ['admin-unpaid-invoices'],
    queryFn: async (): Promise<UnpaidInvoice[]> => {
      const { data, error } = await supabase
        .from('employer_billing_overview')
        .select('*')
        .neq('status', 'Paid')
        .neq('status', 'Void')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as UnpaidInvoice[];
    },
    staleTime: 30_000,
  });

  const pendingQ = useQuery({
    queryKey: ['admin-pending-payouts'],
    queryFn: async (): Promise<PendingPayout[]> => {
      const { data, error } = await supabase
        .from('worker_earnings_overview')
        .select('*')
        .in('status', ['Pending', 'Approved'])
        .order('shift_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingPayout[];
    },
    staleTime: 30_000,
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!reasonModal) throw new Error('no target');
      const r = reason.trim();
      if (r.length < 10) throw new Error('Reason must be at least 10 characters');
      if (reasonModal.kind === 'invoice') {
        const { error } = await supabase.rpc('admin_mark_invoice_paid_manual', {
          p_invoice_id: reasonModal.id,
          p_reference: reference.trim(),
          p_reason: r,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('admin_mark_worker_payout_paid', {
          p_payable_id: reasonModal.id,
          p_reference: reference.trim(),
          p_reason: r,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-unpaid-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-pending-payouts'] });
      setReasonModal(null); setReason(''); setReference('');
    },
    onError: (e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Billing Oversight</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab('invoices')} style={[styles.tab, tab === 'invoices' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'invoices' && styles.tabTextActive]}>Unpaid invoices ({unpaidQ.data?.length ?? 0})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('payouts')} style={[styles.tab, tab === 'payouts' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'payouts' && styles.tabTextActive]}>Pending payouts ({pendingQ.data?.length ?? 0})</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={unpaidQ.isRefetching || pendingQ.isRefetching} onRefresh={() => { unpaidQ.refetch(); pendingQ.refetch(); }} tintColor={C.text} />}
      >
        {tab === 'invoices' ? (
          unpaidQ.isLoading ? (
            <ActivityIndicator color={C.accent} />
          ) : (unpaidQ.data ?? []).length === 0 ? (
            <Empty label="No unpaid invoices" />
          ) : (
            (unpaidQ.data ?? []).map((inv) => (
              <View key={inv.invoice_id} style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} color={C.textMuted} />
                  <Text style={styles.cardTitle}>{inv.invoice_number ?? inv.invoice_id.slice(0, 8)}</Text>
                </View>
                <Text style={styles.cardSub}>{inv.due_date ? `Due ${inv.due_date}` : '—'}</Text>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Total</Text>
                  <Text style={styles.cardValue}>${inv.total_amount.toFixed(2)} {inv.currency}</Text>
                </View>
                <TouchableOpacity onPress={() => setReasonModal({ kind: 'invoice', id: inv.invoice_id, amount: inv.total_amount })} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Mark paid manually</Text>
                </TouchableOpacity>
              </View>
            ))
          )
        ) : (
          pendingQ.isLoading ? (
            <ActivityIndicator color={C.accent} />
          ) : (pendingQ.data ?? []).length === 0 ? (
            <Empty label="No pending worker payouts" />
          ) : (
            (pendingQ.data ?? []).map((p) => {
              const canPay = p.invoice_status === 'Paid';
              return (
                <View key={p.payable_id} style={styles.card}>
                  <Text style={styles.cardTitle}>{p.shift_title ?? 'Shift'}</Text>
                  <Text style={styles.cardSub}>{p.employer_name ?? 'Employer'}{p.shift_date ? ` \u00b7 ${p.shift_date}` : ''}</Text>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>{p.confirmed_hours}h × ${p.hourly_rate}</Text>
                    <Text style={styles.cardValue}>${p.gross_pay.toFixed(2)}</Text>
                  </View>
                  <Text style={{ color: canPay ? C.green : C.yellow, fontSize: 11, marginTop: 6 }}>
                    Invoice: {p.invoice_status ?? 'not issued'}{canPay ? '' : ' — invoice must be paid first'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setReasonModal({ kind: 'payout', id: p.payable_id, amount: p.gross_pay })}
                    style={[styles.actionBtn, !canPay && styles.actionBtnDisabled]}
                    disabled={!canPay}
                  >
                    <Text style={[styles.actionBtnText, !canPay && { color: C.textMuted }]}>Mark payout paid</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )
        )}
      </ScrollView>

      <Modal visible={reasonModal !== null} transparent animationType="fade" onRequestClose={() => setReasonModal(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.modalTitle}>Mark {reasonModal?.kind === 'invoice' ? 'invoice' : 'payout'} paid</Text>
              <TouchableOpacity onPress={() => setReasonModal(null)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Amount: ${reasonModal?.amount?.toFixed(2)}</Text>
            <Text style={styles.modalLabel}>Reference (cheque #, transfer id, etc.)</Text>
            <TextInput value={reference} onChangeText={setReference} style={styles.modalInput} placeholder="e.g. cheque #1042" placeholderTextColor={C.textMuted} />
            <Text style={styles.modalLabel}>Reason / note (min 10 chars)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              style={[styles.modalInput, { height: 80 }]}
              multiline
              placeholder="Explain what was paid and how"
              placeholderTextColor={C.textMuted}
            />
            <TouchableOpacity
              onPress={() => markPaid.mutate()}
              disabled={markPaid.isPending || reason.trim().length < 10}
              style={[styles.modalSubmit, (markPaid.isPending || reason.trim().length < 10) && { opacity: 0.5 }]}
            >
              <CheckCircle2 size={14} color="#fff" />
              <Text style={styles.modalSubmitText}>{markPaid.isPending ? 'Submitting…' : 'Confirm'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
      <AlertCircle size={20} color={C.textMuted} />
      <Text style={{ color: C.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bg },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 17, fontWeight: '700' as const },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.bgSecondary, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent + '60' },
  tabText: { color: C.textMuted, fontSize: 12, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  card: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '700' as const },
  cardSub: { color: C.textMuted, fontSize: 11, marginTop: 2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardLabel: { color: C.textMuted, fontSize: 13 },
  cardValue: { color: C.text, fontSize: 16, fontWeight: '700' as const },
  actionBtn: { marginTop: 10, backgroundColor: C.accent, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  actionBtnDisabled: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' as const },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.bgSecondary, borderRadius: 14, padding: 18, gap: 8 },
  modalTitle: { color: C.text, fontSize: 16, fontWeight: '700' as const },
  modalSub: { color: C.textMuted, fontSize: 12 },
  modalLabel: { color: C.textMuted, fontSize: 11, marginTop: 8 },
  modalInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  modalSubmit: { marginTop: 12, backgroundColor: C.accent, paddingVertical: 11, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  modalSubmitText: { color: '#fff', fontWeight: '700' as const, fontSize: 14 },
});
