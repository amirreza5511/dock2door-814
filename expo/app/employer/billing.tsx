import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, TouchableOpacity, RefreshControl, Linking, Platform, TextInput } from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, CheckCircle2, Clock, AlertCircle, CreditCard, Edit3 } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface InvoiceRow {
  invoice_id: string;
  employer_company_id: string;
  invoice_number: string | null;
  status: string;
  subtotal_amount: number;
  total_amount: number;
  currency: string;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

interface CompanyBilling {
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  billing_mode: 'ManualInvoice' | 'CardOnFile' | 'StripeCheckout' | null;
  payment_terms_days: number | null;
  billing_setup_completed_at: string | null;
}

export default function EmployerBillingScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const companyQ = useQuery({
    queryKey: ['employer-billing-company', user?.companyId],
    enabled: Boolean(user?.companyId),
    queryFn: async (): Promise<CompanyBilling | null> => {
      const { data, error } = await supabase
        .from('companies')
        .select('billing_contact_name,billing_email,billing_phone,billing_address,billing_mode,payment_terms_days,billing_setup_completed_at')
        .eq('id', user!.companyId!)
        .maybeSingle();
      if (error) throw error;
      return data as CompanyBilling | null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [mode, setMode] = useState<'ManualInvoice' | 'CardOnFile' | 'StripeCheckout'>('ManualInvoice');
  const [terms, setTerms] = useState('14');

  useEffect(() => {
    const c = companyQ.data;
    if (!c) return;
    setName(c.billing_contact_name ?? '');
    setEmail(c.billing_email ?? '');
    setPhone(c.billing_phone ?? '');
    setAddress(c.billing_address ?? '');
    setMode((c.billing_mode ?? 'ManualInvoice'));
    setTerms(String(c.payment_terms_days ?? 14));
  }, [companyQ.data]);

  const saveSetup = useMutation({
    mutationFn: async () => {
      if (!user?.companyId) throw new Error('No company');
      if (name.trim().length < 2) throw new Error('Billing contact name required');
      if (!/.+@.+\..+/.test(email.trim())) throw new Error('Valid billing email required');
      const { error } = await supabase.rpc('company_update_billing', {
        p_company_id: user.companyId,
        p_contact_name: name.trim(),
        p_email: email.trim(),
        p_phone: phone.trim() || null,
        p_address: address.trim() || null,
        p_billing_mode: mode,
        p_payment_terms_days: Math.max(0, Math.min(90, Number(terms) || 14)),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employer-billing-company', user?.companyId] });
      qc.invalidateQueries({ queryKey: ['company-billing', user?.companyId] });
      qc.invalidateQueries({ queryKey: ['company-billing-status', user?.companyId] });
      setEditing(false);
    },
    onError: (e: unknown) => Alert.alert('Unable to save', e instanceof Error ? e.message : 'Unknown error'),
  });

  const setup = Boolean(companyQ.data?.billing_setup_completed_at);

  const invoicesQ = useQuery({
    queryKey: ['employer-invoices', user?.companyId],
    queryFn: async (): Promise<InvoiceRow[]> => {
      if (!user?.companyId) return [];
      const { data, error } = await supabase
        .from('employer_billing_overview')
        .select('*')
        .eq('employer_company_id', user.companyId)
        .order('issued_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoiceRow[];
    },
    enabled: Boolean(user?.companyId),
    staleTime: 30_000,
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('No checkout URL returned');
      if (Platform.OS === 'web') window.open(url, '_blank');
      else await Linking.openURL(url);
    },
    onError: (err: unknown) => {
      Alert.alert('Unable to start checkout', err instanceof Error ? err.message : 'Unknown error');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employer-invoices', user?.companyId] });
    },
  });

  const unpaid = (invoicesQ.data ?? []).filter((i) => i.status !== 'Paid' && i.status !== 'Void');
  const unpaidTotal = unpaid.reduce((s, i) => s + i.total_amount, 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Billing & Invoices</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={invoicesQ.isRefetching} onRefresh={() => invoicesQ.refetch()} tintColor={C.text} />}
      >
        {/* Billing setup */}
        <View style={[styles.setupCard, { backgroundColor: setup ? C.greenDim : C.yellowDim, borderColor: (setup ? C.green : C.yellow) + '50' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.setupTitle, { color: setup ? C.green : C.yellow }]}>
              {setup ? 'Billing set up' : 'Billing not set up'}
            </Text>
            {!editing && (
              <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn}>
                <Edit3 size={12} color={setup ? C.green : C.yellow} />
                <Text style={[styles.editBtnText, { color: setup ? C.green : C.yellow }]}>
                  {setup ? 'Edit' : 'Set up'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {!editing ? (
            setup && companyQ.data ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                <Text style={styles.setupRow}>Contact: <Text style={{ color: C.text }}>{companyQ.data.billing_contact_name}</Text></Text>
                <Text style={styles.setupRow}>Email: <Text style={{ color: C.text }}>{companyQ.data.billing_email}</Text></Text>
                {companyQ.data.billing_phone ? <Text style={styles.setupRow}>Phone: <Text style={{ color: C.text }}>{companyQ.data.billing_phone}</Text></Text> : null}
                <Text style={styles.setupRow}>Mode: <Text style={{ color: C.text }}>{companyQ.data.billing_mode}</Text> · Net {companyQ.data.payment_terms_days ?? 14} days</Text>
              </View>
            ) : (
              <Text style={[styles.setupRow, { marginTop: 6 }]}>Required before posting paid shifts. Invoices for confirmed hours will be sent to this contact.</Text>
            )
          ) : (
            <View style={{ marginTop: 10, gap: 8 }}>
              <TextInput value={name} onChangeText={setName} placeholder="Billing contact name *" placeholderTextColor={C.textMuted} style={styles.setupInput} />
              <TextInput value={email} onChangeText={setEmail} placeholder="Billing email *" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" style={styles.setupInput} />
              <TextInput value={phone} onChangeText={setPhone} placeholder="Phone (optional)" placeholderTextColor={C.textMuted} keyboardType="phone-pad" style={styles.setupInput} />
              <TextInput value={address} onChangeText={setAddress} placeholder="Billing address (optional)" placeholderTextColor={C.textMuted} style={styles.setupInput} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['ManualInvoice', 'StripeCheckout', 'CardOnFile'] as const).map((m) => (
                  <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeChip, mode === m && styles.modeChipActive]}>
                    <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{m === 'ManualInvoice' ? 'Manual' : m === 'StripeCheckout' ? 'Stripe' : 'Card on file'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput value={terms} onChangeText={(v) => setTerms(v.replace(/[^0-9]/g, ''))} placeholder="Payment terms (days)" placeholderTextColor={C.textMuted} keyboardType="numeric" style={styles.setupInput} />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity onPress={() => saveSetup.mutate()} disabled={saveSetup.isPending} style={[styles.saveBtn, saveSetup.isPending && { opacity: 0.6 }]}>
                  <Text style={styles.saveBtnText}>{saveSetup.isPending ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditing(false)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.summary, { backgroundColor: unpaid.length > 0 ? C.yellowDim : C.greenDim, borderColor: (unpaid.length > 0 ? C.yellow : C.green) + '40' }]}>
          <Text style={[styles.summaryLabel, { color: unpaid.length > 0 ? C.yellow : C.green }]}>{unpaid.length > 0 ? 'Outstanding balance' : 'All caught up'}</Text>
          <Text style={[styles.summaryValue, { color: unpaid.length > 0 ? C.yellow : C.green }]}>${unpaidTotal.toFixed(2)}</Text>
          <Text style={[styles.summarySub, { color: (unpaid.length > 0 ? C.yellow : C.green) + 'cc' }]}>{unpaid.length} unpaid invoice{unpaid.length === 1 ? '' : 's'}</Text>
        </View>

        {invoicesQ.isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>
        ) : (invoicesQ.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <AlertCircle size={20} color={C.textMuted} />
            <Text style={styles.emptyText}>No invoices yet. Invoices are generated when you confirm worker hours after a shift.</Text>
          </View>
        ) : (
          (invoicesQ.data ?? []).map((inv) => (
            <View key={inv.invoice_id} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} color={C.textMuted} />
                    <Text style={styles.cardTitle}>{inv.invoice_number ?? 'Invoice'}</Text>
                  </View>
                  <Text style={styles.cardSub}>
                    {inv.issued_at ? `Issued ${new Date(inv.issued_at).toLocaleDateString()}` : 'Draft'}
                    {inv.due_date ? ` \u00b7 Due ${inv.due_date}` : ''}
                  </Text>
                </View>
                <StatusPill status={inv.status} />
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Total</Text>
                <Text style={styles.cardValue}>${inv.total_amount.toFixed(2)} {inv.currency}</Text>
              </View>
              {inv.status !== 'Paid' && inv.status !== 'Void' ? (
                <TouchableOpacity
                  onPress={() => payMutation.mutate(inv.invoice_id)}
                  disabled={payMutation.isPending}
                  style={[styles.payBtn, payMutation.isPending && { opacity: 0.6 }]}
                >
                  <CreditCard size={14} color="#fff" />
                  <Text style={styles.payBtnText}>{payMutation.isPending ? 'Opening…' : 'Pay invoice'}</Text>
                </TouchableOpacity>
              ) : inv.paid_at ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <CheckCircle2 size={12} color={C.green} />
                  <Text style={{ color: C.green, fontSize: 11 }}>Paid {new Date(inv.paid_at).toLocaleDateString()}</Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'Paid' ? C.green : status === 'Overdue' ? C.red : status === 'Void' ? C.textMuted : C.yellow;
  const bg = status === 'Paid' ? C.greenDim : status === 'Overdue' ? C.redDim : status === 'Void' ? C.bgSecondary : C.yellowDim;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' as const }}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bg },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 17, fontWeight: '700' as const },
  summary: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16 },
  summaryLabel: { fontSize: 12, fontWeight: '600' as const },
  summaryValue: { fontSize: 28, fontWeight: '700' as const, marginTop: 4 },
  summarySub: { fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 320 },
  card: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '700' as const },
  cardSub: { color: C.textMuted, fontSize: 11, marginTop: 2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardLabel: { color: C.textMuted, fontSize: 13 },
  cardValue: { color: C.text, fontSize: 16, fontWeight: '700' as const },
  payBtn: { marginTop: 12, backgroundColor: C.accent, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  payBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  setupCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  setupTitle: { fontSize: 14, fontWeight: '700' as const },
  setupRow: { color: C.textMuted, fontSize: 12, lineHeight: 18 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg },
  editBtnText: { fontSize: 11, fontWeight: '700' as const },
  setupInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  modeChip: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center' },
  modeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  modeChipText: { color: C.textMuted, fontSize: 12, fontWeight: '600' as const },
  modeChipTextActive: { color: C.accent },
  saveBtn: { flex: 1, backgroundColor: C.accent, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: 14 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelBtnText: { color: C.textMuted, fontWeight: '600' as const, fontSize: 14 },
});
