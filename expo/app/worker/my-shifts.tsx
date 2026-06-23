import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, TextInput, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin, Clock, DollarSign, CheckCircle, Star, AlertTriangle, LogIn, LogOut as LogOutIcon,
} from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';

import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';
import ReviewModal from '@/components/ReviewModal';
import { checkAtSite, SITE_RADIUS_METERS } from '@/lib/geo';

type ViewTab = 'Active' | 'Applications' | 'History' | 'Earnings';

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  confirmed_rate: number;
  status: string;
  created_at: string;
  worker_confirmed: boolean | null;
}

interface TimeEntryRow {
  id: string;
  assignment_id: string;
  start_timestamp: string | null;
  end_timestamp: string | null;
  employer_confirmed_hours: number | null;
  employer_notes: string | null;
}

interface AppRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
  rejection_reason?: string | null;
}

function fmtTime(t: string): string {
  try {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch { return t; }
}

function formatDate(date: string): string {
  try {
    const d = new Date(date + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
  } catch { return date; }
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toDateString() === new Date().toDateString();
}

function countdownText(date: string, startTime: string, now: number): string {
  try {
    const target = new Date(`${date}T${startTime}`).getTime();
    const diff = (target - now) / 1000;
    if (diff <= 0) return 'Starting now';
    if (diff < 3600) return `Starts in ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Starts in ${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
    if (diff < 172800) return `Tomorrow ${fmtTime(startTime)}`;
    return `${formatDate(date)} · ${fmtTime(startTime)}`;
  } catch { return startTime; }
}

function elapsedText(startTs: string, now: number): string {
  const diff = Math.max(0, now - new Date(startTs).getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export default function WorkerMyShifts() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const router = useRouter();

  const utils = trpc.useUtils();
  const [tab, setTab] = useState<ViewTab>('Active');
  const [reviewFor, setReviewFor] = useState<AssignmentRow | null>(null);
  const [disputeFor, setDisputeFor] = useState<AssignmentRow | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['myshifts-assignments', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['myshifts-apps', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['myshifts-timeentries', user?.id] }),
      utils.dock.bootstrap.invalidate(),
    ]);
  };

  const [gpsChecking, setGpsChecking] = useState<boolean>(false);
  const clockInM = trpc.shifts.clockIn.useMutation({
    onSuccess: async () => { await invalidate(); Alert.alert('Clocked in!', 'Shift started.'); },
    onError: (e: Error) => Alert.alert('Unable to clock in', e.message),
  });

  /** Verify the worker is at the worksite (GPS) before clocking in. */
  const clockInWithGps = async (assignmentId: string, address: string, city: string) => {
    if (gpsChecking || clockInM.isPending) return;
    setGpsChecking(true);
    try {
      const siteLabel = `${address}, ${city}`;
      const result = await checkAtSite(siteLabel);
      if (!result.withinRange && result.distanceMeters != null) {
        const meters = Math.round(result.distanceMeters);
        const away = meters > 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
        Alert.alert(
          'You are not at the worksite',
          `You appear to be about ${away} from ${siteLabel}. You must be within ${SITE_RADIUS_METERS} m of the site to clock in. Move closer and try again.`,
        );
        return;
      }
      clockInM.mutate({ assignmentId });
    } catch (e) {
      Alert.alert('Location check failed', e instanceof Error ? e.message : 'Could not verify your location.');
    } finally {
      setGpsChecking(false);
    }
  };
  const clockOutM = trpc.shifts.clockOut.useMutation({
    onSuccess: async () => { await invalidate(); Alert.alert('Shift ended', 'Awaiting employer to confirm your hours.'); },
    onError: (e: Error) => Alert.alert('Unable to clock out', e.message),
  });
  const withdrawM = trpc.shifts.withdraw.useMutation({
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Unable to withdraw', e.message),
  });

  // ── Direct Supabase queries ──────────────────────────────────────
  const assignmentsQ = useQuery({
    queryKey: ['myshifts-assignments', user?.id],
    queryFn: async (): Promise<AssignmentRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,worker_user_id,confirmed_rate,status,created_at,worker_confirmed')
        .eq('worker_user_id', user.id);
      return (data ?? []) as AssignmentRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const appsQ = useQuery({
    queryKey: ['myshifts-apps', user?.id],
    queryFn: async (): Promise<AppRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status,applied_at,rejection_reason')
        .eq('worker_user_id', user.id)
        .order('applied_at', { ascending: false });
      return (data ?? []) as AppRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const assignmentsData = assignmentsQ.data;
  const appsData = appsQ.data;
  const myAssignments = useMemo<AssignmentRow[]>(() => assignmentsData ?? [], [assignmentsData]);
  const myApps = useMemo<AppRow[]>(() => appsData ?? [], [appsData]);
  const assignmentIds = useMemo<string[]>(() => myAssignments.map((a) => a.id), [myAssignments]);

  const timeEntriesQ = useQuery({
    queryKey: ['myshifts-timeentries', user?.id, assignmentIds],
    queryFn: async (): Promise<TimeEntryRow[]> => {
      if (!user?.id || assignmentIds.length === 0) return [];
      const ids = assignmentIds;
      const { data } = await supabase
        .from('time_entries')
        .select('id,assignment_id,start_timestamp,end_timestamp,employer_confirmed_hours,employer_notes')
        .in('assignment_id', ids);
      return (data ?? []) as TimeEntryRow[];
    },
    enabled: Boolean(user?.id) && myAssignments.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const myTimeEntries = timeEntriesQ.data ?? [];

  const [refreshing, setRefreshing] = useState<boolean>(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        assignmentsQ.refetch(),
        appsQ.refetch(),
        timeEntriesQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // Fetch shift posts for all assignment shift IDs
  const allShiftIds = useMemo(
    () => [...new Set(myAssignments.map((a) => a.shift_id))],
    [myAssignments],
  );

  const shiftPostsQ = useQuery({
    queryKey: ['myshifts-shiftposts', allShiftIds],
    queryFn: async () => {
      if (allShiftIds.length === 0) return [];
      const { data } = await supabase
        .from('shift_posts')
        .select('id,title,employer_company_id,location_address,location_city,date,start_time,end_time,hourly_rate,flat_rate')
        .in('id', allShiftIds);
      return (data ?? []) as {
        id: string;
        title: string;
        employer_company_id: string;
        location_address: string;
        location_city: string;
        date: string;
        start_time: string;
        end_time: string;
        hourly_rate: number | null;
        flat_rate: number | null;
      }[];
    },
    enabled: allShiftIds.length > 0,
    staleTime: 60_000,
  });
  const shiftPostRows = shiftPostsQ.data ?? [];

  // Fetch companies for all employer_company_ids
  const allCompanyIds = useMemo(
    () => [...new Set(shiftPostRows.map((s) => s.employer_company_id).filter(Boolean))],
    [shiftPostRows],
  );
  const companiesQ = useQuery({
    queryKey: ['myshifts-companies', allCompanyIds],
    queryFn: async () => {
      if (allCompanyIds.length === 0) return [];
      const { data } = await supabase
        .from('companies')
        .select('id,name')
        .in('id', allCompanyIds);
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: allCompanyIds.length > 0,
    staleTime: 60_000,
  });
  const companyRows = companiesQ.data ?? [];

  // Review tracking
  const completedIds = useMemo(
    () => myAssignments.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).map((a) => a.id),
    [myAssignments],
  );
  const myReviewsQ = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'shift_assignment', contextIds: completedIds },
    { enabled: completedIds.length > 0 },
  );
  const reviewedIds = useMemo(
    () => new Set(((myReviewsQ.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [myReviewsQ.data],
  );

  const getShift = (shiftId: string) => shiftPostRows.find((s) => s.id === shiftId);
  const getTE = (assignmentId: string) => myTimeEntries.find((t) => t.assignment_id === assignmentId);
  const getEmpName = (companyId: string) => companyRows.find((c) => c.id === companyId)?.name ?? 'Employer';

  // Earnings tab data
  const confirmedEntries = useMemo(
    () => myTimeEntries.filter((te) => te.employer_confirmed_hours !== null),
    [myTimeEntries],
  );
  const pendingEntries = useMemo(
    () => myTimeEntries.filter((te) => te.end_timestamp !== null && te.employer_confirmed_hours === null),
    [myTimeEntries],
  );
  const earningsSummary = useMemo(() => {
    let totalHours = 0;
    let totalEarnings = 0;
    for (const te of confirmedEntries) {
      const ass = myAssignments.find((a) => a.id === te.assignment_id);
      if (!ass) continue;
      totalHours += te.employer_confirmed_hours ?? 0;
      totalEarnings += (te.employer_confirmed_hours ?? 0) * ass.confirmed_rate;
    }
    return { totalHours, totalEarnings, pendingCount: pendingEntries.length };
  }, [confirmedEntries, pendingEntries, myAssignments]);

  // Partitioned data
  const activeAssignments = useMemo(
    () => myAssignments.filter((a) => ['Scheduled', 'InProgress'].includes(a.status))
      .sort((a, b) => {
        const sa = getShift(a.shift_id);
        const sb = getShift(b.shift_id);
        return new Date((sa?.date ?? '') + 'T' + (sa?.start_time ?? '')).getTime() -
          new Date((sb?.date ?? '') + 'T' + (sb?.start_time ?? '')).getTime();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myAssignments, shiftPostRows],
  );

  const historyAssignments = useMemo(
    () => myAssignments
      .filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed', 'Cancelled', 'NoShow'].includes(a.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [myAssignments],
  );

  const handleDispute = async () => {
    if (!disputeFor || !user || !disputeReason.trim()) {
      Alert.alert('Enter a reason for the dispute');
      return;
    }
    setSubmittingDispute(true);
    try {
      const { error } = await supabase.from('disputes').insert({
        reference_type: 'shift_assignment',
        reference_id: disputeFor.id,
        description: disputeReason.trim(),
        opened_by_user_id: user.id,
        status: 'Open',
      });
      if (error) throw new Error(error.message);
      setDisputeFor(null);
      setDisputeReason('');
      Alert.alert('Dispute submitted', 'An admin will review your dispute.');
    } catch (err) {
      Alert.alert('Unable to submit dispute', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingDispute(false);
    }
  };

  const shouldShowDispute = (ass: AssignmentRow): boolean => {
    const te = getTE(ass.id);
    if (!te?.start_timestamp || !te?.end_timestamp || !te?.employer_confirmed_hours) return false;
    const clock = (new Date(te.end_timestamp).getTime() - new Date(te.start_timestamp).getTime()) / 3_600_000;
    return Math.abs(clock - te.employer_confirmed_hours) > 0.5;
  };

  const TABS: ViewTab[] = ['Active', 'Applications', 'History', 'Earnings'];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Shifts</Text>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />
        }
      >
        {/* ─── Active Tab ─── */}
        {tab === 'Active' && (
          activeAssignments.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No active shifts</Text>
              <Text style={styles.emptySub}>Accepted shifts appear here</Text>
            </View>
          ) : (
            activeAssignments.map((ass) => {
              const shift = getShift(ass.shift_id);
              const te = getTE(ass.id);
              const isInProgress = ass.status === 'InProgress';
              return (
                <Card key={ass.id} style={[styles.card, isInProgress && styles.cardActive]}>
                  {isInProgress ? (
                    <>
                      <View style={styles.activePill}>
                        <Text style={styles.activePillText}>⚡ IN PROGRESS</Text>
                      </View>
                      <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                      {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                      {te?.start_timestamp && (
                        <View style={styles.timerCard}>
                          <Clock size={16} color={C.accent} />
                          <Text style={styles.timerText}>{elapsedText(te.start_timestamp, now)}</Text>
                        </View>
                      )}
                      <Button
                        label="Clock Out"
                        onPress={() => clockOutM.mutate({ assignmentId: ass.id })}
                        loading={clockOutM.isPending}
                        fullWidth
                        size="lg"
                        variant="outline"
                        icon={<LogOutIcon size={16} color={C.accent} />}
                      />
                    </>
                  ) : (
                    <>
                      <View style={styles.cardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                          {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                        </View>
                        <StatusBadge status={ass.status} />
                      </View>
                      {shift && (
                        <>
                          <View style={styles.metaRow}>
                            <Clock size={12} color={C.textMuted} />
                            <Text style={styles.meta}>
                              {countdownText(shift.date, shift.start_time, now)}
                            </Text>
                          </View>
                          <View style={styles.metaRow}>
                            <MapPin size={12} color={C.textMuted} />
                            <Text style={styles.meta} numberOfLines={1}>
                              {shift.location_address}, {shift.location_city}
                            </Text>
                          </View>
                          <View style={styles.metaRow}>
                            <DollarSign size={12} color={C.textMuted} />
                            <Text style={styles.meta}>${ass.confirmed_rate}/hr</Text>
                          </View>
                        </>
                      )}
                      {ass.worker_confirmed === null && shift && (() => {
                        const shiftStart = new Date(`${shift.date}T${shift.start_time}`).getTime();
                        const hoursUntil = (shiftStart - Date.now()) / 3_600_000;
                        if (hoursUntil < 0 || hoursUntil > 48) return null;
                        return (
                          <TouchableOpacity
                            onPress={() => router.push({ pathname: '/worker/shift-confirm' as any, params: { assignmentId: ass.id } })}
                            style={styles.confirmBanner}
                          >
                            <AlertTriangle size={14} color={C.yellow} />
                            <Text style={styles.confirmBannerText}>Shift soon — please confirm attendance</Text>
                            <Text style={styles.confirmBannerAction}>Confirm →</Text>
                          </TouchableOpacity>
                        );
                      })()}
                      <Button
                        label={
                          ass.worker_confirmed !== true
                            ? 'Confirm attendance first'
                            : isToday(shift?.date ?? '') ? 'Clock In' : `Available ${formatDate(shift?.date ?? '')}`
                        }
                        onPress={() => {
                          if (ass.worker_confirmed !== true) {
                            router.push({ pathname: '/worker/shift-confirm' as any, params: { assignmentId: ass.id } });
                            return;
                          }
                          void clockInWithGps(ass.id, shift?.location_address ?? '', shift?.location_city ?? '');
                        }}
                        loading={clockInM.isPending || gpsChecking}
                        disabled={ass.worker_confirmed === true && !isToday(shift?.date ?? '')}
                        fullWidth
                        size="lg"
                        icon={<LogIn size={16} color={C.white} />}
                      />
                    </>
                  )}
                </Card>
              );
            })
          )
        )}

        {/* ─── Applications Tab ─── */}
        {tab === 'Applications' && (
          myApps.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No applications yet</Text>
            </View>
          ) : (
            myApps.map((app) => {
              const shift = getShift(app.shift_id);
              return (
                <Card key={app.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                      {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                      {shift && (
                        <View style={styles.metaRow}>
                          <Clock size={12} color={C.textMuted} />
                          <Text style={styles.meta}>
                            {formatDate(shift.date)} · {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                          </Text>
                        </View>
                      )}
                      {shift && (
                        <View style={styles.metaRow}>
                          <DollarSign size={12} color={C.textMuted} />
                          <Text style={styles.meta}>${shift.hourly_rate ?? shift.flat_rate}/hr</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {app.status === 'Applied' && (
                    <View style={styles.statusInfo}>
                      <View style={styles.pendingBadge}>
                        <Clock size={12} color={C.yellow} />
                        <Text style={styles.pendingText}>Pending review</Text>
                      </View>
                      <Text style={styles.timeAgo}>Applied {timeAgo(app.applied_at)}</Text>
                    </View>
                  )}
                  {app.status === 'Accepted' && (
                    <View style={[styles.statusInfo, styles.acceptedInfo]}>
                      <CheckCircle size={14} color={C.green} />
                      <View>
                        <Text style={styles.acceptedText}>Accepted!</Text>
                        <Text style={styles.acceptedSub}>Check the Active tab to clock in</Text>
                      </View>
                    </View>
                  )}
                  {app.status === 'Rejected' && (
                    <View style={[styles.statusInfo, styles.rejectedInfo]}>
                      <AlertTriangle size={16} color={C.red} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rejectedText}>Not selected</Text>
                        <Text style={styles.rejectedReason}>
                          {app.rejection_reason?.trim()
                            ? app.rejection_reason
                            : 'Not selected for this shift.'}
                        </Text>
                      </View>
                    </View>
                  )}
                  {app.status === 'Applied' && (
                    <Button
                      label="Withdraw Application"
                      onPress={() => Alert.alert('Withdraw?', 'Remove your application?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Withdraw', style: 'destructive', onPress: () => withdrawM.mutate({ applicationId: app.id }) },
                      ])}
                      variant="danger"
                      size="sm"
                    />
                  )}
                </Card>
              );
            })
          )
        )}

        {/* ─── Earnings Tab ─── */}
        {tab === 'Earnings' && (
          <>
            {/* Summary Card */}
            <Card style={styles.earningsSummaryCard}>
              <Text style={styles.earningsSummaryLabel}>TOTAL EARNINGS SUMMARY</Text>
              <View style={styles.earningsSummaryRow}>
                <View style={styles.earningsStat}>
                  <Text style={styles.earningsStatVal}>{earningsSummary.totalHours.toFixed(1)}</Text>
                  <Text style={styles.earningsStatLbl}>Confirmed Hours</Text>
                </View>
                <View style={[styles.earningsStat, styles.earningsStatMid]}>
                  <Text style={[styles.earningsStatVal, { color: C.green }]}>${earningsSummary.totalEarnings.toFixed(0)}</Text>
                  <Text style={styles.earningsStatLbl}>Est. Earnings</Text>
                </View>
                <View style={styles.earningsStat}>
                  <Text style={[styles.earningsStatVal, { color: earningsSummary.pendingCount > 0 ? C.yellow : C.textMuted }]}>
                    {earningsSummary.pendingCount}
                  </Text>
                  <Text style={styles.earningsStatLbl}>Pending</Text>
                </View>
              </View>
            </Card>

            {/* Payment Notice */}
            <Card style={styles.paymentNotice}>
              <Text style={styles.paymentNoticeText}>
                These are your employer-approved hours and the gross amount they represent at your shift rate.
                Payment itself is handled outside the app through your employer's payroll process.
              </Text>
            </Card>

            {confirmedEntries.length > 0 && (
              <Text style={styles.earningsSectionLabel}>CONFIRMED EARNINGS</Text>
            )}
            {confirmedEntries.map((te) => {
              const ass = myAssignments.find((a) => a.id === te.assignment_id);
              const shift = ass ? getShift(ass.shift_id) : null;
              const hours = te.employer_confirmed_hours ?? 0;
              const rate = ass?.confirmed_rate ?? 0;
              const amount = hours * rate;
              return (
                <Card key={te.id} style={[styles.card, { gap: 6 }]}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                      {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                      {shift && <Text style={styles.meta}>{formatDate(shift.date)}</Text>}
                    </View>
                    <View style={styles.earningsAmtBlock}>
                      <Text style={styles.earningsAmt}>${amount.toFixed(2)}</Text>
                      <View style={styles.earningsStatusBadge}>
                        <Text style={styles.earningsStatusText}>Hours approved</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.earningsHours}>{hours}h confirmed · ${rate}/hr</Text>
                </Card>
              );
            })}

            {pendingEntries.length > 0 && (
              <Text style={[styles.earningsSectionLabel, { marginTop: 8 }]}>AWAITING CONFIRMATION</Text>
            )}
            {pendingEntries.map((te) => {
              const ass = myAssignments.find((a) => a.id === te.assignment_id);
              const shift = ass ? getShift(ass.shift_id) : null;
              const clockH = te.start_timestamp && te.end_timestamp
                ? (new Date(te.end_timestamp).getTime() - new Date(te.start_timestamp).getTime()) / 3_600_000
                : null;
              const showDispute = clockH && te.employer_confirmed_hours !== null && Math.abs(clockH - (te.employer_confirmed_hours ?? 0)) > 0.5;
              return (
                <Card key={te.id} style={[styles.card, { gap: 6 }]}>
                  <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                  {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                  <Text style={styles.earningsPending}>
                    Clocked {clockH ? clockH.toFixed(1) : '?'}h — awaiting employer confirmation
                  </Text>
                  {showDispute && ass && (
                    <TouchableOpacity onPress={() => setDisputeFor(ass)} style={styles.disputeBtn}>
                      <AlertTriangle size={12} color={C.yellow} />
                      <Text style={styles.disputeBtnText}>Dispute</Text>
                    </TouchableOpacity>
                  )}
                </Card>
              );
            })}

            {confirmedEntries.length === 0 && pendingEntries.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No earnings yet</Text>
                <Text style={styles.emptySub}>Complete shifts to see earnings here</Text>
              </View>
            )}
          </>
        )}

        {/* ─── History Tab ─── */}
        {tab === 'History' && (
          historyAssignments.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No completed shifts yet</Text>
            </View>
          ) : (
            historyAssignments.map((ass) => {
              const shift = getShift(ass.shift_id);
              const te = getTE(ass.id);
              const confirmed = te?.employer_confirmed_hours;
              const earnings = confirmed ? (confirmed * ass.confirmed_rate).toFixed(0) : null;
              const showDispute = shouldShowDispute(ass);

              return (
                <Card key={ass.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shiftTitle}>{shift?.title ?? '—'}</Text>
                      {shift && (<TouchableOpacity onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: shift.employer_company_id } })}><Text style={[styles.employer, styles.employerLink]}>{getEmpName(shift.employer_company_id)}</Text></TouchableOpacity>)}
                      {shift && (
                        <Text style={styles.meta}>{formatDate(shift.date)}</Text>
                      )}
                    </View>
                    <StatusBadge status={ass.status} />
                  </View>
                  {confirmed != null && (
                    <View style={styles.hoursRow}>
                      <View style={styles.hoursStat}>
                        <Text style={styles.hoursVal}>{confirmed}h</Text>
                        <Text style={styles.hoursLbl}>Confirmed</Text>
                      </View>
                      {earnings && (
                        <View style={styles.hoursStat}>
                          <Text style={[styles.hoursVal, { color: C.green }]}>${earnings}</Text>
                          <Text style={styles.hoursLbl}>Earned</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {showDispute && (
                    <TouchableOpacity
                      onPress={() => setDisputeFor(ass)}
                      style={styles.disputeBtn}
                    >
                      <AlertTriangle size={13} color={C.yellow} />
                      <Text style={styles.disputeBtnText}>Dispute Hours</Text>
                    </TouchableOpacity>
                  )}
                  {['Completed', 'HoursConfirmed', 'Confirmed'].includes(ass.status) &&
                    !reviewedIds.has(ass.id) &&
                    shift && (
                      <Button
                        label="Rate Employer"
                        onPress={() => setReviewFor(ass)}
                        variant="outline"
                        size="sm"
                        fullWidth
                        icon={<Star size={13} color={C.accent} />}
                      />
                    )}
                  {reviewedIds.has(ass.id) && (
                    <View style={styles.ratedRow}>
                      <Star size={13} color={C.yellow} fill={C.yellow} />
                      <Text style={styles.ratedText}>Employer rated</Text>
                    </View>
                  )}
                </Card>
              );
            })
          )
        )}
      </ScrollView>

      {/* Dispute Modal */}
      <Modal visible={!!disputeFor} animationType="slide" presentationStyle="formSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Dispute Hours</Text>
            <Text style={styles.modalSub}>
              Describe why you believe the confirmed hours are incorrect.
            </Text>
            <TextInput
              value={disputeReason}
              onChangeText={setDisputeReason}
              placeholder="e.g. I worked 8h but employer confirmed 6h..."
              placeholderTextColor={C.textMuted}
              style={styles.disputeInput}
              multiline
              numberOfLines={4}
            />
            <Button
              label={submittingDispute ? 'Submitting…' : 'Submit Dispute'}
              onPress={handleDispute}
              loading={submittingDispute}
              fullWidth
              size="lg"
              icon={<AlertTriangle size={15} color={C.white} />}
            />
            <Button
              label="Cancel"
              onPress={() => { setDisputeFor(null); setDisputeReason(''); }}
              variant="ghost"
              fullWidth
            />
          </View>
        </View>
      </Modal>

      {/* Review Modal */}
      <ReviewModal
        visible={!!reviewFor}
        onClose={() => setReviewFor(null)}
        title="Rate this employer"
        subtitle={reviewFor ? getEmpName(getShift(reviewFor.shift_id)?.employer_company_id ?? '') : undefined}
        contextKind="shift_assignment"
        contextId={reviewFor?.id ?? ''}
        targetKind="company"
        targetCompanyId={reviewFor ? getShift(reviewFor.shift_id)?.employer_company_id ?? null : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 0,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 12 },
  tabs: { flexDirection: 'row' },
  tab: { paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.accent },
  tabText: { fontSize: 13, color: C.textMuted, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  list: { padding: 16, gap: 12 },
  card: { gap: 10 },
  cardActive: { borderColor: C.accent + '50', backgroundColor: C.accent + '08' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  activePill: {
    alignSelf: 'flex-start',
    backgroundColor: C.accent + '30',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activePillText: { fontSize: 10, fontWeight: '800' as const, color: C.accent, letterSpacing: 1.5 },
  timerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.bgSecondary,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  timerText: { fontSize: 22, fontWeight: '800' as const, color: C.accent, fontVariant: ['tabular-nums'] as const },
  shiftTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  employerLink: { textDecorationLine: 'underline' as const },
  employer: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 12, color: C.textSecondary, flex: 1 },
  statusInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingText: { fontSize: 13, color: C.yellow, fontWeight: '600' as const },
  timeAgo: { fontSize: 12, color: C.textMuted },
  acceptedInfo: { backgroundColor: C.greenDim, borderRadius: 8, padding: 10 },
  acceptedText: { fontSize: 13, color: C.green, fontWeight: '700' as const },
  acceptedSub: { fontSize: 12, color: C.green + 'BB' },
  rejectedInfo: { backgroundColor: C.redDim, borderRadius: 8, padding: 10 },
  rejectedText: { fontSize: 14, color: C.red, fontWeight: '800' as const },
  rejectedReason: { fontSize: 13, color: C.red, marginTop: 4, lineHeight: 18 },
  hoursRow: { flexDirection: 'row', gap: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  hoursStat: { gap: 2 },
  hoursVal: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  hoursLbl: { fontSize: 11, color: C.textMuted },
  disputeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: C.yellowDim,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.yellow + '40',
  },
  disputeBtnText: { fontSize: 13, color: C.yellow, fontWeight: '600' as const },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratedText: { fontSize: 12, color: C.yellow },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 6 },
  emptyText: { fontSize: 15, color: C.textSecondary, fontWeight: '600' as const },
  emptySub: { fontSize: 13, color: C.textMuted },
  // Confirmation banner
  confirmBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.yellowDim, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.yellow + '40' },
  confirmBannerText: { flex: 1, fontSize: 13, color: C.yellow, fontWeight: '600' as const },
  confirmBannerAction: { fontSize: 13, color: C.yellow, fontWeight: '700' as const },
  // Earnings tab
  earningsSummaryCard: { marginBottom: 0 },
  earningsSummaryLabel: { fontSize: 10, fontWeight: '700' as const, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 12 },
  earningsSummaryRow: { flexDirection: 'row' },
  earningsStat: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 4 },
  earningsStatMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  earningsStatVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  earningsStatLbl: { fontSize: 11, color: C.textSecondary, textAlign: 'center' as const },
  paymentNotice: { backgroundColor: C.bgSecondary },
  paymentNoticeText: { fontSize: 12, color: C.textMuted, lineHeight: 18 },
  earningsSectionLabel: { fontSize: 10, fontWeight: '700' as const, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8, marginTop: 4 },
  earningsAmtBlock: { alignItems: 'flex-end', gap: 4 },
  earningsAmt: { fontSize: 16, fontWeight: '800' as const, color: C.green },
  earningsStatusBadge: { backgroundColor: C.yellowDim, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  earningsStatusText: { fontSize: 10, color: C.yellow, fontWeight: '700' as const },
  earningsHours: { fontSize: 12, color: C.textMuted },
  earningsPending: { fontSize: 13, color: C.yellow },
  // Modal
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  modalSub: { fontSize: 14, color: C.textSecondary },
  disputeInput: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    color: C.text,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top' as const,
  },
});
