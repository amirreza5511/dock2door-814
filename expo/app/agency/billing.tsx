import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, Zap, CheckCircle2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface PayableRow {
  payable_id: string;
  shift_id: string;
  shift_title: string;
  shift_date: string;
  worker_user_id: string;
  worker_name: string;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  agency_fee: number;
  net_to_agency: number;
  status: string;
  invoice_status: string;
  paid_at: string | null;
}

type Filter = 'All' | 'Pending' | 'Approved' | 'Paid';

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_TINT: Record<string, string> = {
  Pending: C.yellow, Approved: C.blue, Paid: C.green, Cancelled: C.red,
};

export default function AgencyBilling() {
  const insets = useSafeAreaInsets();
  const payablesQuery = trpc.agency.payables.useQuery();
  const [filter, setFilter] = useState<Filter>('All');

  const payables = useMemo(() => (payablesQuery.data as PayableRow[] | undefined) ?? [], [payablesQuery.data]);
  const filtered = filter === 'All' ? payables : payables.filter((p) => p.status === filter);

  const owed = payables.filter((p) => p.status === 'Pending' || p.status === 'Approved')
    .reduce((s, p) => s + Number(p.net_to_agency ?? 0), 0);
  const paidOut = payables.filter((p) => p.status === 'Paid')
    .reduce((s, p) => s + Number(p.net_to_agency ?? 0), 0);
  const feesTotal = payables.reduce((s, p) => s + Number(p.agency_fee ?? 0), 0);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Billing & payouts</Text>
        <SupportMenu />
      </View>

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Wallet size={15} color={C.green} />
          <Text style={styles.summaryValue}>{money(owed)}</Text>
          <Text style={styles.summaryLabel}>Owed to you</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <CheckCircle2 size={15} color={C.blue} />
          <Text style={styles.summaryValue}>{money(paidOut)}</Text>
          <Text style={styles.summaryLabel}>Paid out</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Zap size={15} color={C.yellow} />
          <Text style={styles.summaryValue}>{money(feesTotal)}</Text>
          <Text style={styles.summaryLabel}>Platform fees</Text>
        </Card>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
        {(['All', 'Pending', 'Approved', 'Paid'] as const).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {payablesQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading payables" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyMsg}>
            When your workers complete shifts, the employer&apos;s payment routes to your agency and shows up here.
            You then pay your workers directly.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {filtered.map((p) => {
            const tint = STATUS_TINT[p.status] ?? C.textMuted;
            return (
              <Card key={p.payable_id} style={styles.payCard}>
                <View style={styles.payTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle}>{p.shift_title}</Text>
                    <Text style={styles.paySub}>{p.worker_name} · {p.shift_date} · {Number(p.confirmed_hours).toFixed(1)}h @ ${Number(p.hourly_rate).toFixed(2)}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
                    <Text style={[styles.statusPillText, { color: tint }]}>{p.status}</Text>
                  </View>
                </View>
                <View style={styles.payBreakdown}>
                  <View style={styles.payLine}>
                    <Text style={styles.payLineLabel}>Gross</Text>
                    <Text style={styles.payLineValue}>{money(p.gross_pay)}</Text>
                  </View>
                  <View style={styles.payLine}>
                    <Text style={styles.payLineLabel}>Agency platform fee</Text>
                    <Text style={[styles.payLineValue, { color: C.yellow }]}>−{money(p.agency_fee)}</Text>
                  </View>
                  <View style={[styles.payLine, styles.payLineTotal]}>
                    <Text style={[styles.payLineLabel, { color: C.text, fontWeight: '700' as const }]}>Net to your agency</Text>
                    <Text style={[styles.payLineValue, { color: C.green, fontWeight: '800' as const }]}>{money(p.net_to_agency)}</Text>
                  </View>
                </View>
              </Card>
            );
          })}
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
  filterBar: { maxHeight: 44, marginBottom: 8 },
  filterContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  chipTextActive: { color: C.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  list: { paddingHorizontal: 16 },
  payCard: { padding: 14, marginBottom: 10, gap: 10 },
  payTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  payTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  paySub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  payBreakdown: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, gap: 6 },
  payLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payLineTotal: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  payLineLabel: { fontSize: 12, color: C.textSecondary },
  payLineValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
});
