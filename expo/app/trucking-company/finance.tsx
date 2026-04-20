import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BadgeDollarSign, CreditCard, FileText, Wallet } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

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
}

interface InvoiceItem {
  id: string;
  payment_id?: string | null;
  invoice_number?: string | null;
  total_amount?: string | null;
  currency?: string | null;
  status?: string | null;
}

interface PayoutItem {
  id: string;
  company_id?: string | null;
  amount?: string | null;
  status?: string | null;
}

export default function TruckingFinanceScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<FinanceTab>('payments');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const paymentsQuery = trpc.payments.list.useQuery();
  const invoicesQuery = trpc.payments.listInvoices.useQuery();
  const payoutsQuery = trpc.payments.listPayouts.useQuery();
  const paymentDetailQuery = trpc.payments.getPayment.useQuery({ id: selectedId ?? '' }, { enabled: tab === 'payments' && Boolean(selectedId) });
  const invoiceDetailQuery = trpc.payments.getInvoice.useQuery({ id: selectedId ?? undefined }, { enabled: tab === 'invoices' && Boolean(selectedId) });
  const payoutDetailQuery = trpc.payments.getPayout.useQuery({ id: selectedId ?? '' }, { enabled: tab === 'payouts' && Boolean(selectedId) });
  const payoutStatusMutation = trpc.payments.updatePayoutStatus.useMutation();
  const invoiceStatusMutation = trpc.payments.updateInvoiceStatus.useMutation();

  const activeQuery = useMemo(() => {
    if (tab === 'payments') {
      return paymentsQuery;
    }
    if (tab === 'invoices') {
      return invoicesQuery;
    }
    return payoutsQuery;
  }, [invoicesQuery, paymentsQuery, payoutsQuery, tab]);

  const currentItems: Array<PaymentItem | InvoiceItem | PayoutItem> = useMemo(() => {
    if (tab === 'payments') {
      return (paymentsQuery.data ?? []) as PaymentItem[];
    }
    if (tab === 'invoices') {
      return (invoicesQuery.data ?? []) as InvoiceItem[];
    }
    return (payoutsQuery.data ?? []) as PayoutItem[];
  }, [invoicesQuery.data, paymentsQuery.data, payoutsQuery.data, tab]);

  const updatePayoutStatus = async (id: string, status: 'Processing' | 'Paid') => {
    try {
      await payoutStatusMutation.mutateAsync({ id, status });
      await payoutsQuery.refetch();
      if (selectedId === id) {
        await payoutDetailQuery.refetch();
      }
    } catch (error) {
      Alert.alert('Unable to update payout', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const updateInvoiceStatus = async (id: string, status: 'Issued' | 'Paid' | 'Void') => {
    try {
      await invoiceStatusMutation.mutateAsync({ id, status });
      await invoicesQuery.refetch();
      if (selectedId === id) {
        await invoiceDetailQuery.refetch();
      }
    } catch (error) {
      Alert.alert('Unable to update invoice', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (activeQuery.isLoading && currentItems.length === 0) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading finance" /></View>;
  }

  if (activeQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load finance data" onRetry={() => void activeQuery.refetch()} /></View>;
  }

  const selectedInvoice: InvoiceItem | null = tab === 'invoices' ? (invoiceDetailQuery.data as InvoiceItem | undefined) ?? (((invoicesQuery.data ?? []) as InvoiceItem[]).find((item) => String(item.id) === selectedId) ?? null) : null;
  const selectedPayment: PaymentItem | null = tab === 'payments' ? (paymentDetailQuery.data as PaymentItem | undefined) ?? null : null;
  const selectedPayout: PayoutItem | null = tab === 'payouts' ? (payoutDetailQuery.data as PayoutItem | undefined) ?? null : null;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Finance</Text>
        <Text style={styles.subtitle}>Live invoices, payments, and payouts from the production backend.</Text>

        <View style={styles.segmentRow}>
          {([
            ['payments', 'Payments'],
            ['invoices', 'Invoices'],
            ['payouts', 'Payouts'],
          ] as [FinanceTab, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => { setTab(key); setSelectedId(null); }} style={[styles.segment, tab === key && styles.segmentActive]}>
              <Text style={[styles.segmentText, tab === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {currentItems.length === 0 ? (
          <EmptyState icon={Wallet} title={`No ${tab}`} description="When backend records are created they will appear here automatically." />
        ) : currentItems.map((item) => (
          <Card key={String(item.id)} style={styles.listCard} onPress={() => setSelectedId(String(item.id))}>
            <View style={styles.listTop}>
              <View style={styles.iconWrap}>
                {tab === 'payments' ? <CreditCard size={16} color={C.accent} /> : null}
                {tab === 'invoices' ? <FileText size={16} color={C.blue} /> : null}
                {tab === 'payouts' ? <BadgeDollarSign size={16} color={C.green} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{tab === 'payments' ? `Payment ${String(item.id).slice(0, 8)}` : tab === 'invoices' ? String((item as InvoiceItem).invoice_number ?? item.id) : `Payout ${String(item.id).slice(0, 8)}`}</Text>
                <Text style={styles.itemMeta}>{tab === 'payments' ? `${String((item as PaymentItem).gross_amount ?? '0')} ${String((item as PaymentItem).currency ?? 'CAD').toUpperCase()}` : tab === 'invoices' ? `${String((item as InvoiceItem).total_amount ?? '0')} ${String((item as InvoiceItem).currency ?? 'CAD').toUpperCase()}` : `${String((item as PayoutItem).amount ?? '0')} CAD`}</Text>
              </View>
              <StatusBadge status={String(item.status ?? 'Draft')} />
            </View>
          </Card>
        ))}

        {selectedId ? (
          <Card elevated>
            <Text style={styles.sectionTitle}>Detail</Text>
            {tab === 'payments' && selectedPayment ? (
              <View style={styles.detailGroup}>
                <Text style={styles.detailLine}>Payment ID: {String(selectedPayment.id)}</Text>
                <Text style={styles.detailLine}>Booking: {String(selectedPayment.booking_id ?? '—')}</Text>
                <Text style={styles.detailLine}>Gross: {String(selectedPayment.gross_amount)} {String(selectedPayment.currency).toUpperCase()}</Text>
                <Text style={styles.detailLine}>Commission: {String(selectedPayment.commission_amount)}</Text>
                <Text style={styles.detailLine}>Net: {String(selectedPayment.net_amount)}</Text>
                <Text style={styles.detailLine}>Stripe Intent: {String(selectedPayment.stripe_payment_intent_id ?? '—')}</Text>
              </View>
            ) : null}
            {tab === 'invoices' && selectedInvoice ? (
              <View style={styles.detailGroup}>
                <Text style={styles.detailLine}>Invoice #: {String(selectedInvoice.invoice_number)}</Text>
                <Text style={styles.detailLine}>Payment ID: {String(selectedInvoice.payment_id)}</Text>
                <Text style={styles.detailLine}>Total: {String(selectedInvoice.total_amount)} {String(selectedInvoice.currency).toUpperCase()}</Text>
                <Text style={styles.detailLine}>Status: {String(selectedInvoice.status)}</Text>
                <View style={styles.actionRow}>
                  <Button label="Mark Issued" variant="secondary" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Issued')} loading={invoiceStatusMutation.isPending} />
                  <Button label="Mark Paid" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Paid')} loading={invoiceStatusMutation.isPending} />
                  <Button label="Void" variant="ghost" onPress={() => void updateInvoiceStatus(String(selectedInvoice.id), 'Void')} loading={invoiceStatusMutation.isPending} />
                </View>
              </View>
            ) : null}
            {tab === 'payouts' && selectedPayout ? (
              <View style={styles.detailGroup}>
                <Text style={styles.detailLine}>Payout ID: {String(selectedPayout.id)}</Text>
                <Text style={styles.detailLine}>Company: {String(selectedPayout.company_id)}</Text>
                <Text style={styles.detailLine}>Amount: {String(selectedPayout.amount)}</Text>
                <Text style={styles.detailLine}>Status: {String(selectedPayout.status)}</Text>
                <View style={styles.actionRow}>
                  <Button label="Mark Processing" variant="secondary" onPress={() => void updatePayoutStatus(String(selectedPayout.id), 'Processing')} loading={payoutStatusMutation.isPending} />
                  <Button label="Mark Paid" onPress={() => void updatePayoutStatus(String(selectedPayout.id), 'Paid')} loading={payoutStatusMutation.isPending} />
                </View>
              </View>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  segmentRow: { flexDirection: 'row', gap: 10 },
  segment: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  listCard: { gap: 10 },
  listTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  detailGroup: { gap: 8, marginTop: 12 },
  detailLine: { fontSize: 13, color: C.textSecondary },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
});
