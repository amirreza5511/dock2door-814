import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AlertTriangle, Camera, ChevronRight, Clock, FileText, LogIn, LogOut, MapPin, Navigation, Package, Play, Truck, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type JobRow = {
  id: string; status: string; appointment_type: string; scheduled_start: string; scheduled_end?: string;
  dock_door?: string | null; driver_name?: string | null; truck_plate?: string | null; pallet_count?: number;
  data?: { eta_minutes?: number; podFileId?: string | null } | null;
};

const NEXT_ACTION: Record<string, { label: string; status: string; icon: React.ComponentType<{ size?: number; color?: string }>; tone: 'primary' | 'secondary' }> = {
  Requested: { label: 'Start trip', status: 'EnRoute', icon: Play, tone: 'primary' },
  Approved: { label: 'Start trip', status: 'EnRoute', icon: Play, tone: 'primary' },
  Scheduled: { label: 'Start trip', status: 'EnRoute', icon: Play, tone: 'primary' },
  EnRoute: { label: 'Arrive at gate', status: 'CheckedIn', icon: LogIn, tone: 'primary' },
  Dispatched: { label: 'Arrive at gate', status: 'CheckedIn', icon: LogIn, tone: 'primary' },
  CheckedIn: { label: 'Pull to door', status: 'AtDoor', icon: Navigation, tone: 'primary' },
  AtGate: { label: 'Pull to door', status: 'AtDoor', icon: Navigation, tone: 'primary' },
  AtDoor: { label: 'Begin loading', status: 'Loading', icon: Package, tone: 'primary' },
  Loading: { label: 'Depart', status: 'Completed', icon: LogOut, tone: 'primary' },
  Unloading: { label: 'Depart', status: 'Completed', icon: LogOut, tone: 'primary' },
};

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.operations.driverJobs.useQuery(undefined, { refetchInterval: 20000, refetchOnWindowFocus: true });
  const statusMutation = trpc.operations.checkInAppointment.useMutation({
    onSuccess: async () => { await utils.operations.driverJobs.invalidate(); },
  });
  const eventMutation = trpc.yard.recordEvent.useMutation();
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [issueText, setIssueText] = useState('');

  const jobs = useMemo<JobRow[]>(() => (jobsQuery.data ?? []) as JobRow[], [jobsQuery.data]);

  const partitioned = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const active: JobRow[] = [];
    const upcoming: JobRow[] = [];
    const done: JobRow[] = [];
    for (const j of jobs) {
      const st = j.status;
      if (st === 'Completed' || st === 'Cancelled' || st === 'NoShow') done.push(j);
      else if (['EnRoute', 'Dispatched', 'CheckedIn', 'AtGate', 'AtDoor', 'Loading', 'Unloading'].includes(st)) active.push(j);
      else upcoming.push(j);
    }
    const sortAsc = (a: JobRow, b: JobRow) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    return { active: active.sort(sortAsc), upcoming: upcoming.sort(sortAsc), done: done.sort(sortAsc).reverse() };
  }, [jobs]);

  const doAdvance = async (job: JobRow) => {
    const next = NEXT_ACTION[job.status];
    if (!next) return;
    try {
      if (Platform.OS !== 'web') { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
      await statusMutation.mutateAsync({ appointmentId: job.id, status: next.status });
      const map: Record<string, string> = { CheckedIn: 'check_in', AtDoor: 'at_door', Loading: 'loading', Completed: 'check_out', Unloading: 'unloading', EnRoute: 'en_route' };
      const kind = map[next.status];
      if (kind) { try { await eventMutation.mutateAsync({ appointmentId: job.id, kind }); } catch { /* non-fatal */ } }
      if (Platform.OS !== 'web') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    } catch (err) {
      if (Platform.OS !== 'web') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
      Alert.alert('Status update failed', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const advance = async (job: JobRow) => {
    const next = NEXT_ACTION[job.status];
    if (!next) return;
    if (next.status === 'Completed') {
      const hasPod = Boolean(job.data?.podFileId);
      const msg = hasPod ? 'Depart and mark this job complete?' : 'No POD captured yet. Depart and complete without POD?';
      Alert.alert('Depart?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: hasPod ? 'Depart' : 'Depart anyway', style: hasPod ? 'default' : 'destructive', onPress: () => void doAdvance(job) },
      ]);
      return;
    }
    await doAdvance(job);
  };

  const reportIssue = async () => {
    if (!issueFor) return;
    if (!issueText.trim()) { Alert.alert('Describe the issue'); return; }
    try {
      await eventMutation.mutateAsync({ appointmentId: issueFor, kind: 'hold', notes: issueText.trim() });
      setIssueFor(null);
      setIssueText('');
      Alert.alert('Issue reported', 'Dispatch has been notified.');
    } catch (err) {
      Alert.alert('Unable to report', err instanceof Error ? err.message : 'Unknown');
    }
  };

  if (jobsQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading today's jobs" /></View>;
  if (jobsQuery.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load jobs" onRetry={() => void jobsQuery.refetch()} /></View>;

  const renderCard = (job: JobRow, primary: boolean) => {
    const next = NEXT_ACTION[job.status];
    const NextIcon = next?.icon;
    const hasPod = Boolean(job.data?.podFileId);
    return (
      <View key={job.id} style={[styles.jobCard, primary && styles.jobCardActive]}>
        <View style={styles.jobHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.jobTitle}>{job.appointment_type}</Text>
            <View style={styles.metaRow}>
              <Clock size={11} color={C.textMuted} />
              <Text style={styles.metaText}>{new Date(job.scheduled_start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              {job.dock_door ? (<><MapPin size={11} color={C.blue} /><Text style={[styles.metaText, { color: C.blue }]}>Door {job.dock_door}</Text></>) : null}
            </View>
          </View>
          <StatusBadge status={job.status} />
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}><Text style={styles.infoLabel}>Pallets</Text><Text style={styles.infoValue}>{job.pallet_count ?? 0}</Text></View>
          <View style={styles.infoCell}><Text style={styles.infoLabel}>Truck</Text><Text style={styles.infoValue}>{job.truck_plate || '—'}</Text></View>
          <View style={styles.infoCell}><Text style={styles.infoLabel}>ETA</Text><Text style={styles.infoValue}>{job.data?.eta_minutes ? `${job.data.eta_minutes} min` : '—'}</Text></View>
        </View>

        {primary && next ? (
          <TouchableOpacity
            onPress={() => void advance(job)}
            disabled={statusMutation.isPending}
            style={[styles.primaryBtn, statusMutation.isPending && { opacity: 0.6 }]}
            testID={`advance-${job.id}`}
          >
            {NextIcon ? <NextIcon size={16} color={C.white} /> : null}
            <Text style={styles.primaryBtnText}>{next.label}</Text>
            <ChevronRight size={16} color={C.white} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.secondaryRow}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/driver/pod', params: { appointmentId: job.id } } as never)}
            style={styles.secondaryBtn}
          >
            <Camera size={13} color={hasPod ? C.green : C.accent} />
            <Text style={[styles.secondaryBtnText, hasPod && { color: C.green }]}>{hasPod ? 'POD linked' : 'Capture POD'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setIssueFor(job.id); setIssueText(''); }} style={[styles.secondaryBtn, styles.secondaryBtnWarn]}>
            <AlertTriangle size={13} color={C.red} />
            <Text style={[styles.secondaryBtnText, { color: C.red }]}>Issue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={jobsQuery.isFetching} onRefresh={() => void jobsQuery.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.hero}>
          <Text style={styles.greeting}>Today</Text>
          <Text style={styles.heroTitle}>{partitioned.active.length + partitioned.upcoming.length} jobs assigned</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{partitioned.active.length}</Text><Text style={styles.heroStatLabel}>Active</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{partitioned.upcoming.length}</Text><Text style={styles.heroStatLabel}>Upcoming</Text></View>
            <View style={styles.heroStat}><Text style={[styles.heroStatValue, { color: C.green }]}>{partitioned.done.length}</Text><Text style={styles.heroStatLabel}>Done</Text></View>
          </View>
        </View>

        {partitioned.active.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Truck size={14} color={C.accent} />
              <Text style={[styles.sectionTitle, { color: C.accent }]}>Now</Text>
            </View>
            {partitioned.active.map((j) => renderCard(j, true))}
          </>
        ) : null}

        {partitioned.upcoming.length > 0 ? (
          <>
            <View style={styles.sectionHeader}><Clock size={14} color={C.textSecondary} /><Text style={styles.sectionTitle}>Upcoming</Text></View>
            {partitioned.upcoming.map((j) => renderCard(j, partitioned.active.length === 0 && j === partitioned.upcoming[0]))}
          </>
        ) : null}

        {partitioned.done.length > 0 ? (
          <>
            <View style={styles.sectionHeader}><FileText size={14} color={C.textMuted} /><Text style={[styles.sectionTitle, { color: C.textMuted }]}>Completed today</Text></View>
            {partitioned.done.slice(0, 10).map((j) => renderCard(j, false))}
          </>
        ) : null}

        {jobs.length === 0 ? (
          <View style={styles.empty}>
            <Truck size={44} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No jobs yet</Text>
            <Text style={styles.emptyText}>Dispatcher will send jobs to your phone as they become available.</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={issueFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setIssueFor(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Report issue</Text>
            <TouchableOpacity onPress={() => setIssueFor(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Input label="What happened?" value={issueText} onChangeText={setIssueText} placeholder="Late, blocked door, damage, mechanical…" multiline numberOfLines={4} />
            <Button label="Send to dispatcher" onPress={() => void reportIssue()} loading={eventMutation.isPending} fullWidth size="lg" variant="danger" icon={<AlertTriangle size={15} color={C.white} />} />
            <Button label="Cancel" onPress={() => setIssueFor(null)} variant="ghost" fullWidth />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 16, gap: 14 },
  hero: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 18, gap: 6 },
  greeting: { fontSize: 12, color: C.textMuted, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  heroTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  heroStat: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, alignItems: 'center' },
  heroStatValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  heroStatLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  jobCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  jobCardActive: { borderColor: C.accent, borderWidth: 2 },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 11, color: C.textSecondary },
  infoGrid: { flexDirection: 'row', gap: 8 },
  infoCell: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10 },
  infoLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  infoValue: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 3 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 14 },
  primaryBtnText: { flex: 1, textAlign: 'center' as const, color: C.white, fontSize: 15, fontWeight: '800' as const },
  secondaryRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, paddingVertical: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  secondaryBtnWarn: { backgroundColor: C.red + '10', borderColor: C.red + '40' },
  secondaryBtnText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const, maxWidth: 280 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
});
