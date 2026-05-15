import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MapPin, Clock, Search, ChevronRight, AlertCircle, Zap, Navigation, DollarSign } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  confirmed_rate: number;
  status: string;
  created_at: string;
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

export default function WorkerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const bootstrapQuery = useDockBootstrapData();
  const { shiftPosts, companies, workerProfiles } = bootstrapQuery.data;

  const utils = trpc.useUtils();

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-assignments', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['my-time-entries', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['my-applications', user?.id] }),
      utils.dock.bootstrap.invalidate(),
    ]);
  };

  const clockInM = trpc.shifts.clockIn.useMutation({
    onSuccess: invalidateAll,
    onError: (e: Error) => Alert.alert('Unable to clock in', e.message),
  });

  const clockOutM = trpc.shifts.clockOut.useMutation({
    onSuccess: async () => {
      await invalidateAll();
      Alert.alert('Shift ended', 'Awaiting employer to confirm your hours.');
    },
    onError: (e: Error) => Alert.alert('Unable to clock out', e.message),
  });

  const assignmentsQ = useQuery({
    queryKey: ['my-assignments', user?.id],
    queryFn: async (): Promise<AssignmentRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,worker_user_id,confirmed_rate,status,created_at')
        .eq('worker_user_id', user.id);
      return (data ?? []) as AssignmentRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const appsQ = useQuery({
    queryKey: ['my-applications', user?.id],
    queryFn: async (): Promise<AppRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status,applied_at')
        .eq('worker_user_id', user.id);
      return (data ?? []) as AppRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const myAssignments = assignmentsQ.data ?? [];
  const myApps = appsQ.data ?? [];

  const timeEntriesQ = useQuery({
    queryKey: ['my-time-entries', user?.id],
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
    staleTime: 30_000,
  });

  const myTimeEntries = timeEntriesQ.data ?? [];
  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);

  // Section 1: Next shift
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

  // Section 2: Action items
  const actions = useMemo(() => {
    const pendingApps = myApps.filter((a) => a.status === 'Applied').length;
    const needReview = myAssignments
      .filter((a) => ['Completed', 'HoursConfirmed'].includes(a.status))
      .filter((a) => {
        const te = myTimeEntries.find((t) => t.assignment_id === a.id);
        return te && te.end_timestamp && !te.employer_confirmed_hours;
      }).length;
    const toDispute = myAssignments
      .filter((a) => ['Completed', 'HoursConfirmed'].includes(a.status))
      .filter((a) => {
        const te = myTimeEntries.find((t) => t.assignment_id === a.id);
        if (!te?.start_timestamp || !te?.end_timestamp || !te?.employer_confirmed_hours) return false;
        const clock = (new Date(te.end_timestamp).getTime() - new Date(te.start_timestamp).getTime()) / 3_600_000;
        return Math.abs(clock - te.employer_confirmed_hours) > 0.5;
      }).length;
    return { pendingApps, needReview, toDispute };
  }, [myApps, myAssignments, myTimeEntries]);

  // Section 3: This week earnings
  const weekStats = useMemo(() => {
    let hours = 0;
    let earnings = 0;
    let pendingPay = 0;
    for (const te of myTimeEntries) {
      const ass = myAssignments.find((a) => a.id === te.assignment_id);
      if (!ass) continue;
      const shift = shiftPosts.find((s) => s.id === ass.shift_id);
      if (!shift || !isThisWeek(shift.date)) continue;
      if (te.employer_confirmed_hours) {
        hours += te.employer_confirmed_hours;
        earnings += te.employer_confirmed_hours * ass.confirmed_rate;
      } else if (te.end_timestamp) {
        pendingPay++;
      }
    }
    return { hours, earnings, pendingPay };
  }, [myTimeEntries, myAssignments, shiftPosts]);

  const employerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? 'Employer';
  const hasActions = actions.pendingApps > 0 || actions.needReview > 0 || actions.toDispute > 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.name}>{profile?.displayName ?? user?.name ?? 'Worker'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/worker/profile' as any)} style={styles.avatarBtn}>
          <Text style={styles.avatarLetter}>{(profile?.displayName ?? user?.name ?? 'W').charAt(0).toUpperCase()}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Section 1: Next Shift Banner ─── */}
        {nextShift ? (
          nextShift.assignment.status === 'InProgress' ? (
            <View style={[styles.banner, styles.bannerActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerLabel}>⚡ SHIFT IN PROGRESS</Text>
                <Text style={styles.bannerTitle}>{nextShift.shift.title}</Text>
                <Text style={styles.bannerEmp}>{employerName(nextShift.shift.employerCompanyId)}</Text>
                {nextTE?.start_timestamp && (
                  <Text style={styles.bannerMeta}>
                    Started at {new Date(nextTE.start_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
              <Button
                label="Clock Out"
                onPress={() => clockOutM.mutate({ assignmentId: nextShift.assignment.id })}
                loading={clockOutM.isPending}
                size="sm"
                variant="outline"
              />
            </View>
          ) : (
            <View style={[styles.banner, styles.bannerScheduled]}>
              <View style={styles.bannerPill}>
                <Text style={styles.bannerPillText}>
                  {isToday(nextShift.shift.date) ? 'TODAY' : isTomorrow(nextShift.shift.date) ? 'TOMORROW' : 'UPCOMING'}
                </Text>
              </View>
              <Text style={styles.bannerTitle}>{nextShift.shift.title}</Text>
              <Text style={styles.bannerEmp}>{employerName(nextShift.shift.employerCompanyId)}</Text>
              <View style={styles.bannerRow}>
                <Clock size={12} color={C.blue + 'CC'} />
                <Text style={styles.bannerMeta}>{formatShiftDateTime(nextShift.shift.date, nextShift.shift.startTime, nextShift.shift.endTime)}</Text>
              </View>
              <View style={styles.bannerRow}>
                <MapPin size={12} color={C.blue + 'CC'} />
                <Text style={styles.bannerMeta} numberOfLines={1}>
                  {nextShift.shift.locationAddress}, {nextShift.shift.locationCity}
                </Text>
              </View>
              <View style={styles.bannerBtns}>
                <TouchableOpacity
                  style={styles.dirBtn}
                  onPress={() =>
                    Linking.openURL(
                      `https://maps.google.com/?q=${encodeURIComponent(
                        `${nextShift.shift.locationAddress}, ${nextShift.shift.locationCity}`,
                      )}`,
                    )
                  }
                >
                  <Navigation size={13} color={C.blue} />
                  <Text style={styles.dirBtnText}>Get Directions</Text>
                </TouchableOpacity>
                <Button
                  label="Clock In"
                  onPress={() => clockInM.mutate({ assignmentId: nextShift.assignment.id })}
                  loading={clockInM.isPending}
                  disabled={!isToday(nextShift.shift.date)}
                  size="sm"
                />
              </View>
            </View>
          )
        ) : (
          <View style={styles.noShift}>
            <Text style={styles.noShiftTitle}>No upcoming shifts</Text>
            <Text style={styles.noShiftSub}>Browse open shifts near you</Text>
            <Button
              label="Browse Shifts"
              onPress={() => router.push('/worker/browse' as any)}
              size="sm"
              icon={<Search size={14} color={C.white} />}
            />
          </View>
        )}

        {/* ─── Section 2: Action Items ─── */}
        {hasActions && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ACTION REQUIRED</Text>
            <View style={styles.chips}>
              {actions.pendingApps > 0 && (
                <TouchableOpacity onPress={() => router.push('/worker/my-shifts' as any)} style={[styles.chip, styles.chipYellow]}>
                  <AlertCircle size={13} color={C.yellow} />
                  <Text style={[styles.chipText, { color: C.yellow }]}>
                    {actions.pendingApps} application{actions.pendingApps > 1 ? 's' : ''} pending
                  </Text>
                </TouchableOpacity>
              )}
              {actions.needReview > 0 && (
                <TouchableOpacity onPress={() => router.push('/worker/my-shifts' as any)} style={[styles.chip, styles.chipBlue]}>
                  <Clock size={13} color={C.blue} />
                  <Text style={[styles.chipText, { color: C.blue }]}>
                    {actions.needReview} shift{actions.needReview > 1 ? 's' : ''} need review
                  </Text>
                </TouchableOpacity>
              )}
              {actions.toDispute > 0 && (
                <TouchableOpacity onPress={() => router.push('/worker/my-shifts' as any)} style={[styles.chip, styles.chipRed]}>
                  <Zap size={13} color={C.red} />
                  <Text style={[styles.chipText, { color: C.red }]}>
                    {actions.toDispute} hour{actions.toDispute > 1 ? 's' : ''} to dispute
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ─── Section 3: This Week Earnings ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THIS WEEK</Text>
          <Card>
            <View style={styles.weekRow}>
              <View style={styles.weekStat}>
                <Text style={styles.weekVal}>{weekStats.hours.toFixed(1)}</Text>
                <Text style={styles.weekLbl}>Hours Worked</Text>
              </View>
              <View style={[styles.weekStat, styles.weekMid]}>
                <Text style={[styles.weekVal, { color: C.green }]}>${weekStats.earnings.toFixed(0)}</Text>
                <Text style={styles.weekLbl}>Est. Earnings</Text>
              </View>
              <View style={styles.weekStat}>
                <Text style={[styles.weekVal, { color: weekStats.pendingPay > 0 ? C.yellow : C.textMuted }]}>
                  {weekStats.pendingPay}
                </Text>
                <Text style={styles.weekLbl}>Payment Pending</Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Quick Nav */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>QUICK NAV</Text>
          <View style={styles.navList}>
            {[
              { label: 'Browse Open Shifts', icon: Search, color: C.accent, path: '/worker/browse' },
              { label: 'My Shifts & Applications', icon: Clock, color: C.blue, path: '/worker/my-shifts' },
              { label: 'My Earnings & Profile', icon: DollarSign, color: C.green, path: '/worker/profile' },
            ].map(({ label, icon: Icon, color, path }) => (
              <TouchableOpacity key={label} onPress={() => router.push(path as any)} style={styles.navItem}>
                <View style={[styles.navIcon, { backgroundColor: color + '20' }]}>
                  <Icon size={18} color={color} />
                </View>
                <Text style={styles.navLabel}>{label}</Text>
                <ChevronRight size={16} color={C.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

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
  banner: { borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1 },
  bannerActive: { backgroundColor: C.accent + '15', borderColor: C.accent + '50', flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerScheduled: { backgroundColor: C.blueDim, borderColor: C.blue + '50' },
  bannerLabel: { fontSize: 10, fontWeight: '800' as const, color: C.accent, letterSpacing: 1.5, marginBottom: 6 },
  bannerPill: {
    alignSelf: 'flex-start',
    backgroundColor: C.blue + '30',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  bannerPillText: { fontSize: 10, fontWeight: '800' as const, color: C.blue, letterSpacing: 1.5 },
  bannerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, marginBottom: 2 },
  bannerEmp: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginBottom: 8 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  bannerMeta: { fontSize: 12, color: C.textSecondary },
  bannerBtns: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  dirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.blue + '25',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dirBtnText: { fontSize: 13, color: C.blue, fontWeight: '600' as const },
  noShift: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  noShiftTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  noShiftSub: { fontSize: 13, color: C.textSecondary, marginBottom: 6 },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700' as const, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipYellow: { backgroundColor: C.yellowDim, borderColor: C.yellow + '40' },
  chipBlue: { backgroundColor: C.blueDim, borderColor: C.blue + '40' },
  chipRed: { backgroundColor: C.redDim, borderColor: C.red + '40' },
  chipText: { fontSize: 13, fontWeight: '600' as const },
  weekRow: { flexDirection: 'row' },
  weekStat: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 4 },
  weekMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  weekVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  weekLbl: { fontSize: 11, color: C.textSecondary, textAlign: 'center' as const },
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
});
