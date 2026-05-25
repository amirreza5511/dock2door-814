import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Users, CheckCircle, XCircle, Clock, Star, ChevronDown, ChevronUp,
  Award, User, AlertTriangle, AlertCircle,
} from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import { useRouter } from 'expo-router';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftPost, ShiftStatus } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import ReviewModal from '@/components/ReviewModal';

const FILTERS: (ShiftStatus | 'All')[] = ['All', 'Posted', 'Filled', 'InProgress', 'Completed', 'Cancelled'];

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  confirmed_rate: number;
  status: string;
  created_at: string;
  worker_confirmed: boolean | null;
  worker_confirmed_at: string | null;
  cancellation_reason: string | null;
}

interface AppRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
}

interface RejectTarget {
  applicationId: string;
  workerName: string;
  shiftTitle: string;
}

interface TimeEntryRow {
  id: string;
  assignment_id: string;
  start_timestamp: string | null;
  end_timestamp: string | null;
  employer_confirmed_hours: number | null;
  employer_notes: string | null;
}

interface WorkerReviewRow { target_user_id: string; rating: number; }

function calcClockHours(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function fmtTs(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function EmployerShifts() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { shiftPosts, workerProfiles, users, workerCertifications } = useDockData();
  const queryClient = useQueryClient();

  const utils = trpc.useUtils();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['employer-assignments', user?.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['employer-apps', user?.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['employer-timeentries', user?.companyId] }),
      utils.dock.bootstrap.invalidate(),
    ]);
  };

  const acceptM = trpc.shifts.acceptApplicant.useMutation({ onSuccess: invalidate });
  const rejectM = trpc.shifts.rejectApplicant.useMutation({ onSuccess: invalidate });
  const confirmM = trpc.shifts.confirmHours.useMutation({ onSuccess: invalidate });
  const setStatusM = trpc.shifts.setStatus.useMutation({ onSuccess: invalidate });

  const [filter, setFilter] = useState<ShiftStatus | 'All'>('All');
  const [selected, setSelected] = useState<ShiftPost | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [confirmHours, setConfirmHours] = useState('');
  const [editingHours, setEditingHours] = useState(false);
  const [reviewFor, setReviewFor] = useState<{ assignmentId: string; workerUserId: string; workerName: string } | null>(null);
  const [expandedApplicantId, setExpandedApplicantId] = useState<string | null>(null);
  const [noShowFor, setNoShowFor] = useState<AssignmentRow | null>(null);
  const [noShowReason, setNoShowReason] = useState('');
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [rejectFor, setRejectFor] = useState<RejectTarget | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelFor, setCancelFor] = useState<ShiftPost | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const myShifts = useMemo(
    () => shiftPosts
      .filter((s) => s.employerCompanyId === user?.companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [shiftPosts, user],
  );
  const filteredShifts = useMemo(
    () => (filter === 'All' ? myShifts : myShifts.filter((s) => s.status === filter)),
    [myShifts, filter],
  );

  // Direct Supabase queries for assignments and applications
  const assignmentsQ = useQuery({
    queryKey: ['employer-assignments', user?.companyId],
    queryFn: async (): Promise<AssignmentRow[]> => {
      if (!user?.companyId) return [];
      const shiftIds = shiftPosts.filter((s) => s.employerCompanyId === user.companyId).map((s) => s.id);
      if (shiftIds.length === 0) return [];
      const { data } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,worker_user_id,confirmed_rate,status,created_at,worker_confirmed,worker_confirmed_at,cancellation_reason')
        .in('shift_id', shiftIds);
      return (data ?? []) as AssignmentRow[];
    },
    enabled: Boolean(user?.companyId),
    staleTime: 30_000,
  });

  const appsQ = useQuery({
    queryKey: ['employer-apps', user?.companyId],
    queryFn: async (): Promise<AppRow[]> => {
      if (!user?.companyId) return [];
      const shiftIds = shiftPosts.filter((s) => s.employerCompanyId === user.companyId).map((s) => s.id);
      if (shiftIds.length === 0) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status,applied_at')
        .in('shift_id', shiftIds)
        .eq('status', 'Applied');
      return (data ?? []) as AppRow[];
    },
    enabled: Boolean(user?.companyId),
    staleTime: 30_000,
  });

  const teQ = useQuery({
    queryKey: ['employer-timeentries', user?.companyId],
    queryFn: async (): Promise<TimeEntryRow[]> => {
      const ids = (assignmentsQ.data ?? []).map((a) => a.id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from('time_entries')
        .select('id,assignment_id,start_timestamp,end_timestamp,employer_confirmed_hours,employer_notes')
        .in('assignment_id', ids);
      return (data ?? []) as TimeEntryRow[];
    },
    enabled: (assignmentsQ.data?.length ?? 0) > 0,
    staleTime: 30_000,
  });

  // Worker reviews for inline rating display
  const workerReviewsQ = useQuery({
    queryKey: ['worker-ratings'],
    queryFn: async (): Promise<WorkerReviewRow[]> => {
      const { data } = await supabase
        .from('reviews')
        .select('target_user_id,rating')
        .not('target_user_id', 'is', null);
      return (data ?? []) as WorkerReviewRow[];
    },
    staleTime: 120_000,
  });

  const allAssignments = assignmentsQ.data ?? [];
  const allApps = appsQ.data ?? [];
  const allTEs = teQ.data ?? [];
  const workerReviews = workerReviewsQ.data ?? [];

  const getApplicants = (shiftId: string) => allApps.filter((a) => a.shift_id === shiftId);
  const getAssignments = (shiftId: string) => allAssignments.filter((a) => a.shift_id === shiftId);
  const getTE = (assignmentId: string) => allTEs.find((t) => t.assignment_id === assignmentId);

  const getWorkerName = (userId: string) => {
    const wp = workerProfiles.find((w) => w.userId === userId);
    if (wp) return wp.displayName;
    return users.find((u) => u.id === userId)?.name ?? userId;
  };

  const getWorkerProfile = (userId: string) => workerProfiles.find((w) => w.userId === userId);
  // Use status === 'Approved' — the adminApproved boolean is a legacy field and may be false
  // even for newly approved certs. The status column is the authoritative source.
  const getWorkerCerts = (userId: string) => workerCertifications.filter((c) => c.workerUserId === userId && c.status === 'Approved');

  const getWorkerRating = (userId: string): { avg: number; count: number } => {
    const revs = workerReviews.filter((r) => r.target_user_id === userId);
    if (revs.length === 0) return { avg: 0, count: 0 };
    return { avg: revs.reduce((s, r) => s + r.rating, 0) / revs.length, count: revs.length };
  };

  const isShiftPast = (shiftId: string): boolean => {
    const shift = shiftPosts.find((s) => s.id === shiftId);
    if (!shift) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(shift.date + 'T00:00:00') < today;
  };

  const isWithin48h = (shiftId: string): boolean => {
    const shift = shiftPosts.find((s) => s.id === shiftId);
    if (!shift) return false;
    const shiftStart = new Date(`${shift.date}T${shift.startTime}`).getTime();
    const now = Date.now();
    return shiftStart - now < 48 * 3_600_000 && shiftStart > now;
  };

  const handleNoShow = async () => {
    if (!noShowFor) return;
    const reason = noShowReason.trim();
    if (reason.length < 10) {
      Alert.alert(
        'Reason required',
        'Please describe the no-show specifically (at least 10 characters). This is logged in audit and appears on the worker’s record.',
      );
      return;
    }
    setNoShowLoading(true);
    try {
      const { error } = await supabase.rpc('mark_shift_no_show', {
        p_shift_id: noShowFor.shift_id,
        p_worker_user_id: noShowFor.worker_user_id,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      setNoShowFor(null);
      setNoShowReason('');
      await invalidate();
      Alert.alert('Recorded', 'Worker has been marked as no-show.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to mark no-show');
    } finally {
      setNoShowLoading(false);
    }
  };

  const getWorkerReliability = (userId: string): { total: number; noShows: number } => {
    const workerAsss = allAssignments.filter((a) => a.worker_user_id === userId);
    const total = workerAsss.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).length;
    const noShows = workerAsss.filter((a) => a.status === 'NoShow').length;
    return { total, noShows };
  };

  // Review tracking
  const reviewableIds = useMemo(
    () => allAssignments
      .filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status))
      .map((a) => a.id),
    [allAssignments],
  );
  const myReviewsQ = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'shift_assignment', contextIds: reviewableIds },
    { enabled: reviewableIds.length > 0 },
  );
  const reviewedIds = useMemo(
    () => new Set(((myReviewsQ.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [myReviewsQ.data],
  );

  const handleConfirmHours = (assignmentId: string, teId: string, hours: number) => {
    const h = Number(hours);
    if (!h || h <= 0) { Alert.alert('Enter valid hours'); return; }
    confirmM.mutate(
      { timeEntryId: teId, hours: h, notes: '' },
      {
        onSuccess: () => {
          setConfirmHours('');
          setEditingHours(false);
          Alert.alert('Hours Confirmed', 'Hours saved. The worker has been notified. Payment follows your payroll schedule.');
        },
        onError: (e: Error) => Alert.alert('Unable to confirm hours', e.message),
      },
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Shifts</Text>
        <Text style={styles.sub}>{myShifts.length} total · {allApps.length} pending applicants</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {filteredShifts.length === 0 && (
          <View style={styles.empty}><Text style={styles.emptyText}>No shifts here</Text></View>
        )}
        {filteredShifts.map((s) => {
          const apps = getApplicants(s.id);
          const assignments = getAssignments(s.id);
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => { setSelected(s); setExpandedApplicantId(null); setDetailModal(true); }}
              activeOpacity={0.85}
            >
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

      {/* Detail Modal */}
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
                <Text style={styles.modalMeta}>
                  {selected.locationAddress}, {selected.locationCity} · {selected.date} · {selected.startTime}–{selected.endTime}
                </Text>

                {/* Applicants */}
                {getApplicants(selected.id).length > 0 && (
                  <View style={styles.applicantsSection}>
                    <Text style={styles.sectionTitle}>
                      Applicants ({getApplicants(selected.id).length})
                    </Text>
                    {getApplicants(selected.id).map((app) => {
                      const wp = getWorkerProfile(app.worker_user_id);
                      const certs = getWorkerCerts(app.worker_user_id);
                      const rating = getWorkerRating(app.worker_user_id);
                      const rel = getWorkerReliability(app.worker_user_id);
                      const isExpanded = expandedApplicantId === app.id;

                      return (
                        <View key={app.id} style={styles.applicantBlock}>
                          <View style={styles.applicantRow}>
                            <TouchableOpacity
                              style={styles.workerInfo}
                              onPress={() => setExpandedApplicantId(isExpanded ? null : app.id)}
                            >
                              <View style={styles.workerAvatar}>
                                <Text style={styles.workerAvatarText}>
                                  {getWorkerName(app.worker_user_id).charAt(0)}
                                </Text>
                              </View>
                              <View>
                                <Text style={styles.workerName}>{getWorkerName(app.worker_user_id)}</Text>
                                <Text style={styles.appliedAt}>Applied {app.applied_at.split('T')[0]}</Text>
                              </View>
                              {isExpanded ? (
                                <ChevronUp size={14} color={C.textMuted} />
                              ) : (
                                <ChevronDown size={14} color={C.textMuted} />
                              )}
                            </TouchableOpacity>
                            <View style={styles.applicantBtns}>
                              <TouchableOpacity
                                onPress={() => acceptM.mutate({ applicationId: app.id }, {
                                  onError: (e: Error) => Alert.alert('Unable to accept', e.message),
                                })}
                                style={styles.acceptBtn}
                              >
                                <CheckCircle size={16} color={C.green} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => {
                                  setRejectReason('');
                                  setRejectFor({
                                    applicationId: app.id,
                                    workerName: getWorkerName(app.worker_user_id),
                                    shiftTitle: selected?.title ?? '',
                                  });
                                }}
                                style={styles.rejectBtn}
                              >
                                <XCircle size={16} color={C.red} />
                              </TouchableOpacity>
                            </View>
                          </View>

                          {/* Inline expanded worker profile */}
                          {isExpanded && (
                            <View style={styles.workerExpandCard}>
                              {/* Skills */}
                              {(wp?.skills ?? []).length > 0 && (
                                <View style={styles.expandRow}>
                                  {(wp!.skills).map((s) => (
                                    <View key={s} style={styles.skillChip}>
                                      <Text style={styles.skillText}>{s}</Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                              {/* Certs */}
                              {certs.length > 0 && (
                                <View style={styles.expandRow}>
                                  {certs.map((c) => (
                                    <View key={c.id} style={styles.certChip}>
                                      <Award size={11} color={C.green} />
                                      <Text style={styles.certChipText}>{c.type}</Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                              {/* Rating */}
                              {rating.count > 0 && (
                                <View style={styles.expandMeta}>
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <Star key={n} size={12} color={n <= Math.round(rating.avg) ? C.yellow : C.border} fill={n <= Math.round(rating.avg) ? C.yellow : 'transparent'} />
                                  ))}
                                  <Text style={styles.expandMetaText}>{rating.avg.toFixed(1)} ({rating.count})</Text>
                                </View>
                              )}
                              {/* Reliability */}
                              <View style={styles.expandMeta}>
                                <CheckCircle size={12} color={C.green} />
                                <Text style={styles.expandMetaText}>
                                  {rel.total} shifts completed
                                  {rel.noShows > 0 ? ` · ${rel.noShows} no-shows` : ''}
                                </Text>
                              </View>
                              {/* Bio snippet */}
                              {wp?.bio && (
                                <Text style={styles.bioSnippet} numberOfLines={2}>{wp.bio}</Text>
                              )}
                              <TouchableOpacity
                                onPress={() => {
                                  setDetailModal(false);
                                  setTimeout(() => router.push({ pathname: '/worker/[id]' as any, params: { id: app.worker_user_id } }), 300);
                                }}
                              >
                                <Text style={styles.viewFullProfile}>View Full Profile →</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Assignments + Time Confirmation */}
                {getAssignments(selected.id).length > 0 && (
                  <View style={styles.assignSection}>
                    <Text style={styles.sectionTitle}>Assignments</Text>
                    {getAssignments(selected.id).map((ass) => {
                      const te = getTE(ass.id);
                      const clockHours = te?.start_timestamp && te?.end_timestamp
                        ? calcClockHours(te.start_timestamp, te.end_timestamp)
                        : null;
                      const preFilledHours = clockHours ? roundHalf(clockHours) : 0;
                      const diff = clockHours && te?.employer_confirmed_hours
                        ? Math.abs(clockHours - te.employer_confirmed_hours)
                        : 0;

                      return (
                        <View key={ass.id} style={styles.assignRow}>
                          <View style={styles.assignWorkerInfo}>
                            <View style={styles.workerAvatar}>
                              <User size={14} color={C.accent} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.workerName}>{getWorkerName(ass.worker_user_id)}</Text>
                              <Text style={styles.appliedAt}>${ass.confirmed_rate}/hr</Text>
                            </View>
                            <StatusBadge status={ass.status} />
                            {['Completed', 'HoursConfirmed', 'Confirmed'].includes(ass.status) &&
                              !reviewedIds.has(ass.id) && (
                                <TouchableOpacity
                                  onPress={() => setReviewFor({
                                    assignmentId: ass.id,
                                    workerUserId: ass.worker_user_id,
                                    workerName: getWorkerName(ass.worker_user_id),
                                  })}
                                  style={styles.rateBtn}
                                >
                                  <Star size={13} color={C.accent} />
                                  <Text style={styles.rateBtnText}>Rate</Text>
                                </TouchableOpacity>
                              )}
                          </View>

                          {/* Worker confirmation status */}
                          {ass.worker_confirmed === true && (
                            <View style={[styles.awaitingBadge, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
                              <CheckCircle size={12} color={C.green} />
                              <Text style={[styles.awaitingText, { color: C.green }]}>✓ Worker confirmed attendance</Text>
                            </View>
                          )}
                          {ass.worker_confirmed === false && (
                            <View style={[styles.awaitingBadge, { backgroundColor: C.redDim, borderColor: C.red + '40' }]}>
                              <AlertCircle size={12} color={C.red} />
                              <Text style={[styles.awaitingText, { color: C.red }]} numberOfLines={2}>
                                ✗ Worker cancelled{ass.cancellation_reason ? `: ${ass.cancellation_reason}` : ''}
                              </Text>
                            </View>
                          )}
                          {ass.worker_confirmed === null && ass.status === 'Scheduled' && isWithin48h(ass.shift_id) && (
                            <View style={styles.awaitingBadge}>
                              <Clock size={12} color={C.yellow} />
                              <Text style={styles.awaitingText}>⏳ Awaiting worker confirmation</Text>
                            </View>
                          )}
                          {/* No-show button — only for Scheduled assignments on a past shift date.
                              Completed / HoursConfirmed / Cancelled / NoShow / Confirmed are excluded. */}
                          {ass.status === 'Scheduled' && isShiftPast(ass.shift_id) && !['Completed', 'HoursConfirmed', 'Cancelled', 'NoShow', 'Confirmed'].includes(ass.status) && (
                            <TouchableOpacity
                              onPress={() => { setNoShowFor(ass); setNoShowReason(''); }}
                              style={styles.noShowBtn}
                            >
                              <AlertCircle size={13} color={C.red} />
                              <Text style={styles.noShowBtnText}>Mark No-Show</Text>
                            </TouchableOpacity>
                          )}

                          {/* Time entry + confirmation */}
                          {te && te.end_timestamp && !te.employer_confirmed_hours && (
                            <View style={styles.timeConfirmBox}>
                              <Text style={styles.timeConfirmTitle}>Confirm Hours</Text>
                              <View style={styles.clockRecord}>
                                <Clock size={13} color={C.textMuted} />
                                <Text style={styles.clockText}>
                                  Worker clocked: {fmtTs(te.start_timestamp!)} – {fmtTs(te.end_timestamp)}
                                  {' '}({clockHours?.toFixed(2)}h)
                                </Text>
                              </View>

                              {!editingHours ? (
                                <View style={styles.confirmBtns}>
                                  <Button
                                    label={`Confirm Exact (${preFilledHours}h)`}
                                    onPress={() => handleConfirmHours(ass.id, te.id, preFilledHours)}
                                    size="sm"
                                    fullWidth
                                    icon={<CheckCircle size={13} color={C.white} />}
                                  />
                                  <Button
                                    label="Edit Hours"
                                    onPress={() => { setConfirmHours(String(preFilledHours)); setEditingHours(true); }}
                                    variant="outline"
                                    size="sm"
                                    fullWidth
                                  />
                                </View>
                              ) : (
                                <View style={styles.confirmBtns}>
                                  <Input
                                    value={confirmHours}
                                    onChangeText={(v) => setConfirmHours(v)}
                                    keyboardType="numeric"
                                    placeholder={String(preFilledHours)}
                                    label="Hours worked"
                                  />
                                  {/* OT warning (BC Employment Standards) */}
                                  {Number(confirmHours) > 0 && (() => {
                                    const h = Number(confirmHours);
                                    const rate = ass.confirmed_rate;
                                    const reg = Math.min(h, 8);
                                    const ot = h > 8 ? Math.min(h - 8, 4) : 0;
                                    const dbl = h > 12 ? h - 12 : 0;
                                    const total = (reg * rate) + (ot * rate * 1.5) + (dbl * rate * 2);
                                    if (h <= 8) return (
                                      <Text style={styles.otRegular}>Regular time: ${total.toFixed(2)}</Text>
                                    );
                                    if (h <= 12) return (
                                      <View style={styles.warnRow}>
                                        <AlertTriangle size={13} color={C.yellow} />
                                        <Text style={styles.warnText}>⚠️ Overtime applies: {reg}h regular + {ot}h at 1.5× = ${total.toFixed(2)} total</Text>
                                      </View>
                                    );
                                    return (
                                      <View style={[styles.warnRow, { backgroundColor: C.redDim, borderColor: C.red + '40' }]}>
                                        <AlertTriangle size={13} color={C.red} />
                                        <Text style={[styles.warnText, { color: C.red }]}>⚠️ Double time: 8h regular + 4h at 1.5× + {dbl.toFixed(1)}h at 2× = ${total.toFixed(2)} total</Text>
                                      </View>
                                    );
                                  })()}
                                  {Number(confirmHours) > 0 && clockHours && Math.abs(clockHours - Number(confirmHours)) > 1 && (
                                    <View style={styles.warnRow}>
                                      <AlertTriangle size={13} color={C.yellow} />
                                      <Text style={styles.warnText}>
                                        ⚠️ Hours differ significantly from clock record. Worker may dispute.
                                      </Text>
                                    </View>
                                  )}
                                  <Button
                                    label="Confirm"
                                    onPress={() => handleConfirmHours(ass.id, te.id, Number(confirmHours))}
                                    loading={confirmM.isPending}
                                    size="sm"
                                    fullWidth
                                    icon={<CheckCircle size={13} color={C.white} />}
                                  />
                                  <Button
                                    label="Cancel"
                                    onPress={() => setEditingHours(false)}
                                    variant="ghost"
                                    size="sm"
                                    fullWidth
                                  />
                                </View>
                              )}
                            </View>
                          )}

                          {te && te.end_timestamp && !te.employer_confirmed_hours && (
                            <Text style={styles.bcNotice}>Reminder: verify local minimum wage and overtime rules before confirming.</Text>
                          )}
                          {te?.employer_confirmed_hours != null && (
                            <View style={styles.confirmedBox}>
                              <CheckCircle size={14} color={C.green} />
                              <Text style={styles.confirmedText}>
                                {te.employer_confirmed_hours}h confirmed
                                {diff > 0.5 && <Text style={{ color: C.yellow }}> (disputed)</Text>}
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={styles.actionBtns}>
                  {selected.status === 'Posted' && (
                    <Button
                      label="Cancel Shift"
                      onPress={() => {
                        setCancelFor(selected);
                        setCancelReason('');
                        setDetailModal(false);
                      }}
                      variant="danger"
                      fullWidth
                    />
                  )}
                  <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Reject Applicant Modal */}
      <Modal visible={!!rejectFor} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setRejectFor(null)}>
        <View style={[styles.modal, { paddingBottom: 40, paddingHorizontal: 20, paddingTop: 20, gap: 14 }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.noShowModalTitle}>Reject Applicant</Text>
          <Text style={styles.noShowModalSub}>
            {rejectFor ? `${rejectFor.workerName} applied to ${rejectFor.shiftTitle || 'this shift'}.` : ''} The worker will see your reason in their Applications list, so please be professional and specific.
          </Text>
          <TextInput
            value={rejectReason}
            onChangeText={setRejectReason}
            placeholder="Reason (e.g. Position filled, certifications not matching, scheduling conflict)"
            placeholderTextColor={C.textMuted}
            style={styles.noShowInput}
            multiline
            numberOfLines={4}
          />
          <View style={{ gap: 10 }}>
            <Button
              label={rejectM.isPending ? 'Rejecting…' : 'Send Rejection'}
              onPress={() => {
                if (!rejectFor) return;
                const reason = rejectReason.trim();
                if (reason.length < 10) {
                  Alert.alert(
                    'Reason required',
                    'Please write a specific, professional reason (min 10 characters). The worker will see this in their Applications list.',
                  );
                  return;
                }
                rejectM.mutate(
                  { applicationId: rejectFor.applicationId, reason },
                  {
                    onSuccess: () => { setRejectFor(null); setRejectReason(''); },
                    onError: (e: Error) => Alert.alert('Unable to reject', e.message),
                  },
                );
              }}
              loading={rejectM.isPending}
              variant="danger"
              fullWidth
              size="lg"
              icon={<XCircle size={15} color={C.white} />}
            />
            <Button
              label="Cancel"
              onPress={() => { setRejectFor(null); setRejectReason(''); }}
              variant="ghost"
              fullWidth
            />
          </View>
        </View>
      </Modal>

      {/* Cancel Shift Modal — real reason required, sent to all applicants/assigned workers via cancel_shift_with_reason → 0059 notifications */}
      <Modal visible={!!cancelFor} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setCancelFor(null)}>
        <View style={[styles.modal, { paddingBottom: 40, paddingHorizontal: 20, paddingTop: 20, gap: 14 }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.noShowModalTitle}>Cancel Shift</Text>
          <Text style={styles.noShowModalSub}>
            {cancelFor ? `"${cancelFor.title}" on ${cancelFor.date}.` : ''} All applicants and assigned workers will be notified with your reason. Please be specific.
          </Text>
          <TextInput
            value={cancelReason}
            onChangeText={setCancelReason}
            placeholder="Reason (e.g. Project postponed, weather, customer cancelled)"
            placeholderTextColor={C.textMuted}
            style={styles.noShowInput}
            multiline
            numberOfLines={4}
            autoFocus
          />
          <View style={{ gap: 10 }}>
            <Button
              label={setStatusM.isPending ? 'Cancelling…' : 'Confirm Cancellation'}
              onPress={() => {
                if (!cancelFor) return;
                const reason = cancelReason.trim();
                if (reason.length < 10) {
                  Alert.alert('Reason required', 'Please enter a specific reason (at least 10 characters) so workers understand why.');
                  return;
                }
                setStatusM.mutate(
                  { id: cancelFor.id, status: 'Cancelled', reason },
                  {
                    onSuccess: () => { setCancelFor(null); setCancelReason(''); },
                    onError: (e: Error) => Alert.alert('Unable to cancel', e.message),
                  },
                );
              }}
              loading={setStatusM.isPending}
              variant="danger"
              fullWidth
              size="lg"
              icon={<XCircle size={15} color={C.white} />}
            />
            <Button
              label="Keep Shift"
              onPress={() => { setCancelFor(null); setCancelReason(''); }}
              variant="ghost"
              fullWidth
            />
          </View>
        </View>
      </Modal>

      {/* No-Show Modal */}
      <Modal visible={!!noShowFor} animationType="slide" presentationStyle="formSheet">
        <View style={[styles.modal, { paddingBottom: 40, paddingHorizontal: 20, paddingTop: 20, gap: 14 }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.noShowModalTitle}>Mark Worker No-Show</Text>
          <Text style={styles.noShowModalSub}>
            This will mark {noShowFor ? getWorkerName(noShowFor.worker_user_id) : ''} as no-show for this shift,
            cancel the assignment, and add a no-show risk badge to their profile.
          </Text>
          <TextInput
            value={noShowReason}
            onChangeText={setNoShowReason}
            placeholder="Reason (required, min 10 chars). e.g. Did not arrive, no contact for 2h."
            placeholderTextColor={C.textMuted}
            style={styles.noShowInput}
            multiline
            numberOfLines={3}
            autoFocus
          />
          <View style={{ gap: 10 }}>
            <Button
              label={noShowLoading ? 'Recording…' : 'Confirm No-Show'}
              onPress={handleNoShow}
              loading={noShowLoading}
              variant="danger"
              fullWidth
              size="lg"
              icon={<AlertCircle size={15} color={C.white} />}
            />
            <Button
              label="Cancel"
              onPress={() => { setNoShowFor(null); setNoShowReason(''); }}
              variant="ghost"
              fullWidth
            />
          </View>
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
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 8 },
  applicantsSection: { gap: 8, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  applicantBlock: { gap: 0 },
  applicantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  workerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  workerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  workerAvatarText: { fontSize: 14, fontWeight: '700' as const, color: C.accent },
  workerName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  appliedAt: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  applicantBtns: { flexDirection: 'row', gap: 8 },
  acceptBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.redDim, alignItems: 'center', justifyContent: 'center' },
  // Inline expanded worker card
  workerExpandCard: {
    backgroundColor: C.bgSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 8,
    marginBottom: 8,
  },
  expandRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillChip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.accentDim, borderRadius: 6 },
  skillText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  certChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.greenDim, borderRadius: 6 },
  certChipText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  expandMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  expandMetaText: { fontSize: 12, color: C.textSecondary },
  bioSnippet: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  viewFullProfile: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  // Assignments
  assignSection: { gap: 10, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  assignRow: { gap: 8 },
  assignWorkerInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  awaitingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.yellowDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  awaitingText: { fontSize: 12, color: C.yellow, fontWeight: '600' as const },
  // Time confirm
  timeConfirmBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border, gap: 8 },
  timeConfirmTitle: { fontSize: 12, color: C.accent, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  clockRecord: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clockText: { fontSize: 12, color: C.textSecondary },
  confirmBtns: { gap: 8 },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.yellowDim, borderRadius: 8, padding: 10 },
  warnText: { fontSize: 12, color: C.yellow, flex: 1 },
  confirmedBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmedText: { fontSize: 13, color: C.green, fontWeight: '600' as const },
  actionBtns: { gap: 10 },
  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rateBtnText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  noShowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.redDim, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.red + '40' },
  noShowBtnText: { fontSize: 12, color: C.red, fontWeight: '700' as const },
  otRegular: { fontSize: 12, color: C.textSecondary },
  bcNotice: { fontSize: 11, color: C.textMuted, fontStyle: 'italic' as const, paddingTop: 4 },
  noShowModalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  noShowModalSub: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  noShowInput: { backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, color: C.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top' as const },
});
