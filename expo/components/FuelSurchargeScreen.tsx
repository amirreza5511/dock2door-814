import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Fuel, TrendingUp } from 'lucide-react-native';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type FscRow = { id: string; month: string; percent: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 7 ? '-01' : ''));
  if (!Number.isFinite(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Shared Fuel Surcharge settings screen for trucking + drayage carriers. */
export default function FuelSurchargeScreen({ subtitle }: { subtitle?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const listQuery = trpc.fsc.list.useQuery(undefined, { refetchInterval: 60000 });
  const setFsc = trpc.fsc.set.useMutation();

  const rows = useMemo<FscRow[]>(() => (listQuery.data ?? []) as FscRow[], [listQuery.data]);
  const thisMonth = currentMonthIso();
  const currentRow = rows.find((r) => (r.month || '').slice(0, 7) === thisMonth.slice(0, 7));

  const [percent, setPercent] = useState<string>('');

  // Keep the input in sync when the current month's value loads.
  const currentPercent = currentRow ? Number(currentRow.percent) : null;
  const [touched, setTouched] = useState<boolean>(false);
  if (!touched && currentPercent != null && percent === '') {
    // one-time seed
    setPercent(String(currentPercent));
    setTouched(true);
  }

  const save = useCallback(() => {
    const val = Number(percent);
    if (!Number.isFinite(val) || val < 0 || val > 100) { Alert.alert('Enter a percent between 0 and 100'); return; }
    setFsc.mutate({ month: thisMonth, percent: val }, {
      onSuccess: async () => { await utils.fsc.list.invalidate(); await utils.fsc.current.invalidate(); Alert.alert('Saved', `Fuel surcharge for ${monthLabel(thisMonth)} set to ${val}%.`); },
      onError: (e) => Alert.alert('Unable to save', e instanceof Error ? e.message : 'Error'),
    });
  }, [percent, thisMonth, setFsc, utils]);

  if (listQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading fuel surcharge" /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/' as never); } }} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fuel surcharge</Text>
          <Text style={styles.subtitle}>{subtitle ?? 'Monthly percent added to freight on bills'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.currentCard}>
          <View style={styles.currentIcon}><Fuel size={20} color={C.blue} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.currentLabel}>{monthLabel(thisMonth)} surcharge</Text>
            <Text style={styles.currentValue}>{currentPercent != null ? `${currentPercent}%` : 'Not set'}</Text>
          </View>
        </View>

        <View style={styles.editCard}>
          <Text style={styles.editTitle}>Set this month&apos;s rate</Text>
          <Text style={styles.editHint}>Applied as a percent of freight on every bill and invoice this month, and shown as its own line in settlement.</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={percent}
              onChangeText={(v) => { setPercent(v); setTouched(true); }}
              keyboardType="numeric"
              placeholder="e.g. 12"
              placeholderTextColor={C.textMuted}
              style={styles.input}
            />
            <Text style={styles.percentSign}>%</Text>
          </View>
          <TouchableOpacity style={[styles.saveBtn, setFsc.isPending && { opacity: 0.6 }]} disabled={setFsc.isPending} onPress={save}>
            <Text style={styles.saveBtnText}>{setFsc.isPending ? 'Saving…' : `Save ${monthLabel(thisMonth)} rate`}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>History</Text>
        {rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No history yet" description="Once you set monthly rates, they appear here so you can track how your fuel surcharge changed over time." />
        ) : rows.map((r) => (
          <View key={r.id} style={styles.historyRow}>
            <Text style={styles.historyMonth}>{monthLabel(r.month)}</Text>
            <Text style={styles.historyPercent}>{Number(r.percent)}%</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 14 },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.blueDim, borderWidth: 1, borderColor: C.blue + '55', borderRadius: 16, padding: 16 },
  currentIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  currentLabel: { fontSize: 13, color: C.textSecondary },
  currentValue: { fontSize: 26, fontWeight: '900' as const, color: C.text, marginTop: 2 },
  editCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, gap: 10 },
  editTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  editHint: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, height: 50, color: C.text, fontSize: 18, fontWeight: '700' as const },
  percentSign: { fontSize: 20, fontWeight: '800' as const, color: C.textSecondary },
  saveBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, marginTop: 2 },
  saveBtnText: { fontSize: 15, fontWeight: '800' as const, color: C.white },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  historyMonth: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  historyPercent: { fontSize: 14, fontWeight: '800' as const, color: C.blue },
});
