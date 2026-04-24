import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BadgeDollarSign, CreditCard, FileText, Wallet, ExternalLink, CreditCard as PayIcon, Linking as LinkIcon } from 'lucide-react-native';
import { Linking } from 'react-native';
import { supabase } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

type FinanceTab = 'payments' | 'invoices' | 'payouts';

interface PaymentItem {
  id: string;
  booking_id?: string | null;
  gross_amount?: string | null;
  commission_amount?: string | null;
  net_amount?: string | null;
  currency?: string | null;
  stripe_payment_intent_id?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface InvoiceItem {
  id: string;
  payment_id?: string | null;
  invoice_number?: string | null;
  total_amount?: string | null;
  subtotal_amount?: string | null;
  commission_amount?: string | null;
  currency?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface PayoutItem {
  id: string;
  company_id?: string | null;
  amount?: string | null;
  currency?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface FinanceScreenProps {
  title?: string;
  subtitle?: string;
  adminActions?: boolean;
  showPayouts?: boolean;
}

export default function FinanceScreen({ title = 'Billing', subtitle, adminActions, showPayouts = true }: FinanceScreenProps) {
  const insets = useSafeAreaInsets();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'Admin' || role === 'SuperAdmin';
  const showAdmin = adminActions ?? isAdmin;

  const [tab, setTab] = useState<FinanceTab>('payments');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const paymentsQuery = trpc.payments.list.useQuery();
  const invoicesQuery = trpc.payments.listInvoices.useQuery();
  const payoutsQuery = trpc.payments.listPayouts.useQuery(undefined, { enabled: showPayouts });
  const paymentDetailQuery = trpc.payments.getPayment.useQuery({ id: selectedId ?? '' }, { enabled: tab === 'payments' && Boolean(selectedId) });
  const invoiceDetailQuery = trpc.payments.getInvoice.useQuery({ id: selectedId ?? undefined }, { enabled: tab === 'invoices' && Boolean(selectedId) });
  const payoutDetailQuery = trpc.payments.getPayout.useQuery({ id: selectedId ?? '' }, { enabled: showPayouts && tab === 'payouts' && Boolean(selectedId) });
  const renderInvoiceQuery = trpc.payments.renderInvoice.useQuery({ invoiceId: selectedId ?? '' }, { enabled: tab === 'invoices' && Boolean(selectedId) });
  const payoutStatusMutation = trpc.payments.updatePayoutStatus.useMutation();
  const invoiceStatusMutation = trpc.payments.updateInvoiceStatus.useMutation();
  const [paying, setPaying] = useState<boolean>(false);

  const payInvoice = async (invoiceId: string) => {
    try {
      setPaying(true);
      const successUrl = Platform.OS === 'web' ? (window.location.origin + '/payment-success') : 'dock2door://payment-success';
      const cancelUrl = Platform.OS === 'web' ? (window.location.origin + '/payment-cancel') : 'dock2door://payment-cancel';
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { invoice_id: invoiceId, success_url: successUrl, cancel_url: cancelUrl },
      });
      if (error) throw new Error(error.message);
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('Checkout URL not returned');
      if (Platform.OS === 'web') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Unable to start payment', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPaying(false);
    }
  };

  const activeQuery = useMemo(() => {
    if (tab === 'payments') return paymentsQuery;
    if (tab === 'invoices') return invoicesQuery;
    return payoutsQuery;
  }, [invoicesQuery, paymentsQuery, payoutsQuery, tab]);

  const currentItems: Array<PaymentItem | InvoiceItem | PayoutItem> = useMemo(() => {
    if (tab === 'payments') return (paymentsQuery.data ?? []) as PaymentItem[];
    if (tab === 'invoices') return (invoicesQuery.data ?? []) as InvoiceItem[];
    return (payoutsQuery.data ?? []) as PayoutItem[];
  }, [invoicesQuery.data, paymentsQuery.data, payoutsQuery.data, tab]);

  const totals = useMemo(() => {
    const payments = (paymentsQuery.data ?? []) as PaymentItem[];
    const invoices = (invoicesQuery.data ?? []) as InvoiceItem[];
    const payouts = (payoutsQuery.data ?? []) as PayoutItem[];
    const paid = payments.filter((p) => p.status === 'Paid').reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
    const outstanding = invoices.filter((i) => i.status !== 'Paid' && i.status !== 'Void').reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    const pendingPayouts = payouts.filter((p) => p.status !== 'Paid').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    return { paid, outstanding, pendingPayouts };
  }, [paymentsQuery.data, invoicesQuery.data, payoutsQuery.data]);

  const updatePayoutStatus = async (id: string, status: 'Processing' | 'Paid') => {
    try {
      await payoutStatusMutation.mutateAsync({ id, status });
      await payoutsQuery.refetch();
      if (selectedId === id) await payoutDetailQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to update payout', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const updateInvoiceStatus = async (id: string, status: 'Issued' | 'Paid' | 'Void') => {
    try {
      await invoiceStatusMutation.mutateAsync({ id, status });
      await invoicesQuery.refetch();
      if (selectedId === id) await invoiceDetailQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to update invoice', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const openInvoiceHtml = (html: string) => {
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
      }
    } else {
      Alert.alert('Invoice preview', 'Invoice HTML is available. Open on web to view or print to PDF.');
    }
  };

  if (activeQuery.isLoading && currentItems.length === 0) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title={`Loading ${tab}`} /></View>;
  }
  if (activeQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load finance data" onRetry={() => void activeQuery.refetch()} /></View>;
  }

