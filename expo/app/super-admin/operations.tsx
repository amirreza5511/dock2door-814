import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ship, Package, HardHat, CheckCircle2, Clock, Activity } from 'lucide-react-native';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';

type MoveRow = {
  id: string;
  order_id: string;
  move_type: string;
  status: string;
  driver_user_id: string | null;
  updated_at: string | null;
  created_at: string | null;
  drayage_orders: { reference_code?: string | null; container_number?: string | null; container_size?: string | null } | null;
};

type AssignmentRow = {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  created_at: string | null;
};

type ShiftRow = { id: string; title: string; category: string; date: string; start_time: string; end_time: string };
type ProfileRow = { id: string; name: string | null; email: string | null };

type OpsData = {
  moves: MoveRow[];
  assignments: AssignmentRow[];
  shiftsById: Record<string, ShiftRow>;
  namesById: Record<string, string>;
};

const DRAYAGE_ACTIVE = ['Assigned', 'EnRoute', 'AtOrigin', 'Loaded', 'InTransit', 'AtDestination', 'Unloaded'];
const SHIFT_ACTIVE = ['Scheduled', 'InProgress'];
const SHIFT_DONE = ['Completed', 'HoursConfirmed', 'Confirmed'];

type Filter = 'completed' | 'active' | 'all';

/** Super-admin operations log: every drayage move + worker shift the platform has run,
 * so the admin can see completed and in-progress jobs across all companies. */
