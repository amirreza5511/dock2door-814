import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, Wallet, Zap, CircleDollarSign, TrendingUp, Truck, Warehouse,
  Wrench, CircleCheck, Clock, Building2, User, Megaphone,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type PaymentsMode = 'sandbox' | 'stripe' | 'off';

interface UnsettledRow {
  id: string;
  kind: 'drayage' | 'warehouse' | 'service';
  amount: number;
  createdAt: string;
}
interface PayoutRow {
  id: string; net_amount: number; status: string; companyName: string;
}
interface PayableRow {
  id: string; gross_pay: number; status: string; workerName: string;
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const KIND_ICON = {
  drayage: Truck,
  warehouse: Warehouse,
  service: Wrench,
} as const;

export default function SuperAdminFinance() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.finance.settings.useQuery();
  const overviewQuery = trpc.finance.overview.useQuery();
  const unsettledQuery = trpc.finance.unsettled.useQuery();
  const payoutsQuery = trpc.finance.payouts.useQuery();
  const payablesQuery = trpc.finance.workerPayables.useQuery();

  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.finance.settings.invalidate(),
      utils.finance.overview.invalidate(),
      utils.finance.unsettled.invalidate(),
      utils.finance.payouts.invalidate(),
      utils.finance.workerPayables.invalidate(),
    ]);
  }, [utils]);

  const setMode = trpc.finance.setPaymentsMode.useMutation({ onSuccess: refetchAll });
  const settleAll = trpc.finance.settleAllCompleted.useMutation({ onSuccess: refetchAll });
  const settleDray = trpc.finance.settleDrayageOrder.useMutation({ onSuccess: refetchAll });
  const settleBook = trpc.finance.settleBooking.useMutation({ onSuccess: refetchAll });
  const settleSvc = trpc.finance.settleServiceJob.useMutation({ onSuccess: refetchAll });
  const runPayout = trpc.finance.runPayout.useMutation({ onSuccess: refetchAll });
  const runAllPayouts = trpc.finance.runAllPayouts.useMutation({ onSuccess: refetchAll });
  const payWorker = trpc.finance.payWorker.useMutation({ onSuccess: refetchAll });

  const mode = (settingsQuery.data?.paymentsMode as PaymentsMode | undefined) ?? 'sandbox';
  const overview = overviewQuery.data;
  const revenueByCategory = (overview?.revenueByCategory ?? {}) as Record<string, number>;
  const unsettled = useMemo(() => (unsettledQuery.data as UnsettledRow[] | undefined) ?? [], [unsettledQuery.data]);
  const payouts = useMemo(
    () => ((payoutsQuery.data as PayoutRow[] | undefined) ?? []).filter((p) => p.status !== 'Paid'),
    [payoutsQuery.data],
  );
  const payables = useMemo(
    () => ((payablesQuery.data as PayableRow[] | undefined) ?? []).filter((p) => p.status !== 'Paid' && p.status !== 'Cancelled'),
    [payablesQuery.data],
  );

  const [busy, setBusy] = useState<string | null>(null);

  const changeMode = useCallback((next: PaymentsMode) => {
    if (next === 'stripe') {
      Alert.alert('Stripe is off', 'Real card payments need a Stripe key, which isn\u2019t connected yet. Keep using the internal sandbox for testing.');
      return;
    }
    setMode.mutate({ mode: next });
  }, [setMode]);

  const settleOne = useCallback((row: UnsettledRow) => {
    setBusy(row.id);
    const opts = { onSuccess: () => setBusy(null), onError: (e: unknown) => { setBusy(null); Alert.alert('Could not settle', e instanceof Error ? e.message : 'Error'); } };
    if (row.kind === 'drayage') settleDray.mutate({ id: row.id }, opts);
    else if (row.kind === 'warehouse') settleBook.mutate({ id: row.id }, opts);
    else settleSvc.mutate({ id: row.id }, opts);
  }, [settleDray, settleBook, settleSvc]);

  const isLoading = settingsQuery.isLoading || overviewQuery.isLoading;
  const anyFetching = settingsQuery.isFetching || overviewQuery.isFetching || unsettledQuery.isFetching || payoutsQuery.isFetching || payablesQuery.isFetching;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Payments & Finance</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading finance" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={anyFetching} onRefresh={() => void refetchAll()} tintColor={C.accent} />}
        >
          {/* Payments mode */}
          <Card style={styles.modeCard}>
            <View style={styles.modeHeader}>
              <View style={[styles.modeIcon, { backgroundColor: C.accentDim }]}><Wallet size={18} color={C.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>Payment engine</Text>
                <Text style={styles.modeSub}>Simulate money movement without a real gateway.</Text>
              </View>
            </View>
            <View style={styles.modeRow}>
              {(['sandbox', 'stripe', 'off'] as const).map((m) => {
                const active = mode === m;
                const label = m === 'sandbox' ? 'Sandbox' : m === 'stripe' ? 'Stripe (off)' : 'Off';
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => changeMode(m)}
                    style={[styles.modePill, active && styles.modePillActive, m === 'stripe' && styles.modePillDisabled]}
                    disabled={setMode.isPending}
                  >
                    <Text style={[styles.modePillText, active && styles.modePillTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modeNote}>
              <Zap size={13} color={C.green} />
              <Text style={styles.modeNoteText}>
                {mode === 'sandbox'
                  ? 'Sandbox on \u2014 invoices, payments and payouts are simulated. No real money moves.'
                  : mode === 'off'
                    ? 'Payments are off \u2014 nothing will settle automatically.'
                    : 'Stripe selected but not connected.'}
              </Text>
            </View>
          </Card>

          {/* Money overview */}
          <View style={styles.statGrid}>
            <StatTile icon={<CircleDollarSign size={16} color={C.green} />} label="Collected" value={money(overview?.collected ?? 0)} tint={C.green} />
            <StatTile icon={<TrendingUp size={16} color={C.accent} />} label="Platform revenue" value={money(overview?.revenue ?? 0)} tint={C.accent} />
            <StatTile icon={<Building2 size={16} color={C.blue} />} label="Provider payouts due" value={money(overview?.providerPayoutsPending ?? 0)} tint={C.blue} />
            <StatTile icon={<User size={16} color={C.yellow} />} label="Worker pay due" value={money(overview?.workerPayoutsPending ?? 0)} tint={C.yellow} />
          </View>

          {/* Revenue by area */}
          {Object.keys(revenueByCategory).length > 0 && (
            <Card style={styles.breakdownCard}>
              <Text style={styles.sectionLabel}>Revenue by area</Text>
              {Object.entries(revenueByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <View key={cat} style={styles.breakdownRow}>
                  <Text style={styles.breakdownName}>{cat}</Text>
                  <Text style={styles.breakdownAmt}>{money(amt)}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Settle queue */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Settle completed jobs</Text>
            {unsettled.length > 0 && (
              <TouchableOpacity
                onPress={() => settleAll.mutate(undefined)}
                style={styles.settleAllBtn}
                disabled={settleAll.isPending}
              >
                <Zap size={13} color={C.white} />
                <Text style={styles.settleAllText}>{settleAll.isPending ? 'Settling\u2026' : `Settle all (${unsettled.length})`}</Text>
              </TouchableOpacity>
            )}
          </View>
          {unsettled.length === 0 ? (
            <Card style={styles.emptyCard}>
              <CircleCheck size={20} color={C.green} />
              <Text style={styles.emptyText}>Everything completed has been billed.</Text>
            </Card>
          ) : unsettled.map((row) => {
            const Icon = KIND_ICON[row.kind];
            return (
              <Card key={`${row.kind}-${row.id}`} style={styles.settleRow}>
                <View style={[styles.settleIcon, { backgroundColor: C.bgSecondary }]}><Icon size={16} color={C.textSecondary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settleKind}>{row.kind}</Text>
                  <Text style={styles.settleAmt}>{money(row.amount)}</Text>
                </View>
                <TouchableOpacity onPress={() => settleOne(row)} style={styles.settleBtn} disabled={busy === row.id}>
                  <Text style={styles.settleBtnText}>{busy === row.id ? '\u2026' : 'Settle'}</Text>
                </TouchableOpacity>
              </Card>
            );
          })}

          {/* Provider payouts */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Provider payouts</Text>
            {payouts.length > 0 && (
              <TouchableOpacity onPress={() => runAllPayouts.mutate(undefined)} style={styles.settleAllBtn} disabled={runAllPayouts.isPending}>
                <CircleCheck size={13} color={C.white} />
                <Text style={styles.settleAllText}>{runAllPayouts.isPending ? 'Paying\u2026' : `Pay all (${payouts.length})`}</Text>
              </TouchableOpacity>
            )}
          </View>
          {payouts.length === 0 ? (
            <Card style={styles.emptyCard}><CircleCheck size={20} color={C.green} /><Text style={styles.emptyText}>No provider payouts pending.</Text></Card>
          ) : payouts.map((p) => (
            <Card key={p.id} style={styles.settleRow}>
              <View style={[styles.settleIcon, { backgroundColor: C.blueDim }]}><Building2 size={16} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settleKind}>{p.companyName}</Text>
                <View style={styles.pendPill}><Clock size={10} color={C.yellow} /><Text style={styles.pendText}>{p.status}</Text></View>
              </View>
              <Text style={styles.payAmt}>{money(p.net_amount)}</Text>
              <TouchableOpacity onPress={() => runPayout.mutate({ id: p.id })} style={[styles.settleBtn, { backgroundColor: C.greenDim }]} disabled={runPayout.isPending}>
                <Text style={[styles.settleBtnText, { color: C.green }]}>Pay</Text>
              </TouchableOpacity>
            </Card>
          ))}

          {/* Worker pay */}
          {payables.length > 0 && (
            <>
              <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Worker pay</Text></View>
              {payables.map((p) => (
                <Card key={p.id} style={styles.settleRow}>
                  <View style={[styles.settleIcon, { backgroundColor: C.yellowDim }]}><User size={16} color={C.yellow} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settleKind}>{p.workerName}</Text>
                    <View style={styles.pendPill}><Clock size={10} color={C.yellow} /><Text style={styles.pendText}>{p.status}</Text></View>
                  </View>
                  <Text style={styles.payAmt}>{money(p.gross_pay)}</Text>
                  <TouchableOpacity onPress={() => payWorker.mutate({ id: p.id })} style={[styles.settleBtn, { backgroundColor: C.greenDim }]} disabled={payWorker.isPending}>
                    <Text style={[styles.settleBtnText, { color: C.green }]}>Pay</Text>
                  </TouchableOpacity>
                </Card>
              ))}
            </>
          )}

          {/* Related tools */}
          <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Related</Text></View>
          <TouchableOpacity onPress={() => router.push('/admin/sales-agents' as never)} style={styles.linkRow}>
            <View style={[styles.settleIcon, { backgroundColor: C.accentDim }]}><TrendingUp size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Sales agents & commissions</Text>
              <Text style={styles.linkMeta}>Agent payouts: {money(overview?.agentCommissionsPending ?? 0)} pending</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/super-admin/ads' as never)} style={styles.linkRow}>
            <View style={[styles.settleIcon, { backgroundColor: C.accentDim }]}><Megaphone size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Advertising payments</Text>
              <Text style={styles.linkMeta}>Approve paid ads to bill & activate them</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

function StatTile({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: string; tint: string }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIconRow}>{icon}</View>
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { padding: 16, gap: 12 },

  modeCard: { padding: 16, gap: 12 },
  modeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  modeSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modePill: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modePillActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  modePillDisabled: { opacity: 0.6 },
  modePillText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  modePillTextActive: { color: C.accent },
  modeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: C.greenDim, borderRadius: 10, padding: 10 },
  modeNoteText: { flex: 1, fontSize: 12, color: C.green, lineHeight: 17 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: { width: '47.5%', flexGrow: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statIconRow: { marginBottom: 2 },
  statValue: { fontSize: 20, fontWeight: '800' as const },
  statLabel: { fontSize: 11, color: C.textSecondary },

  breakdownCard: { padding: 14, gap: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownName: { fontSize: 14, color: C.text, textTransform: 'capitalize' as const },
  breakdownAmt: { fontSize: 14, fontWeight: '700' as const, color: C.text },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  settleAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  settleAllText: { fontSize: 12, fontWeight: '700' as const, color: C.white },

  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  emptyText: { fontSize: 13, color: C.textSecondary },

  settleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  settleIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settleKind: { fontSize: 14, fontWeight: '700' as const, color: C.text, textTransform: 'capitalize' as const },
  settleAmt: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  settleBtn: { backgroundColor: C.accentDim, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  settleBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  payAmt: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  pendPill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, alignSelf: 'flex-start' },
  pendText: { fontSize: 11, color: C.yellow, fontWeight: '600' as const },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  linkTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  linkMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
