import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Receipt, CreditCard, CheckCircle2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  requires_prepayment: boolean;
  created_at: string;
}

const STATUS_TINT: Record<string, string> = {
  Draft: C.textMuted, Issued: C.yellow, Paid: C.green, Void: C.textMuted, Refunded: C.blue, Overdue: C.red,
};

type Filter = 'unpaid' | 'paid' | 'all';

/** Guest billing — every invoice is prepaid (guest surcharge included). */
export default function GuestBilling() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Filter>('unpaid');

  const invoicesQuery = trpc.guest.invoices.useQuery(undefined, { refetchInterval: 20000 });
  const payMutation = trpc.guest.payInvoice.useMutation({
    onSuccess: () => utils.guest.invoices.invalidate(),
  });

  const rows = useMemo(() => (invoicesQuery.data as InvoiceRow[] | undefined) ?? [], [invoicesQuery.data]);
  const filtered = rows.filter((r) => {
    if (filter === 'unpaid') return r.status !== 'Paid' && r.status !== 'Void' && r.status !== 'Refunded';
    if (filter === 'paid') return r.status === 'Paid';
    return true;
  });
  const unpaidTotal = rows
    .filter((r) => r.status !== 'Paid' && r.status !== 'Void' && r.status !== 'Refunded')
    .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const pay = (inv: InvoiceRow) => {
    Alert.alert(
      'Prepay invoice?',
      `Pay $${Number(inv.total_amount).toFixed(2)} ${inv.currency} now? This total already includes the guest service surcharge.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Pay now',
          onPress: async () => {
            try {
              await payMutation.mutateAsync({ invoiceId: inv.id });
              Alert.alert('Paid', 'Your prepayment was recorded. The provider was notified and work can start.');
            } catch (e) {
              Alert.alert('Payment failed', e instanceof Error ? e.message : 'Try again');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Billing</Text>
          <Text style={styles.subtitle}>Prepaid invoices — guest surcharge included</Text>
        </View>
        <SupportMenu />
      </View>

      {unpaidTotal > 0 ? (
        <View style={styles.totalBar}>
          <CreditCard size={15} color={C.yellow} />
          <Text style={styles.totalText}>Outstanding: ${unpaidTotal.toFixed(2)} — prepay to start services</Text>
        </View>
      ) : null}

      <View style={styles.filterRow}>
        {(['unpaid', 'paid', 'all'] as Filter[]).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterBtn, filter === f && styles.filterBtnActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'unpaid' ? 'To pay' : f === 'paid' ? 'Paid' : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
        {invoicesQuery.isLoading ? (
          <View style={styles.centerPad}><ScreenFeedback state="loading" title="Loading invoices" /></View>
        ) : filtered.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Receipt size={22} color={C.accent} />
            <Text style={styles.emptyTitle}>{filter === 'unpaid' ? 'Nothing to pay' : 'No invoices yet'}</Text>
            <Text style={styles.emptyMsg}>
              When you order a service, the invoice appears here with the guest surcharge — prepay it and work starts immediately.
            </Text>
          </Card>
        ) : (
          filtered.map((inv) => {
            const tint = STATUS_TINT[inv.status] ?? C.textMuted;
            const payable = inv.status !== 'Paid' && inv.status !== 'Void' && inv.status !== 'Refunded';
            return (
              <Card key={inv.id} style={styles.invCard}>
                <View style={styles.invTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invNumber}>{inv.invoice_number ?? `Invoice ${inv.id.slice(0, 8)}`}</Text>
                    <Text style={styles.invMeta}>
                      {inv.issued_at ? `Issued ${new Date(inv.issued_at).toLocaleDateString()}` : 'Draft'}
                      {inv.due_date ? ` · Due ${inv.due_date}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
                    <Text style={[styles.statusPillText, { color: tint }]}>{inv.status}</Text>
                  </View>
                </View>
                <View style={styles.amountRow}>
                  <Text style={styles.amountLabel}>Total (incl. guest surcharge)</Text>
                  <Text style={styles.amountValue}>${Number(inv.total_amount).toFixed(2)} {inv.currency}</Text>
                </View>
                {payable ? (
                  <TouchableOpacity style={styles.payBtn} onPress={() => pay(inv)} disabled={payMutation.isPending}>
                    <CreditCard size={15} color={C.bg} />
                    <Text style={styles.payBtnText}>{payMutation.isPending ? 'Processing…' : 'Prepay now'}</Text>
                  </TouchableOpacity>
                ) : inv.status === 'Paid' ? (
                  <View style={styles.paidRow}>
                    <CheckCircle2 size={14} color={C.green} />
                    <Text style={styles.paidText}>
                      Paid{inv.paid_at ? ` on ${new Date(inv.paid_at).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  totalBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.yellow + '15', borderWidth: 1, borderColor: C.yellow + '44',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  totalText: { flex: 1, fontSize: 12, fontWeight: '700' as const, color: C.yellow },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  filterTextActive: { color: C.accent },
  list: { paddingHorizontal: 16 },
  centerPad: { paddingTop: 60, alignItems: 'center' },
  emptyCard: { padding: 20, alignItems: 'center', gap: 8, marginTop: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  invCard: { padding: 14, marginBottom: 10, gap: 10 },
  invTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  invNumber: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  invMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountLabel: { fontSize: 12, color: C.textSecondary },
  amountValue: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 10, paddingVertical: 11,
  },
  payBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.bg },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paidText: { fontSize: 12, fontWeight: '600' as const, color: C.green },
});
