import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Award, Building2, ClipboardCheck, Database, LogOut, ShieldCheck,
  Users, FileText, Clock, ChevronRight, Bell, AlertCircle,
} from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export default function SuperAdminOverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const dashboardQuery = trpc.admin.dashboard.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Unread notifications
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
    staleTime: 30_000,
  });
  const unreadCount = notifCountQ.data ?? 0;

  // Pending time entries (hours awaiting admin/employer confirmation)
  const pendingHoursQ = useQuery({
    queryKey: ['admin-pending-hours'],
    queryFn: async (): Promise<number> => {
      const { count } = await supabase
        .from('time_entries')
        .select('*', { count: 'exact', head: true })
        .not('end_timestamp', 'is', null)
        .is('employer_confirmed_hours', null);
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  // Active shifts right now
  const activeShiftsQ = useQuery({
    queryKey: ['admin-active-shifts'],
    queryFn: async (): Promise<number> => {
      const { count } = await supabase
        .from('shift_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'InProgress');
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  // Refetch every time the super admin returns to this screen so newly-created
  // companies show up immediately in the approval queue.
  // IMPORTANT: depend ONLY on the stable `refetch` fns. The query objects are a
  // fresh reference every render, so depending on them re-fires this focus
  // effect on every render → infinite refetch loop that pins the JS thread and
  // freezes every tap on the screen.
  const refetchDashboard = dashboardQuery.refetch;
  const refetchPendingHours = pendingHoursQ.refetch;
  const refetchActiveShifts = activeShiftsQ.refetch;
  const refetchNotifCount = notifCountQ.refetch;

  useFocusEffect(useCallback(() => {
    void refetchDashboard();
    void refetchPendingHours();
    void refetchActiveShifts();
    void refetchNotifCount();
  }, [refetchDashboard, refetchPendingHours, refetchActiveShifts, refetchNotifCount]));

  if (dashboardQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading control tower" />
      </View>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback
          state="error"
          title="Unable to load super admin overview"
          onRetry={() => void dashboardQuery.refetch()}
        />
      </View>
    );
  }

  const data = dashboardQuery.data;
  const pendingCertCount    = data?.pendingCertCount    ?? 0;
  const pendingCompanyCount = data?.pendingCompanyCount ?? 0;
  const pendingListingCount = data?.pendingListingCount ?? 0;
  const openDisputeCount    = data?.openDisputeCount    ?? 0;
  const totalPending = pendingCertCount + pendingCompanyCount + pendingListingCount + openDisputeCount;
  const pendingHours = pendingHoursQ.data ?? 0;
  const activeShifts = activeShiftsQ.data ?? 0;

  // ── Single top priority action ────────────────────────────────────────────
  const topAction = (() => {
    if (openDisputeCount > 0) {
      return {
        type: 'error' as const,
        title: `${openDisputeCount} open dispute${openDisputeCount > 1 ? 's' : ''}`,
        body: 'Workers or companies are waiting for resolution.',
        action: 'Resolve',
        route: '/super-admin/compliance',
      };
    }
    if (pendingCertCount > 0) {
      return {
        type: 'warning' as const,
        title: `${pendingCertCount} worker document${pendingCertCount > 1 ? 's' : ''} pending`,
        body: 'Workers cannot pick up shifts until their IDs and certificates are reviewed.',
        action: 'Review',
        route: '/super-admin/certifications',
      };
    }
    if (pendingCompanyCount > 0) {
      return {
        type: 'warning' as const,
        title: `${pendingCompanyCount} compan${pendingCompanyCount > 1 ? 'ies' : 'y'} awaiting approval`,
        body: 'Employers cannot post live shifts until their company is approved.',
        action: 'Review',
        route: '/super-admin/companies',
      };
    }
    return null;
  })();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashboardQuery.isFetching}
            onRefresh={() => void dashboardQuery.refetch()}
            tintColor={C.accent}
          />
        }
      >
          {/* ── Header ── */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeRow}>
                <ShieldCheck size={14} color={C.red} />
                <Text style={styles.badgeText}>Super Admin</Text>
              </View>
              <Text style={styles.title}>Control Tower</Text>
              {user?.name ? <Text style={styles.userName}>{user.name}</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={() => router.push('/notifications' as never)}
                style={styles.logoutBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
              >
                <Bell size={18} color={C.text} />
                {unreadCount > 0 && (
                  <View style={styles.notifBadge}>
                    <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void logout()}
                style={styles.logoutBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <LogOut size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Top Priority Action Banner ── */}
          {topAction && (
            <TouchableOpacity
              onPress={() => router.push(topAction.route as never)}
              style={[
                styles.topActionBanner,
                {
                  backgroundColor: topAction.type === 'error' ? C.redDim : C.yellowDim,
                  borderColor: (topAction.type === 'error' ? C.red : C.yellow) + '50',
                },
              ]}
              activeOpacity={0.85}
            >
              <AlertCircle size={18} color={topAction.type === 'error' ? C.red : C.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.topActionTitle, { color: topAction.type === 'error' ? C.red : C.yellow }]}>
                  {topAction.title}
                </Text>
                <Text style={[styles.topActionBody, { color: (topAction.type === 'error' ? C.red : C.yellow) + 'CC' }]}>
                  {topAction.body}
                </Text>
              </View>
              <View style={[styles.topActionBtn, { backgroundColor: (topAction.type === 'error' ? C.red : C.yellow) + '25' }]}>
                <Text style={[styles.topActionBtnText, { color: topAction.type === 'error' ? C.red : C.yellow }]}>
                  {topAction.action} →
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* ── Platform Stats ── */}
          <View style={styles.statsRow}>
            {([
              ['Workers', (data?.users ?? []).length],
              ['Companies', (data?.companies ?? []).length],
              ['Active', activeShifts],
            ] as [string, number][]).map(([label, value]) => (
              <View key={label} style={styles.statCard}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {/* ── Attention Banner (only if no top action shown) ── */}
          {!topAction && totalPending > 0 && (
            <View style={styles.attentionBanner}>
              <ShieldCheck size={14} color={C.red} />
              <Text style={styles.attentionText}>
                {totalPending} item{totalPending !== 1 ? 's' : ''} need your attention
              </Text>
            </View>
          )}
          {!topAction && totalPending === 0 && (
            <View style={[styles.attentionBanner, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
              <ShieldCheck size={14} color={C.green} />
              <Text style={[styles.attentionText, { color: C.green }]}>
                All caught up — no pending approvals
              </Text>
            </View>
          )}

          {/* ── Work Queue ── */}
          <Text style={styles.sectionTitle}>Approval Queue</Text>
          <View style={styles.workQueueGrid}>
            <TouchableOpacity
              style={[styles.workQueueCard, pendingCertCount > 0 && styles.workQueueAlert]}
              onPress={() => router.push('/super-admin/certifications' as never)}
              activeOpacity={0.8}
            >
              <View style={[styles.workQueueIcon, { backgroundColor: pendingCertCount > 0 ? C.yellowDim : C.bgSecondary }]}>
                <Award size={18} color={pendingCertCount > 0 ? C.yellow : C.textMuted} />
              </View>
              <Text style={[styles.workQueueValue, pendingCertCount > 0 && { color: C.yellow }]}>
                {pendingCertCount}
              </Text>
              <Text style={styles.workQueueLabel}>Worker Docs</Text>
              {pendingCertCount > 0 && <Text style={styles.workQueueSub}>Tap to review →</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.workQueueCard, pendingCompanyCount > 0 && styles.workQueueAlert]}
              onPress={() => router.push('/super-admin/companies' as never)}
              activeOpacity={0.8}
            >
              <View style={[styles.workQueueIcon, { backgroundColor: pendingCompanyCount > 0 ? C.yellowDim : C.bgSecondary }]}>
                <Building2 size={18} color={pendingCompanyCount > 0 ? C.yellow : C.textMuted} />
              </View>
              <Text style={[styles.workQueueValue, pendingCompanyCount > 0 && { color: C.yellow }]}>
                {pendingCompanyCount}
              </Text>
              <Text style={styles.workQueueLabel}>Companies</Text>
              {pendingCompanyCount > 0 && <Text style={styles.workQueueSub}>Tap to review →</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.workQueueCard, pendingHours > 0 && { borderColor: C.blue + '50', backgroundColor: C.blueDim }]}
              onPress={() => router.push('/super-admin/users' as never)}
              activeOpacity={0.8}
            >
              <View style={[styles.workQueueIcon, { backgroundColor: pendingHours > 0 ? C.blueDim : C.bgSecondary }]}>
                <Clock size={18} color={pendingHours > 0 ? C.blue : C.textMuted} />
              </View>
              <Text style={[styles.workQueueValue, pendingHours > 0 && { color: C.blue }]}>
                {pendingHours}
              </Text>
              <Text style={styles.workQueueLabel}>Pending Hours</Text>
              {pendingHours > 0 && <Text style={[styles.workQueueSub, { color: C.blue }]}>Unconfirmed</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.workQueueCard, openDisputeCount > 0 && styles.workQueueDanger]}
              onPress={() => router.push('/super-admin/compliance' as never)}
              activeOpacity={0.8}
            >
              <View style={[styles.workQueueIcon, { backgroundColor: openDisputeCount > 0 ? C.redDim : C.bgSecondary }]}>
                <ShieldCheck size={18} color={openDisputeCount > 0 ? C.red : C.textMuted} />
              </View>
              <Text style={[styles.workQueueValue, openDisputeCount > 0 && { color: C.red }]}>
                {openDisputeCount}
              </Text>
              <Text style={styles.workQueueLabel}>Disputes</Text>
              {openDisputeCount > 0 && <Text style={[styles.workQueueSub, { color: C.red }]}>Open</Text>}
            </TouchableOpacity>
          </View>

          {/* ── Tools ── */}
          <Text style={styles.sectionTitle}>Tools</Text>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/users' as never)}
            style={styles.toolRow}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.greenDim }]}>
              <Users size={16} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>Users & Roles</Text>
              <Text style={styles.toolMeta}>Manage worker and employer accounts</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/certifications' as never)}
            style={styles.toolRow}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.yellowDim }]}>
              <Award size={16} color={C.yellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>
                Worker Documents
                {pendingCertCount > 0 ? ` · ${pendingCertCount} pending` : ''}
              </Text>
              <Text style={styles.toolMeta}>Approve/reject IDs and certifications</Text>
            </View>
            {pendingCertCount > 0 ? (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentBadgeText}>{pendingCertCount}</Text>
              </View>
            ) : <ChevronRight size={16} color={C.textMuted} />}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/companies' as never)}
            style={styles.toolRow}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.blueDim }]}>
              <Building2 size={16} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>
                Companies
                {pendingCompanyCount > 0 ? ` · ${pendingCompanyCount} pending` : ''}
              </Text>
              <Text style={styles.toolMeta}>Approve/suspend employer and worker companies</Text>
            </View>
            {pendingCompanyCount > 0 ? (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentBadgeText}>{pendingCompanyCount}</Text>
              </View>
            ) : <ChevronRight size={16} color={C.textMuted} />}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/compliance' as never)}
            style={styles.toolRow}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.accentDim }]}>
              <ClipboardCheck size={16} color={C.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>Compliance Queue</Text>
              <Text style={styles.toolMeta}>Listings, disputes, audit trail</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/analytics' as never)}
            style={styles.toolRow}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.card }]}>
              <FileText size={16} color={C.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>Analytics & Audit Logs</Text>
              <Text style={styles.toolMeta}>Platform activity and admin action history</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/super-admin/data-manager' as never)}
            style={[styles.toolRow, { marginBottom: 20 }]}
            activeOpacity={0.8}
          >
            <View style={[styles.toolIcon, { backgroundColor: C.redDim }]}>
              <Database size={16} color={C.red} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>Data Manager</Text>
              <Text style={styles.toolMeta}>Cross-tenant entity controls — use carefully</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          {/* ── Recent Companies ── */}
          <Text style={styles.sectionTitle}>Recent Companies</Text>
          {(data?.companies ?? []).slice(0, 5).map((company: any) => (
            <Card key={String(company.id)} style={styles.itemCard}>
              <View style={[styles.itemIcon, { backgroundColor: C.blueDim }]}>
                <Building2 size={14} color={C.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{String(company.name)}</Text>
                <Text style={styles.itemMeta}>{String(company.type)} · {String(company.city ?? '—')}</Text>
              </View>
              <StatusBadge status={String(company.status)} />
            </Card>
          ))}

          {/* ── Recent Users ── */}
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Recent Users</Text>
          {(data?.users ?? []).slice(0, 5).map((entry: any) => (
            <Card key={String(entry.id)} style={styles.itemCard}>
              <View style={[styles.itemIcon, { backgroundColor: C.greenDim }]}>
                <Users size={14} color={C.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{String(entry.name)}</Text>
                <Text style={styles.itemMeta}>{String(entry.email)}</Text>
              </View>
              <StatusBadge status={String(entry.status)} />
            </Card>
          ))}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.redDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.red },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, marginTop: 8 },
  userName: { fontSize: 12, color: C.textMuted, marginTop: 4 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 3 },

  attentionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.red + '40' },
  topActionBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  topActionTitle: { fontSize: 14, fontWeight: '800' as const },
  topActionBody: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  topActionBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  topActionBtnText: { fontSize: 12, fontWeight: '700' as const },
  notifBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: C.red, borderRadius: 10, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notifBadgeText: { fontSize: 10, fontWeight: '800' as const, color: C.white },
  attentionText: { fontSize: 13, fontWeight: '700' as const, color: C.red },

  sectionTitle: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 4, marginBottom: 4 },

  workQueueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  workQueueCard: { width: '47%', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  workQueueAlert: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim + '80' },
  workQueueDanger: { borderColor: C.red + '60', backgroundColor: C.redDim },
  workQueueIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  workQueueValue: { fontSize: 28, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  workQueueLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  workQueueSub: { fontSize: 11, color: C.yellow },

  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 8 },
  toolIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  toolMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  urgentBadge: { backgroundColor: C.yellow, borderRadius: 12, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  urgentBadgeText: { fontSize: 12, fontWeight: '800' as const, color: C.bg },

  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
