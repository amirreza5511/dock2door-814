import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, RefreshControl } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CalendarDays, CalendarPlus, CircleDot, Clock, Filter, MapPin, Package, Plus, Search, Truck, UserCheck, Warehouse, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type ColumnKey = 'Unassigned' | 'Assigned' | 'EnRoute' | 'AtGate' | 'AtDoor' | 'Loading' | 'Completed' | 'Exception';

const COLUMNS: { key: ColumnKey; label: string; color: string; statuses: string[] }[] = [
  { key: 'Unassigned', label: 'Unassigned', color: C.textMuted, statuses: ['Requested'] },
  { key: 'Assigned', label: 'Assigned', color: C.blue, statuses: ['Approved', 'Scheduled'] },
  { key: 'EnRoute', label: 'En Route', color: C.purple, statuses: ['EnRoute', 'Dispatched'] },
  { key: 'AtGate', label: 'At Gate', color: C.yellow, statuses: ['CheckedIn', 'AtGate'] },
  { key: 'AtDoor', label: 'At Door', color: C.accent, statuses: ['AtDoor'] },
  { key: 'Loading', label: 'Loading', color: C.accent, statuses: ['Loading', 'Unloading'] },
  { key: 'Completed', label: 'Completed', color: C.green, statuses: ['Completed'] },
  { key: 'Exception', label: 'Exception', color: C.red, statuses: ['NoShow', 'Cancelled', 'Exception', 'Delayed'] },
];

interface AssignForm {
  driverId: string;
  driverName: string;
  /** auth.uid() of a Driver-role user linked to this fleet driver (enables driverJobs lookup). */
  driverUserId: string;
  truckPlate: string;
  etaMinutes: string;
  notes: string;
}

const INITIAL_ASSIGN: AssignForm = { driverId: '', driverName: '', driverUserId: '', truckPlate: '', etaMinutes: '30', notes: '' };

const APPOINTMENT_TYPES = ['Pallet Delivery', 'Pallet Pickup', 'Container', 'Floor Loaded', 'Other'] as const;

/** Round a date up to the next whole hour, seconds zeroed. */
function roundToNextHour(d: Date): Date {
  const next = new Date(d);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function formatFriendly(d: Date): string {
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Friendly date + time picker that hides the raw ISO timestamp from the user. */
function DateTimeField({ label, value, onChange, minimumDate }: { label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date }) {
  const [mode, setMode] = useState<null | 'date' | 'time'>(null);

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.dtField}>
        <Text style={styles.dtLabel}>{label}</Text>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="compact"
          themeVariant="dark"
          minimumDate={minimumDate}
          onChange={(_e, d) => { if (d) onChange(d); }}
          style={styles.dtIosPicker}
        />
      </View>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.dtField}>
        <Text style={styles.dtLabel}>{label}</Text>
        <View style={styles.dtRow}>
          <TouchableOpacity style={styles.dtBtn} onPress={() => setMode('date')}>
            <CalendarDays size={14} color={C.accent} />
            <Text style={styles.dtBtnText}>{value.toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dtBtn} onPress={() => setMode('time')}>
            <Clock size={14} color={C.accent} />
            <Text style={styles.dtBtnText}>{value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </TouchableOpacity>
        </View>
        {mode ? (
          <DateTimePicker
            value={value}
            mode={mode}
            display="default"
            minimumDate={minimumDate}
            onChange={(_e, d) => { setMode(null); if (d) onChange(d); }}
          />
        ) : null}
      </View>
    );
  }

  // Web fallback — native browser datetime input via a controlled text field.
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <View style={styles.dtField}>
      <Text style={styles.dtLabel}>{label}</Text>
      <TextInput
        value={local}
        onChangeText={(t) => { const d = new Date(t); if (!Number.isNaN(d.getTime())) onChange(d); }}
        placeholder="YYYY-MM-DD HH:MM"
        placeholderTextColor={C.textMuted}
        style={styles.dtWebInput}
      />
    </View>
  );
}

