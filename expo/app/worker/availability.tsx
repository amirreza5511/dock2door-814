import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, RefreshControl, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
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

type DayMode = 'default' | 'custom' | 'off';

const DEFAULT_START = '08:00';
const DEFAULT_END = '17:00';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hhmm(t: string): string {
  return (t ?? '').slice(0, 5);
}

export default function WorkerAvailability() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState<string | null>(null);
  const [editStart, setEditStart] = useState<string>(DEFAULT_START);
  const [editEnd, setEditEnd] = useState<string>(DEFAULT_END);
  const [editOff, setEditOff] = useState<boolean>(false);

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

  const rowByDate = new Map<string, AvailabilityRow>();
  for (const r of availQ.data ?? []) if (!rowByDate.has(r.date)) rowByDate.set(r.date, r);

  const modeFor = (iso: string): DayMode => {
    const r = rowByDate.get(iso);
    if (!r) return 'default';
    if (r.kind === 'unavailable') return 'off';
    return 'custom';
  };

  const saveMut = useMutation({
    mutationFn: async (payload: { date: string; mode: DayMode; start: string; end: string }) => {
      const existing = (availQ.data ?? []).filter((r) => r.date === payload.date);
      for (const r of existing) {
        const { error } = await supabase.rpc('delete_my_availability', { p_id: r.id });
        if (error) throw new Error(error.message);
      }
      if (payload.mode === 'default') return;
      if (payload.mode === 'off') {
        const { error } = await supabase.rpc('set_my_availability', {
          p_date: payload.date, p_start: '00:00', p_end: '23:59',
          p_kind: 'unavailable', p_preferred_area: null, p_preferred_category: null, p_notes: '',
        });
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await supabase.rpc('set_my_availability', {
        p_date: payload.date, p_start: payload.start, p_end: payload.end,
        p_kind: 'available', p_preferred_area: null, p_preferred_category: null, p_notes: '',
      });
      if (error) throw new Error(error.message);
    },
    onError: (err: unknown) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error'),
    onSuccess: () => { setSelected(null); void qc.invalidateQueries({ queryKey: ['my-availability', user?.id] }); },
  });

  const openDay = (iso: string) => {
    if (iso < today) return;
    const r = rowByDate.get(iso);
    setSelected(iso);
    if (r && r.kind === 'unavailable') {
      setEditOff(true); setEditStart(DEFAULT_START); setEditEnd(DEFAULT_END);
    } else if (r) {
      setEditOff(false); setEditStart(hhmm(r.start_time) || DEFAULT_START); setEditEnd(hhmm(r.end_time) || DEFAULT_END);
    } else {
      setEditOff(false); setEditStart(DEFAULT_START); setEditEnd(DEFAULT_END);
    }
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
  const offList = [...rowByDate.values()].filter((r) => r.kind === 'unavailable');

  const selLabel = selected
    ? new Date(selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

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
          You&apos;re available every day from 8:00 to 17:00 by default. Tap any day to mark it off or change its hours.
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
              const mode = modeFor(iso);
              const r = rowByDate.get(iso);
              return (
                <TouchableOpacity
                  key={iso}
                  activeOpacity={0.7}
                  disabled={isPast}
                  onPress={() => openDay(iso)}
                  style={[
                    styles.cell,
                    isPast ? styles.cellPast : mode === 'off' ? styles.cellOff : mode === 'custom' ? styles.cellCustom : styles.cellAvail,
                    !inMonth && styles.cellOutMonth,
                    isToday && !isPast && styles.cellToday,
                  ]}
                >
                  <Text style={[styles.cellText, isPast ? styles.cellTextPast : mode === 'off' ? styles.cellTextOff : styles.cellTextAvail]}>
                    {d.getDate()}
                  </Text>
                  {!isPast && mode === 'custom' && r ? (
                    <Text style={styles.cellHours}>{hhmm(r.start_time)}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.legendText}>Available 8–17</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.accent }]} /><Text style={styles.legendText}>Custom</Text></View>
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
              <TouchableOpacity onPress={() => saveMut.mutate({ date: r.date, mode: 'default', start: DEFAULT_START, end: DEFAULT_END })} disabled={saveMut.isPending}>
                <Text style={styles.makeAvail}>Make available</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
        <View style={{ height: insets.bottom + 80 }} />
      </ScrollView>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selLabel}</Text>
              <TouchableOpacity onPress={() => setSelected(null)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Set your hours for this day, or mark it as a day off.</Text>

            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modeBtn, !editOff && styles.modeBtnActive]} onPress={() => setEditOff(false)}>
                <Text style={[styles.modeText, !editOff && styles.modeTextActive]}>Working</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeBtn, editOff && styles.modeBtnActive]} onPress={() => setEditOff(true)}>
                <Text style={[styles.modeText, editOff && styles.modeTextActive]}>Day off</Text>
              </TouchableOpacity>
            </View>

            {!editOff && (
              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}><Input label="Start" value={editStart} onChangeText={setEditStart} placeholder="08:00" /></View>
                <View style={{ flex: 1 }}><Input label="End" value={editEnd} onChangeText={setEditEnd} placeholder="17:00" /></View>
              </View>
            )}

            <Button
              label={saveMut.isPending ? 'Saving…' : 'Save'}
              disabled={saveMut.isPending}
              fullWidth
              onPress={() => selected && saveMut.mutate({
                date: selected,
                mode: editOff ? 'off' : (editStart === DEFAULT_START && editEnd === DEFAULT_END ? 'default' : 'custom'),
                start: editStart,
                end: editEnd,
              })}
            />
            {selected && modeFor(selected) !== 'default' && (
              <TouchableOpacity style={styles.resetBtn} onPress={() => selected && saveMut.mutate({ date: selected, mode: 'default', start: DEFAULT_START, end: DEFAULT_END })} disabled={saveMut.isPending}>
                <Text style={styles.resetText}>Reset to default (8–17)</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
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
  cellCustom: { backgroundColor: C.accentDim, borderColor: C.accent },
  cellOff: { backgroundColor: C.bgSecondary, borderColor: 'transparent' },
  cellPast: { backgroundColor: 'transparent', borderColor: 'transparent' },
  cellOutMonth: { opacity: 0.3 },
  cellToday: { borderColor: C.accent, borderWidth: 2 },
  cellText: { fontSize: 14, fontWeight: '600' as const },
  cellTextAvail: { color: C.text },
  cellTextOff: { color: C.textMuted, textDecorationLine: 'line-through' as const },
  cellTextPast: { color: C.textMuted, opacity: 0.5 },
  cellHours: { fontSize: 8, color: C.accent, marginTop: 1 },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: C.textSecondary },
  listCard: { gap: 8 },
  formTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  empty: { color: C.textMuted, fontStyle: 'italic' as const, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  rowText: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  makeAvail: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  modalSub: { fontSize: 13, color: C.textSecondary },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary },
  modeBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  modeText: { fontSize: 14, fontWeight: '600' as const, color: C.textSecondary },
  modeTextActive: { color: C.accent },
  timeRow: { flexDirection: 'row', gap: 10 },
  resetBtn: { alignItems: 'center', paddingVertical: 6 },
  resetText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
});
