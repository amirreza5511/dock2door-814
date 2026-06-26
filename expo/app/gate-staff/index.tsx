import React, { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheckBig, LogOut, Search, ShieldAlert, Warehouse, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

/** Map appointment status → gate_event kind understood by gate_record_event RPC (migration 0014). */
const STATUS_TO_KIND: Record<string, string> = {
  Requested: 'check_in',
  Approved:   'check_in',
  CheckedIn:  'at_gate',
  AtGate:     'at_door',
  AtDoor:     'loading',
  Loading:    'check_out',
  Unloading:  'check_out',
  NoShow:     'no_show',
};

/** Human label for the next action button. */
const NEXT_LABEL: Record<string, string> = {
  Requested: 'Check in',
  Approved:  'Check in',
  CheckedIn: 'Pull to gate',
  AtGate:    'Assign door',
  AtDoor:    'Begin loading',
  Loading:   'Check out',
  Unloading: 'Check out',
};

interface FormState {
  kind: string;
  driverName: string;
  truckPlate: string;
  trailerNumber: string;
  referenceNumber: string;
  notes: string;
}

const INITIAL_FORM: FormState = {
  kind: 'check_in',
  driverName: '',
  truckPlate: '',
  trailerNumber: '',
  referenceNumber: '',
  notes: '',
};

export default function GatePanelScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const logout = useAuthStore((s) => s.logout);

  // Search state — was previously an undeclared variable causing a runtime error.
  const [search, setSearch] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  // Each warehouse is its own gate. The panel is scoped to a single selected warehouse;
  // appointments from other warehouses never appear here.
  const [listingId, setListingId] = useState<string | null>(null);
  const warehousesQuery = trpc.operations.gateWarehouses.useQuery();
  const warehouses = useMemo(
    () => (warehousesQuery.data ?? []) as { id: string; name: string }[],
    [warehousesQuery.data],
  );

  // Auto-select the only warehouse so single-site companies skip the picker.
  React.useEffect(() => {
    if (!listingId && warehouses.length === 1) setListingId(warehouses[0].id);
  }, [listingId, warehouses]);

  const panelQuery = trpc.operations.gatePanel.useQuery(
    { listingId },
    { enabled: Boolean(listingId) },
  );

  /**
   * All gate-staff advancement now routes through yard.recordEvent which calls
   * gate_record_event RPC (migration 0014).  That RPC atomically:
   *   1. Appends an append-only gate_events row.
   *   2. Advances dock_appointments.status to the next state.
   * This replaces the previous direct dock_appointments UPDATE (checkInAppointment).
   */
  const recordMutation = trpc.yard.recordEvent.useMutation({
    onSuccess: async () => {
      await utils.operations.gatePanel.invalidate();
      await utils.yard.listEvents.invalidate();
    },
  });

  /**
   * patchVehicleInfo updates only non-status columns (driver_name, truck_plate,
   * trailer_number, reference_number) and never touches status.
   * This is safe to call alongside recordEvent.
   */
  const patchMutation = trpc.operations.patchVehicleInfo.useMutation();

  const stats = useMemo(() => {
    const appointments = panelQuery.data ?? [];
    return {
      queue:     appointments.length,
      onSite:    appointments.filter((it: any) => ['CheckedIn', 'AtGate', 'AtDoor'].includes(String(it.status))).length,
      active:    appointments.filter((it: any) => ['Loading', 'Unloading'].includes(String(it.status))).length,
      completed: appointments.filter((it: any) => String(it.status) === 'Completed').length,
    };
  }, [panelQuery.data]);

  const openForm = (appointmentId: string, currentStatus: string, driverName?: string | null, truckPlate?: string | null) => {
    const kind = STATUS_TO_KIND[currentStatus] ?? 'check_in';
    setActiveId(appointmentId);
    setForm({
      ...INITIAL_FORM,
      kind,
      driverName: driverName ?? '',
      truckPlate: truckPlate ?? '',
    });
  };

  const submitForm = async () => {
    if (!activeId) return;
    try {
      // 1. Record gate event + advance status via gate_record_event RPC.
      await recordMutation.mutateAsync({
        appointmentId: activeId,
        kind: form.kind,
        notes: form.notes.trim() || undefined,
        meta: {
          driver_name:       form.driverName.trim()       || undefined,
          truck_plate:       form.truckPlate.trim()       || undefined,
          trailer_number:    form.trailerNumber.trim()    || undefined,
          reference_number:  form.referenceNumber.trim()  || undefined,
        },
      });

      // 2. Persist vehicle info on the appointment row (non-status fields only).
      if (form.driverName.trim() || form.truckPlate.trim() || form.trailerNumber.trim() || form.referenceNumber.trim()) {
        void patchMutation.mutateAsync({
          appointmentId: activeId,
          driverName:      form.driverName.trim()      || null,
          truckPlate:      form.truckPlate.trim()      || null,
          trailerNumber:   form.trailerNumber.trim()   || null,
          referenceNumber: form.referenceNumber.trim() || null,
        });
      }

      setActiveId(null);
    } catch (error) {
      Alert.alert('Gate event failed', error instanceof Error ? error.message : 'Unable to advance appointment');
    }
  };

  const markNoShow = (appointmentId: string) => {
    Alert.alert('Mark No-Show', 'Confirm no-show for this appointment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark No-Show',
        style: 'destructive',
        onPress: async () => {
          try {
            await recordMutation.mutateAsync({
              appointmentId,
              kind: 'no_show',
              notes: 'No-show logged by gate staff',
            });
          } catch (error) {
            Alert.alert('Update failed', error instanceof Error ? error.message : 'Unable to mark no-show');
          }
        },
      },
    ]);
  };

  if (warehousesQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading warehouses" />
      </View>
    );
  }

  if (listingId && panelQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading gate panel" />
      </View>
    );
  }

  if (listingId && panelQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load gate panel" onRetry={() => void panelQuery.refetch()} />
      </View>
    );
  }

  const allAppointments = panelQuery.data ?? [];
  const appointments = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAppointments;
    return allAppointments.filter((it: any) => {
      const hay = [it.driver_name, it.truck_plate, it.trailer_number, it.reference_number, it.appointment_type, it.dock_door]
        .map((v) => (v == null ? '' : String(v).toLowerCase()))
        .join(' ');
      return hay.includes(q);
    });
  })();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Gate Staff Panel</Text>
          <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn} testID="gate-logout-btn">
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Each warehouse has its own gate. Pick a gate to manage its arrivals.</Text>

        {/* Warehouse (gate) selector */}
        {warehouses.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gateRow}>
            {warehouses.map((w) => (
              <TouchableOpacity
                key={w.id}
                onPress={() => setListingId(w.id)}
                style={[styles.gateChip, listingId === w.id && styles.gateChipActive]}
                testID={`gate-${w.id}`}
              >
                <Warehouse size={13} color={listingId === w.id ? C.accent : C.textSecondary} />
                <Text style={[styles.gateChipText, listingId === w.id && styles.gateChipTextActive]}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {warehouses.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No warehouses yet"
            description="Once your company has a warehouse, its gate will appear here."
          />
        ) : !listingId ? (
          <EmptyState
            icon={Warehouse}
            title="Select a gate"
            description="Choose a warehouse above to see today's arrivals for that gate."
          />
        ) : (
        <>
        {/* Stats */}
        <View style={styles.statsRow}>
          {([['Queue', stats.queue], ['On Site', stats.onSite], ['Active', stats.active], ['Done', stats.completed]] as [string, number][]).map(([label, value]) => (
            <View key={label} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={14} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search driver / plate / type"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
            testID="gate-search"
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={() => setSearch('')}><X size={14} color={C.textMuted} /></TouchableOpacity>
          ) : null}
        </View>

        {appointments.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No appointments today"
            description="Today's dock schedule will appear here. Only Approved appointments are shown."
          />
        ) : (
          appointments.map((item: any) => {
            const status = String(item.status);
            const isDone = status === 'Completed' || status === 'NoShow' || status === 'Cancelled';
            const nextLabel = NEXT_LABEL[status] ?? 'Advance';
            return (
              <Card key={String(item.id)} style={styles.itemCard}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{String(item.driver_name ?? item.truck_plate ?? 'Incoming vehicle')}</Text>
                    <Text style={styles.cardMeta}>
                      {String(item.appointment_type)} · {String(item.pallet_count)} pallets
                      {item.dock_door ? ` · Door ${item.dock_door}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={status} />
                </View>
                <Text style={styles.cardSub}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
                {!isDone ? (
                  <View style={styles.btnRow}>
                    <Button
                      label={nextLabel}
                      onPress={() => openForm(String(item.id), status, item.driver_name as string | null, item.truck_plate as string | null)}
                      size="sm"
                      icon={<CircleCheckBig size={14} color={C.white} />}
                    />
                    <Button
                      label="No-Show"
                      onPress={() => markNoShow(String(item.id))}
                      size="sm"
                      variant="danger"
                      icon={<ShieldAlert size={14} color={C.red} />}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
        </>
        )}
      </ScrollView>

      {/* Advance modal */}
      <Modal visible={activeId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setActiveId(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Record Gate Event</Text>
            <TouchableOpacity onPress={() => setActiveId(null)} style={styles.closeBtn}>
              <X size={18} color={C.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Event kind</Text>
            <View style={styles.kindRow}>
              {(['check_in', 'at_gate', 'at_door', 'loading', 'unloading', 'check_out'] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setForm((prev) => ({ ...prev, kind: k }))}
                  style={[styles.kindChip, form.kind === k && styles.kindChipActive]}
                >
                  <Text style={[styles.kindChipText, form.kind === k && styles.kindChipTextActive]}>
                    {k.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Vehicle / driver info</Text>
            <TextInput
              value={form.driverName}
              onChangeText={(v) => setForm((p) => ({ ...p, driverName: v }))}
              placeholder="Driver name"
              placeholderTextColor={C.textMuted}
              style={styles.textInput}
            />
            <TextInput
              value={form.truckPlate}
              onChangeText={(v) => setForm((p) => ({ ...p, truckPlate: v }))}
              placeholder="Truck plate"
              placeholderTextColor={C.textMuted}
              style={styles.textInput}
              autoCapitalize="characters"
            />
            <TextInput
              value={form.trailerNumber}
              onChangeText={(v) => setForm((p) => ({ ...p, trailerNumber: v }))}
              placeholder="Trailer number"
              placeholderTextColor={C.textMuted}
              style={styles.textInput}
              autoCapitalize="characters"
            />
            <TextInput
              value={form.referenceNumber}
              onChangeText={(v) => setForm((p) => ({ ...p, referenceNumber: v }))}
              placeholder="Reference / PO number"
              placeholderTextColor={C.textMuted}
              style={styles.textInput}
              autoCapitalize="characters"
            />
            <TextInput
              value={form.notes}
              onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))}
              placeholder="Seal number, observations…"
              placeholderTextColor={C.textMuted}
              style={[styles.textInput, { minHeight: 72, textAlignVertical: 'top' }]}
              multiline
              numberOfLines={3}
            />

            <Button
              label={form.kind === 'check_out' ? 'Check Out & Complete' : `Record ${form.kind.replace(/_/g, ' ')}`}
              onPress={() => void submitForm()}
              loading={recordMutation.isPending}
              fullWidth
              size="lg"
            />
            <Button label="Cancel" onPress={() => setActiveId(null)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  gateRow: { gap: 8, paddingVertical: 2 },
  gateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  gateChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  gateChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  gateChipTextActive: { color: C.accent, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textSecondary, marginTop: 3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, color: C.text, fontSize: 13 },
  itemCard: { gap: 10, padding: 14 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardSub: { fontSize: 12, color: C.textMuted },
  btnRow: { flexDirection: 'row', gap: 8 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
  fieldLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  kindChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  kindChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  kindChipTextActive: { color: C.accent, fontWeight: '700' as const },
  textInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
});
