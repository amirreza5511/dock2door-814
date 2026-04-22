import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, LogIn, LogOut as LogOutIcon, CheckCircle, Star } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftAssignment } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import ReviewModal from '@/components/ReviewModal';

type ViewTab = 'Applications' | 'Assignments';

export default function WorkerMyShifts() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { shiftApplications, shiftAssignments, shiftPosts, timeEntries, companies } = useDockData();
  const utils = trpc.useUtils();
  const invalidate = async () => { await utils.dock.bootstrap.invalidate(); };
  const withdrawM = trpc.shifts.withdraw.useMutation({ onSuccess: invalidate });
  const clockInM = trpc.shifts.clockIn.useMutation({ onSuccess: invalidate });
  const clockOutM = trpc.shifts.clockOut.useMutation({ onSuccess: invalidate });

  const [tab, setTab] = useState<ViewTab>('Applications');
  const [selectedAss, setSelectedAss] = useState<ShiftAssignment | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [reviewFor, setReviewFor] = useState<ShiftAssignment | null>(null);

  const completedAssignmentIds = useMemo(
    () => myAssignments.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).map((a) => a.id),
    [myAssignments],
  );
  const myReviewsQuery = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'shift_assignment', contextIds: completedAssignmentIds },
    { enabled: completedAssignmentIds.length > 0 },
  );
  const reviewedAssignmentIds = useMemo(
    () => new Set(((myReviewsQuery.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [myReviewsQuery.data],
  );

  const myApps = useMemo(() => shiftApplications.filter((a) => a.workerUserId === user?.id).sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()), [shiftApplications, user]);
  const myAssignments = useMemo(() => shiftAssignments.filter((a) => a.workerUserId === user?.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [shiftAssignments, user]);

  const getShift = (id: string) => shiftPosts.find((s) => s.id === id);
  const getTimeEntry = (assignmentId: string) => timeEntries.find((t) => t.assignmentId === assignmentId);
  const getEmployerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? companyId;

  const handleWithdraw = (appId: string) => {
    Alert.alert('Withdraw Application', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => withdrawM.mutate({ applicationId: appId }, {
        onError: (e: Error) => Alert.alert('Unable to withdraw', e.message),
      }) },
    ]);
  };

  const handleStartShift = (ass: ShiftAssignment) => {
    clockInM.mutate({ assignmentId: ass.id }, {
      onSuccess: () => Alert.alert('Shift Started!', 'Your start time has been recorded.'),
      onError: (e: Error) => Alert.alert('Unable to start shift', e.message),
    });
  };

  const handleEndShift = (ass: ShiftAssignment) => {
    clockOutM.mutate({ assignmentId: ass.id }, {
      onSuccess: () => { Alert.alert('Shift Ended!', 'Awaiting employer to confirm your hours.'); setDetailModal(false); },
      onError: (e: Error) => Alert.alert('Unable to end shift', e.message),
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Shifts</Text>
        <View style={styles.tabs}>
          {(['Applications', 'Assignments'] as ViewTab[]).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {tab === 'Applications' && (
          myApps.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No applications yet</Text></View>
          ) : myApps.map((app) => {
            const shift = getShift(app.shiftId);
            return (
              <Card key={app.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{shift?.title ?? app.shiftId}</Text>
                    {shift && <Text style={styles.employer}>{getEmployerName(shift.employerCompanyId)}</Text>}
                    {shift && (
                      <View style={styles.metaRow}>
                        <MapPin size={12} color={C.textMuted} />
                        <Text style={styles.meta}>{shift.locationCity}</Text>
                        <Clock size={12} color={C.textMuted} />
                        <Text style={styles.meta}>{shift.date}</Text>
                        <DollarSign size={12} color={C.textMuted} />
                        <Text style={styles.meta}>${shift.hourlyRate}/hr</Text>
                      </View>
                    )}
                  </View>
                  <StatusBadge status={app.status} />
                </View>
                {app.status === 'Applied' && (
                  <Button label="Withdraw" onPress={() => handleWithdraw(app.id)} variant="danger" size="sm" />
                )}
              </Card>
            );
          })
        )}

        {tab === 'Assignments' && (
          myAssignments.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No assignments yet</Text></View>
          ) : myAssignments.map((ass) => {
            const shift = getShift(ass.shiftId);
            const te = getTimeEntry(ass.id);
            return (
              <TouchableOpacity key={ass.id} onPress={() => { setSelectedAss(ass); setDetailModal(true); }} activeOpacity={0.85}>
                <Card style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shiftTitle}>{shift?.title ?? ass.shiftId}</Text>
                      {shift && <Text style={styles.employer}>{getEmployerName(shift.employerCompanyId)}</Text>}
                      {shift && (
                        <View style={styles.metaRow}>
                          <MapPin size={12} color={C.textMuted} />
                          <Text style={styles.meta}>{shift.locationCity} · {shift.date}</Text>
                          <DollarSign size={12} color={C.textMuted} />
                          <Text style={styles.meta}>${ass.confirmedRate}/hr</Text>
                        </View>
                      )}
                    </View>
                    <StatusBadge status={ass.status} />
                  </View>
                  {te && (
                    <View style={styles.timeRow}>
                      {te.startTimestamp && <Text style={styles.timeText}>Started: {te.startTimestamp.replace('T', ' ').slice(0, 16)}</Text>}
                      {te.endTimestamp && <Text style={styles.timeText}>Ended: {te.endTimestamp.replace('T', ' ').slice(0, 16)}</Text>}
                      {te.employerConfirmedHours && (
                        <View style={styles.confirmedRow}>
                          <CheckCircle size={13} color={C.green} />
                          <Text style={styles.confirmedText}>{te.employerConfirmedHours}h confirmed · ${(te.employerConfirmedHours * ass.confirmedRate).toFixed(0)} earned</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {ass.status === 'Scheduled' && (
                    <Button label="Start Shift" onPress={() => handleStartShift(ass)} size="sm" icon={<LogIn size={13} color={C.white} />} />
                  )}
                  {ass.status === 'InProgress' && (
                    <Button label="End Shift" onPress={() => { setSelectedAss(ass); setDetailModal(true); }} size="sm" variant="outline" icon={<LogOutIcon size={13} color={C.accent} />} />
                  )}
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Modal visible={detailModal && !!selectedAss} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selectedAss && (() => {
            const shift = getShift(selectedAss.shiftId);
            const te = getTimeEntry(selectedAss.id);
            return (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalBody}>
                  <View style={styles.modalTitleRow}>
                    <Text style={styles.modalTitle}>{shift?.title ?? selectedAss.shiftId}</Text>
                    <StatusBadge status={selectedAss.status} size="md" />
                  </View>
                  {shift && <Text style={styles.modalEmployer}>{getEmployerName(shift.employerCompanyId)}</Text>}
                  <View style={styles.detailGrid}>
                    {shift && [
                      ['Location', `${shift.locationAddress}, ${shift.locationCity}`],
                      ['Date', shift.date],
                      ['Time', `${shift.startTime} – ${shift.endTime}`],
                      ['Rate', `$${selectedAss.confirmedRate}/hr`],
                      ['Category', shift.category],
                    ].map(([l, v]) => (
                      <View key={l} style={styles.detailItem}>
                        <Text style={styles.detailLabel}>{l}</Text>
                        <Text style={styles.detailValue}>{v}</Text>
                      </View>
                    ))}
                  </View>
                  {te && (
                    <View style={styles.timeCard}>
                      <Text style={styles.timeCardTitle}>Time Record</Text>
                      {te.startTimestamp && <Text style={styles.timeCardDetail}>Check-In: {te.startTimestamp.replace('T', ' ').slice(0, 16)}</Text>}
                      {te.endTimestamp && <Text style={styles.timeCardDetail}>Check-Out: {te.endTimestamp.replace('T', ' ').slice(0, 16)}</Text>}
                      {te.employerConfirmedHours && (
                        <Text style={[styles.timeCardDetail, { color: C.green }]}>Confirmed: {te.employerConfirmedHours}h · ${(te.employerConfirmedHours * selectedAss.confirmedRate).toFixed(0)}</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.actionBtns}>
                    {selectedAss.status === 'Scheduled' && (
                      <Button label="Start Shift" onPress={() => { handleStartShift(selectedAss); setDetailModal(false); }} fullWidth size="lg" icon={<LogIn size={16} color={C.white} />} />
                    )}
                    {selectedAss.status === 'InProgress' && (
                      <Button label="End Shift" onPress={() => handleEndShift(selectedAss)} fullWidth size="lg" variant="outline" icon={<LogOutIcon size={16} color={C.accent} />} />
                    )}
                    {['Completed', 'HoursConfirmed', 'Confirmed'].includes(selectedAss.status) && !reviewedAssignmentIds.has(selectedAss.id) && shift && (
                      <Button
                        label="Rate Employer"
                        onPress={() => { setDetailModal(false); setReviewFor(selectedAss); }}
                        fullWidth
                        variant="outline"
                        icon={<Star size={15} color={C.accent} />}
                      />
                    )}
                    {['Completed', 'HoursConfirmed', 'Confirmed'].includes(selectedAss.status) && reviewedAssignmentIds.has(selectedAss.id) && (
                      <Text style={{ color: C.green, textAlign: 'center', fontSize: 13, fontWeight: '600' as const }}>You rated this employer</Text>
                    )}
                    <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                  </View>
                </View>
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      <ReviewModal
        visible={!!reviewFor}
        onClose={() => setReviewFor(null)}
        title="Rate this employer"
        subtitle={reviewFor ? getEmployerName(getShift(reviewFor.shiftId)?.employerCompanyId ?? '') : undefined}
        contextKind="shift_assignment"
        contextId={reviewFor?.id ?? ''}
        targetKind="company"
        targetCompanyId={reviewFor ? getShift(reviewFor.shiftId)?.employerCompanyId ?? null : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 0, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 12 },
  tabs: { flexDirection: 'row' },
  tab: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.accent },
  tabText: { fontSize: 14, color: C.textMuted, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  list: { padding: 16, gap: 10 },
  card: {},
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  shiftTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  employer: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginTop: 2, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: C.textSecondary },
  timeRow: { paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, gap: 4 },
  timeText: { fontSize: 12, color: C.textSecondary },
  confirmedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmedText: { fontSize: 12, color: C.green, fontWeight: '600' as const },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  modalEmployer: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  timeCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, gap: 6 },
  timeCardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  timeCardDetail: { fontSize: 13, color: C.textSecondary },
  actionBtns: { gap: 10 },
});
