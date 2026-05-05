import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Clock } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import CalendarView, { CalendarEvent } from '@/components/CalendarView';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

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

export default function WorkerAvailability() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState<string>('09:00');
  const [end, setEnd] = useState<string>('17:00');
  const [area, setArea] = useState<string>('');
  const [kind, setKind] = useState<'available' | 'unavailable' | 'preferred'>('available');

  const availQ = useQuery({
    queryKey: ['my-availability', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<AvailabilityRow[]> => {
      const { data, error } = await supabase
        .from('worker_availability')
        .select('id,worker_user_id,date,start_time,end_time,kind,preferred_area,preferred_category,notes')
        .eq('worker_user_id', user!.id)
        .order('date');
      if (error) throw new Error(error.message);
      return (data ?? []) as AvailabilityRow[];
    },
  });

  const events: CalendarEvent[] = (availQ.data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    title: r.kind === 'available' ? 'Available' : r.kind === 'preferred' ? 'Preferred' : 'Off',
    subtitle: r.preferred_area ?? '',
    color: r.kind === 'available' ? C.green : r.kind === 'preferred' ? C.accent : C.textMuted,
  }));

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_my_availability', {
        p_date: selectedDate,
        p_start: start,
        p_end: end,
        p_kind: kind,
        p_preferred_area: area,
        p_preferred_category: null,
        p_notes: '',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-availability', user?.id] }); },
    onError: (err: unknown) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_my_availability', { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-availability', user?.id] }); },
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>My Availability</Text>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <CalendarView
          events={events}
          initialMode="week"
          onSelectDate={setSelectedDate}
          onSelectEvent={(e) => {
            Alert.alert('Remove?', `${e.date} ${e.startTime}-${e.endTime}`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(e.id) },
            ]);
          }}
        />

        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Add Availability</Text>
          <Text style={styles.formMeta}>Date: {selectedDate}</Text>
          <View style={styles.kindRow}>
            {(['available', 'preferred', 'unavailable'] as const).map((k) => (
              <TouchableOpacity key={k} onPress={() => setKind(k)} style={[styles.kindChip, kind === k && styles.kindChipActive]}>
                <Text style={[styles.kindText, kind === k && styles.kindTextActive]}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}><Input label="Start" value={start} onChangeText={setStart} placeholder="09:00" /></View>
            <View style={{ flex: 1 }}><Input label="End" value={end} onChangeText={setEnd} placeholder="17:00" /></View>
          </View>
          <Input label="Preferred Area (optional)" value={area} onChangeText={setArea} placeholder="Vancouver" />
          <Button label={addMut.isPending ? 'Adding...' : 'Add to Calendar'} onPress={() => addMut.mutate()} disabled={addMut.isPending} icon={<Plus size={15} color={C.white} />} fullWidth />
        </Card>

        <Card style={styles.listCard}>
          <Text style={styles.formTitle}>Upcoming</Text>
          {(availQ.data ?? []).length === 0 ? (
            <Text style={styles.empty}>No availability set yet.</Text>
          ) : (availQ.data ?? []).map((r) => (
            <View key={r.id} style={styles.row}>
              <Clock size={14} color={C.textSecondary} />
              <Text style={styles.rowText}>{r.date} {r.start_time}–{r.end_time} · {r.kind}</Text>
              <TouchableOpacity onPress={() => deleteMut.mutate(r.id)}>
                <Trash2 size={14} color={C.red} />
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
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, paddingHorizontal: 20, paddingBottom: 12 },
  scroll: { padding: 20, gap: 16 },
  formCard: { gap: 12 },
  formTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  formMeta: { fontSize: 12, color: C.textSecondary },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary },
  kindChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  kindText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  kindTextActive: { color: C.accent },
  timeRow: { flexDirection: 'row', gap: 10 },
  listCard: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  rowText: { flex: 1, fontSize: 13, color: C.text },
  empty: { color: C.textMuted, fontStyle: 'italic' as const, fontSize: 13 },
});
