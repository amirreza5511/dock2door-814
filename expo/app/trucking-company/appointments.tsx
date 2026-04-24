import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarPlus, MapPin, Timer, UserCheck } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SearchField from '@/components/ui/SearchField';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function TruckingAppointmentsScreen() {
  const insets = useSafeAreaInsets();
  const dashboardQuery = trpc.operations.truckingDashboard.useQuery();
  const createMutation = trpc.operations.createDockAppointment.useMutation();
  const checkInMutation = trpc.operations.checkInAppointment.useMutation();
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignDriver, setAssignDriver] = useState<string>('');
  const [assignPlate, setAssignPlate] = useState<string>('');
  const [assignEtaMinutes, setAssignEtaMinutes] = useState<string>('30');
  const [search, setSearch] = useState('');
  const [warehouseListingId, setWarehouseListingId] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [driverName, setDriverName] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [appointmentType, setAppointmentType] = useState('Pallet Delivery');
  const [palletCount, setPalletCount] = useState('1');

  const filteredAppointments = useMemo(() => {
    const items = dashboardQuery.data?.appointments ?? [];
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(normalized));
  }, [dashboardQuery.data?.appointments, search]);

  const handleCreate = async () => {
    if (!warehouseListingId.trim() || !scheduledStart.trim() || !scheduledEnd.trim()) {
      Alert.alert('Missing fields', 'Warehouse listing, start, and end time are required.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        warehouseListingId: warehouseListingId.trim(),
        scheduledStart: scheduledStart.trim(),
        scheduledEnd: scheduledEnd.trim(),
        driverName: driverName.trim() || null,
        truckPlate: truckPlate.trim() || null,
        appointmentType: appointmentType.trim(),
        palletCount: Number(palletCount) || 0,
      });
      setWarehouseListingId('');
      setScheduledStart('');
      setScheduledEnd('');
      setDriverName('');
      setTruckPlate('');
      setPalletCount('1');
      Alert.alert('Appointment created');
      await dashboardQuery.refetch();
    } catch (error) {
      Alert.alert('Create failed', error instanceof Error ? error.message : 'Unable to create appointment');
    }
  };

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading appointments" /></View>;
  }

  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load appointments" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Dock Appointments</Text>
        <Text style={styles.subtitle}>Live backend scheduling for dispatch teams.</Text>

        <Card elevated style={styles.formCard}>
          <Text style={styles.sectionTitle}>Create appointment</Text>
          <View style={styles.formGap}>
            <Input label="Warehouse Listing ID" value={warehouseListingId} onChangeText={setWarehouseListingId} placeholder="listing_123" testID="appointment-warehouse-id" />
            <Input label="Start (ISO)" value={scheduledStart} onChangeText={setScheduledStart} placeholder="2026-04-03T10:00:00.000Z" testID="appointment-start" />
            <Input label="End (ISO)" value={scheduledEnd} onChangeText={setScheduledEnd} placeholder="2026-04-03T11:00:00.000Z" testID="appointment-end" />
            <Input label="Driver Name" value={driverName} onChangeText={setDriverName} placeholder="Sam Driver" testID="appointment-driver" />
            <Input label="Truck Plate" value={truckPlate} onChangeText={setTruckPlate} placeholder="BC-12345" testID="appointment-plate" />
            <Input label="Appointment Type" value={appointmentType} onChangeText={setAppointmentType} placeholder="Pallet Delivery" testID="appointment-type" />
            <Input label="Pallet Count" value={palletCount} onChangeText={setPalletCount} keyboardType="numeric" testID="appointment-pallets" />
            <Button label="Create Appointment" onPress={() => void handleCreate()} loading={createMutation.isPending} fullWidth icon={<CalendarPlus size={16} color={C.white} />} />
          </View>
        </Card>

        <SearchField value={search} onChangeText={setSearch} placeholder="Search by driver, truck, type, or status" testID="appointments-search" />

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Scheduled trips</Text></View>
        {filteredAppointments.length === 0 ? (
          <EmptyState icon={CalendarPlus} title="No matching appointments" description="Create a new appointment or change your search." />
        ) : filteredAppointments.map((item) => {
          const id = String(item.id);
          const driver = String(item.driver_name ?? '');
          const plate = String(item.truck_plate ?? '');
          const isAssigning = assigning === id;
          const eta = (item.data as { eta_minutes?: number } | null | undefined)?.eta_minutes ?? null;
          const status = String(item.status);
          const canAdvance = status !== 'Completed' && status !== 'Cancelled';
          const nextStatus: 'CheckedIn' | 'AtDoor' | 'Loading' | 'Completed' =
            status === 'Requested' || status === 'Approved' ? 'CheckedIn'
              : status === 'CheckedIn' || status === 'AtGate' ? 'AtDoor'
              : status === 'AtDoor' ? 'Loading'
              : 'Completed';
          return (
            <Card key={id} style={styles.listCard}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{driver || plate || 'Pending assignment'}</Text>
                  <Text style={styles.cardMeta}>{String(item.appointment_type)} · Dock {String(item.dock_door ?? 'TBD')}</Text>
                </View>
                <StatusBadge status={status} />
              </View>
              <View style={styles.metaRow}>
                <Timer size={12} color={C.textMuted} />
                <Text style={styles.cardDate}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
                {eta !== null ? (<><MapPin size={12} color={C.blue} /><Text style={styles.cardEta}>ETA {eta} min</Text></>) : null}
              </View>

              {isAssigning ? (
                <View style={styles.assignBox}>
                  <Input label="Driver name" value={assignDriver} onChangeText={setAssignDriver} placeholder="Sam Driver" />
                  <Input label="Truck plate" value={assignPlate} onChangeText={setAssignPlate} placeholder="BC-12345" />
                  <Input label="ETA (minutes)" value={assignEtaMinutes} onChangeText={setAssignEtaMinutes} keyboardType="numeric" />
                  <View style={styles.btnRow}>
                    <Button label="Save assignment" onPress={async () => {
                      try {
                        await checkInMutation.mutateAsync({
                          appointmentId: id,
                          status: status === 'Requested' ? 'Approved' : status,
                          driverName: assignDriver || null,
                          truckPlate: assignPlate || null,
                        });
                        setAssigning(null);
                        setAssignDriver(''); setAssignPlate(''); setAssignEtaMinutes('30');
                        await dashboardQuery.refetch();
                      } catch (err) { Alert.alert('Assignment failed', err instanceof Error ? err.message : 'Unknown'); }
                    }} loading={checkInMutation.isPending} />
                    <Button label="Cancel" variant="secondary" onPress={() => setAssigning(null)} />
                  </View>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <Button label={driver ? 'Reassign driver' : 'Assign driver'} variant="secondary" icon={<UserCheck size={14} color={C.accent} />} onPress={() => { setAssignDriver(driver); setAssignPlate(plate); setAssigning(id); }} />
                  {canAdvance ? (
                    <Button label={`Advance → ${nextStatus}`} onPress={async () => {
                      try { await checkInMutation.mutateAsync({ appointmentId: id, status: nextStatus }); await dashboardQuery.refetch(); }
                      catch (err) { Alert.alert('Update failed', err instanceof Error ? err.message : 'Unknown'); }
                    }} loading={checkInMutation.isPending} />
                  ) : null}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  formCard: { gap: 12 },
  formGap: { gap: 12 },
  sectionHeader: { marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  listCard: { marginTop: 10, gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  cardDate: { fontSize: 12, color: C.textMuted },
  cardEta: { fontSize: 11, color: C.blue, fontWeight: '700' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  assignBox: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
});
