import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  MapPin, Clock, Search, ChevronRight, AlertCircle, Bell, MessageCircle,
  Navigation, CheckCircle, Shield, Award, Star, XCircle, DollarSign, Sparkles, BookOpen,
  TrendingUp, Briefcase, Wallet, Zap,
} from 'lucide-react-native';
import { skillLabel } from '@/constants/skills';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';
import WorldSwitcher from '@/components/WorldSwitcher';
import SupportMenu from '@/components/SupportMenu';
import ReviewModal from '@/components/ReviewModal';
import { checkAtSite, SITE_RADIUS_METERS } from '@/lib/geo';

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface AppRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
}

type BannerType = 'error' | 'active' | 'warning' | 'info' | 'success';

interface CriticalAction {
  type: BannerType;
  title: string;
  body: string;
  action: string;
  route: string | null;
  assignmentId: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToday(dateStr: string): boolean {
  const today = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  return d.toDateString() === today.toDateString();
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
  } catch {
    return t;
  }
}

function formatShiftDateTime(date: string, startTime: string, endTime: string): string {
  try {
    const d = new Date(date + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${fmtTime(startTime)} – ${fmtTime(endTime)}`;
  } catch {
    return `${date} · ${startTime} – ${endTime}`;
  }
}

function isThisWeek(dateStr: string): boolean {
  const now = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return d >= mon && d <= sun;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { shiftPosts, companies, workerProfiles, workerCertifications } = bootstrapQuery.data;
  const utils = trpc.useUtils();

  const invalidateAll = async () => {
    await Promise.all([
      utils.dock.bootstrap.invalidate(),
    ]);
  };

  const [gpsChecking, setGpsChecking] = React.useState<boolean>(false);
  const clockInM = trpc.shifts.clockIn.useMutation({
    onSuccess: invalidateAll,
    onError: (e: Error) => Alert.alert('Unable to clock in', e.message),
  });

  /** Verify the worker is at the worksite (GPS) before clocking in. */
  const clockInWithGps = async (assignmentId: string, address: string, city: string) => {
    if (gpsChecking || clockInM.isPending) return;
    setGpsChecking(true);
    try {
      const site = `${address}, ${city}`;
      const result = await checkAtSite(site);
      if (!result.withinRange && result.distanceMeters != null) {
        const meters = Math.round(result.distanceMeters);
        const away = meters > 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
        Alert.alert(
          'You are not at the worksite',
          `You appear to be about ${away} from ${site}. You must be within ${SITE_RADIUS_METERS} m of the site to clock in. Move closer and try again.`,
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
    onSuccess: async () => {
      await invalidateAll();
      Alert.alert('Shift ended', 'Your hours have been submitted. Waiting for employer to confirm.');
    },
    onError: (e: Error) => Alert.alert('Unable to clock out', e.message),
  });

  // ── Assignments ──────────────────────────────────────────────────────────
  const assignmentsQ = useQuery({
    queryKey: ['my-assignments', user?.id],
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

  // ── Applications ─────────────────────────────────────────────────────────
  const appsQ = useQuery({
    queryKey: ['my-applications', user?.id],
    queryFn: async (): Promise<AppRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status,applied_at')
        .eq('worker_user_id', user.id)
        .order('applied_at', { ascending: false });
      return (data ?? []) as AppRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const myAssignments = assignmentsQ.data ?? [];
  const myApps = appsQ.data ?? [];

  // ── Time entries ─────────────────────────────────────────────────────────
  const timeEntriesQ = useQuery({
    queryKey: ['my-time-entries', user?.id, myAssignments.map((a) => a.id).join(',')],
    queryFn: async (): Promise<TimeEntryRow[]> => {
      if (!user?.id || myAssignments.length === 0) return [];
      const ids = myAssignments.map((a) => a.id);
      const { data } = await supabase
        .from('time_entries')
        .select('id,assignment_id,start_timestamp,end_timestamp,employer_confirmed_hours')
        .in('assignment_id', ids);
      return (data ?? []) as TimeEntryRow[];
    },
    enabled: Boolean(user?.id) && myAssignments.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const myTimeEntries = timeEntriesQ.data ?? [];

  // ── Unread notifications ─────────────────────────────────────────────────
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
        assignmentsQ.refetch(),
        appsQ.refetch(),
        timeEntriesQ.refetch(),
        notifCountQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Profile + certs ──────────────────────────────────────────────────────
  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);
  const myCerts = useMemo(() => workerCertifications.filter((c) => c.workerUserId === user?.id), [workerCertifications, user]);
  const govtIds = useMemo(() => myCerts.filter((c) => c.type.startsWith('GovtID_')), [myCerts]);
  const workCerts = useMemo(() => myCerts.filter((c) => !c.type.startsWith('GovtID_')), [myCerts]);

  // ── Review tracking ──────────────────────────────────────────────────────
  const completedIds = useMemo(
    () => myAssignments.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).map((a) => a.id),
    [myAssignments],
  );
  const reviewsQ = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'shift_assignment', contextIds: completedIds },
    { enabled: completedIds.length > 0 },
  );
  const reviewedIds = useMemo(
    () => new Set(((reviewsQ.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [reviewsQ.data],
  );
  const ratingPending = completedIds.some((id) => !reviewedIds.has(id));
  const [reviewForId, setReviewForId] = useState<string | null>(null);
  const pendingReviewAssignment = useMemo(() => {
    const id = completedIds.find((cid) => !reviewedIds.has(cid));
    if (!id) return null;
    const ass = myAssignments.find((a) => a.id === id);
    if (!ass) return null;
    const shift = shiftPosts.find((s) => s.id === ass.shift_id);
    return { assignmentId: ass.id, companyId: shift?.employerCompanyId ?? null };
  }, [completedIds, reviewedIds, myAssignments, shiftPosts]);
  const activeReview = useMemo(() => {
    if (!reviewForId) return null;
    const ass = myAssignments.find((a) => a.id === reviewForId);
    if (!ass) return null;
    const shift = shiftPosts.find((s) => s.id === ass.shift_id);
    return { assignmentId: ass.id, companyId: shift?.employerCompanyId ?? null };
  }, [reviewForId, myAssignments, shiftPosts]);

  // ── Critical action banner ────────────────────────────────────────────────
  const criticalAction = useMemo((): CriticalAction | null => {
    // 1. Profile missing
    if (!profile) {
      return {
        type: 'error',
        title: 'Create your worker profile',
        body: 'Complete your profile to start applying for shifts.',
        action: 'Create Profile',
        route: '/worker/profile',
        assignmentId: null,
      };
    }

    // 2. Government ID rejected
    const rejectedId = govtIds.find((c) => c.status === 'Rejected');
    if (rejectedId) {
      const label = rejectedId.type.replace('GovtID_', '');
      return {
        type: 'error',
        title: 'Government ID rejected',
        body: rejectedId.notes ? `${label}: ${rejectedId.notes}` : `Your ${label} was rejected. Please upload a new document.`,
        action: 'Fix Now',
        route: '/worker/profile',
        assignmentId: null,
      };
    }

    // 3. Certificate rejected
    const rejectedCert = workCerts.find((c) => c.status === 'Rejected');
    if (rejectedCert) {
      return {
        type: 'error',
        title: `${rejectedCert.type} certificate rejected`,
        body: rejectedCert.notes ? `Reason: ${rejectedCert.notes}` : 'Please upload a replacement certificate.',
        action: 'Fix Certificate',
        route: '/worker/profile',
        assignmentId: null,
      };
    }

    // 4. Active shift — clock out needed
    const activeAss = myAssignments.find((a) => a.status === 'InProgress');
    if (activeAss) {
      const shift = shiftPosts.find((s) => s.id === activeAss.shift_id);
      return {
        type: 'active',
        title: '⚡ You are clocked in',
        body: shift ? `${shift.title} is in progress.` : 'Your shift is currently in progress.',
        action: 'Clock Out',
        route: null,
        assignmentId: activeAss.id,
      };
    }

    // 5. Attendance confirmation needed (within 48h, not yet confirmed)
    const needsConfirm = myAssignments.find((a) => {
      if (a.status !== 'Scheduled') return false;
      if (a.worker_confirmed !== null && a.worker_confirmed !== undefined) return false;
      const shift = shiftPosts.find((s) => s.id === a.shift_id);
      if (!shift) return false;
      const shiftStart = new Date(`${shift.date}T${shift.startTime}`).getTime();
      const hoursUntil = (shiftStart - Date.now()) / 3_600_000;
      return hoursUntil >= 0 && hoursUntil <= 48;
    });
    if (needsConfirm) {
      const shift = shiftPosts.find((s) => s.id === needsConfirm.shift_id);
      return {
        type: 'warning',
        title: 'Confirm your attendance',
        body: shift
          ? `${shift.title} starts ${isToday(shift.date) ? 'today' : 'soon'}. Please confirm you will attend.`
          : 'A shift is starting soon. Please confirm attendance.',
        action: 'Confirm Now',
        route: '/worker/shift-confirm',
        assignmentId: needsConfirm.id,
      };
    }

    // 6. Government ID pending (no approved ID)
    if (govtIds.length > 0 && !govtIds.some((c) => c.status === 'Approved')) {
      return {
        type: 'info',
        title: 'Government ID under review',
        body: 'Your ID is waiting for admin approval. You can still browse shifts.',
        action: 'View Status',
        route: '/worker/profile',
        assignmentId: null,
      };
    }

    // 7. Hours awaiting employer confirmation
    const awaitingHours = myTimeEntries.some((t) => t.end_timestamp && !t.employer_confirmed_hours);
    if (awaitingHours) {
      return {
        type: 'info',
        title: 'Hours awaiting confirmation',
        body: 'You have clocked hours waiting for employer to confirm.',
        action: 'View Hours',
        route: '/worker/my-shifts',
        assignmentId: null,
      };
    }

    // 8. Rating pending
    if (ratingPending) {
      return {
        type: 'info',
        title: 'Rate your employer',
        body: 'You have completed shifts. Share your experience.',
        action: 'Rate Now',
        route: '/worker/my-shifts',
        assignmentId: null,
      };
    }

    return null;
  }, [profile, govtIds, workCerts, myAssignments, shiftPosts, myTimeEntries, ratingPending]);

  // ── Compliance readiness ─────────────────────────────────────────────────
  const readiness = useMemo(() => {
    const hasProfile = Boolean(profile);
    const govtIdStatus = govtIds.length === 0
      ? 'missing'
      : govtIds.some((c) => c.status === 'Approved') ? 'done'
      : govtIds.some((c) => c.status === 'Rejected') ? 'rejected' : 'pending';
    const certStatus = workCerts.some((c) => c.status === 'Approved')
      ? 'done'
      : workCerts.length === 0 ? 'missing' : 'pending';
    const profileOk = hasProfile && (profile!.bio?.length ?? 0) > 5 && profile!.skills.length > 0;

    return { hasProfile, govtIdStatus, certStatus, profileOk };
  }, [profile, govtIds, workCerts]);

  // ── Next shift ───────────────────────────────────────────────────────────
  const nextShift = useMemo(() => {
    const active = myAssignments
      .filter((a) => a.status === 'Scheduled' || a.status === 'InProgress')
      .map((a) => {
        const shift = shiftPosts.find((s) => s.id === a.shift_id);
        return { assignment: a, shift };
      })
      .filter((x): x is { assignment: AssignmentRow; shift: NonNullable<typeof x.shift> } => Boolean(x.shift))
      .sort((x, y) => {
        const dX = new Date((x.shift.date ?? '') + 'T' + (x.shift.startTime ?? '00:00'));
        const dY = new Date((y.shift.date ?? '') + 'T' + (y.shift.startTime ?? '00:00'));
        return dX.getTime() - dY.getTime();
      });
    return active[0] ?? null;
  }, [myAssignments, shiftPosts]);

  const nextTE = useMemo(() => {
    if (!nextShift) return null;
    return myTimeEntries.find((t) => t.assignment_id === nextShift.assignment.id) ?? null;
  }, [nextShift, myTimeEntries]);

  // ── Applications summary ─────────────────────────────────────────────────
  const appStats = useMemo(() => ({
    pending: myApps.filter((a) => a.status === 'Applied').length,
    accepted: myApps.filter((a) => a.status === 'Accepted').length,
    rejected: myApps.filter((a) => a.status === 'Rejected').length,
  }), [myApps]);

  // ── This week stats ──────────────────────────────────────────────────────
  const weekStats = useMemo(() => {
    let confirmedHours = 0;
    let estimatedEarnings = 0;
    let awaitingConfirmation = 0;
    for (const te of myTimeEntries) {
      const ass = myAssignments.find((a) => a.id === te.assignment_id);
      if (!ass) continue;
      const shift = shiftPosts.find((s) => s.id === ass.shift_id);
      if (!shift || !isThisWeek(shift.date)) continue;
      if (te.employer_confirmed_hours) {
        confirmedHours += te.employer_confirmed_hours;
        estimatedEarnings += te.employer_confirmed_hours * ass.confirmed_rate;
      } else if (te.end_timestamp) {
        awaitingConfirmation++;
      }
    }
    return { confirmedHours, estimatedEarnings, awaitingConfirmation };
  }, [myTimeEntries, myAssignments, shiftPosts]);

  // ── All-time career stats ────────────────────────────────────────────────
  const careerStats = useMemo(() => {
    let totalHours = 0;
    let totalEarnings = 0;
    const completedShiftIds = new Set<string>();
    for (const te of myTimeEntries) {
      const ass = myAssignments.find((a) => a.id === te.assignment_id);
      if (!ass) continue;
      if (te.employer_confirmed_hours) {
        totalHours += te.employer_confirmed_hours;
        totalEarnings += te.employer_confirmed_hours * ass.confirmed_rate;
        completedShiftIds.add(ass.id);
      }
    }
    return { totalHours, totalEarnings, completedShifts: completedShiftIds.size };
  }, [myTimeEntries, myAssignments]);

  // ── Recommended open shifts (matched to skills + city) ─────────────────────
  const recommendedShifts = useMemo(() => {
    const todayStr = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); })();
    const appliedIds = new Set(myApps.map((a) => a.shift_id));
    const assignedIds = new Set(myAssignments.map((a) => a.shift_id));
    const skills = new Set(profile?.skills ?? []);
    const cities = new Set((profile?.coverageCities ?? []).map((c) => c.toLowerCase()));

    const open = shiftPosts.filter(
      (s) => s.status === 'Posted' && s.date >= todayStr && !appliedIds.has(s.id) && !assignedIds.has(s.id),
    );
    const scored = open
      .map((s) => {
        const skillMatch = skills.size > 0 && skills.has(s.category) ? 2 : 0;
        const cityMatch = cities.size > 0 && cities.has(s.locationCity.toLowerCase()) ? 1 : 0;
        return { shift: s, score: skillMatch + cityMatch };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.shift.date.localeCompare(b.shift.date);
      });
    return scored.slice(0, 4);
  }, [shiftPosts, myApps, myAssignments, profile]);

  const employerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? 'Employer';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const BANNER_COLORS: Record<BannerType, { bg: string; border: string; text: string; btnBg: string; btnText: string }> = {
    error:   { bg: C.redDim,    border: C.red    + '50', text: C.red,    btnBg: C.red    + '30', btnText: C.red    },
    active:  { bg: C.accent + '12', border: C.accent + '50', text: C.accent, btnBg: C.accent + '25', btnText: C.accent },
    warning: { bg: C.yellowDim, border: C.yellow + '50', text: C.yellow, btnBg: C.yellow + '30', btnText: C.yellow },
    info:    { bg: C.blueDim,   border: C.blue   + '50', text: C.blue,   btnBg: C.blue   + '25', btnText: C.blue   },
    success: { bg: C.greenDim,  border: C.green  + '50', text: C.green,  btnBg: C.green  + '25', btnText: C.green  },
  };

  const handleBannerPress = (action: CriticalAction) => {
    if (action.type === 'active' && action.assignmentId) {
      clockOutM.mutate({ assignmentId: action.assignmentId });
    } else if (action.route === '/worker/shift-confirm' && action.assignmentId) {
      router.push({ pathname: '/worker/shift-confirm' as any, params: { assignmentId: action.assignmentId } });
    } else if (action.route) {
      router.push(action.route as any);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'done') return <CheckCircle size={13} color={C.green} />;
    if (status === 'pending') return <Clock size={13} color={C.yellow} />;
    if (status === 'rejected') return <XCircle size={13} color={C.red} />;
    return <AlertCircle size={13} color={C.textMuted} />;
  };
  const statusLabel = (status: string) => {
    if (status === 'done') return 'Approved';
    if (status === 'pending') return 'Under review';
    if (status === 'rejected') return 'Rejected';
    return 'Missing';
  };
  const statusColor = (status: string) => {
    if (status === 'done') return C.green;
    if (status === 'pending') return C.yellow;
    if (status === 'rejected') return C.red;
    return C.textMuted;
  };

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
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.name}>{profile?.displayName ?? user?.name ?? 'Worker'}</Text>
        </View>
        <View style={styles.headerRight}>
          <WorldSwitcher />
          <SupportMenu />
          <TouchableOpacity onPress={() => router.push('/notifications' as any)} style={styles.notifBtn}>
            <Bell size={18} color={C.text} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/worker/profile' as any)} style={styles.avatarBtn}>
            <Text style={styles.avatarLetter}>{(profile?.displayName ?? user?.name ?? 'W').charAt(0).toUpperCase()}</Text>
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
        {/* ── Critical Action Banner ── */}
        {criticalAction && (() => {
          const colors = BANNER_COLORS[criticalAction.type];
          return (
            <TouchableOpacity
              onPress={() => handleBannerPress(criticalAction)}
              style={[styles.criticalBanner, { backgroundColor: colors.bg, borderColor: colors.border }]}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.criticalTitle, { color: colors.text }]}>{criticalAction.title}</Text>
                <Text style={[styles.criticalBody, { color: colors.text + 'CC' }]}>{criticalAction.body}</Text>
              </View>
              <View style={[styles.criticalBtn, { backgroundColor: colors.btnBg }]}>
                <Text style={[styles.criticalBtnText, { color: colors.btnText }]}>
                  {criticalAction.type === 'active' && clockOutM.isPending ? 'Clocking out…' : criticalAction.action + ' →'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })()}

        {/* ── Work Readiness ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WORK READINESS</Text>
          <Card>
            {/* Profile */}
            <View style={styles.readinessRow}>
              <View style={[styles.readinessIcon, { backgroundColor: readiness.profileOk ? C.greenDim : C.card }]}>
                {readiness.profileOk ? <CheckCircle size={14} color={C.green} /> : <AlertCircle size={14} color={C.textMuted} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.readinessLabel}>Worker Profile</Text>
              </View>
              <Text style={[styles.readinessStatus, { color: readiness.profileOk ? C.green : C.textMuted }]}>
                {readiness.profileOk ? 'Complete' : 'Incomplete'}
              </Text>
              {!readiness.profileOk && (
                <TouchableOpacity onPress={() => router.push('/worker/profile' as any)} style={styles.readinessAction}>
                  <Text style={styles.readinessActionText}>Fix</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.readinessDivider} />

            {/* Government ID */}
            <View style={styles.readinessRow}>
              <View style={[styles.readinessIcon, {
                backgroundColor: readiness.govtIdStatus === 'done' ? C.greenDim
                  : readiness.govtIdStatus === 'rejected' ? C.redDim
                  : readiness.govtIdStatus === 'pending' ? C.yellowDim : C.card,
              }]}>
                {statusIcon(readiness.govtIdStatus)}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.readinessLabel}>Government ID</Text>
              </View>
              <Text style={[styles.readinessStatus, { color: statusColor(readiness.govtIdStatus) }]}>
                {statusLabel(readiness.govtIdStatus)}
              </Text>
              {(readiness.govtIdStatus === 'missing' || readiness.govtIdStatus === 'rejected') && (
                <TouchableOpacity onPress={() => router.push('/worker/profile' as any)} style={styles.readinessAction}>
                  <Text style={styles.readinessActionText}>
                    {readiness.govtIdStatus === 'rejected' ? 'Re-upload' : 'Upload'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.readinessDivider} />

            {/* Certifications */}
            <View style={styles.readinessRow}>
              <View style={[styles.readinessIcon, {
                backgroundColor: readiness.certStatus === 'done' ? C.greenDim
                  : readiness.certStatus === 'pending' ? C.yellowDim : C.card,
              }]}>
                <Award size={14} color={
                  readiness.certStatus === 'done' ? C.green
                  : readiness.certStatus === 'pending' ? C.yellow : C.textMuted
                } />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.readinessLabel}>Certifications</Text>
                {workCerts.length > 0 && (
                  <Text style={styles.readinessSub}>
                    {workCerts.filter((c) => c.status === 'Approved').length} approved · {workCerts.filter((c) => c.status === 'Pending').length} pending
                  </Text>
                )}
              </View>
              <Text style={[styles.readinessStatus, { color: statusColor(readiness.certStatus) }]}>
                {statusLabel(readiness.certStatus)}
              </Text>
              {readiness.certStatus === 'missing' && (
                <TouchableOpacity onPress={() => router.push('/worker/profile' as any)} style={styles.readinessAction}>
                  <Text style={styles.readinessActionText}>Upload</Text>
                </TouchableOpacity>
              )}
            </View>
          </Card>
        </View>

        {/* ── Current / Next Shift ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>YOUR SHIFT</Text>
          {nextShift ? (
            nextShift.assignment.status === 'InProgress' ? (
              <View style={[styles.shiftCard, styles.shiftCardActive]}>
                <View style={styles.shiftPill}>
                  <Text style={[styles.shiftPillText, { color: C.accent }]}>⚡ IN PROGRESS</Text>
                </View>
                <Text style={styles.shiftTitle}>{nextShift.shift.title}</Text>
                <Text style={styles.shiftEmployer}>{employerName(nextShift.shift.employerCompanyId)}</Text>
                {nextTE?.start_timestamp && (
                  <Text style={styles.shiftMeta}>
                    Started at {new Date(nextTE.start_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
                <Button
                  label={clockOutM.isPending ? 'Clocking out…' : 'Clock Out'}
                  onPress={() => clockOutM.mutate({ assignmentId: nextShift.assignment.id })}
                  loading={clockOutM.isPending}
                  size="sm"
                  variant="outline"
                  fullWidth
                />
              </View>
            ) : (
              <View style={[styles.shiftCard, styles.shiftCardScheduled]}>
                <View style={styles.shiftPill}>
                  <Text style={[styles.shiftPillText, { color: C.blue }]}>
                    {isToday(nextShift.shift.date) ? 'TODAY' : isTomorrow(nextShift.shift.date) ? 'TOMORROW' : 'UPCOMING'}
                  </Text>
                </View>
                <Text style={styles.shiftTitle}>{nextShift.shift.title}</Text>
                <Text style={styles.shiftEmployer}>{employerName(nextShift.shift.employerCompanyId)}</Text>
                <View style={styles.shiftMetaRow}>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={styles.shiftMeta}>{formatShiftDateTime(nextShift.shift.date, nextShift.shift.startTime, nextShift.shift.endTime)}</Text>
                </View>
                <View style={styles.shiftMetaRow}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.shiftMeta} numberOfLines={1}>
                    {nextShift.shift.locationAddress}, {nextShift.shift.locationCity}
                  </Text>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(`${nextShift.shift.locationAddress}, ${nextShift.shift.locationCity}`)}`)}
                    style={styles.directionsBtn}
                  >
                    <Navigation size={11} color={C.blue} />
                    <Text style={styles.directionsBtnText}>Directions</Text>
                  </TouchableOpacity>
                </View>
                {nextShift.assignment.worker_confirmed !== true && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/worker/shift-confirm' as any, params: { assignmentId: nextShift.assignment.id } })}
                    style={styles.confirmBanner}
                  >
                    <AlertCircle size={13} color={C.yellow} />
                    <Text style={styles.confirmBannerText}>Confirm attendance before clocking in</Text>
                    <Text style={styles.confirmBannerArrow}>→</Text>
                  </TouchableOpacity>
                )}
                <Button
                  label={
                    nextShift.assignment.worker_confirmed !== true
                      ? 'Confirm attendance first'
                      : isToday(nextShift.shift.date) ? 'Clock In' : 'Available on shift day'
                  }
                  onPress={() => {
                    if (nextShift.assignment.worker_confirmed !== true) {
                      router.push({ pathname: '/worker/shift-confirm' as any, params: { assignmentId: nextShift.assignment.id } });
                      return;
                    }
                    void clockInWithGps(nextShift.assignment.id, nextShift.shift.locationAddress, nextShift.shift.locationCity);
                  }}
                  loading={clockInM.isPending || gpsChecking}
                  disabled={nextShift.assignment.worker_confirmed === true && !isToday(nextShift.shift.date)}
                  size="sm"
                  fullWidth
                />
              </View>
            )
          ) : (
            <View style={styles.noShift}>
              <Search size={28} color={C.textMuted} />
              <Text style={styles.noShiftTitle}>No upcoming shifts</Text>
              <Text style={styles.noShiftSub}>Browse open shifts and apply</Text>
              <Button
                label="Browse Shifts"
                onPress={() => router.push('/worker/browse' as any)}
                size="sm"
                icon={<Search size={14} color={C.white} />}
              />
            </View>
          )}
        </View>

        {/* ── Recommended Shifts (matched to skills + city) ── */}
        {recommendedShifts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>RECOMMENDED FOR YOU</Text>
              <TouchableOpacity onPress={() => router.push('/worker/browse' as any)}>
                <Text style={styles.seeAll}>Browse all →</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.recList}>
              {recommendedShifts.map(({ shift, score }) => (
                <TouchableOpacity
                  key={shift.id}
                  onPress={() => router.push('/worker/browse' as any)}
                  activeOpacity={0.85}
                  style={styles.recCard}
                >
                  <View style={styles.recTop}>
                    <View style={styles.recCatChip}>
                      <Text style={styles.recCatText}>{skillLabel(shift.category)}</Text>
                    </View>
                    {score >= 2 && (
                      <View style={styles.recMatchChip}>
                        <Zap size={10} color={C.accent} />
                        <Text style={styles.recMatchText}>Skill match</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <Text style={styles.recRate}>${shift.hourlyRate ?? shift.flatRate}/hr</Text>
                  </View>
                  <Text style={styles.recTitle} numberOfLines={1}>{shift.title}</Text>
                  <Text style={styles.recEmployer} numberOfLines={1}>{employerName(shift.employerCompanyId)}</Text>
                  <View style={styles.recMetaRow}>
                    <MapPin size={11} color={C.textMuted} />
                    <Text style={styles.recMeta} numberOfLines={1}>{shift.locationCity}</Text>
                    <Clock size={11} color={C.textMuted} />
                    <Text style={styles.recMeta}>{formatShiftDateTime(shift.date, shift.startTime, shift.endTime).split(' · ')[0]}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Applications ── */}
        {(appStats.pending > 0 || appStats.accepted > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>APPLICATIONS</Text>
              <TouchableOpacity onPress={() => router.push('/worker/my-shifts' as any)}>
                <Text style={styles.seeAll}>View All →</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.appRow}>
              {appStats.pending > 0 && (
                <View style={[styles.appChip, { backgroundColor: C.yellowDim, borderColor: C.yellow + '40' }]}>
                  <Clock size={12} color={C.yellow} />
                  <Text style={[styles.appChipText, { color: C.yellow }]}>
                    {appStats.pending} pending
                  </Text>
                </View>
              )}
              {appStats.accepted > 0 && (
                <View style={[styles.appChip, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
                  <CheckCircle size={12} color={C.green} />
                  <Text style={[styles.appChipText, { color: C.green }]}>
                    {appStats.accepted} accepted
                  </Text>
                </View>
              )}
              {appStats.rejected > 0 && (
                <View style={[styles.appChip, { backgroundColor: C.card, borderColor: C.border }]}>
                  <XCircle size={12} color={C.textMuted} />
                  <Text style={[styles.appChipText, { color: C.textMuted }]}>
                    {appStats.rejected} not selected
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Hours This Week ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THIS WEEK</Text>
          <Card>
            <View style={styles.weekRow}>
              <View style={styles.weekStat}>
                <Text style={styles.weekVal}>{weekStats.confirmedHours.toFixed(1)}</Text>
                <Text style={styles.weekLbl}>Confirmed{'\n'}Hours</Text>
              </View>
              <View style={[styles.weekStat, styles.weekMid]}>
                <Text style={[styles.weekVal, { color: weekStats.estimatedEarnings > 0 ? C.green : C.textMuted }]}>
                  ${weekStats.estimatedEarnings.toFixed(0)}
                </Text>
                <Text style={styles.weekLbl}>Est.{'\n'}Earnings</Text>
              </View>
              <View style={styles.weekStat}>
                <Text style={[styles.weekVal, { color: weekStats.awaitingConfirmation > 0 ? C.yellow : C.textMuted }]}>
                  {weekStats.awaitingConfirmation}
                </Text>
                <Text style={styles.weekLbl}>Awaiting{'\n'}Confirm.</Text>
              </View>
            </View>
            <Text style={styles.payrollNote}>
              Payment handled through your employer's payroll process.
            </Text>
          </Card>
        </View>

        {/* ── All-time career stats ── */}
        {(careerStats.completedShifts > 0 || (profile?.skills.length ?? 0) > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR CAREER</Text>
            <View style={styles.careerRow}>
              <View style={styles.careerCard}>
                <View style={[styles.careerIcon, { backgroundColor: C.blueDim }]}>
                  <Briefcase size={15} color={C.blue} />
                </View>
                <Text style={styles.careerVal}>{careerStats.completedShifts}</Text>
                <Text style={styles.careerLbl}>Shifts done</Text>
              </View>
              <View style={styles.careerCard}>
                <View style={[styles.careerIcon, { backgroundColor: C.accentDim }]}>
                  <TrendingUp size={15} color={C.accent} />
                </View>
                <Text style={styles.careerVal}>{careerStats.totalHours.toFixed(0)}</Text>
                <Text style={styles.careerLbl}>Total hours</Text>
              </View>
              <View style={styles.careerCard}>
                <View style={[styles.careerIcon, { backgroundColor: C.greenDim }]}>
                  <Wallet size={15} color={C.green} />
                </View>
                <Text style={styles.careerVal}>${careerStats.totalEarnings.toFixed(0)}</Text>
                <Text style={styles.careerLbl}>Earned</Text>
              </View>
            </View>
            {(profile?.skills.length ?? 0) > 0 && (
              <View style={styles.skillsCard}>
                <View style={styles.skillsHeader}>
                  <Text style={styles.skillsTitle}>Your skills</Text>
                  <TouchableOpacity onPress={() => router.push('/worker/profile' as any)}>
                    <Text style={styles.skillsEdit}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.skillsWrap}>
                  {(profile?.skills ?? []).map((s) => (
                    <View key={s} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{skillLabel(s)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Ratings ── */}
        {ratingPending && (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => {
                if (pendingReviewAssignment) setReviewForId(pendingReviewAssignment.assignmentId);
                else router.push('/worker/my-shifts' as any);
              }}
              style={styles.ratingPrompt}
            >
              <Star size={16} color={C.yellow} fill={C.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={styles.ratingPromptTitle}>Rate your employer</Text>
                <Text style={styles.ratingPromptSub}>Build your reputation on the platform</Text>
              </View>
              <ChevronRight size={16} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
          <View style={styles.navList}>
            {[
              { label: 'Browse Open Shifts', icon: Search, color: C.accent, path: '/worker/browse' },
              { label: 'My Shifts & Applications', icon: Clock, color: C.blue, path: '/worker/my-shifts' },
              { label: 'Documents & Certificates', icon: Shield, color: C.yellow, path: '/worker/profile' },
              { label: 'AI Assistant', icon: Sparkles, color: C.accent, path: '/assistant' },
              { label: 'Help Center & Manual', icon: BookOpen, color: C.green, path: '/help' },
              { label: 'My Reviews', icon: Star, color: C.yellow, path: '/reviews' },
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

      <ReviewModal
        visible={!!activeReview}
        onClose={() => setReviewForId(null)}
        onSubmitted={() => {
          setReviewForId(null);
          void reviewsQ.refetch();
        }}
        title="Rate this employer"
        subtitle={activeReview?.companyId ? employerName(activeReview.companyId) : undefined}
        contextKind="shift_assignment"
        contextId={activeReview?.assignmentId ?? ''}
        targetKind="company"
        targetCompanyId={activeReview?.companyId ?? null}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bgSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: { fontSize: 12, color: C.textMuted, marginBottom: 2 },
  name: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notifBtn: {
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
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accentDim,
    borderWidth: 2,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 16, fontWeight: '800' as const, color: C.accent },
  scroll: { padding: 16 },

  // Critical banner
  criticalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  criticalTitle: { fontSize: 15, fontWeight: '800' as const, marginBottom: 2 },
  criticalBody: { fontSize: 12, lineHeight: 18 },
  criticalBtn: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  criticalBtnText: { fontSize: 12, fontWeight: '700' as const },

  // Section
  section: { marginBottom: 20 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700' as const, color: C.textMuted,
    letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10,
  },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },

  // Readiness card rows
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  readinessIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  readinessLabel: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  readinessSub: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  readinessStatus: { fontSize: 12, fontWeight: '600' as const },
  readinessAction: {
    marginLeft: 8,
    backgroundColor: C.accentDim,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  readinessActionText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  readinessDivider: { height: 1, backgroundColor: C.border, marginVertical: 4 },

  // Shift card
  shiftCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 0, gap: 8 },
  shiftCardActive: { backgroundColor: C.accent + '10', borderColor: C.accent + '40' },
  shiftCardScheduled: { backgroundColor: C.blueDim, borderColor: C.blue + '40' },
  shiftPill: { alignSelf: 'flex-start', backgroundColor: 'transparent', marginBottom: 2 },
  shiftPillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.5 },
  shiftTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  shiftEmployer: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  shiftMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  shiftMeta: { fontSize: 12, color: C.textSecondary, flex: 1 },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.blueDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  directionsBtnText: { fontSize: 11, color: C.blue, fontWeight: '600' as const },
  confirmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.yellowDim,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.yellow + '40',
  },
  confirmBannerText: { flex: 1, fontSize: 12, color: C.yellow, fontWeight: '600' as const },
  confirmBannerArrow: { fontSize: 13, color: C.yellow, fontWeight: '700' as const },

  // No shift
  noShift: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  noShiftTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  noShiftSub: { fontSize: 13, color: C.textSecondary, marginBottom: 6 },

  // Applications
  appRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  appChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  appChipText: { fontSize: 13, fontWeight: '600' as const },

  // Week stats
  weekRow: { flexDirection: 'row', marginBottom: 10 },
  weekStat: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 4 },
  weekMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  weekVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  weekLbl: { fontSize: 11, color: C.textSecondary, textAlign: 'center' as const },
  payrollNote: { fontSize: 11, color: C.textMuted, textAlign: 'center' as const, lineHeight: 16 },

  // Rating prompt
  ratingPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.yellowDim,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.yellow + '40',
    padding: 14,
  },
  ratingPromptTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  ratingPromptSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  // Recommended shifts
  recList: { gap: 10 },
  recCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 4,
  },
  recTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  recCatChip: { backgroundColor: C.accent + '18', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  recCatText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  recMatchChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accentDim, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  recMatchText: { fontSize: 10, fontWeight: '700' as const, color: C.accent },
  recRate: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  recTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  recEmployer: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  recMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  recMeta: { fontSize: 12, color: C.textSecondary, marginRight: 6 },

  // Career stats
  careerRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  careerCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    alignItems: 'center',
    gap: 5,
  },
  careerIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  careerVal: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  careerLbl: { fontSize: 11, color: C.textMuted, fontWeight: '500' as const },

  // Skills strip
  skillsCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  skillsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  skillsTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  skillsEdit: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  skillChip: { backgroundColor: C.bgSecondary, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 5 },
  skillChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },

  // Nav list
  navList: { gap: 8 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  navIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: C.text },
  navBadge: { backgroundColor: C.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  navBadgeText: { fontSize: 11, fontWeight: '700' as const, color: C.white },

  // Shared
  white: { color: '#fff' },
});
