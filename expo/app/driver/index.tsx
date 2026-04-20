import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Timer } from 'lucide-react-native';
import AttachmentList from '@/components/ui/AttachmentList';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function DriverJobsScreen() {
  const insets = useSafeAreaInsets();
  const jobsQuery = trpc.operations.driverJobs.useQuery();
  const podMutation = trpc.operations.uploadPodReference.useMutation();
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [podReference, setPodReference] = useState('');

  const summary = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    return {
      total: jobs.length,
      active: jobs.filter((item) => ['Requested', 'Approved', 'AtGate', 'AtDoor', 'Loading', 'Unloading'].includes(String(item.status))).length,
      completed: jobs.filter((item) => String(item.status) === 'Completed').length,
    };
  }, [jobsQuery.data]);

  const submitPod = async () => {
    if (!selectedAppointmentId.trim() || !podReference.trim()) {
      Alert.alert('Appointment and POD reference are required');
      return;
    }

    try {
      await podMutation.mutateAsync({ appointmentId: selectedAppointmentId.trim(), fileId: podReference.trim() });
      Alert.alert('POD linked');
      setPodReference('');
      await jobsQuery.refetch();
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Unable to save POD reference');
    }
  };

  if (jobsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading jobs" /></View>;
  }

  if (jobsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load driver jobs" onRetry={() => void jobsQuery.refetch()} /></View>;
  }

  const jobs = jobsQuery.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <Text style={styles.title}>Driver Jobs</Text>
        <Text style={styles.subtitle}>Live appointment feed from backend operations.</Text>

        <View style={styles.statsRow}>
          {[
            ['Total', summary.total],
            ['Active', summary.active],
            ['Done', summary.completed],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <Card elevated>
          <Text style={styles.sectionTitle}>Link proof of delivery</Text>
          <View style={styles.formGap}>
            <Input label="Appointment ID" value={selectedAppointmentId} onChangeText={setSelectedAppointmentId} placeholder="appointment_123" testID="driver-appointment-id" />
            <Input label="POD File ID" value={podReference} onChangeText={setPodReference} placeholder="file_123" testID="driver-pod-id" />
            <Button label="Save POD reference" onPress={() => void submitPod()} loading={podMutation.isPending} fullWidth />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Assigned jobs</Text>
        {jobs.length === 0 ? <EmptyState icon={Timer} title="No jobs assigned" description="Assigned appointment records will appear here automatically." /> : jobs.map((item) => (
          <Card key={String(item.id)} style={styles.jobCard}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobTitle}>{String(item.appointment_type)}</Text>
                <Text style={styles.jobMeta}>{new Date(String(item.scheduled_start)).toLocaleString()}</Text>
              </View>
              <StatusBadge status={String(item.status)} />
            </View>
            <View style={styles.metaRow}>
              <MapPin size={14} color={C.blue} />
              <Text style={styles.metaText}>Truck {String(item.truck_plate ?? 'TBD')} · Door {String(item.dock_door ?? 'TBD')}</Text>
            </View>
            <AttachmentList items={item.data?.podFileId ? [{ id: String(item.data.podFileId), label: `POD ${String(item.data.podFileId)}` }] : []} emptyLabel="No POD linked yet." />
          </Card>
        ))}
        </ResponsiveContainer>
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
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginTop: 4 },
  formGap: { gap: 12 },
  jobCard: { marginTop: 10, gap: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  jobTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  jobMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 12, color: C.textSecondary },
});
