import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarPlus } from 'lucide-react-native';
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
        ) : filteredAppointments.map((item) => (
          <Card key={String(item.id)} style={styles.listCard}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{String(item.driver_name ?? item.truck_plate ?? 'Pending assignment')}</Text>
                <Text style={styles.cardMeta}>{String(item.appointment_type)} · Dock {String(item.dock_door ?? 'TBD')}</Text>
              </View>
              <StatusBadge status={String(item.status)} />
            </View>
            <Text style={styles.cardDate}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
          </Card>
        ))}
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
});
