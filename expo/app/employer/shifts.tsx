import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, CheckCircle, XCircle, Clock, Star } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftPost, ShiftStatus } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import ReviewModal from '@/components/ReviewModal';

const FILTERS: (ShiftStatus | 'All')[] = ['All', 'Posted', 'Filled', 'InProgress', 'Completed', 'Cancelled'];

export default function EmployerShifts() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { shiftPosts, shiftApplications, shiftAssignments, timeEntries, workerProfiles, users } = useDockData();
  const utils = trpc.useUtils();
  const invalidate = async () => { await utils.dock.bootstrap.invalidate(); };
  const acceptApplicantM = trpc.shifts.acceptApplicant.useMutation({ onSuccess: invalidate });
  const rejectApplicantM = trpc.shifts.rejectApplicant.useMutation({ onSuccess: invalidate });
  const confirmHoursM = trpc.shifts.confirmHours.useMutation({ onSuccess: invalidate });
  const setStatusM = trpc.shifts.setStatus.useMutation({ onSuccess: invalidate });

  const [filter, setFilter] = useState<ShiftStatus | 'All'>('All');
  const [selected, setSelected] = useState<ShiftPost | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [confirmHours, setConfirmHours] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [reviewFor, setReviewFor] = useState<{ assignmentId: string; workerUserId: string; workerName: string } | null>(null);

  const myAssignmentIds = useMemo(
    () => shiftAssignments
      .filter((a) => myShifts.some((s) => s.id === a.shiftId))
      .filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status))
      .map((a) => a.id),
    [shiftAssignments, myShifts],
  );
  const myReviewsQuery = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'shift_assignment', contextIds: myAssignmentIds },
    { enabled: myAssignmentIds.length > 0 },
  );
  const reviewedAssignmentIds = useMemo(
    () => new Set(((myReviewsQuery.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [myReviewsQuery.data],
  );

  const myShifts = useMemo(() => shiftPosts.filter((s) => s.employerCompanyId === user?.companyId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [shiftPosts, user]);
  const filtered = useMemo(() => filter === 'All' ? myShifts : myShifts.filter((s) => s.status === filter), [myShifts, filter]);

  const getApplicants = (shiftId: string) => shiftApplications.filter((a) => a.shiftId === shiftId && a.status === 'Applied');
  const getAssignments = (shiftId: string) => shiftAssignments.filter((a) => a.shiftId === shiftId);
  const getWorkerName = (userId: string) => {
    const wp = workerProfiles.find((w) => w.userId === userId);
    if (wp) return wp.displayName;
    return users.find((u) => u.id === userId)?.name ?? userId;
  };

  const getTimeEntry = (assignmentId: string) => timeEntries.find((t) => t.assignmentId === assignmentId);

  const handleAcceptApplicant = (_shiftId: string, _workerUserId: string, appId: string) => {
    acceptApplicantM.mutate({ applicationId: appId }, {
      onError: (e: Error) => Alert.alert('Unable to accept', e.message),
    });
  };

  const handleRejectApplicant = (appId: string) => {
    rejectApplicantM.mutate({ applicationId: appId, reason: 'Rejected by employer' }, {
      onError: (e: Error) => Alert.alert('Unable to reject', e.message),
    });
  };

  const handleConfirmHours = (_assignmentId: string, teId: string) => {
    if (!confirmHours) { Alert.alert('Enter confirmed hours'); return; }
    confirmHoursM.mutate(
      { timeEntryId: teId, hours: Number(confirmHours), notes: confirmNotes },
      {
        onSuccess: () => {
          setConfirmHours(''); setConfirmNotes('');
          Alert.alert('Hours Confirmed', 'Worker payment will be processed.');
        },
        onError: (e: Error) => Alert.alert('Unable to confirm hours', e.message),
      },
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Shifts</Text>
        <Text style={styles.sub}>{myShifts.length} total</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 && <View style={styles.empty}><Text style={styles.emptyText}>No shifts here</Text></View>}
        {filtered.map((s) => {
          const apps = getApplicants(s.id);
          const assignments = getAssignments(s.id);
          return (
            <TouchableOpacity key={s.id} onPress={() => { setSelected(s); setDetailModal(true); }} activeOpacity={0.85}>
              <Card style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{s.title}</Text>
                    <Text style={styles.shiftMeta}>{s.locationCity} · {s.date} · {s.startTime}–{s.endTime}</Text>
                  </View>
                  <StatusBadge status={s.status} />
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.rate}>${s.hourlyRate}/hr · {s.workersNeeded} needed</Text>
                  <View style={styles.badgeRow}>
                    {apps.length > 0 && (
                      <View style={styles.appsBadge}>
                        <Users size={12} color={C.yellow} />
                        <Text style={styles.appsText}>{apps.length}</Text>
                      </View>
                    )}
                    {assignments.length > 0 && (
                      <View style={styles.assignBadge}>
                        <CheckCircle size={12} color={C.green} />
                        <Text style={styles.assignText}>{assignments.length}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal visible={detailModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>{selected.title}</Text>
                  <StatusBadge status={selected.status} size="md" />
                </View>
                <Text style={styles.modalMeta}>{selected.locationAddress}, {selected.locationCity} · {selected.date} · {selected.startTime}–{selected.endTime}</Text>
                <View style={styles.detailGrid}>
                  {[
                    ['Category', selected.category],
                    ['Rate', `$${selected.hourlyRate}/hr`],
                    ['Min Hours', `${selected.minimumHours}h`],
                    ['Workers Needed', `${selected.workersNeeded}`],
                    ['Requirements', selected.requirements || 'None'],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {/* Applicants */}
                {getApplicants(selected.id).length > 0 && (
                  <View style={styles.applicantsSection}>
                    <Text style={styles.sectionTitle}>Applicants ({getApplicants(selected.id).length})</Text>
                    {getApplicants(selected.id).map((app) => (
                      <View key={app.id} style={styles.applicantRow}>
                        <View style={styles.workerInfo}>
                          <View style={styles.workerAvatar}>
                            <Text style={styles.workerAvatarText}>{getWorkerName(app.workerUserId).charAt(0)}</Text>
                          </View>
                          <View>
                            <Text style={styles.workerName}>{getWorkerName(app.workerUserId)}</Text>
                            <Text style={styles.appliedAt}>Applied {app.appliedAt.split('T')[0]}</Text>
                          </View>
                        </View>
                        <View style={styles.applicantBtns}>
                          <TouchableOpacity onPress={() => handleAcceptApplicant(selected.id, app.workerUserId, app.id)} style={styles.acceptBtn}>
                            <CheckCircle size={16} color={C.green} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleRejectApplicant(app.id)} style={styles.rejectBtn}>
                            <XCircle size={16} color={C.red} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Assignments & Time Confirmation */}
                {getAssignments(selected.id).length > 0 && (
                  <View style={styles.assignSection}>
                    <Text style={styles.sectionTitle}>Assignments</Text>
                    {getAssignments(selected.id).map((ass) => {
                      const te = getTimeEntry(ass.id);
                      return (
                        <View key={ass.id} style={styles.assignRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.workerName}>{getWorkerName(ass.workerUserId)}</Text>
                            <Text style={styles.appliedAt}>${ass.confirmedRate}/hr</Text>
                            <StatusBadge status={ass.status} />
                          </View>
                          {te && te.endTimestamp && !te.employerConfirmedHours && (
                            <View style={styles.timeConfirm}>
                              <Text style={styles.timeConfirmTitle}>Confirm Hours</Text>
                              <Input value={confirmHours} onChangeText={setConfirmHours} keyboardType="numeric" placeholder="Hours worked" />
                              <Input value={confirmNotes} onChangeText={setConfirmNotes} placeholder="Notes (optional)" />
                              <Button label="Confirm" onPress={() => handleConfirmHours(ass.id, te.id)} size="sm" fullWidth icon={<Clock size={13} color={C.white} />} />
                            </View>
                          )}
                          {te && te.employerConfirmedHours && (
                            <View style={styles.confirmedBadge}>
                              <CheckCircle size={14} color={C.green} />
                              <Text style={styles.confirmedText}>{te.employerConfirmedHours}h confirmed</Text>
                            </View>
                          )}
                          {['Completed', 'HoursConfirmed', 'Confirmed'].includes(ass.status) && !reviewedAssignmentIds.has(ass.id) && (
                            <TouchableOpacity
                              onPress={() => setReviewFor({ assignmentId: ass.id, workerUserId: ass.workerUserId, workerName: getWorkerName(ass.workerUserId) })}
                              style={styles.rateBtn}
                            >
                              <Star size={14} color={C.accent} />
                              <Text style={styles.rateBtnText}>Rate</Text>
                            </TouchableOpacity>
                          )}
                          {['Completed', 'HoursConfirmed', 'Confirmed'].includes(ass.status) && reviewedAssignmentIds.has(ass.id) && (
                            <View style={styles.ratedBadge}>
                              <Star size={12} color={C.yellow} fill={C.yellow} />
                              <Text style={styles.ratedText}>Rated</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={styles.actionBtns}>
                  {selected.status === 'Posted' && (
                    <Button label="Cancel Shift" onPress={() => { setStatusM.mutate({ id: selected.id, status: 'Cancelled' }); setDetailModal(false); }} variant="danger" fullWidth />
                  )}
                  <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <ReviewModal
        visible={!!reviewFor}
        onClose={() => setReviewFor(null)}
        title="Rate this worker"
        subtitle={reviewFor?.workerName}
        contextKind="shift_assignment"
        contextId={reviewFor?.assignmentId ?? ''}
        targetKind="worker"
        targetUserId={reviewFor?.workerUserId ?? null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 10 },
  card: {},
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  shiftTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  rate: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  badgeRow: { flexDirection: 'row', gap: 6 },
  appsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.yellowDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  appsText: { fontSize: 12, color: C.yellow, fontWeight: '700' as const },
  assignBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  assignText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  modalMeta: { fontSize: 13, color: C.textSecondary },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  applicantsSection: { gap: 10, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  applicantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  workerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  workerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  workerAvatarText: { fontSize: 14, fontWeight: '700' as const, color: C.accent },
  workerName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  appliedAt: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  applicantBtns: { flexDirection: 'row', gap: 8 },
  acceptBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.redDim, alignItems: 'center', justifyContent: 'center' },
  assignSection: { gap: 10, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  assignRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  timeConfirm: { flex: 1, gap: 8 },
  timeConfirmTitle: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  confirmedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmedText: { fontSize: 13, color: C.green, fontWeight: '600' as const },
  actionBtns: { gap: 10 },
  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rateBtnText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  ratedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratedText: { fontSize: 12, color: C.yellow, fontWeight: '600' as const },
});
