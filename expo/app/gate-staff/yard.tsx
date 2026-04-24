import React, { useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Calendar, CircleDot, Clock, DoorOpen, MoveRight, Pause, PlayCircle, Truck, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Appt = {
  id: string; status: string; dock_door?: string | null; truck_plate?: string | null; driver_name?: string | null;
  scheduled_start: string; appointment_type: string; pallet_count?: number;
};
type GateEvent = { id: string; appointment_id: string; kind: string; notes?: string; occurred_at: string };
type YardMove = { id: string; kind?: string; from_location?: string; to_location?: string; truck_plate?: string; trailer_number?: string; created_at: string };

const DOORS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];

type Tab = 'board' | 'queue' | 'events' | 'moves';

export default function YardBoardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>('board');

  const panelQuery = trpc.operations.gatePanel.useQuery();
  const eventsQuery = trpc.yard.listEvents.useQuery();
  const movesQuery = trpc.yard.listMoves.useQuery();
  const statusMutation = trpc.operations.checkInAppointment.useMutation({
    onSuccess: async () => {
      await utils.operations.gatePanel.invalidate();
      await utils.yard.listEvents.invalidate();
    },
  });
  const recordMutation = trpc.yard.recordEvent.useMutation({
    onSuccess: async () => {
      await utils.yard.listEvents.invalidate();
      await utils.operations.gatePanel.invalidate();
    },
  });

  const [holdFor, setHoldFor] = useState<string | null>(null);
  const [holdNotes, setHoldNotes] = useState('');
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignDoor, setAssignDoor] = useState('');

  const appointments = useMemo<Appt[]>(() => (panelQuery.data ?? []) as Appt[], [panelQuery.data]);

  const doorOccupancy = useMemo(() => {
    const map: Record<string, Appt | null> = {};
    for (const d of DOORS) map[d] = null;
    for (const a of appointments) {
      const door = a.dock_door ? String(a.dock_door).toUpperCase() : null;
      if (!door) continue;
      if (['AtDoor', 'Loading', 'Unloading', 'CheckedIn', 'AtGate'].includes(a.status)) {
        if (!map[door]) map[door] = a;
      }
    }
    return map;
  }, [appointments]);

  const queue = useMemo(() => appointments.filter((a) => ['Requested', 'Approved', 'Scheduled', 'EnRoute', 'CheckedIn', 'AtGate'].includes(a.status) && !a.dock_door), [appointments]);
  const onHold = useMemo(() => appointments.filter((a) => a.status === 'NoShow' || a.status === 'Cancelled'), [appointments]);

  const assignDoor_ = async () => {
    if (!assignFor || !assignDoor.trim()) { Alert.alert('Pick a door'); return; }
    try {
      await recordMutation.mutateAsync({ appointmentId: assignFor, kind: 'at_door', notes: `Assigned to door ${assignDoor.toUpperCase()}`, meta: { dock_door: assignDoor.toUpperCase() } });
      setAssignFor(null);
      setAssignDoor('');
    } catch (err) { Alert.alert('Unable to assign', err instanceof Error ? err.message : 'Unknown'); }
  };

  const hold = async () => {
    if (!holdFor) return;
    try {
      await recordMutation.mutateAsync({ appointmentId: holdFor, kind: 'hold', notes: holdNotes.trim() || 'Held by gate' });
      setHoldFor(null); setHoldNotes('');
    } catch (err) { Alert.alert('Unable to hold', err instanceof Error ? err.message : 'Unknown'); }
  };

  const release = async (id: string) => {
    try {
      await recordMutation.mutateAsync({ appointmentId: id, kind: 'released', notes: 'Released by gate' });
    } catch (err) { Alert.alert('Unable to release', err instanceof Error ? err.message : 'Unknown'); }
  };

  const complete = async (id: string) => {
    try {
      await statusMutation.mutateAsync({ appointmentId: id, status: 'Completed' });
      await recordMutation.mutateAsync({ appointmentId: id, kind: 'check_out', notes: 'Checked out' });
    } catch (err) { Alert.alert('Unable to complete', err instanceof Error ? err.message : 'Unknown'); }
  };

  if (panelQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading yard" /></View>;

  const events = (eventsQuery.data ?? []) as GateEvent[];
  const moves = (movesQuery.data ?? []) as YardMove[];

  const occupiedCount = Object.values(doorOccupancy).filter(Boolean).length;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Yard Control</Text>
          <Text style={styles.subtitle}>{occupiedCount}/{DOORS.length} doors busy · {queue.length} in queue</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(['board', 'queue', 'events', 'moves'] as Tab[]).map((k) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
              {k === 'board' ? 'Dock board' : k === 'queue' ? `Queue (${queue.length})` : k === 'events' ? 'Events' : 'Moves'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={panelQuery.isFetching || eventsQuery.isFetching} onRefresh={() => { void panelQuery.refetch(); void eventsQuery.refetch(); void movesQuery.refetch(); }} tintColor={C.accent} />}
      >
        {tab === 'board' ? (
          <>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.green }]} /><Text style={styles.legendText}>Free</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.accent }]} /><Text style={styles.legendText}>Active</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.yellow }]} /><Text style={styles.legendText}>Waiting</Text></View>
            </View>
            <View style={styles.doorGrid}>
              {DOORS.map((door) => {
                const occ = doorOccupancy[door];
                const isLoading = occ && ['Loading', 'Unloading', 'AtDoor'].includes(occ.status);
                const color = !occ ? C.green : isLoading ? C.accent : C.yellow;
                return (
                  <View key={door} style={[styles.door, { borderColor: color + '60' }]}>
                    <View style={styles.doorTop}>
                      <DoorOpen size={16} color={color} />
                      <Text style={styles.doorLabel}>{door}</Text>
                      <View style={[styles.doorDot, { backgroundColor: color }]} />
                    </View>
                    {occ ? (
                      <>
                        <Text style={styles.doorDriver} numberOfLines={1}>{occ.driver_name || occ.truck_plate || 'In use'}</Text>
                        <Text style={styles.doorMeta} numberOfLines={1}>{occ.appointment_type}</Text>
                        <StatusBadge status={occ.status} size="sm" />
                        <View style={styles.doorActions}>
                          {isLoading ? (
                            <TouchableOpacity onPress={() => void complete(occ.id)} style={styles.doorActionBtn}>
                              <Text style={styles.doorActionText}>Check out</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity onPress={() => void statusMutation.mutateAsync({ appointmentId: occ.id, status: 'Loading' })} style={styles.doorActionBtn}>
                              <PlayCircle size={12} color={C.white} />
                              <Text style={styles.doorActionText}>Load</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => { setHoldFor(occ.id); setHoldNotes(''); }} style={[styles.doorActionBtn, styles.doorActionGhost]}>
                            <Pause size={12} color={C.red} />
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.doorFree}>Available</Text>
                        <View style={styles.doorActions}>
                          {queue.length > 0 ? (
                            <TouchableOpacity
                              onPress={() => { setAssignFor(queue[0].id); setAssignDoor(door); }}
                              style={styles.doorActionBtn}
                            >
                              <Text style={styles.doorActionText}>Assign next</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
            </View>

            {onHold.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>On hold / exceptions</Text>
                {onHold.map((a) => (
                  <View key={a.id} style={styles.holdCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.holdTitle}>{a.driver_name || a.truck_plate || a.appointment_type}</Text>
                      <Text style={styles.holdMeta}>{a.appointment_type} · {new Date(a.scheduled_start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                    <Button label="Release" size="sm" variant="secondary" onPress={() => void release(a.id)} />
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {tab === 'queue' ? (
          queue.length === 0 ? (
            <View style={styles.empty}><Truck size={36} color={C.textMuted} /><Text style={styles.emptyText}>Queue is clear.</Text></View>
          ) : queue.map((a, idx) => (
            <View key={a.id} style={styles.queueCard}>
              <View style={styles.queueNum}><Text style={styles.queueNumText}>{idx + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.queueTitle}>{a.driver_name || a.truck_plate || 'Pending'}</Text>
                <Text style={styles.queueMeta}>{a.appointment_type} · {a.pallet_count ?? 0} pallets</Text>
                <Text style={styles.queueMeta}>{new Date(a.scheduled_start).toLocaleString()}</Text>
              </View>
              <View style={{ gap: 4 }}>
                <StatusBadge status={a.status} size="sm" />
                <Button label="Assign door" size="sm" onPress={() => { setAssignFor(a.id); setAssignDoor(''); }} />
              </View>
            </View>
          ))
        ) : null}

        {tab === 'events' ? (
          events.length === 0 ? (
            <View style={styles.empty}><Calendar size={36} color={C.textMuted} /><Text style={styles.emptyText}>No gate events yet.</Text></View>
          ) : events.slice(0, 60).map((e) => (
            <View key={e.id} style={styles.eventRow}>
              <View style={styles.eventIcon}><CircleDot size={12} color={C.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventKind}>{e.kind.replace(/_/g, ' ').toUpperCase()}</Text>
                <Text style={styles.eventMeta}>{new Date(e.occurred_at).toLocaleString()}</Text>
                {e.notes ? <Text style={styles.eventNotes}>{e.notes}</Text> : null}
              </View>
            </View>
          ))
        ) : null}

        {tab === 'moves' ? (
          moves.length === 0 ? (
            <View style={styles.empty}><MoveRight size={36} color={C.textMuted} /><Text style={styles.emptyText}>No yard moves logged.</Text></View>
          ) : moves.slice(0, 60).map((m) => (
            <View key={m.id} style={styles.moveRow}>
              <View style={styles.eventIcon}><MoveRight size={12} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventKind}>{m.truck_plate || m.trailer_number || m.kind || 'Move'}</Text>
                <Text style={styles.eventMeta}>{m.from_location ?? '—'} → {m.to_location ?? '—'}</Text>
                <View style={styles.eventRowBottom}><Clock size={10} color={C.textMuted} /><Text style={styles.eventMeta}>{new Date(m.created_at).toLocaleString()}</Text></View>
              </View>
            </View>
          ))
        ) : null}
      </ScrollView>

      <Modal visible={holdFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHoldFor(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Place on hold</Text>
            <TouchableOpacity onPress={() => setHoldFor(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Input label="Reason" value={holdNotes} onChangeText={setHoldNotes} placeholder="Paperwork / seal / damage / temp…" multiline numberOfLines={3} />
            <Button label="Hold" onPress={() => void hold()} loading={recordMutation.isPending} variant="danger" fullWidth size="lg" />
          </View>
        </View>
      </Modal>

      <Modal visible={assignFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAssignFor(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign door</Text>
            <TouchableOpacity onPress={() => setAssignFor(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.pickLabel}>Select door</Text>
            <View style={styles.doorPicker}>
              {DOORS.map((d) => {
                const busy = Boolean(doorOccupancy[d]);
                const active = assignDoor === d;
                return (
                  <TouchableOpacity key={d} onPress={() => !busy && setAssignDoor(d)} disabled={busy} style={[styles.doorPick, active && styles.doorPickActive, busy && styles.doorPickBusy]}>
                    <Text style={[styles.doorPickText, active && { color: C.accent }, busy && { color: C.textMuted }]}>{d}</Text>
                    {busy ? <Text style={styles.doorPickHint}>busy</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Button label={`Assign to ${assignDoor || '—'}`} onPress={() => void assignDoor_()} loading={recordMutation.isPending} disabled={!assignDoor} fullWidth size="lg" />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  tabText: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const },
  tabTextActive: { color: C.accent },
  body: { padding: 16, gap: 12 },
  legendRow: { flexDirection: 'row', gap: 12, paddingBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.textMuted },
  doorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  door: { width: '48%', backgroundColor: C.card, borderRadius: 14, borderWidth: 2, padding: 12, gap: 6 },
  doorTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doorLabel: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: C.text },
  doorDot: { width: 10, height: 10, borderRadius: 5 },
  doorDriver: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  doorMeta: { fontSize: 11, color: C.textSecondary },
  doorFree: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  doorActions: { flexDirection: 'row', gap: 5, marginTop: 4 },
  doorActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accent, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  doorActionGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.red + '40' },
  doorActionText: { fontSize: 11, color: C.white, fontWeight: '700' as const },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10 },
  holdCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.red + '40', padding: 12 },
  holdTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  holdMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  queueCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  queueNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  queueNumText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  queueTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  queueMeta: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  eventRow: { flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  eventIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  eventKind: { fontSize: 12, fontWeight: '800' as const, color: C.text, letterSpacing: 0.3 },
  eventMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  eventNotes: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  eventRowBottom: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  moveRow: { flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 8 },
  emptyText: { fontSize: 13, color: C.textMuted },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
  pickLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  doorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  doorPick: { width: 72, height: 56, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  doorPickActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  doorPickBusy: { opacity: 0.5 },
  doorPickText: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  doorPickHint: { fontSize: 9, color: C.textMuted },
});
