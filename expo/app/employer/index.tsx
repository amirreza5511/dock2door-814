import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CalendarDays, Users, Clock, CheckCircle, LogOut, Bell,
  ChevronRight, AlertCircle, Plus, Star, Building2, XCircle, UserCircle2, DollarSign, Sparkles, MessageCircle, BookOpen,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';
import WorldSwitcher from '@/components/WorldSwitcher';
import SupportMenu from '@/components/SupportMenu';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmpAssRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  confirmed_rate: number;
  status: string;
  worker_confirmed: boolean | null;
  created_at: string;
}

interface EmpAppRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
}

interface EmpTERow {
  id: string;
  assignment_id: string;
  start_timestamp: string | null;
  end_timestamp: string | null;
  employer_confirmed_hours: number | null;
}

type BannerType = 'error' | 'warning' | 'info' | 'success';

interface PriorityAction {
  type: BannerType;
  title: string;
  body: string;
  action: string;
  route: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toDateString() === new Date().toDateString();
}

function isTomorrow(dateStr: string): boolean {
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  const d = new Date(dateStr + 'T00:00:00');
  return d.toDateString() === tmr.toDateString();
}

function fmtTime(t: string): string {
  try {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch { return t; }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EmployerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const utils = trpc.useUtils();

  const bootstrapQuery = useDockBootstrapData();
  const { shiftPosts, companies, workerProfiles } = bootstrapQuery.data;

  const myShifts = useMemo(
    () => shiftPosts
      .filter((s) => s.employerCompanyId === user?.companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [shiftPosts, user],
  );
  const myShiftIds = useMemo(() => myShifts.map((s) => s.id), [myShifts]);
  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);

  // ── Assignments ──────────────────────────────────────────────────────────
  const assignsQ = useQuery({
    queryKey: ['emp-dash-assigns', user?.companyId],
    queryFn: async (): Promise<EmpAssRow[]> => {
      if (myShiftIds.length === 0) return [];
      const { data } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,worker_user_id,confirmed_rate,status,worker_confirmed,created_at')
        .in('shift_id', myShiftIds);
      return (data ?? []) as EmpAssRow[];
    },
    enabled: myShiftIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const allAssignments = assignsQ.data ?? [];

  // ── Applications ─────────────────────────────────────────────────────────
  const appsQ = useQuery({
    queryKey: ['emp-dash-apps', user?.companyId],
    queryFn: async (): Promise<EmpAppRow[]> => {
      if (myShiftIds.length === 0) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status,applied_at')
        .in('shift_id', myShiftIds)
        .eq('status', 'Applied');
      return (data ?? []) as EmpAppRow[];
    },
    enabled: myShiftIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const allApps = appsQ.data ?? [];

  // ── Time entries ─────────────────────────────────────────────────────────
  const teQ = useQuery({
    queryKey: ['emp-dash-te', user?.companyId, allAssignments.map((a) => a.id).join(',')],
    queryFn: async (): Promise<EmpTERow[]> => {
      const ids = allAssignments.map((a) => a.id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from('time_entries')
        .select('id,assignment_id,start_timestamp,end_timestamp,employer_confirmed_hours')
        .in('assignment_id', ids);
      return (data ?? []) as EmpTERow[];
    },
    enabled: allAssignments.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const allTEs = teQ.data ?? [];

  // ── Notifications count ───────────────────────────────────────────────────
  const notifCountQ = useQuery({
    queryKey: ['notif-unread-count', user?.id],
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0;
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null);
      return count ?? 0;
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const unreadCount = notifCountQ.data ?? 0;

  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        bootstrapQuery.refetch(),
        assignsQ.refetch(),
        appsQ.refetch(),
        teQ.refetch(),
        notifCountQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Review tracking ───────────────────────────────────────────────────────
  const reviewableIds = useMemo(
    () => allAssignments.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).map((a) => a.id),
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
  const ratingPending = reviewableIds.some((id) => !reviewedIds.has(id));

  // ── Computed operational metrics ─────────────────────────────────────────

  // Hours waiting for confirmation
  const hoursToConfirm = useMemo(
    () => allTEs.filter((t) => t.end_timestamp && !t.employer_confirmed_hours),
    [allTEs],
  );

  // Workers currently clocked in
  const clockedIn = useMemo(
    () => allTEs.filter((t) => t.start_timestamp && !t.end_timestamp),
    [allTEs],
  );

  // Today's shifts
  const todayShifts = useMemo(
    () => myShifts.filter((s) => isToday(s.date) && ['Posted', 'Filled', 'InProgress'].includes(s.status)),
    [myShifts],
  );

  // Upcoming (tomorrow) shifts
  const tomorrowShifts = useMemo(
    () => myShifts.filter((s) => isTomorrow(s.date) && ['Posted', 'Filled'].includes(s.status)),
    [myShifts],
  );

  // Unconfirmed workers on upcoming shifts (within 48h)
  const unconfirmedWorkers = useMemo(() => {
    return allAssignments.filter((a) => {
      if (a.status !== 'Scheduled') return false;
      if (a.worker_confirmed === true) return false;
      const shift = myShifts.find((s) => s.id === a.shift_id);
      if (!shift) return false;
      const shiftStart = new Date(`${shift.date}T${shift.startTime}`).getTime();
      const hoursUntil = (shiftStart - Date.now()) / 3_600_000;
      return hoursUntil >= 0 && hoursUntil <= 48;
    });
  }, [allAssignments, myShifts]);

  // Past scheduled assignments that need no-show marking
  const noShowCandidates = useMemo(() => {
    return allAssignments.filter((a) => {
      if (a.status !== 'Scheduled') return false;
      const shift = myShifts.find((s) => s.id === a.shift_id);
      if (!shift) return false;
      const shiftEnd = new Date(`${shift.date}T${shift.endTime}`).getTime();
      return shiftEnd < Date.now();
    });
  }, [allAssignments, myShifts]);

  const getWorkerName = (userId: string) => {
    const wp = workerProfiles.find((w) => w.userId === userId);
    return wp?.displayName ?? userId.slice(0, 8);
  };

  const getShift = (shiftId: string) => myShifts.find((s) => s.id === shiftId);

  // ── Priority action banner ────────────────────────────────────────────────
  const priorityAction = useMemo((): PriorityAction | null => {
    // 1. No company
    if (!company) {
      return {
        type: 'error',
        title: 'Set up your company profile',
        body: 'Create a company before posting shifts.',
        action: 'Set Up Company',
        route: '/onboarding/company-setup',
      };
    }

    // 2. Company suspended
    if (company.status === 'Suspended') {
      return {
        type: 'error',
        title: 'Company suspended',
        body: 'Contact support to resolve your account status.',
        action: 'View Status',
        route: '/employer/company-profile',
      };
    }

    // 3. Company pending approval
    if (company.status === 'PendingApproval') {
      return {
        type: 'warning',
        title: 'Company waiting for approval',
        body: 'You can post shifts. They will go live once your company is approved.',
        action: 'View Status',
        route: '/employer/company-profile',
      };
    }

    // 4. Hours to confirm (workers clocked out and waiting)
    if (hoursToConfirm.length > 0) {
      const first = hoursToConfirm[0];
      const ass = allAssignments.find((a) => a.id === first.assignment_id);
      const workerName = ass ? getWorkerName(ass.worker_user_id) : 'A worker';
      return {
        type: 'warning',
        title: `Confirm hours for ${workerName}${hoursToConfirm.length > 1 ? ` +${hoursToConfirm.length - 1} more` : ''}`,
        body: 'Workers have clocked out and are waiting for your confirmation.',
        action: 'Confirm Hours',
        route: '/employer/shifts',
      };
    }

    // 5. Pending applicants
    if (allApps.length > 0) {
      return {
        type: 'info',
        title: `${allApps.length} worker${allApps.length > 1 ? 's' : ''} applied`,
        body: 'Review applicants and decide who to accept.',
        action: 'Review Now',
        route: '/employer/shifts',
      };
    }

    // 6. Unconfirmed workers on upcoming shifts
    if (unconfirmedWorkers.length > 0) {
      return {
        type: 'info',
        title: `${unconfirmedWorkers.length} worker${unconfirmedWorkers.length > 1 ? 's' : ''} haven't confirmed`,
        body: 'Check attendance for upcoming shifts.',
        action: 'View Shifts',
        route: '/employer/shifts',
      };
    }

    // 7. No-show candidates
    if (noShowCandidates.length > 0) {
      return {
        type: 'warning',
        title: 'Past shift needs review',
        body: `${noShowCandidates.length} worker${noShowCandidates.length > 1 ? 's' : ''} may need to be marked no-show.`,
        action: 'Review',
        route: '/employer/shifts',
      };
    }

    // 8. Rating pending
    if (ratingPending) {
      return {
        type: 'info',
        title: 'Rate your workers',
        body: 'You have completed shifts. Rate the workers.',
        action: 'Rate Now',
        route: '/employer/shifts',
      };
    }

    return null;
  }, [company, hoursToConfirm, allApps, unconfirmedWorkers, noShowCandidates, ratingPending, allAssignments]);

  const BANNER_COLORS: Record<BannerType, { bg: string; border: string; text: string; btnBg: string }> = {
    error:   { bg: C.redDim,    border: C.red    + '50', text: C.red,    btnBg: C.red    + '25' },
    warning: { bg: C.yellowDim, border: C.yellow + '50', text: C.yellow, btnBg: C.yellow + '25' },
    info:    { bg: C.blueDim,   border: C.blue   + '50', text: C.blue,   btnBg: C.blue   + '25' },
    success: { bg: C.greenDim,  border: C.green  + '50', text: C.green,  btnBg: C.green  + '25' },
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    activeShifts: myShifts.filter((s) => ['Posted', 'InProgress', 'Filled'].includes(s.status)).length,
    pendingApplicants: allApps.length,
    clockedInNow: clockedIn.length,
    hoursToConfirmCount: hoursToConfirm.length,
  }), [myShifts, allApps, clockedIn, hoursToConfirm]);

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Employer Portal</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {company && (
            <View style={styles.companyRow}>
              <Building2 size={12} color={company.status === 'Approved' ? C.accent : C.yellow} />
              <Text style={[styles.company, { color: company.status === 'Approved' ? C.accent : C.yellow }]}>
                {company.name}
                {company.status !== 'Approved' ? ` · ${company.status}` : ''}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <WorldSwitcher />
          <SupportMenu />
          <TouchableOpacity onPress={() => router.push('/notifications' as any)} style={styles.iconBtn}>
            <Bell size={18} color={C.text} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/employer/account' as any)} style={styles.iconBtn}>
            <UserCircle2 size={18} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={styles.iconBtn}>
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />
        }
      >
        {/* ── Priority Action Banner ── */}
        {priorityAction && (() => {
          const colors = BANNER_COLORS[priorityAction.type];
          return (
            <TouchableOpacity
              onPress={() => router.push(priorityAction.route as any)}
              style={[styles.priorityBanner, { backgroundColor: colors.bg, borderColor: colors.border }]}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.priorityTitle, { color: colors.text }]}>{priorityAction.title}</Text>
                <Text style={[styles.priorityBody, { color: colors.text + 'CC' }]}>{priorityAction.body}</Text>
              </View>
              <View style={[styles.priorityBtn, { backgroundColor: colors.btnBg }]}>
                <Text style={[styles.priorityBtnText, { color: colors.text }]}>{priorityAction.action} →</Text>
              </View>
            </TouchableOpacity>
          );
        })()}

        {/* ── Today's Staffing Overview ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LIVE STATUS</Text>
          <View style={styles.statsGrid}>
            <TouchableOpacity
              style={[styles.statCard, stats.activeShifts > 0 && styles.statCardActive]}
              onPress={() => router.push('/employer/shifts' as any)}
            >
              <View style={[styles.statIcon, { backgroundColor: C.blue + '20' }]}>
                <CalendarDays size={16} color={C.blue} />
              </View>
              <Text style={styles.statValue}>{stats.activeShifts}</Text>
              <Text style={styles.statLabel}>Active{'\n'}Shifts</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statCard, stats.pendingApplicants > 0 && styles.statCardWarning]}
              onPress={() => router.push('/employer/shifts' as any)}
            >
              <View style={[styles.statIcon, { backgroundColor: stats.pendingApplicants > 0 ? C.yellow + '25' : C.card }]}>
                <Users size={16} color={stats.pendingApplicants > 0 ? C.yellow : C.textMuted} />
              </View>
              <Text style={[styles.statValue, stats.pendingApplicants > 0 && { color: C.yellow }]}>
                {stats.pendingApplicants}
              </Text>
              <Text style={styles.statLabel}>New{'\n'}Applicants</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statCard, stats.clockedInNow > 0 && { borderColor: C.accent + '50', backgroundColor: C.accent + '08' }]}
              onPress={() => router.push('/employer/shifts' as any)}
            >
              <View style={[styles.statIcon, { backgroundColor: stats.clockedInNow > 0 ? C.accent + '20' : C.card }]}>
                <CheckCircle size={16} color={stats.clockedInNow > 0 ? C.accent : C.textMuted} />
              </View>
              <Text style={[styles.statValue, stats.clockedInNow > 0 && { color: C.accent }]}>
                {stats.clockedInNow}
              </Text>
              <Text style={styles.statLabel}>Clocked{'\n'}In Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statCard, stats.hoursToConfirmCount > 0 && styles.statCardWarning]}
              onPress={() => router.push('/employer/shifts' as any)}
            >
              <View style={[styles.statIcon, { backgroundColor: stats.hoursToConfirmCount > 0 ? C.yellow + '25' : C.card }]}>
                <Clock size={16} color={stats.hoursToConfirmCount > 0 ? C.yellow : C.textMuted} />
              </View>
              <Text style={[styles.statValue, stats.hoursToConfirmCount > 0 && { color: C.yellow }]}>
                {stats.hoursToConfirmCount}
              </Text>
              <Text style={styles.statLabel}>Confirm{'\n'}Hours</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Hours to Confirm ── */}
        {hoursToConfirm.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>HOURS AWAITING CONFIRMATION</Text>
              <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)}>
                <Text style={styles.seeAll}>Confirm All →</Text>
              </TouchableOpacity>
            </View>
            {hoursToConfirm.slice(0, 3).map((te) => {
              const ass = allAssignments.find((a) => a.id === te.assignment_id);
              const shift = ass ? getShift(ass.shift_id) : null;
              const clockH = te.start_timestamp && te.end_timestamp
                ? ((new Date(te.end_timestamp).getTime() - new Date(te.start_timestamp).getTime()) / 3_600_000).toFixed(1)
                : null;
              return (
                <TouchableOpacity
                  key={te.id}
                  onPress={() => router.push('/employer/shifts' as any)}
                  style={styles.hoursCard}
                >
                  <View style={styles.hoursAvatar}>
                    <Text style={styles.hoursAvatarText}>
                      {ass ? getWorkerName(ass.worker_user_id).charAt(0) : '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hoursWorker}>{ass ? getWorkerName(ass.worker_user_id) : '—'}</Text>
                    {shift && (
                      <Text style={styles.hourcShift}>{shift.title} · {shift.date}</Text>
                    )}
                  </View>
                  {clockH && (
                    <View style={styles.hoursBadge}>
                      <Text style={styles.hoursBadgeText}>{clockH}h clocked</Text>
                    </View>
                  )}
                  <ChevronRight size={14} color={C.textMuted} />
                </TouchableOpacity>
              );
            })}
            {hoursToConfirm.length > 3 && (
              <Text style={styles.moreText}>+{hoursToConfirm.length - 3} more workers waiting</Text>
            )}
            <Text style={styles.payrollNote}>
              Confirming hours records approved time. Payment follows your payroll schedule.
            </Text>
          </View>
        )}

        {/* ── Today's Shifts ── */}
        {(todayShifts.length > 0 || tomorrowShifts.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>
                {todayShifts.length > 0 ? "TODAY'S SHIFTS" : "TOMORROW'S SHIFTS"}
              </Text>
              <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)}>
                <Text style={styles.seeAll}>All Shifts →</Text>
              </TouchableOpacity>
            </View>
            {(todayShifts.length > 0 ? todayShifts : tomorrowShifts).slice(0, 3).map((s) => {
              const shiftAssignments = allAssignments.filter((a) => a.shift_id === s.id && a.status === 'Scheduled');
              const confirmed = shiftAssignments.filter((a) => a.worker_confirmed === true).length;
              const notConfirmed = shiftAssignments.filter((a) => a.worker_confirmed !== true).length;
              const pendingApps = allApps.filter((a) => a.shift_id === s.id).length;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => router.push('/employer/shifts' as any)}
                  style={styles.todayShiftCard}
                  activeOpacity={0.8}
                >
                  <View style={styles.todayShiftTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.todayShiftTitle}>{s.title}</Text>
                      <Text style={styles.todayShiftTime}>{fmtTime(s.startTime)} – {fmtTime(s.endTime)} · {s.locationCity}</Text>
                    </View>
                    <StatusBadge status={s.status} />
                  </View>
                  <View style={styles.todayShiftMeta}>
                    {shiftAssignments.length > 0 && (
                      <>
                        {confirmed > 0 && (
                          <View style={styles.metaChip}>
                            <CheckCircle size={11} color={C.green} />
                            <Text style={[styles.metaChipText, { color: C.green }]}>{confirmed} confirmed</Text>
                          </View>
                        )}
                        {notConfirmed > 0 && (
                          <View style={[styles.metaChip, { backgroundColor: C.yellowDim, borderColor: C.yellow + '40' }]}>
                            <Clock size={11} color={C.yellow} />
                            <Text style={[styles.metaChipText, { color: C.yellow }]}>{notConfirmed} unconfirmed</Text>
                          </View>
                        )}
                      </>
                    )}
                    {pendingApps > 0 && (
                      <View style={[styles.metaChip, { backgroundColor: C.blueDim, borderColor: C.blue + '40' }]}>
                        <Users size={11} color={C.blue} />
                        <Text style={[styles.metaChipText, { color: C.blue }]}>{pendingApps} applicants</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Unconfirmed Workers ── */}
        {unconfirmedWorkers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>WORKERS HAVEN'T CONFIRMED</Text>
            <View style={styles.unconfirmedCard}>
              <AlertCircle size={14} color={C.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={styles.unconfirmedTitle}>
                  {unconfirmedWorkers.length} worker{unconfirmedWorkers.length > 1 ? 's' : ''} haven't confirmed attendance
                </Text>
                <Text style={styles.unconfirmedSub}>
                  {unconfirmedWorkers.slice(0, 3).map((a) => getWorkerName(a.worker_user_id)).join(', ')}
                  {unconfirmedWorkers.length > 3 ? ` +${unconfirmedWorkers.length - 3} more` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)} style={styles.unconfirmedBtn}>
                <Text style={styles.unconfirmedBtnText}>View →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── No-Show Candidates ── */}
        {noShowCandidates.length > 0 && (
          <View style={styles.section}>
            <View style={[styles.unconfirmedCard, { backgroundColor: C.redDim, borderColor: C.red + '40' }]}>
              <XCircle size={14} color={C.red} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.unconfirmedTitle, { color: C.red }]}>
                  {noShowCandidates.length} past shift{noShowCandidates.length > 1 ? 's' : ''} need review
                </Text>
                <Text style={[styles.unconfirmedSub, { color: C.red + 'BB' }]}>
                  Workers scheduled but shift has ended — mark as no-show if needed
                </Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)} style={[styles.unconfirmedBtn, { backgroundColor: C.red + '20' }]}>
                <Text style={[styles.unconfirmedBtnText, { color: C.red }]}>Review →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Recent Shifts ── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>RECENT SHIFTS</Text>
            <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)}>
              <Text style={styles.seeAll}>See All →</Text>
            </TouchableOpacity>
          </View>
          {myShifts.length === 0 ? (
            <View style={styles.emptyCard}>
              <CalendarDays size={32} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No shifts posted yet</Text>
              <Text style={styles.emptySub}>Post your first shift to start hiring workers</Text>
            </View>
          ) : (
            myShifts.slice(0, 4).map((s) => {
              const apps = allApps.filter((a) => a.shift_id === s.id).length;
              const assigned = allAssignments.filter((a) => a.shift_id === s.id && a.status === 'Scheduled').length;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => router.push('/employer/shifts' as any)}
                  activeOpacity={0.85}
                >
                  <Card style={styles.shiftCard}>
                    <View style={styles.shiftTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shiftTitle}>{s.title}</Text>
                        <Text style={styles.shiftMeta}>
                          {isToday(s.date) ? 'Today' : isTomorrow(s.date) ? 'Tomorrow' : s.date}
                          {' · '}{s.locationCity}
                        </Text>
                      </View>
                      <StatusBadge status={s.status} />
                    </View>
                    <View style={styles.shiftBottom}>
                      <Text style={styles.shiftRate}>${s.hourlyRate}/hr · {s.workersNeeded} needed</Text>
                      <View style={styles.shiftBadges}>
                        {apps > 0 && (
                          <View style={styles.appsBadge}>
                            <Users size={11} color={C.yellow} />
                            <Text style={styles.appsBadgeText}>{apps}</Text>
                          </View>
                        )}
                        {assigned > 0 && (
                          <View style={styles.assignBadge}>
                            <CheckCircle size={11} color={C.green} />
                            <Text style={styles.assignBadgeText}>{assigned}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Rating pending ── */}
        {ratingPending && (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => router.push('/employer/shifts' as any)}
              style={styles.ratingPrompt}
            >
              <Star size={16} color={C.yellow} fill={C.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={styles.ratingPromptTitle}>Rate your workers</Text>
                <Text style={styles.ratingPromptSub}>You have completed shifts waiting for ratings</Text>
              </View>
              <ChevronRight size={16} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
          <TouchableOpacity
            onPress={() => router.push('/employer/create-shift' as any)}
            style={styles.postShiftBtn}
          >
            <Plus size={20} color={C.white} />
            <Text style={styles.postShiftText}>Post a New Shift</Text>
          </TouchableOpacity>
          <View style={styles.navList}>
            {[
              { label: 'My Shifts', icon: CalendarDays, color: C.blue, path: '/employer/shifts' },
              { label: stats.pendingApplicants > 0 ? `Review Applicants (${stats.pendingApplicants})` : 'Review Applicants', icon: Users, color: stats.pendingApplicants > 0 ? C.yellow : C.textMuted, path: '/employer/shifts', badge: stats.pendingApplicants > 0 ? stats.pendingApplicants : undefined },
              { label: stats.hoursToConfirmCount > 0 ? `Confirm Hours (${stats.hoursToConfirmCount})` : 'Confirm Hours', icon: Clock, color: stats.hoursToConfirmCount > 0 ? C.yellow : C.textMuted, path: '/employer/shifts', badge: stats.hoursToConfirmCount > 0 ? stats.hoursToConfirmCount : undefined },
              { label: 'My Account', icon: UserCircle2, color: C.blue, path: '/employer/account' },
              { label: 'Labor Rates & Categories', icon: DollarSign, color: C.green, path: '/employer/rates' },
              { label: 'Company Profile', icon: Building2, color: C.accent, path: '/employer/company-profile' },
              { label: 'Billing & Invoices', icon: DollarSign, color: C.green, path: '/employer/billing' },
              { label: 'Invoicing & Accounting', icon: BookOpen, color: C.blue, path: '/employer/invoicing' },
              { label: 'AI Copilot', icon: Sparkles, color: C.accent, path: '/copilot' },
              { label: 'Help Center & Manual', icon: BookOpen, color: C.green, path: '/help' },
              { label: 'Reviews', icon: Star, color: C.yellow, path: '/reviews' },
              { label: 'Messages', icon: MessageCircle, color: C.blue, path: '/messages' },
              { label: 'Notifications', icon: Bell, color: unreadCount > 0 ? C.red : C.textMuted, path: '/notifications', badge: unreadCount > 0 ? unreadCount : undefined },
            ].map(({ label, icon: Icon, color, path, badge }) => (
              <TouchableOpacity key={label} onPress={() => router.push(path as any)} style={styles.navItem}>
                <View style={[styles.navIcon, { backgroundColor: color + '20' }]}>
                  <Icon size={18} color={color} />
                </View>
                <Text style={styles.navLabel}>{label}</Text>
                {badge != null ? (
                  <View style={styles.navBadge}>
                    <Text style={styles.navBadgeText}>{badge}</Text>
                  </View>
                ) : (
                  <ChevronRight size={16} color={C.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bgSecondary,
  },
  greeting: { fontSize: 12, color: C.textSecondary, marginBottom: 2 },
  name: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  company: { fontSize: 12, fontWeight: '600' as const },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: C.red,
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: { fontSize: 10, fontWeight: '800' as const, color: C.white },

  scroll: { padding: 16 },

  // Priority banner
  priorityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  priorityTitle: { fontSize: 15, fontWeight: '800' as const, marginBottom: 2 },
  priorityBody: { fontSize: 12, lineHeight: 18 },
  priorityBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  priorityBtnText: { fontSize: 12, fontWeight: '700' as const },

  // Section
  section: { marginBottom: 20 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700' as const, color: C.textMuted,
    letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10,
  },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },

  // Stats grid
  statsGrid: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 4,
    alignItems: 'center',
  },
  statCardActive: { borderColor: C.blue + '50', backgroundColor: C.blueDim },
  statCardWarning: { borderColor: C.yellow + '50', backgroundColor: C.yellowDim },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 14 },

  // Hours to confirm
  hoursCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 8,
  },
  hoursAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.yellowDim, alignItems: 'center', justifyContent: 'center' },
  hoursAvatarText: { fontSize: 14, fontWeight: '700' as const, color: C.yellow },
  hoursWorker: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  hourcShift: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  hoursBadge: { backgroundColor: C.yellowDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.yellow + '40' },
  hoursBadgeText: { fontSize: 12, color: C.yellow, fontWeight: '600' as const },
  moreText: { fontSize: 12, color: C.textMuted, textAlign: 'center' as const, marginTop: 4 },
  payrollNote: { fontSize: 11, color: C.textMuted, textAlign: 'center' as const, marginTop: 10, lineHeight: 16 },

  // Today's shifts
  todayShiftCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  todayShiftTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  todayShiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  todayShiftTime: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  todayShiftMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.greenDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.green + '40',
  },
  metaChipText: { fontSize: 11, color: C.green, fontWeight: '600' as const },

  // Unconfirmed workers
  unconfirmedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.yellowDim,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.yellow + '40',
    padding: 14,
  },
  unconfirmedTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  unconfirmedSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  unconfirmedBtn: { backgroundColor: C.yellow + '25', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  unconfirmedBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.yellow },

  // Recent shifts
  emptyCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const },
  shiftCard: { marginBottom: 8 },
  shiftTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  shiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  shiftBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  shiftRate: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  shiftBadges: { flexDirection: 'row', gap: 6 },
  appsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.yellowDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  appsBadgeText: { fontSize: 11, color: C.yellow, fontWeight: '700' as const },
  assignBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  assignBadgeText: { fontSize: 11, color: C.green, fontWeight: '700' as const },

  // Rating prompt
  ratingPrompt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.yellowDim, borderRadius: 14, borderWidth: 1, borderColor: C.yellow + '40', padding: 14, marginTop: -10 },
  ratingPromptTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  ratingPromptSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  // Quick actions
  postShiftBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.accent, borderRadius: 14, padding: 16, marginBottom: 10 },
  postShiftText: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  navList: { gap: 8 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  navIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: C.text },
  navBadge: { backgroundColor: C.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  navBadgeText: { fontSize: 11, fontWeight: '700' as const, color: C.white },

  white: { color: '#fff' },
});
