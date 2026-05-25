import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Clock, CheckCircle2, AlertCircle } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface EarningRow {
  payable_id: string;
  worker_user_id: string;
  shift_id: string;
  shift_title: string | null;
  shift_date: string | null;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  status: 'Pending' | 'Approved' | 'Paid' | 'Cancelled';
  paid_at: string | null;
  invoice_id: string | null;
  invoice_status: string | null;
  employer_name: string | null;
}

export default function WorkerEarningsScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const q = useQuery({
    queryKey: ['worker-earnings', user?.id],
    queryFn: async (): Promise<EarningRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('worker_earnings_overview')
        .select('*')
        .eq('worker_user_id', user.id)
        .order('shift_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EarningRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    const rows = q.data ?? [];
    const paid = rows.filter((r) => r.status === 'Paid').reduce((s, r) => s + r.gross_pay, 0);
    const pending = rows.filter((r) => r.status !== 'Paid' && r.status !== 'Cancelled').reduce((s, r) => s + r.gross_pay, 0);
    return { paid, pending };
  }, [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Earnings</Text>
        <Text style={styles.sub}>Honest record of your confirmed hours and pay</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={C.text} />}
      >
        <View style={styles.totalsRow}>
          <View style={[styles.totalCard, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
            <DollarSign size={18} color={C.green} />
            <Text style={[styles.totalLabel, { color: C.green }]}>Paid</Text>
            <Text style={[styles.totalValue, { color: C.green }]}>${totals.paid.toFixed(2)}</Text>
          </View>
          <View style={[styles.totalCard, { backgroundColor: C.yellowDim, borderColor: C.yellow + '40' }]}>
            <Clock size={18} color={C.yellow} />
            <Text style={[styles.totalLabel, { color: C.yellow }]}>Pending</Text>
            <Text style={[styles.totalValue, { color: C.yellow }]}>${totals.pending.toFixed(2)}</Text>
          </View>
        </View>

        {q.isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>
        ) : (q.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <AlertCircle size={20} color={C.textMuted} />
            <Text style={styles.emptyText}>No earnings yet. Complete a shift and your employer will confirm your hours.</Text>
          </View>
        ) : (
          (q.data ?? []).map((row) => (
            <View key={row.payable_id} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{row.shift_title ?? 'Shift'}</Text>
                  <Text style={styles.cardSub}>{row.employer_name ?? 'Employer'}{row.shift_date ? ` \u00b7 ${row.shift_date}` : ''}</Text>
                </View>
                <StatusPill status={row.status} />
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>{row.confirmed_hours}h \u00d7 ${row.hourly_rate}</Text>
                <Text style={styles.cardValue}>${row.gross_pay.toFixed(2)}</Text>
              </View>
              {row.status === 'Paid' && row.paid_at ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <CheckCircle2 size={12} color={C.green} />
                  <Text style={{ color: C.green, fontSize: 11 }}>Paid {new Date(row.paid_at).toLocaleDateString()}</Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function StatusPill({ status }: { status: EarningRow['status'] }) {
  const color =
    status === 'Paid' ? C.green :
    status === 'Approved' ? C.blue :
    status === 'Cancelled' ? C.red : C.yellow;
  const bg =
    status === 'Paid' ? C.greenDim :
    status === 'Approved' ? C.blueDim :
    status === 'Cancelled' ? C.redDim : C.yellowDim;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' as const }}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 24, fontWeight: '700' as const },
  sub: { color: C.textMuted, fontSize: 13, marginTop: 2 },
  totalsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  totalCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  totalLabel: { fontSize: 12, fontWeight: '600' as const },
  totalValue: { fontSize: 22, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 280 },
  card: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '700' as const },
  cardSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardLabel: { color: C.textMuted, fontSize: 13 },
  cardValue: { color: C.text, fontSize: 16, fontWeight: '700' as const },
});
