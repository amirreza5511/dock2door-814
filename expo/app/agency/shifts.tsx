import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, X, UserCheck, Zap, CalendarDays } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface OpenShiftRow {
  id: string;
  title: string;
  category: string;
  location_address: string;
  location_city: string;
  date: string;
  start_time: string;
  end_time: string;
  hourly_rate: number | null;
  flat_rate: number | null;
  workers_needed: number;
  status: string;
}

interface AgencyWorkerRow {
  id: string;
  worker_user_id: string | null;
  name: string;
  email: string;
  status: 'Invited' | 'Active' | 'Removed';
}

interface AssignmentRow {
  assignment_id: string;
  shift_id: string;
  shift_title: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  location_city: string;
  employer_name: string | null;
  worker_name: string;
  rate: number;
  status: string;
}

function fmtTime(t: string): string {
  try {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch { return t; }
}

export default function AgencyShifts() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const shiftsQuery = trpc.shifts.listOpen.useQuery();
  const workersQuery = trpc.agency.workers.useQuery();
  const assignmentsQuery = trpc.agency.assignments.useQuery();
  const claimMutation = trpc.agency.claimShift.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.shifts.listOpen.invalidate(),
        utils.agency.assignments.invalidate(),
      ]);
    },
  });

  const shifts = useMemo(() => (shiftsQuery.data as OpenShiftRow[] | undefined) ?? [], [shiftsQuery.data]);
  const workers = useMemo(() => (workersQuery.data as AgencyWorkerRow[] | undefined) ?? [], [workersQuery.data]);
  const assignments = useMemo(() => (assignmentsQuery.data as AssignmentRow[] | undefined) ?? [], [assignmentsQuery.data]);

  const bookableWorkers = workers.filter((w) => w.status === 'Active' && !!w.worker_user_id);

  const [tab, setTab] = useState<'open' | 'placements'>('open');
  const [claimShift, setClaimShift] = useState<OpenShiftRow | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');

  const openClaim = (s: OpenShiftRow) => {
    setClaimError('');
    setSelectedWorkerId(null);
    setClaimShift(s);
  };

  const submitClaim = async () => {
    if (!claimShift || !selectedWorkerId) { setClaimError('Pick a worker for this shift'); return; }
    setClaimError('');
    try {
      await claimMutation.mutateAsync({ shiftId: claimShift.id, agencyWorkerId: selectedWorkerId });
      setClaimShift(null);
      Alert.alert('Shift claimed', 'Your worker was placed on this shift. The employer and your worker were notified.');
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Unable to claim shift');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Shifts</Text>
        <SupportMenu />
      </View>

      <View style={styles.tabRow}>
        {([
          { key: 'open', label: `Open shifts (${shifts.length})` },
          { key: 'placements', label: `My placements (${assignments.length})` },
        ] as const).map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'open' ? (
        shiftsQuery.isLoading ? (
          <View style={styles.center}><ScreenFeedback state="loading" title="Loading open shifts" /></View>
        ) : shifts.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No open shifts right now</Text>
            <Text style={styles.emptyMsg}>When employers post shifts, you can claim them for your workers here.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
            <View style={styles.premiumNote}>
              <Zap size={13} color={C.yellow} />
              <Text style={styles.premiumNoteText}>
                Agency placements pay a small extra platform fee, deducted from your payout — not from the worker.
              </Text>
            </View>
            {shifts.map((s) => (
              <Card key={s.id} style={styles.shiftCard}>
                <Text style={styles.shiftTitle}>{s.title}</Text>
                <View style={styles.metaRow}>
                  <CalendarDays size={13} color={C.textMuted} />
                  <Text style={styles.metaText}>{s.date} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}</Text>
                </View>
                {s.location_city ? (
                  <View style={styles.metaRow}>
                    <MapPin size={13} color={C.textMuted} />
                    <Text style={styles.metaText}>{s.location_city}</Text>
                  </View>
                ) : null}
                <View style={styles.metaRow}>
                  <DollarSign size={13} color={C.green} />
                  <Text style={[styles.metaText, { color: C.green, fontWeight: '700' as const }]}>
                    {s.hourly_rate ? `$${Number(s.hourly_rate).toFixed(2)}/h` : s.flat_rate ? `$${Number(s.flat_rate).toFixed(2)} flat` : 'Rate TBD'}
                  </Text>
                  <Clock size={13} color={C.textMuted} style={{ marginLeft: 8 }} />
                  <Text style={styles.metaText}>{s.workers_needed} needed</Text>
                </View>
                <Button
                  label="Claim for my worker"
                  onPress={() => openClaim(s)}
                  fullWidth
                  size="sm"
                />
              </Card>
            ))}
          </ScrollView>
        )
      ) : assignmentsQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading placements" /></View>
      ) : assignments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No placements yet</Text>
          <Text style={styles.emptyMsg}>Shifts you claim (or your workers get accepted to) appear here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {assignments.map((a) => (
            <Card key={a.assignment_id} style={styles.placementCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.shiftTitle}>{a.shift_title}</Text>
                <Text style={styles.metaText}>{a.worker_name} · {a.employer_name ?? 'Employer'}</Text>
                <Text style={styles.metaText}>{a.shift_date} · {fmtTime(a.start_time)} – {fmtTime(a.end_time)}{a.location_city ? ` · ${a.location_city}` : ''}</Text>
              </View>
              <View style={styles.statusPill}><Text style={styles.statusPillText}>{a.status}</Text></View>
            </Card>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!claimShift} animationType="slide" transparent onRequestClose={() => setClaimShift(null)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Claim shift</Text>
              <TouchableOpacity onPress={() => setClaimShift(null)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            {claimShift ? <Text style={styles.modalShift}>{claimShift.title} · {claimShift.date}</Text> : null}
            <Text style={styles.modalLabel}>Pick a worker from your roster</Text>
            {bookableWorkers.length === 0 ? (
              <Text style={styles.modalEmpty}>
                No bookable workers yet. Workers must be on your roster AND have a linked Dock2Door Worker account
                (same email) before you can book them.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {bookableWorkers.map((w) => {
                  const selected = selectedWorkerId === w.id;
                  return (
                    <TouchableOpacity key={w.id} onPress={() => setSelectedWorkerId(w.id)} style={[styles.workerRow, selected && styles.workerRowSelected]}>
                      <UserCheck size={16} color={selected ? C.accent : C.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.workerName, selected && { color: C.accent }]}>{w.name}</Text>
                        {w.email ? <Text style={styles.workerEmail}>{w.email}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.premiumNote}>
              <Zap size={13} color={C.yellow} />
              <Text style={styles.premiumNoteText}>
                Payment for this shift goes to your agency; you pay your worker. An agency premium fee is deducted
                from your payout by the platform.
              </Text>
            </View>
            {claimError ? <Text style={styles.error}>{claimError}</Text> : null}
            <Button
              label="Confirm placement"
              onPress={submitClaim}
              loading={claimMutation.isPending}
              disabled={!selectedWorkerId}
              fullWidth
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  tabTextActive: { color: C.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  list: { paddingHorizontal: 16 },
  premiumNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, marginBottom: 12,
  },
  premiumNoteText: { flex: 1, fontSize: 11, color: C.textSecondary, lineHeight: 16 },
  shiftCard: { padding: 14, marginBottom: 10, gap: 7 },
  shiftTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: C.textSecondary },
  placementCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.accentDim },
  statusPillText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalShift: { fontSize: 13, color: C.textSecondary },
  modalLabel: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  modalEmpty: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  workerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card, marginBottom: 6,
  },
  workerRowSelected: { borderColor: C.accent, backgroundColor: C.accentDim },
  workerName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  workerEmail: { fontSize: 11, color: C.textMuted },
  error: { fontSize: 12, color: C.red },
});