export default function SuperAdminOperations() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('completed');

  const opsQuery = useQuery({
    queryKey: ['admin-operations-log'],
    staleTime: 20_000,
    queryFn: async (): Promise<OpsData> => {
      const [movesRes, assignRes] = await Promise.all([
        supabase
          .from('drayage_moves')
          .select('id,order_id,move_type,status,driver_user_id,updated_at,created_at,drayage_orders(reference_code,container_number,container_size)')
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase
          .from('shift_assignments')
          .select('id,shift_id,worker_user_id,status,created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      if (movesRes.error) throw new Error(movesRes.error.message);
      if (assignRes.error) throw new Error(assignRes.error.message);

      const moves = (movesRes.data ?? []) as unknown as MoveRow[];
      const assignments = (assignRes.data ?? []) as AssignmentRow[];

      const shiftIds = Array.from(new Set(assignments.map((a) => a.shift_id).filter(Boolean)));
      const userIds = Array.from(new Set([
        ...moves.map((m) => m.driver_user_id).filter(Boolean) as string[],
        ...assignments.map((a) => a.worker_user_id).filter(Boolean),
      ]));

      const [shiftsRes, profilesRes] = await Promise.all([
        shiftIds.length
          ? supabase.from('shift_posts').select('id,title,category,date,start_time,end_time').in('id', shiftIds)
          : Promise.resolve({ data: [] as ShiftRow[], error: null }),
        userIds.length
          ? supabase.from('profiles').select('id,name,email').in('id', userIds)
          : Promise.resolve({ data: [] as ProfileRow[], error: null }),
      ]);

      const shiftsById: Record<string, ShiftRow> = {};
      for (const s of (shiftsRes.data ?? []) as ShiftRow[]) shiftsById[s.id] = s;
      const namesById: Record<string, string> = {};
      for (const p of (profilesRes.data ?? []) as ProfileRow[]) namesById[p.id] = p.name ?? p.email ?? p.id.slice(0, 8);

      return { moves, assignments, shiftsById, namesById };
    },
  });

  const data = opsQuery.data;

  const moves = useMemo(() => {
    const all = data?.moves ?? [];
    if (filter === 'completed') return all.filter((m) => m.status === 'Completed');
    if (filter === 'active') return all.filter((m) => DRAYAGE_ACTIVE.includes(m.status));
    return all;
  }, [data?.moves, filter]);

  const assignments = useMemo(() => {
    const all = data?.assignments ?? [];
    if (filter === 'completed') return all.filter((a) => SHIFT_DONE.includes(a.status));
    if (filter === 'active') return all.filter((a) => SHIFT_ACTIVE.includes(a.status));
    return all;
  }, [data?.assignments, filter]);

  const counts = useMemo(() => {
    const m = data?.moves ?? [];
    const a = data?.assignments ?? [];
    return {
      completed: m.filter((x) => x.status === 'Completed').length + a.filter((x) => SHIFT_DONE.includes(x.status)).length,
      active: m.filter((x) => DRAYAGE_ACTIVE.includes(x.status)).length + a.filter((x) => SHIFT_ACTIVE.includes(x.status)).length,
    };
  }, [data?.moves, data?.assignments]);

  if (opsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading operations" /></View>;
  }
  if (opsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load operations" onRetry={() => void opsQuery.refetch()} /></View>;
  }

  const fmt = (ts: string | null) => (ts ? new Date(ts).toLocaleString() : '—');

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Operations Log</Text>
          <Text style={styles.subtitle}>Completed & in-progress jobs across all companies</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.stat, { borderLeftColor: C.green }]}><Text style={styles.statValue}>{counts.completed}</Text><Text style={styles.statLabel}>Completed</Text></View>
        <View style={[styles.stat, { borderLeftColor: C.accent }]}><Text style={styles.statValue}>{counts.active}</Text><Text style={styles.statLabel}>In progress</Text></View>
      </View>

      <View style={styles.filterRow}>
        {(['completed', 'active', 'all'] as Filter[]).map((k) => (
          <TouchableOpacity key={k} onPress={() => setFilter(k)} style={[styles.filterChip, filter === k && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === k && styles.filterTextActive]}>{k[0].toUpperCase() + k.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={opsQuery.isFetching} onRefresh={() => void opsQuery.refetch()} tintColor={C.accent} />}
      >
        {/* Drayage moves */}
        <View style={styles.sectionHeader}>
          <Ship size={15} color={C.accent} />
          <Text style={styles.sectionTitle}>Drayage jobs ({moves.length})</Text>
        </View>
        {moves.length === 0 ? (
          <Text style={styles.empty}>No drayage jobs in this view.</Text>
        ) : moves.map((m) => {
          const o = m.drayage_orders;
          const driver = m.driver_user_id ? (data?.namesById[m.driver_user_id] ?? m.driver_user_id.slice(0, 8)) : 'Unassigned';
          return (
            <View key={m.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{m.move_type} · {o?.reference_code ?? m.order_id.slice(0, 8)}</Text>
                  <View style={styles.metaRow}><Package size={11} color={C.textMuted} /><Text style={styles.metaText}>{o?.container_number || 'Container TBD'}{o?.container_size ? ` · ${o.container_size}` : ''}</Text></View>
                  <View style={styles.metaRow}><HardHat size={11} color={C.textMuted} /><Text style={styles.metaText}>Driver: {driver}</Text></View>
                  <View style={styles.metaRow}>{m.status === 'Completed' ? <CheckCircle2 size={11} color={C.green} /> : <Clock size={11} color={C.textMuted} />}<Text style={styles.metaText}>{fmt(m.updated_at ?? m.created_at)}</Text></View>
                </View>
                <StatusBadge status={m.status} />
              </View>
            </View>
          );
        })}

        {/* Worker shifts */}
        <View style={[styles.sectionHeader, { marginTop: 18 }]}>
          <HardHat size={15} color={C.blue} />
          <Text style={styles.sectionTitle}>Worker shifts ({assignments.length})</Text>
        </View>
        {assignments.length === 0 ? (
          <Text style={styles.empty}>No worker shifts in this view.</Text>
        ) : assignments.map((a) => {
          const shift = data?.shiftsById[a.shift_id];
          const worker = data?.namesById[a.worker_user_id] ?? a.worker_user_id.slice(0, 8);
          const done = SHIFT_DONE.includes(a.status);
          return (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{shift?.title ?? 'Shift'}</Text>
                  {shift ? <View style={styles.metaRow}><Activity size={11} color={C.textMuted} /><Text style={styles.metaText}>{shift.category} · {shift.date} {shift.start_time}–{shift.end_time}</Text></View> : null}
                  <View style={styles.metaRow}><HardHat size={11} color={C.textMuted} /><Text style={styles.metaText}>Worker: {worker}</Text></View>
                  <View style={styles.metaRow}>{done ? <CheckCircle2 size={11} color={C.green} /> : <Clock size={11} color={C.textMuted} />}<Text style={styles.metaText}>{fmt(a.created_at)}</Text></View>
                </View>
                <StatusBadge status={a.status} />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.bgSecondary },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, padding: 10 },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  filterTextActive: { color: C.accent },
  body: { padding: 16, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardTop: { flexDirection: 'row', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' as const },
  metaText: { fontSize: 11, color: C.textSecondary },
  empty: { fontSize: 13, color: C.textMuted, fontStyle: 'italic' as const, paddingVertical: 8 },
});
