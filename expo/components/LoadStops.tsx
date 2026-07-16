import React, { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, MapPin, Plus, Trash2 } from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export type LoadStop = {
  id: string; load_id: string; seq: number; kind: string;
  label?: string | null; address?: string | null; city?: string | null;
  lat?: number | null; lng?: number | null; status: string; completed_at?: string | null;
};

export function useLoadStops(loadId: string | null, enabled: boolean = true) {
  return trpc.loads.stops.useQuery({ loadId: loadId ?? '' }, { enabled: enabled && !!loadId, refetchInterval: 20000 });
}

/** Driver-facing checklist: tap each stop to mark it done / undone. */
export function LoadStopsChecklist({ loadId }: { loadId: string }) {
  const query = useLoadStops(loadId);
  const complete = trpc.loads.completeStop.useMutation({ onSuccess: () => void query.refetch() });
  const stops = useMemo<LoadStop[]>(() => (query.data ?? []) as LoadStop[], [query.data]);
  if (stops.length === 0) return null;

  const doneCount = stops.filter((s) => s.status === 'Done').length;

  const toggle = (s: LoadStop) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    complete.mutate({ stopId: s.id, done: s.status !== 'Done' }, {
      onError: (e) => Alert.alert('Unable to update stop', e instanceof Error ? e.message : 'Error'),
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <MapPin size={14} color={C.accent} />
        <Text style={styles.headText}>Stops · {doneCount}/{stops.length} done</Text>
      </View>
      {stops.map((s, i) => {
        const done = s.status === 'Done';
        return (
          <TouchableOpacity key={s.id} style={styles.stopRow} disabled={complete.isPending} onPress={() => toggle(s)}>
            <View style={[styles.check, done && styles.checkOn]}>
              {done ? <Check size={13} color={C.white} /> : <Text style={styles.checkNum}>{i + 1}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.stopTitle, done && styles.stopTitleDone]} numberOfLines={1}>
                {s.label || s.address || `${s.kind} stop`}
              </Text>
              <Text style={styles.stopMeta} numberOfLines={1}>{s.kind}{s.city ? ` · ${s.city}` : ''}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type DraftStop = { kind: string; label: string; address: string; city: string };

/** Dispatcher-facing editor: add / remove ordered stops for a load. */
export function LoadStopsEditor({ loadId, onSaved }: { loadId: string; onSaved?: () => void }) {
  const query = useLoadStops(loadId);
  const save = trpc.loads.setStops.useMutation();
  const existing = useMemo<LoadStop[]>(() => (query.data ?? []) as LoadStop[], [query.data]);
  const [drafts, setDrafts] = useState<DraftStop[] | null>(null);

  const list = drafts ?? existing.map((s) => ({ kind: s.kind, label: s.label ?? '', address: s.address ?? '', city: s.city ?? '' }));

  const update = (i: number, patch: Partial<DraftStop>) => {
    setDrafts(list.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };
  const add = () => setDrafts([...list, { kind: 'Dropoff', label: '', address: '', city: '' }]);
  const remove = (i: number) => setDrafts(list.filter((_, idx) => idx !== i));

  const persist = () => {
    const clean = list
      .filter((d) => (d.label.trim() || d.address.trim()))
      .map((d) => ({ kind: d.kind, label: d.label.trim(), address: d.address.trim(), city: d.city.trim() }));
    save.mutate({ loadId, stops: clean }, {
      onSuccess: async () => { setDrafts(null); await query.refetch(); onSaved?.(); },
      onError: (e) => Alert.alert('Unable to save stops', e instanceof Error ? e.message : 'Error'),
    });
  };

  return (
    <View style={{ gap: 10 }}>
      {list.length === 0 ? (
        <Text style={styles.emptyText}>No extra stops. Add multi-pickup or multi-drop stops below.</Text>
      ) : list.map((d, i) => (
        <View key={i} style={styles.editRow}>
          <View style={styles.kindToggle}>
            {(['Pickup', 'Dropoff'] as const).map((k) => (
              <TouchableOpacity key={k} style={[styles.kindChip, d.kind === k && styles.kindChipOn]} onPress={() => update(i, { kind: k })}>
                <Text style={[styles.kindChipText, d.kind === k && styles.kindChipTextOn]}>{k}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.removeBtn} onPress={() => remove(i)}><Trash2 size={14} color={C.red} /></TouchableOpacity>
          </View>
          <TextInput value={d.label} onChangeText={(t) => update(i, { label: t })} placeholder="Label (e.g. Warehouse B)" placeholderTextColor={C.textMuted} style={styles.input} />
          <TextInput value={d.address} onChangeText={(t) => update(i, { address: t })} placeholder="Address" placeholderTextColor={C.textMuted} style={styles.input} />
          <TextInput value={d.city} onChangeText={(t) => update(i, { city: t })} placeholder="City" placeholderTextColor={C.textMuted} style={styles.input} />
        </View>
      ))}
      <View style={styles.editActions}>
        <TouchableOpacity style={styles.addBtn} onPress={add}>
          <Plus size={15} color={C.accent} />
          <Text style={styles.addBtnText}>Add stop</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} disabled={save.isPending || drafts === null} onPress={persist}>
          <Text style={styles.saveBtnText}>{save.isPending ? 'Saving…' : 'Save stops'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkNum: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary },
  stopTitle: { fontSize: 13.5, fontWeight: '700' as const, color: C.text },
  stopTitleDone: { textDecorationLine: 'line-through' as const, color: C.textMuted },
  stopMeta: { fontSize: 11.5, color: C.textMuted, marginTop: 1 },
  emptyText: { fontSize: 12.5, color: C.textMuted, lineHeight: 18 },
  editRow: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, gap: 8 },
  kindToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  kindChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  kindChipText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  kindChipTextOn: { color: C.accent },
  removeBtn: { marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.redDim },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, height: 42, color: C.text, fontSize: 13 },
  editActions: { flexDirection: 'row', gap: 10 },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55', borderRadius: 12, paddingVertical: 12 },
  addBtnText: { fontSize: 13.5, fontWeight: '800' as const, color: C.accent },
  saveBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12 },
  saveBtnText: { fontSize: 13.5, fontWeight: '800' as const, color: C.white },
});
