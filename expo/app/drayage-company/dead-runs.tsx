import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, TrendingDown, Truck, User, Repeat2, DollarSign, Navigation, Check } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const PERIODS: { days: number; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

interface AggRow { key: string; miles: number; cost: number }

function aggToRows(obj: Record<string, { miles?: number; cost?: number }> | null | undefined): AggRow[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .map(([key, v]) => ({ key, miles: Number(v?.miles ?? 0), cost: Number(v?.cost ?? 0) }))
    .sort((a, b) => b.cost - a.cost);
}

function fmtWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export default function DeadRunsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [days, setDays] = useState<number>(7);
  const [rateDraft, setRateDraft] = useState<string>('');
  const [rateSaved, setRateSaved] = useState<boolean>(false);

  const query = trpc.drayage.deadRuns.useQuery({ days });
  const data = query.data as {
    summary?: {
      empty_miles?: number; deadhead_miles?: number; loaded_miles?: number; dead_cost?: number;
      pct_empty?: number; savings_miles?: number; savings_cost?: number; default_rate?: number;
    };
    runs?: Record<string, unknown>[];
    by_truck?: Record<string, { miles?: number; cost?: number }>;
    by_driver?: Record<string, { miles?: number; cost?: number }>;
  } | null | undefined;

  const setRateMutation = trpc.drayage.setDefaultCostPerMile.useMutation({
    onSuccess: async () => {
      setRateSaved(true);
      setTimeout(() => setRateSaved(false), 1800);
      await utils.drayage.deadRuns.invalidate({ days });
    },
  });

  const saveRate = useCallback(() => {
    const n = Number(rateDraft);
    if (!Number.isFinite(n) || n < 0) { Alert.alert('Invalid rate', 'Enter a dollar amount per mile, e.g. 2.10'); return; }
    void setRateMutation.mutateAsync({ rate: n }).catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [rateDraft, setRateMutation]);

  const summary = data?.summary;
  const totalDead = Number(summary?.empty_miles ?? 0) + Number(summary?.deadhead_miles ?? 0);
  const byTruck = useMemo(() => aggToRows(data?.by_truck), [data?.by_truck]);
  const byDriver = useMemo(() => aggToRows(data?.by_driver), [data?.by_driver]);
  const runs = (data?.runs ?? []) as {
    kind?: string; move_type?: string; miles?: number; cost?: number; driver?: string; truck?: string;
    ref?: string; from_ref?: string; to_ref?: string; at?: string;
  }[];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dead Runs</Text>
          <Text style={styles.headerSub}>Empty miles, what they cost & what pairing saved</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.days}
              onPress={() => setDays(p.days)}
              style={[styles.periodChip, days === p.days && styles.periodChipActive]}
            >
              <Text style={[styles.periodText, days === p.days && styles.periodTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {query.isLoading ? (
          <ScreenFeedback state="loading" title="Crunching empty miles" />
        ) : query.isError ? (
          <ScreenFeedback state="error" title="Unable to load dead runs" onRetry={() => void query.refetch()} />
        ) : data == null ? (
          <EmptyState
            icon={TrendingDown}
            title="Not ready yet"
            description="Apply the latest database migration (0149) in Supabase to unlock dead-run analytics."
          />
        ) : (
          <>
            {/* Summary */}
            <View style={styles.grid}>
              <Card style={styles.statCard}>
                <TrendingDown size={16} color={C.red} />
                <Text style={styles.statValue}>{totalDead.toFixed(1)} mi</Text>
                <Text style={styles.statLabel}>Dead-run miles</Text>
              </Card>
              <Card style={styles.statCard}>
                <DollarSign size={16} color={C.red} />
                <Text style={[styles.statValue, { color: C.red }]}>${Number(summary?.dead_cost ?? 0).toFixed(0)}</Text>
                <Text style={styles.statLabel}>Cost of empty miles</Text>
              </Card>
              <Card style={styles.statCard}>
                <Navigation size={16} color={C.blue} />
                <Text style={styles.statValue}>{Number(summary?.pct_empty ?? 0)}%</Text>
                <Text style={styles.statLabel}>Empty vs total</Text>
              </Card>
              <Card style={styles.statCard}>
                <Repeat2 size={16} color={C.green} />
                <Text style={[styles.statValue, { color: C.green }]}>${Number(summary?.savings_cost ?? 0).toFixed(0)}</Text>
                <Text style={styles.statLabel}>Saved by street turns</Text>
              </Card>
            </View>
            <Text style={styles.breakdownLine}>
              Empty legs {Number(summary?.empty_miles ?? 0).toFixed(1)} mi · deadhead gaps {Number(summary?.deadhead_miles ?? 0).toFixed(1)} mi · loaded {Number(summary?.loaded_miles ?? 0).toFixed(1)} mi
            </Text>

            {/* Default cost per mile */}
            <Card style={styles.rateCard}>
              <Text style={styles.rateTitle}>Company default cost per mile</Text>
              <Text style={styles.rateHint}>
                Used when a truck has no rate of its own (set per truck in Fleet). Current: ${Number(summary?.default_rate ?? 2).toFixed(2)}/mi
              </Text>
              <View style={styles.rateRow}>
                <Input
                  value={rateDraft}
                  onChangeText={setRateDraft}
                  placeholder={String(summary?.default_rate ?? 2)}
                  keyboardType="numeric"
                  containerStyle={{ flex: 1 }}
                />
                <Button
                  label={rateSaved ? 'Saved' : 'Save'}
                  size="md"
                  icon={rateSaved ? <Check size={14} color={C.white} /> : undefined}
                  loading={setRateMutation.isPending}
                  onPress={saveRate}
                />
              </View>
            </Card>

            {/* By truck */}
            <View style={styles.sectionRow}>
              <Truck size={16} color={C.accent} />
              <Text style={styles.sectionTitle}>By truck</Text>
            </View>
            {byTruck.length === 0 ? (
              <Text style={styles.emptyLine}>No dead runs recorded in this period. 🎉</Text>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' as const }}>
                {byTruck.map((r, idx) => (
                  <View key={r.key} style={[styles.aggRow, idx === 0 && { borderTopWidth: 0 }]}>
                    <Text style={styles.aggName}>{r.key}</Text>
                    <Text style={styles.aggMiles}>{r.miles.toFixed(1)} mi</Text>
                    <Text style={styles.aggCost}>${r.cost.toFixed(0)}</Text>
                  </View>
                ))}
              </Card>
            )}

            {/* By driver */}
            <View style={styles.sectionRow}>
              <User size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>By driver</Text>
            </View>
            {byDriver.length === 0 ? (
              <Text style={styles.emptyLine}>Nothing here yet.</Text>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' as const }}>
                {byDriver.map((r, idx) => (
                  <View key={r.key} style={[styles.aggRow, idx === 0 && { borderTopWidth: 0 }]}>
                    <Text style={styles.aggName}>{r.key}</Text>
                    <Text style={styles.aggMiles}>{r.miles.toFixed(1)} mi</Text>
                    <Text style={styles.aggCost}>${r.cost.toFixed(0)}</Text>
                  </View>
                ))}
              </Card>
            )}

            {/* Recent runs */}
            <View style={styles.sectionRow}>
              <TrendingDown size={16} color={C.red} />
              <Text style={styles.sectionTitle}>Recent dead runs</Text>
            </View>
            {runs.length === 0 ? (
              <Text style={styles.emptyLine}>No empty legs or deadhead gaps detected in this window.</Text>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' as const }}>
                {runs.slice().reverse().map((r, idx) => (
                  <View key={`${r.at}-${idx}`} style={[styles.runRow, idx === 0 && { borderTopWidth: 0 }]}>
                    <View style={[styles.runDot, { backgroundColor: r.kind === 'deadhead' ? C.yellow : C.red }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.runTitle}>
                        {r.kind === 'deadhead'
                          ? `Deadhead ${r.from_ref ? `${r.from_ref} → ` : ''}${r.to_ref ?? ''}`
                          : `${r.move_type ?? 'Empty leg'} · ${r.ref ?? ''}`}
                      </Text>
                      <Text style={styles.runMeta}>{[r.driver, r.truck, fmtWhen(r.at)].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' as const }}>
                      <Text style={styles.runMiles}>{Number(r.miles ?? 0).toFixed(1)} mi</Text>
                      <Text style={styles.runCost}>${Number(r.cost ?? 0).toFixed(0)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 12 },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  periodChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  periodText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  periodTextActive: { color: C.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flexBasis: '47%', flexGrow: 1, gap: 6 },
  statValue: { fontSize: 20, fontWeight: '900' as const, color: C.text },
  statLabel: { fontSize: 11.5, color: C.textSecondary },
  breakdownLine: { fontSize: 12, color: C.textMuted },
  rateCard: { gap: 8 },
  rateTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  rateHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  emptyLine: { fontSize: 13, color: C.textMuted, paddingVertical: 4 },
  aggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  aggName: { flex: 1, fontSize: 13.5, fontWeight: '700' as const, color: C.text },
  aggMiles: { fontSize: 12.5, color: C.textSecondary, fontWeight: '600' as const },
  aggCost: { fontSize: 13.5, fontWeight: '800' as const, color: C.red, minWidth: 54, textAlign: 'right' as const },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  runDot: { width: 8, height: 8, borderRadius: 4 },
  runTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  runMeta: { fontSize: 11.5, color: C.textMuted, marginTop: 2 },
  runMiles: { fontSize: 12.5, fontWeight: '700' as const, color: C.text },
  runCost: { fontSize: 11.5, color: C.red, fontWeight: '700' as const, marginTop: 2 },
});
