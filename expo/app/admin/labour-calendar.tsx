import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AlertTriangle, Users, UserX, UserPlus, CheckCircle } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import CalendarView, { CalendarEvent } from '@/components/CalendarView';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  workers_needed: number;
  employer_company_id: string;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
}

interface ConflictRow {
  worker_user_id: string;
  shift_a: string;
  shift_b: string;
  date: string;
}

export default function AdminLabourCalendar() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<'calendar' | 'conflicts' | 'assign'>('calendar');
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [assignReason, setAssignReason] = useState('Admin scheduling');
  const [replaceAssignmentId, setReplaceAssignmentId] = useState('');
  const [approveTimeEntryId, setApproveTimeEntryId] = useState('');

  const shiftsQ = useQuery({
    queryKey: ['admin-shifts-cal'],
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await supabase
        .from('shift_posts')
        .select('id,title,category,date,start_time,end_time,status,workers_needed,employer_company_id')
        .order('date', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as ShiftRow[];
    },
  });

  const assignmentsQ = useQuery({
    queryKey: ['admin-assignments-cal'],
    queryFn: async (): Promise<AssignmentRow[]> => {
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,worker_user_id,status')
        .in('status', ['Scheduled', 'InProgress']);
      if (error) throw new Error(error.message);
      return (data ?? []) as AssignmentRow[];
    },
  });

  const conflicts = useMemo<ConflictRow[]>(() => {
    const out: ConflictRow[] = [];
    const shifts = shiftsQ.data ?? [];
    const assigns = assignmentsQ.data ?? [];
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const byWorker = new Map<string, { shift: ShiftRow; assignmentId: string }[]>();
    for (const a of assigns) {
      const s = shiftMap.get(a.shift_id);
      if (!s) continue;
      const arr = byWorker.get(a.worker_user_id) ?? [];
      arr.push({ shift: s, assignmentId: a.id });
      byWorker.set(a.worker_user_id, arr);
    }
    for (const [worker, list] of byWorker) {
      list.sort((x, y) => (x.shift.date + x.shift.start_time).localeCompare(y.shift.date + y.shift.start_time));
      for (let i = 0; i < list.length - 1; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i].shift; const B = list[j].shift;
          if (A.date !== B.date) continue;
          if (!(A.end_time <= B.start_time || A.start_time >= B.end_time)) {
            out.push({ worker_user_id: worker, shift_a: A.id, shift_b: B.id, date: A.date });
          }
        }
      }
    }
    return out;
  }, [shiftsQ.data, assignmentsQ.data]);

  const events: CalendarEvent[] = useMemo(() => (shiftsQ.data ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    startTime: s.start_time,
    endTime: s.end_time,
    title: s.title,
    subtitle: `${s.category} · ${s.workers_needed} needed · ${s.status}`,
    color: s.status === 'Filled' ? C.green : s.status === 'Cancelled' ? C.red : s.status === 'Posted' ? C.accent : C.blue,
  })), [shiftsQ.data]);

  const assignMut = trpc.shifts.adminAssign.useMutation({
    onSuccess: async () => {
      await utils.dock.bootstrap.invalidate();
      void qc.invalidateQueries({ queryKey: ['admin-shifts-cal'] });
      void qc.invalidateQueries({ queryKey: ['admin-assignments-cal'] });
      Alert.alert('Assigned', 'Worker was assigned and notified.');
    },
    onError: (err: Error) => Alert.alert('Assignment failed', err.message),
  });

  const payrollMut = trpc.shifts.adminApproveTimeEntry.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); Alert.alert('Payroll ready', 'Timesheet is invoice/payroll ready.'); },
    onError: (err: Error) => Alert.alert('Approval failed', err.message),
  });

  const noShowMut = useMutation({
    mutationFn: async ({ shiftId, workerId, reason }: { shiftId: string; workerId: string; reason: string }) => {
      const { error } = await supabase.rpc('mark_shift_no_show', {
        p_shift_id: shiftId, p_worker_user_id: workerId, p_reason: reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-shifts-cal'] });
      void qc.invalidateQueries({ queryKey: ['admin-assignments-cal'] });
    },
    onError: (err: unknown) => Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Labour Calendar</Text>
        <View style={styles.tabs}>
          <TouchableOpacity onPress={() => setTab('calendar')} style={[styles.tab, tab === 'calendar' && styles.tabActive]}>
            <Users size={14} color={tab === 'calendar' ? C.accent : C.textSecondary} />
            <Text style={[styles.tabText, tab === 'calendar' && styles.tabTextActive]}>Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('conflicts')} style={[styles.tab, tab === 'conflicts' && styles.tabActive]}>
            <AlertTriangle size={14} color={tab === 'conflicts' ? C.red : C.textSecondary} />
            <Text style={[styles.tabText, tab === 'conflicts' && styles.tabTextActive]}>Conflicts ({conflicts.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('assign')} style={[styles.tab, tab === 'assign' && styles.tabActive]}>
            <UserPlus size={14} color={tab === 'assign' ? C.accent : C.textSecondary} />
            <Text style={[styles.tabText, tab === 'assign' && styles.tabTextActive]}>Assign</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === 'assign' ? (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}> 
          <Card style={styles.assignCard}>
            <Text style={styles.sectionTitle}>Assign / replace worker</Text>
            <Input label="Shift ID" value={selectedShiftId} onChangeText={setSelectedShiftId} placeholder="Paste shift id" />
            <Input label="Worker user ID" value={workerId} onChangeText={setWorkerId} placeholder="Paste worker user id" />
            <Input label="Replace assignment ID (optional)" value={replaceAssignmentId} onChangeText={setReplaceAssignmentId} placeholder="Existing assignment id" />
            <Input label="Reason" value={assignReason} onChangeText={setAssignReason} placeholder="Coverage / replacement / dispatch" />
            <Button label={assignMut.isPending ? 'Assigning…' : 'Assign Worker'} onPress={() => assignMut.mutate({ shiftId: selectedShiftId, workerUserId: workerId, replaceAssignmentId: replaceAssignmentId || undefined, reason: assignReason })} disabled={!selectedShiftId || !workerId || assignMut.isPending} fullWidth icon={<UserPlus size={15} color={C.white} />} />
          </Card>
          <Card style={styles.assignCard}>
            <Text style={styles.sectionTitle}>Final payroll approval</Text>
            <Input label="Time entry ID" value={approveTimeEntryId} onChangeText={setApproveTimeEntryId} placeholder="Paste time_entries.id" />
            <Button label={payrollMut.isPending ? 'Approving…' : 'Mark invoice/payroll ready'} onPress={() => payrollMut.mutate({ timeEntryId: approveTimeEntryId })} disabled={!approveTimeEntryId || payrollMut.isPending} fullWidth icon={<CheckCircle size={15} color={C.white} />} />
          </Card>
          <Card><Text style={styles.empty}>Tip: tap a calendar event to copy its shift ID from the alert. Conflict checks run server-side before assignment.</Text></Card>
        </ScrollView>
      ) : tab === 'calendar' ? (
        <View style={styles.body}>
          <CalendarView
            events={events}
            initialMode="month"
            onSelectEvent={(e) => {
              const meta = e.subtitle ?? '';
              setSelectedShiftId(e.id);
              Alert.alert(e.title, `${e.date} ${e.startTime}-${e.endTime}\nShift ID: ${e.id}\n${meta}`);
            }}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}>
          {conflicts.length === 0 ? (
            <Card><Text style={styles.empty}>No scheduling conflicts detected.</Text></Card>
          ) : conflicts.map((c, i) => (
            <Card key={`${c.worker_user_id}-${i}`} style={styles.conflictCard}>
              <View style={styles.conflictHead}>
                <AlertTriangle size={14} color={C.red} />
                <Text style={styles.conflictDate}>{c.date}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push(`/worker/${c.worker_user_id}`)}>
                <Text style={styles.conflictWorker}>Worker: {c.worker_user_id.slice(0, 8)}…</Text>
              </TouchableOpacity>
              <Text style={styles.conflictMeta}>Shift A: {c.shift_a.slice(0, 8)}…</Text>
              <Text style={styles.conflictMeta}>Shift B: {c.shift_b.slice(0, 8)}…</Text>
              <TouchableOpacity
                style={styles.noShowBtn}
                onPress={() => Alert.alert('Mark no-show?', 'Confirms worker did not show up. Cancels assignment + adds at-risk badge.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Mark', style: 'destructive', onPress: () => noShowMut.mutate({ shiftId: c.shift_a, workerId: c.worker_user_id, reason: 'Conflict resolution' }) },
                ])}
              >
                <UserX size={12} color={C.red} />
                <Text style={styles.noShowText}>Mark no-show</Text>
              </TouchableOpacity>
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  body: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginBottom: 8 },
  assignCard: { gap: 10 },
  empty: { color: C.textMuted, textAlign: 'center', fontSize: 13, fontStyle: 'italic' as const },
  conflictCard: { borderLeftWidth: 3, borderLeftColor: C.red, gap: 6 },
  conflictHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  conflictDate: { fontSize: 13, fontWeight: '700' as const, color: C.red },
  conflictWorker: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  conflictMeta: { fontSize: 12, color: C.textSecondary },
  noShowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: C.redDim, marginTop: 4 },
  noShowText: { fontSize: 11, color: C.red, fontWeight: '700' as const },
});
