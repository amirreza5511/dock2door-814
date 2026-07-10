import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import Card from '@/components/ui/Card';
import SupportMenu from '@/components/SupportMenu';

interface AvailabilityRow {
  id: string;
  worker_user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  kind: 'available' | 'unavailable' | 'preferred';
  preferred_area: string | null;
  preferred_category: string | null;
  notes: string | null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WorkerAvailability() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const availQ = useQuery({
    queryKey: ['my-availability', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<AvailabilityRow[]> => {
      const { data, error } = await supabase
        .from('worker_availability')
        .select('id,worker_user_id,date,start_time,end_time,kind,preferred_area,preferred_category,notes')
        .eq('worker_user_id', user!.id)
        .gte('date', today)
        .order('date');
      if (error) throw new Error(error.message);
      return (data ?? []) as AvailabilityRow[];
    },
  });

  const offByDate = new Map<string, AvailabilityRow>();
  for (const r of availQ.data ?? []) {
    if (r.kind === 'unavailable' && !offByDate.has(r.date)) offByDate.set(r.date, r);
  }

  const markOff = useMutation({
    mutationFn: async (iso: string) => {
      const { error } = await supabase.rpc('set_my_availability', {
        p_date: iso,
        p_start: '00:00',
        p_end: '23:59',
        p_kind: 'unavailable',
        p_preferred_area: null,
        p_preferred_category: null,
        p_notes: '',
      });
      if (error) throw new Error(error.message);
    },
    onError: (err: unknown) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error'),
    onSettled: () => { setBusyDate(null); void qc.invalidateQueries({ queryKey: ['my-availability', user?.id] }); },
  });

  const markAvailable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_my_availability', { p_id: id });
      if (error) throw new Error(error.message);
    },
    onError: (err: unknown) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error'),
    onSettled: () => { setBusyDate(null); void qc.invalidateQueries({ queryKey: ['my-availability', user?.id] }); },
  });

  const toggle = (iso: string) => {
    if (iso < today) return;
    setBusyDate(iso);
    const off = offByDate.get(iso);
    if (off) markAvailable.mutate(off.id);
    else markOff.mutate(iso);
  };

  const monthStart = new Date(cursor);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const offList = [...offByDate.values()];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerTopRow}>
        <Text style={styles.title}>My Availability</Text>
        <SupportMenu />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={availQ.isRefetching} onRefresh={() => availQ.refetch()} tintColor={C.accent} colors={[C.accent]} />
        }
      >
        <Text style={styles.subtitle}>
          You&apos;re available every day by default. Tap the days you can&apos;t work to mark them off.
        </Text>

        <Card style={styles.calCard}>
          <View style={styles.calHeader}>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.navBtn} onPress={() => setCursor((c) => { const d = new Date(c); d.setMonth(d.getMonth() - 1); return d; })}>
                <ChevronLeft size={18} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.navBtn} onPress={() => setCursor((c) => { const d = new Date(c); d.setMonth(d.getMonth() + 1); return d; })}>
                <ChevronRight size={18} color={C.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.dowRow}>
            {DOW.map((d) => <Text key={d} style={styles.dowText}>{d}</Text>)}
          </View>

          <View style={styles.grid}>
            {cells.map((d) => {
              const iso = fmt(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = iso === today;
              const isPast = iso < today;
              const isOff = offByDate.has(iso);
              const isBusy = busyDate === iso;
              return (
                <TouchableOpacity
                  key={iso}
                  activeOpacity={0.7}
                  disabled={isPast || isBusy}
                  onPress={() => toggle(iso)}
                  style={[
                    styles.cell,
                    isPast ? styles.cellPast : isOff ? styles.cellOff : styles.cellAvail,
                    !inMonth && styles.cellOutMonth,
                    isToday && !isPast && styles.cellToday,
                    isBusy && styles.cellBusy,
                  ]}
                >
                  <Text style={[styles.cellText, isPast ? styles.cellTextPast : isOff ? styles.cellTextOff : styles.cellTextAvail]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.legendText}>Available (default)</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.textMuted }]} /><Text style={styles.legendText}>Off</Text></View>
          </View>
        </Card>

        <Card style={styles.listCard}>
          <Text style={styles.formTitle}>Days off</Text>
          {offList.length === 0 ? (
            <Text style={styles.empty}>You&apos;re available every upcoming day.</Text>
          ) : offList.map((r) => (
            <View key={r.id} style={styles.row}>
              <Text style={styles.rowText}>
                {new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
              <TouchableOpacity onPress={() => { setBusyDate(r.date); markAvailable.mutate(r.id); }} disabled={busyDate === r.date}>
                <Text style={styles.makeAvail}>Make available</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
        <View style={{ height: insets.bottom + 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, paddingBottom: 12 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20 },
  scroll: { padding: 20, gap: 16 },
  subtitle: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  calCard: { gap: 12 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  navRow: { flexDirection: 'row', gap: 8 },
  navBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  dowRow: { flexDirection: 'row' },
  dowText: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, marginVertical: 1 },
  cellAvail: { backgroundColor: C.green + '22', borderColor: C.green + '55' },
  cellOff: { backgroundColor: C.bgSecondary, borderColor: 'transparent' },
  cellPast: { backgroundColor: 'transparent', borderColor: 'transparent' },
  cellOutMonth: { opacity: 0.3 },
  cellToday: { borderColor: C.accent, borderWidth: 2 },
  cellBusy: { opacity: 0.5 },
  cellText: { fontSize: 14, fontWeight: '600' as const },
  cellTextAvail: { color: C.text },
  cellTextOff: { color: C.textMuted, textDecorationLine: 'line-through' as const },
  cellTextPast: { color: C.textMuted, opacity: 0.5 },
  legend: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: C.textSecondary },
  listCard: { gap: 8 },
  formTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  empty: { color: C.textMuted, fontStyle: 'italic' as const, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  rowText: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  makeAvail: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
});