export default function DispatcherBoardScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const dashboardQuery = trpc.operations.truckingDashboard.useQuery(undefined, { refetchInterval: 15000, refetchOnWindowFocus: true });
  const updateMutation = trpc.operations.checkInAppointment.useMutation({
    onSuccess: async () => { await utils.operations.truckingDashboard.invalidate(); },
  });
  const createMutation = trpc.operations.createDockAppointment.useMutation({
    onSuccess: async () => { await utils.operations.truckingDashboard.invalidate(); },
  });

  const [filter, setFilter] = useState<ColumnKey | 'All'>('All');
  const [search, setSearch] = useState('');
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState<AssignForm>(INITIAL_ASSIGN);
  const [exceptionId, setExceptionId] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    warehouseListingId: '',
    driverName: '', truckPlate: '', appointmentType: 'Pallet Delivery', palletCount: '1',
  });
  const [startDate, setStartDate] = useState<Date>(() => roundToNextHour(new Date()));
  const [endDate, setEndDate] = useState<Date>(() => { const s = roundToNextHour(new Date()); return new Date(s.getTime() + 60 * 60 * 1000); });

  const appointments = dashboardQuery.data?.appointments ?? [];
  const drivers = (dashboardQuery.data?.drivers ?? []) as Array<{ id: string; name: string; status?: string; data?: Record<string, unknown> | null }>;
  const trucks = (dashboardQuery.data?.trucks ?? []) as Array<{ id: string; plate: string }>;

  const grouped = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const rows = appointments.filter((a: any) => {
      if (!normalized) return true;
      return JSON.stringify(a).toLowerCase().includes(normalized);
    });
    const map: Record<ColumnKey, typeof rows> = {
      Unassigned: [], Assigned: [], EnRoute: [], AtGate: [], AtDoor: [], Loading: [], Completed: [], Exception: [],
    };
    for (const r of rows) {
      const status = String(r.status);
      const col = COLUMNS.find((c) => c.statuses.includes(status));
      if (col) map[col.key].push(r);
      else map.Assigned.push(r);
    }
    return map;
  }, [appointments, search]);

  const totals = useMemo(() => ({
    unassigned: grouped.Unassigned.length,
    inMotion: grouped.EnRoute.length + grouped.AtGate.length + grouped.AtDoor.length + grouped.Loading.length,
    exceptions: grouped.Exception.length,
    completed: grouped.Completed.length,
  }), [grouped]);

  const visibleColumns = filter === 'All' ? COLUMNS : COLUMNS.filter((c) => c.key === filter);

  const advance = async (id: string, status: string) => {
    try {
      if (Platform.OS !== 'web') { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      await updateMutation.mutateAsync({ appointmentId: id, status });
      if (Platform.OS !== 'web') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    } catch (err) {
      if (Platform.OS !== 'web') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
      Alert.alert('Update failed', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const handleAssign = async () => {
    if (!assignId) return;
    if (!assignForm.driverName.trim() && !assignForm.truckPlate.trim()) {
      Alert.alert('Missing driver', 'Pick a driver or enter a plate.');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        appointmentId: assignId,
        status: 'Approved',
        driverName: assignForm.driverName.trim() || null,
        truckPlate: assignForm.truckPlate.trim() || null,
        // Pass linked auth uid so the driver sees this job via operations.driverJobs.
        driverUserId: assignForm.driverUserId.trim() || null,
      });
      setAssignId(null);
      setAssignForm(INITIAL_ASSIGN);
    } catch (err) { Alert.alert('Assign failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  const handleException = async () => {
    if (!exceptionId) return;
    if (!exceptionReason.trim()) { Alert.alert('Reason required', 'Describe why this appointment is a no-show or exception.'); return; }
    const doIt = async () => {
      try {
        await updateMutation.mutateAsync({ appointmentId: exceptionId, status: 'NoShow' });
        if (Platform.OS !== 'web') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
        setExceptionId(null);
        setExceptionReason('');
      } catch (err) { Alert.alert('Update failed', err instanceof Error ? err.message : 'Unknown'); }
    };
    Alert.alert('Flag No-Show?', 'This marks the appointment as NoShow and notifies operations. This cannot be auto-undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Flag No-Show', style: 'destructive', onPress: () => void doIt() },
    ]);
  };

  const handleCreate = async () => {
    const f = createForm;
    if (!f.warehouseListingId.trim()) {
      Alert.alert('Which warehouse?', 'Enter the warehouse this truck is going to.');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      Alert.alert('Check the times', 'The end of the slot must be after the start.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        warehouseListingId: f.warehouseListingId.trim(),
        scheduledStart: startDate.toISOString(),
        scheduledEnd: endDate.toISOString(),
        driverName: f.driverName.trim() || null,
        truckPlate: f.truckPlate.trim() || null,
        appointmentType: f.appointmentType.trim(),
        palletCount: Number(f.palletCount) || 1,
      });
      setCreateOpen(false);
      setCreateForm({ warehouseListingId: '', driverName: '', truckPlate: '', appointmentType: 'Pallet Delivery', palletCount: '1' });
      const s = roundToNextHour(new Date());
      setStartDate(s);
      setEndDate(new Date(s.getTime() + 60 * 60 * 1000));
    } catch (err) { Alert.alert('Create failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading dispatcher" /></View>;
  }
  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load dispatcher" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Dispatcher Board</Text>
            <Text style={styles.subtitle}>{appointments.length} active · {drivers.length} drivers</Text>
          </View>
          <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.addBtn} testID="dispatcher-create">
            <Plus size={18} color={C.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.stat, { borderLeftColor: C.textMuted }]}><Text style={styles.statValue}>{totals.unassigned}</Text><Text style={styles.statLabel}>To assign</Text></View>
          <View style={[styles.stat, { borderLeftColor: C.accent }]}><Text style={styles.statValue}>{totals.inMotion}</Text><Text style={styles.statLabel}>In motion</Text></View>
          <View style={[styles.stat, { borderLeftColor: C.red }]}><Text style={[styles.statValue, { color: totals.exceptions > 0 ? C.red : C.text }]}>{totals.exceptions}</Text><Text style={styles.statLabel}>Exceptions</Text></View>
          <View style={[styles.stat, { borderLeftColor: C.green }]}><Text style={styles.statValue}>{totals.completed}</Text><Text style={styles.statLabel}>Completed</Text></View>
        </View>

        <View style={styles.searchBar}>
          <Search size={14} color={C.textMuted} />
          <Input value={search} onChangeText={setSearch} placeholder="Search driver / plate / order" containerStyle={styles.searchInput} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><X size={14} color={C.textMuted} /></TouchableOpacity> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity onPress={() => setFilter('All')} style={[styles.filterChip, filter === 'All' && styles.filterChipActive]}>
            <Filter size={11} color={filter === 'All' ? C.accent : C.textMuted} />
            <Text style={[styles.filterText, filter === 'All' && styles.filterTextActive]}>All</Text>
          </TouchableOpacity>
          {COLUMNS.map((c) => (
            <TouchableOpacity key={c.key} onPress={() => setFilter(c.key)} style={[styles.filterChip, filter === c.key && styles.filterChipActive]}>
              <CircleDot size={10} color={c.color} />
              <Text style={[styles.filterText, filter === c.key && styles.filterTextActive]}>{c.label} {grouped[c.key].length > 0 ? `(${grouped[c.key].length})` : ''}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        horizontal={filter === 'All'}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[filter === 'All' ? styles.boardRow : styles.boardSingle]}
        refreshControl={<RefreshControl refreshing={dashboardQuery.isFetching} onRefresh={() => void dashboardQuery.refetch()} tintColor={C.accent} />}
      >
        {visibleColumns.map((col) => (
          <View key={col.key} style={[styles.column, filter === 'All' && styles.columnFixed]}>
            <View style={styles.columnHeader}>
              <View style={[styles.columnDot, { backgroundColor: col.color }]} />
              <Text style={styles.columnTitle}>{col.label}</Text>
              <Text style={styles.columnCount}>{grouped[col.key].length}</Text>
            </View>
            <ScrollView contentContainerStyle={[styles.columnBody, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
              {grouped[col.key].length === 0 ? (
                <View style={styles.columnEmpty}><Text style={styles.columnEmptyText}>Empty</Text></View>
              ) : grouped[col.key].map((item: any) => {
                const id = String(item.id);
                const driver = String(item.driver_name ?? '');
                const plate = String(item.truck_plate ?? '');
                const eta = (item.data as { eta_minutes?: number } | null | undefined)?.eta_minutes ?? null;
                const status = String(item.status);
                const nextMap: Record<string, string> = {
                  Requested: 'Approved', Approved: 'EnRoute', Scheduled: 'EnRoute',
                  EnRoute: 'CheckedIn', CheckedIn: 'AtDoor', AtGate: 'AtDoor',
                  AtDoor: 'Loading', Loading: 'Completed', Unloading: 'Completed',
                };
                const next = nextMap[status];
                return (
                  <View key={id} style={styles.jobCard}>
                    <View style={styles.jobTop}>
                      <Text style={styles.jobTitle} numberOfLines={1}>{driver || plate || 'Unassigned'}</Text>
                      <StatusBadge status={status} size="sm" />
                    </View>
                    <Text style={styles.jobMeta} numberOfLines={1}>{String(item.appointment_type)} · {String(item.pallet_count ?? 0)} pallets</Text>
                    <View style={styles.jobRow}>
                      <Clock size={10} color={C.textMuted} />
                      <Text style={styles.jobMetaSmall}>{new Date(String(item.scheduled_start)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                    {item.dock_door ? (
                      <View style={styles.jobRow}><MapPin size={10} color={C.blue} /><Text style={[styles.jobMetaSmall, { color: C.blue }]}>Door {String(item.dock_door)}</Text></View>
                    ) : null}
                    {eta !== null ? (
                      <View style={styles.jobRow}><Truck size={10} color={C.accent} /><Text style={[styles.jobMetaSmall, { color: C.accent }]}>ETA {eta}m</Text></View>
                    ) : null}

                    <View style={styles.jobActions}>
                      {col.key === 'Unassigned' || !driver ? (
                        <TouchableOpacity
                          onPress={() => {
                            setAssignForm({ ...INITIAL_ASSIGN, driverName: driver, truckPlate: plate });
                            setAssignId(id);
                          }}
                          style={[styles.actionBtn, styles.actionPrimary]}
                          testID={`assign-${id}`}
                        >
                          <UserCheck size={12} color={C.white} />
                          <Text style={styles.actionPrimaryText}>Assign</Text>
                        </TouchableOpacity>
                      ) : next && col.key !== 'Completed' && col.key !== 'Exception' ? (
                        <TouchableOpacity
                          onPress={() => void advance(id, next)}
                          style={[styles.actionBtn, styles.actionPrimary]}
                          testID={`advance-${id}`}
                        >
                          <Text style={styles.actionPrimaryText}>→ {next}</Text>
                        </TouchableOpacity>
                      ) : null}

                      {col.key !== 'Unassigned' && driver && col.key !== 'Completed' && col.key !== 'Exception' ? (
                        <TouchableOpacity
                          onPress={() => { setAssignForm({ ...INITIAL_ASSIGN, driverName: driver, truckPlate: plate }); setAssignId(id); }}
                          style={[styles.actionBtn, styles.actionGhost]}
                          testID={`reassign-${id}`}
                        >
                          <UserCheck size={12} color={C.accent} />
                        </TouchableOpacity>
                      ) : null}

                      {col.key !== 'Completed' && col.key !== 'Exception' ? (
                        <TouchableOpacity
                          onPress={() => { setExceptionId(id); setExceptionReason(''); }}
                          style={[styles.actionBtn, styles.actionGhost]}
                        >
                          <AlertTriangle size={12} color={C.red} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      {/* Assign modal */}
      <Modal visible={assignId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAssignId(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign driver</Text>
            <TouchableOpacity onPress={() => setAssignId(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {drivers.length > 0 ? (
              <>
                <Text style={styles.pickLabel}>Available drivers</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverRow}>
                  {drivers.map((d) => {
                    const active = assignForm.driverName === d.name;
                    return (
                      <TouchableOpacity
                        key={d.id}
                        onPress={() => setAssignForm((p) => ({ ...p, driverId: d.id, driverName: d.name, driverUserId: String(d.data?.userId ?? '') }))}
                        style={[styles.driverChip, active && styles.driverChipActive]}
                      >
                        <UserCheck size={12} color={active ? C.accent : C.textMuted} />
                        <Text style={[styles.driverChipText, active && styles.driverChipTextActive]}>{d.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}
            {trucks.length > 0 ? (
              <>
                <Text style={styles.pickLabel}>Trucks</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverRow}>
                  {trucks.map((t) => {
                    const active = assignForm.truckPlate === t.plate;
                    return (
                      <TouchableOpacity key={t.id} onPress={() => setAssignForm((p) => ({ ...p, truckPlate: t.plate }))} style={[styles.driverChip, active && styles.driverChipActive]}>
                        <Truck size={12} color={active ? C.accent : C.textMuted} />
                        <Text style={[styles.driverChipText, active && styles.driverChipTextActive]}>{t.plate}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}
            <Input label="Driver name" value={assignForm.driverName} onChangeText={(v) => setAssignForm((p) => ({ ...p, driverName: v }))} placeholder="Sam Driver" />
            <Input label="Truck plate" value={assignForm.truckPlate} onChangeText={(v) => setAssignForm((p) => ({ ...p, truckPlate: v }))} placeholder="e.g. ABC 1234" autoCapitalize="characters" />
            <Input label="ETA (minutes)" value={assignForm.etaMinutes} onChangeText={(v) => setAssignForm((p) => ({ ...p, etaMinutes: v }))} keyboardType="numeric" />
            <Input label="Notes" value={assignForm.notes} onChangeText={(v) => setAssignForm((p) => ({ ...p, notes: v }))} multiline numberOfLines={2} />
            <Button label="Save assignment" onPress={() => void handleAssign()} loading={updateMutation.isPending} fullWidth size="lg" icon={<UserCheck size={15} color={C.white} />} />
            <Button label="Cancel" onPress={() => setAssignId(null)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>

      {/* Exception modal */}
      <Modal visible={exceptionId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setExceptionId(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Flag exception</Text>
            <TouchableOpacity onPress={() => setExceptionId(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Input label="Reason" value={exceptionReason} onChangeText={setExceptionReason} placeholder="Late / No-show / Damage / …" multiline numberOfLines={3} />
            <Button label="Flag No-Show" onPress={() => void handleException()} loading={updateMutation.isPending} variant="danger" fullWidth size="lg" icon={<AlertTriangle size={15} color={C.white} />} />
            <Button label="Cancel" onPress={() => setExceptionId(null)} variant="ghost" fullWidth />
          </View>
        </View>
      </Modal>

      {/* Create modal */}
      <Modal visible={createOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateOpen(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Book a dock slot</Text>
            <TouchableOpacity onPress={() => setCreateOpen(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.formIntro}>Reserve a time for a truck to load or unload at a warehouse.</Text>

            <View style={styles.sectionLabelRow}><Warehouse size={13} color={C.accent} /><Text style={styles.sectionLabel}>Warehouse</Text></View>
            <Input label="Warehouse" value={createForm.warehouseListingId} onChangeText={(v) => setCreateForm({ ...createForm, warehouseListingId: v })} placeholder="Warehouse name or code" />
            <Text style={styles.fieldHint}>Use the warehouse code your dispatcher shared, or the one shown on the booking.</Text>

            <View style={styles.sectionLabelRow}><Clock size={13} color={C.accent} /><Text style={styles.sectionLabel}>Time slot</Text></View>
            <DateTimeField label="Arrives" value={startDate} onChange={(d) => { setStartDate(d); if (endDate.getTime() <= d.getTime()) setEndDate(new Date(d.getTime() + 60 * 60 * 1000)); }} minimumDate={new Date()} />
            <DateTimeField label="Done by" value={endDate} onChange={setEndDate} minimumDate={startDate} />
            <Text style={styles.fieldHint}>Booking {formatFriendly(startDate)} → {formatFriendly(endDate)}.</Text>

            <View style={styles.sectionLabelRow}><Package size={13} color={C.accent} /><Text style={styles.sectionLabel}>Load</Text></View>
            <Text style={styles.pickLabel}>What is the truck doing?</Text>
            <View style={styles.typeRow}>
              {APPOINTMENT_TYPES.map((t) => {
                const active = createForm.appointmentType === t;
                return (
                  <TouchableOpacity key={t} onPress={() => setCreateForm({ ...createForm, appointmentType: t })} style={[styles.typeChip, active && styles.typeChipActive]}>
                    <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Input label="How many pallets?" value={createForm.palletCount} onChangeText={(v) => setCreateForm({ ...createForm, palletCount: v })} keyboardType="numeric" />

            <View style={styles.sectionLabelRow}><Truck size={13} color={C.accent} /><Text style={styles.sectionLabel}>Driver (optional)</Text></View>
            <Input label="Driver name" value={createForm.driverName} onChangeText={(v) => setCreateForm({ ...createForm, driverName: v })} placeholder="Add now or assign later" />
            <Input label="Truck plate" value={createForm.truckPlate} onChangeText={(v) => setCreateForm({ ...createForm, truckPlate: v })} autoCapitalize="characters" placeholder="e.g. ABC 1234" />

            <Button label="Book this slot" onPress={() => void handleCreate()} loading={createMutation.isPending} fullWidth size="lg" icon={<CalendarPlus size={15} color={C.white} />} />
            <Button label="Cancel" onPress={() => setCreateOpen(false)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { paddingHorizontal: 16, paddingBottom: 10, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, padding: 10 },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10 },
  searchInput: { flex: 1, marginBottom: 0 },
  filterRow: { gap: 6, paddingVertical: 4 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  filterTextActive: { color: C.accent },
  boardRow: { paddingHorizontal: 10, paddingTop: 12, gap: 10 },
  boardSingle: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  column: { backgroundColor: C.bgSecondary, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 10, gap: 8 },
  columnFixed: { width: 260 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnTitle: { flex: 1, fontSize: 12, fontWeight: '800' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  columnCount: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const },
  columnBody: { gap: 8 },
  columnEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: C.border, borderRadius: 10 },
  columnEmptyText: { fontSize: 11, color: C.textMuted },
  jobCard: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4 },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  jobTitle: { flex: 1, fontSize: 13, fontWeight: '700' as const, color: C.text },
  jobMeta: { fontSize: 11, color: C.textSecondary },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  jobMetaSmall: { fontSize: 10, color: C.textMuted },
  jobActions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionPrimary: { flex: 1, backgroundColor: C.accent, justifyContent: 'center' },
  actionPrimaryText: { color: C.white, fontSize: 11, fontWeight: '700' as const },
  actionGhost: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
  pickLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  formIntro: { fontSize: 13, color: C.textSecondary, marginBottom: 4 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '800' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  fieldHint: { fontSize: 11, color: C.textMuted, marginTop: -4 },
  dtField: { gap: 6 },
  dtLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  dtIosPicker: { alignSelf: 'flex-start' },
  dtRow: { flexDirection: 'row', gap: 8 },
  dtBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  dtBtnText: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  dtWebInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, color: C.text, fontSize: 14 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  typeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  typeChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  typeChipTextActive: { color: C.accent, fontWeight: '700' as const },
  driverRow: { gap: 6, paddingVertical: 4 },
  driverChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  driverChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  driverChipText: { fontSize: 11, color: C.textSecondary },
  driverChipTextActive: { color: C.accent, fontWeight: '700' as const },
});
