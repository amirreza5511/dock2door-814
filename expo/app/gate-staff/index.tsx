import React, { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheckBig, LogIn, LogOut, ShieldAlert, Warehouse, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type GateStatus = 'CheckedIn' | 'AtGate' | 'AtDoor' | 'Loading' | 'Unloading' | 'Completed' | 'NoShow';

interface FormState {
  status: GateStatus;
  driverName: string;
  truckPlate: string;
  trailerNumber: string;
  referenceNumber: string;
  notes: string;
}

const INITIAL_FORM: FormState = {
  status: 'CheckedIn',
  driverName: '',
  truckPlate: '',
  trailerNumber: '',
  referenceNumber: '',
  notes: '',
};

export default function GatePanelScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const panelQuery = trpc.operations.gatePanel.useQuery();
  const updateMutation = trpc.operations.checkInAppointment.useMutation({
    onSuccess: async () => {
      await utils.operations.gatePanel.invalidate();
    },
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const stats = useMemo(() => {
    const appointments = panelQuery.data ?? [];
    return {
      queue: appointments.length,
      onSite: appointments.filter((item) => ['CheckedIn', 'AtGate', 'AtDoor'].includes(String(item.status))).length,
      active: appointments.filter((item) => ['Loading', 'Unloading'].includes(String(item.status))).length,
      completed: appointments.filter((item) => String(item.status) === 'Completed').length,
    };
  }, [panelQuery.data]);

  const openForm = (appointmentId: string, currentStatus: string, driverName?: string | null, truckPlate?: string | null) => {
    const NEXT: Record<string, GateStatus> = {
      Requested: 'CheckedIn',
      Approved: 'CheckedIn',
      CheckedIn: 'AtGate',
      AtGate: 'AtDoor',
      AtDoor: 'Loading',
      Loading: 'Completed',
      Unloading: 'Completed',
    };
    setActiveId(appointmentId);
    setForm({
      ...INITIAL_FORM,
      status: NEXT[currentStatus] ?? 'CheckedIn',
      driverName: driverName ?? '',
      truckPlate: truckPlate ?? '',
    });
  };

  const submitForm = async () => {
    if (!activeId) return;
    try {
      await updateMutation.mutateAsync({
        appointmentId: activeId,
        status: form.status,
        driverName: form.driverName.trim() || null,
        truckPlate: form.truckPlate.trim() || null,
        trailerNumber: form.trailerNumber.trim() || null,
        referenceNumber: form.referenceNumber.trim() || null,
        notes: form.notes.trim() || null,
      });
      setActiveId(null);
    } catch (error) {
      Alert.alert('Status update failed', error instanceof Error ? error.message : 'Unable to update gate status');
    }
  };

  const markNoShow = async (appointmentId: string) => {
    Alert.alert('Mark No-Show', 'Confirm no-show for this appointment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark No-Show',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateMutation.mutateAsync({ appointmentId, status: 'NoShow' });
          } catch (error) {
            Alert.alert('Update failed', error instanceof Error ? error.message : 'Unable to update');
          }
        },
      },
    ]);
  };

  if (panelQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading gate panel" /></View>;
  }

  if (panelQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load gate panel" onRetry={() => void panelQuery.refetch()} /></View>;
  }

  const appointments = panelQuery.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Gate Staff Panel</Text>
        <Text style={styles.subtitle}>Operational queue for dock arrivals and departures.</Text>

        <View style={styles.statsRow}>
          {[
            ['Queue', stats.queue],
            ['On Site', stats.onSite],
            ['Active', stats.active],
            ['Done', stats.completed],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {appointments.length === 0 ? (
          <EmptyState icon={Warehouse} title="No appointments today" description="Today's approved dock schedule will appear here automatically." />
        ) : appointments.map((item) => {
          const status = String(item.status);
          const isDone = status === 'Completed' || status === 'NoShow';
          return (
            <Card key={String(item.id)} style={styles.itemCard}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{String(item.driver_name ?? item.truck_plate ?? 'Incoming vehicle')}</Text>
                  <Text style={styles.cardMeta}>{String(item.appointment_type)} · {String(item.pallet_count)} pallets{item.dock_door ? ` · Door ${item.dock_door}` : ''}</Text>
                </View>
                <StatusBadge status={status} />
              </View>
              <Text style={styles.cardSub}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
              {!isDone ? (
                <View style={styles.btnRow}>
                  <Button
                    label="Advance"
                    onPress={() => openForm(String(item.id), status, item.driver_name as string | null, item.truck_plate as string | null)}
                    size="sm"
                    icon={<CircleCheckBig size={14} color={C.white} />}
                  />
                  <Button
                    label="No-Show"
                    onPress={() => void markNoShow(String(item.id))}
                    size="sm"
                    variant="danger"
                    icon={<ShieldAlert size={14} color={C.red} />}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>

      <Modal visible={activeId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setActiveId(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Advance Appointment</Text>
            <TouchableOpacity onPress={() => setActiveId(null)} style={styles.closeBtn}>
              <X size={18} color={C.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Next status</Text>
            <View style={styles.statusRow}>
              {(['CheckedIn', 'AtGate', 'AtDoor', 'Loading', 'Unloading', 'Completed'] as GateStatus[]).map((s) => (
                <TouchableOpacity key={s} onPress={() => setForm((prev) => ({ ...prev, status: s }))} style={[styles.statusChip, form.status === s && styles.statusChipActive]}>
                  <Text style={[styles.statusChipText, form.status === s && styles.statusChipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input label="Driver name" value={form.driverName} onChangeText={(v) => setForm((p) => ({ ...p, driverName: v }))} placeholder="John Smith" />
            <Input label="Truck plate" value={form.truckPlate} onChangeText={(v) => setForm((p) => ({ ...p, truckPlate: v }))} placeholder="BC ABC-1234" autoCapitalize="characters" />
            <Input label="Trailer number" value={form.trailerNumber} onChangeText={(v) => setForm((p) => ({ ...p, trailerNumber: v }))} placeholder="T-12345" autoCapitalize="characters" />
            <Input label="Reference / PO" value={form.referenceNumber} onChangeText={(v) => setForm((p) => ({ ...p, referenceNumber: v }))} placeholder="PO-1024" autoCapitalize="characters" />
            <Input label="Notes" value={form.notes} onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))} placeholder="Seal number, observations…" multiline numberOfLines={3} />

            <Button
              label={form.status === 'Completed' ? 'Check Out & Complete' : `Record ${form.status}`}
              onPress={() => void submitForm()}
              loading={updateMutation.isPending}
              fullWidth
              size="lg"
              icon={form.status === 'Completed' ? <LogOut size={16} color={C.white} /> : <LogIn size={16} color={C.white} />}
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
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 4 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textSecondary, marginTop: 3 },
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
  fieldLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  statusChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  statusChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  statusChipTextActive: { color: C.accent, fontWeight: '700' as const },
});
