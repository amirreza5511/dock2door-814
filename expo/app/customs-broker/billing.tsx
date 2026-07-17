import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, Zap, CheckCircle2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface BillingRow {
  id: string;
  title: string;
  customer_name: string;
  cleared_at: string | null;
  fee: number;
  platform_fee: number;
  net_to_broker: number;
  invoice_status: string;
  currency: string;
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BrokerBilling() {
  const insets = useSafeAreaInsets();
  const billingQuery = trpc.broker.billing.useQuery();
  const rows = useMemo(() => (billingQuery.data as BillingRow[] | undefined) ?? [], [billingQuery.data]);

  const totalFees = rows.reduce((s, r) => s + Number(r.fee ?? 0), 0);
  const totalPlatform = rows.reduce((s, r) => s + Number(r.platform_fee ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.net_to_broker ?? 0), 0);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Billing</Text>
        <SupportMenu />
      </View>

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Wallet size={15} color={C.green} />
          <Text style={styles.summaryValue}>{money(totalNet)}</Text>
          <Text style={styles.summaryLabel}>Net to you</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <CheckCircle2 size={15} color={C.blue} />
          <Text style={styles.summaryValue}>{money(totalFees)}</Text>
          <Text style={styles.summaryLabel}>Fees billed</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Zap size={15} color={C.yellow} />
          <Text style={styles.summaryValue}>{money(totalPlatform)}</Text>
          <Text style={styles.summaryLabel}>Platform fees</Text>
        </Card>
      </View>

      {billingQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading billing" /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No cleared shipments yet</Text>
          <Text style={styles.emptyMsg}>
            When you mark a shipment cleared, the invoice and your fee breakdown appear here.
            Dock2Door keeps a small commission from your brokerage fee.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {rows.map((r) => (
            <Card key={r.id} style={styles.payCard}>
              <View style={styles.payTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payTitle}>{r.title}</Text>
                  <Text style={styles.paySub}>{r.customer_name}{r.cleared_at ? ` · cleared ${String(r.cleared_at).slice(0, 10)}` : ''}</Text>
                </View>
                {r.invoice_status ? (
                  <View style={styles.statusPill}><Text style={styles.statusPillText}>{r.invoice_status}</Text></View>
                ) : null}
              </View>
              <View style={styles.payBreakdown}>
                <View style={styles.payLine}>
                  <Text style={styles.payLineLabel}>Brokerage fee</Text>
                  <Text style={styles.payLineValue}>{money(r.fee)}</Text>
                </View>
                <View style={styles.payLine}>
                  <Text style={styles.payLineLabel}>Platform commission</Text>
                  <Text style={[styles.payLineValue, { color: C.yellow }]}>−{money(r.platform_fee)}</Text>
                </View>
                <View style={[styles.payLine, styles.payLineTotal]}>
                  <Text style={[styles.payLineLabel, { color: C.text, fontWeight: '700' as const }]}>Net to your brokerage</Text>
                  <Text style={[styles.payLineValue, { color: C.green, fontWeight: '800' as const }]}>{money(r.net_to_broker)}</Text>
                </View>
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  summaryCard: { flex: 1, padding: 12, gap: 4, alignItems: 'flex-start' },
  summaryValue: { fontSize: 15, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  summaryLabel: { fontSize: 10, color: C.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  list: { paddingHorizontal: 16 },
  payCard: { padding: 14, marginBottom: 10, gap: 10 },
  payTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  payTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  paySub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.accentDim },
  statusPillText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  payBreakdown: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, gap: 6 },
  payLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payLineTotal: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  payLineLabel: { fontSize: 12, color: C.textSecondary },
  payLineValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
});