  const selectedInvoice: InvoiceItem | null = tab === 'invoices' ? (invoiceDetailQuery.data as InvoiceItem | undefined) ?? (((invoicesQuery.data ?? []) as InvoiceItem[]).find((item) => String(item.id) === selectedId) ?? null) : null;
  const selectedPayment: PaymentItem | null = tab === 'payments' ? (paymentDetailQuery.data as PaymentItem | undefined) ?? (((paymentsQuery.data ?? []) as PaymentItem[]).find((item) => String(item.id) === selectedId) ?? null) : null;
  const selectedPayout: PayoutItem | null = tab === 'payouts' ? (payoutDetailQuery.data as PayoutItem | undefined) ?? (((payoutsQuery.data ?? []) as PayoutItem[]).find((item) => String(item.id) === selectedId) ?? null) : null;
  const renderedHtml: string | null = (renderInvoiceQuery.data as { html?: string } | undefined)?.html ?? null;

  const tabs: [FinanceTab, string][] = showPayouts
    ? [['payments', 'Payments'], ['invoices', 'Invoices'], ['payouts', 'Payouts']]
    : [['payments', 'Payments'], ['invoices', 'Invoices']];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title} testID="finance-title">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Paid</Text>
            <Text style={styles.summaryValue}>${totals.paid.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Outstanding</Text>
            <Text style={[styles.summaryValue, { color: C.yellow }]}>${totals.outstanding.toFixed(2)}</Text>
          </View>
          {showPayouts && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Pending Payouts</Text>
              <Text style={[styles.summaryValue, { color: C.green }]}>${totals.pendingPayouts.toFixed(2)}</Text>
            </View>
          )}
        </View>

        <View style={styles.segmentRow}>
          {tabs.map(([key, label]) => (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => { setTab(key); setSelectedId(null); }} style={[styles.segment, tab === key && styles.segmentActive]} testID={`segment-${key}`}>
              <Text style={[styles.segmentText, tab === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {currentItems.length === 0 ? (
          <EmptyState icon={Wallet} title={`No ${tab} yet`} description="Records will appear here as transactions flow through the platform." />
        ) : currentItems.map((item) => {
          const isSelected = String(item.id) === selectedId;
          return (
            <Card key={String(item.id)} style={StyleSheet.flatten([styles.listCard, isSelected && styles.listCardActive])} onPress={() => setSelectedId(isSelected ? null : String(item.id))}>
              <View style={styles.listTop}>
                <View style={styles.iconWrap}>
                  {tab === 'payments' ? <CreditCard size={16} color={C.accent} /> : null}
                  {tab === 'invoices' ? <FileText size={16} color={C.blue} /> : null}
                  {tab === 'payouts' ? <BadgeDollarSign size={16} color={C.green} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>
                    {tab === 'payments' ? `Payment ${String(item.id).slice(0, 8)}` : tab === 'invoices' ? String((item as InvoiceItem).invoice_number ?? item.id) : `Payout ${String(item.id).slice(0, 8)}`}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {tab === 'payments'
                      ? `$${Number((item as PaymentItem).gross_amount ?? 0).toFixed(2)} ${String((item as PaymentItem).currency ?? 'CAD').toUpperCase()}`
                      : tab === 'invoices'
                        ? `$${Number((item as InvoiceItem).total_amount ?? 0).toFixed(2)} ${String((item as InvoiceItem).currency ?? 'CAD').toUpperCase()}`
                        : `$${Number((item as PayoutItem).amount ?? 0).toFixed(2)} CAD`}
                    {item.created_at ? ` · ${new Date(String(item.created_at)).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <StatusBadge status={String(item.status ?? 'Draft')} />
              </View>
            </Card>
          );
        })}

        {selectedId ? (
          <Card elevated style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Details</Text>

            {tab === 'payments' && selectedPayment ? (
              <View style={styles.detailGroup}>
                <DetailLine label="Payment ID" value={String(selectedPayment.id)} />
                <DetailLine label="Booking" value={String(selectedPayment.booking_id ?? '—')} />
                <DetailLine label="Gross" value={`$${Number(selectedPayment.gross_amount ?? 0).toFixed(2)} ${String(selectedPayment.currency ?? 'CAD').toUpperCase()}`} />
                <DetailLine label="Commission" value={`$${Number(selectedPayment.commission_amount ?? 0).toFixed(2)}`} />
                <DetailLine label="Net" value={`$${Number(selectedPayment.net_amount ?? 0).toFixed(2)}`} />
                <DetailLine label="Status" value={String(selectedPayment.status ?? '—')} />
                <DetailLine label="Stripe Intent" value={String(selectedPayment.stripe_payment_intent_id ?? '—')} />
              </View>
            ) : null}

            {tab === 'invoices' && selectedInvoice ? (
              <View style={styles.detailGroup}>
                <DetailLine label="Invoice #" value={String(selectedInvoice.invoice_number ?? selectedInvoice.id)} />
                <DetailLine label="Payment ID" value={String(selectedInvoice.payment_id ?? '—')} />
                <DetailLine label="Subtotal" value={`$${Number(selectedInvoice.subtotal_amount ?? 0).toFixed(2)}`} />
                <DetailLine label="Commission" value={`$${Number(selectedInvoice.commission_amount ?? 0).toFixed(2)}`} />
                <DetailLine label="Total" value={`$${Number(selectedInvoice.total_amount ?? 0).toFixed(2)} ${String(selectedInvoice.currency ?? 'CAD').toUpperCase()}`} />
                <DetailLine label="Status" value={String(selectedInvoice.status ?? '—')} />
                <View style={styles.actionRow}>
                  {selectedInvoice.status !== 'Paid' && selectedInvoice.status !== 'Void' ? (
                    <Button
                      label="Pay invoice"
                      onPress={() => void payInvoice(String(selectedInvoice.id))}
                      loading={paying}
                      icon={<PayIcon size={14} color={C.white} />}
                    />
                  ) : null}
                  <Button
                    label={Platform.OS === 'web' ? 'View / Print Invoice' : 'Invoice preview'}
                    variant="secondary"
                    icon={<ExternalLink size={14} color={C.accent} />}
                    onPress={() => renderedHtml ? openInvoiceHtml(renderedHtml) : Alert.alert('Loading invoice…', 'Please try again in a moment.')}
                  />
                  {showAdmin ? (
                    <>
                      <Button label="Mark Issued" variant="ghost" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Issued')} loading={invoiceStatusMutation.isPending} />
                      <Button label="Mark Paid" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Paid')} loading={invoiceStatusMutation.isPending} />
                      <Button label="Void" variant="danger" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Void')} loading={invoiceStatusMutation.isPending} />
                    </>
                  ) : null}
                </View>
              </View>
            ) : null}

            {tab === 'payouts' && selectedPayout ? (
              <View style={styles.detailGroup}>
                <DetailLine label="Payout ID" value={String(selectedPayout.id)} />
                <DetailLine label="Company" value={String(selectedPayout.company_id ?? '—')} />
                <DetailLine label="Amount" value={`$${Number(selectedPayout.amount ?? 0).toFixed(2)} ${String(selectedPayout.currency ?? 'CAD').toUpperCase()}`} />
                <DetailLine label="Status" value={String(selectedPayout.status ?? '—')} />
                {showAdmin ? (
                  <View style={styles.actionRow}>
                    <Button label="Mark Processing" variant="secondary" onPress={() => void updatePayoutStatus(String(selectedPayout.id), 'Processing')} loading={payoutStatusMutation.isPending} />
                    <Button label="Mark Paid" onPress={() => void updatePayoutStatus(String(selectedPayout.id), 'Paid')} loading={payoutStatusMutation.isPending} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailKey}>{label}</Text>
      <Text style={styles.detailVal} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -6 },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  summaryCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  summaryLabel: { fontSize: 11, color: C.textMuted, marginBottom: 6 },
  summaryValue: { fontSize: 18, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  segment: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  listCard: { gap: 10 },
  listCardActive: { borderColor: C.accent },
  listTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  detailCard: { marginTop: 4 },
  detailGroup: { gap: 10, marginTop: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailKey: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  detailVal: { fontSize: 13, color: C.text, flex: 1, textAlign: 'right' as const },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
});
